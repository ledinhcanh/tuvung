/**
 * VocabMaster - Ứng dụng học từ vựng thông minh
 * Phiên bản nâng cấp với: Học theo chủ đề, Xem lại từ hôm nay, Nhắc nhở học tập
 * 
 * Cấu trúc:
 *  - VocabApp: Class chính quản lý toàn bộ ứng dụng
 *  - Modules: topics, flashcard, today, quiz, reminder, ui
 */

class VocabApp {
    constructor() {
        // Dữ liệu từ vựng
        this.words = [];
        this.topics = {};          // Nhóm từ theo test_id (gộp nhiều part cùng chủ đề)
        this.topicMeta = {};       // Tên chủ đề lấy từ topic_mapping.json
        this.topicMapping = {};    // Mapping part_id -> { set_name, test_name, test_id, ... }

        // Trạng thái học tập - lưu trữ lâu dài qua localStorage
        this.learnedIds = this.loadStorage('vocab_learned_ids', []);
        this.todayData = this.loadTodayData();       // { date, learned:[{id,time,status}], sessions, duration }
        this.settings = this.loadStorage('vocab_settings', {
            dailyGoal: 20,
            enableDailyReminder: false,
            morningTime: '08:00',
            eveningTime: '20:00',
            studyDays: [1, 2, 3, 4, 5],
            enableReviewReminder: true,
            reviewInterval: 30
        });
        this.learningHistory = this.loadStorage('vocab_history', {}); // { 'YYYY-MM-DD': { count, duration } }
        this.streak = this.calcStreak();

        // Trạng thái UI (runtime)
        this.currentTab = 'dashboard';
        this.currentLearnPool = [];
        this.currentLearnIndex = 0;
        this.currentTopicId = null;
        this.topicLearnPool = [];
        this.topicLearnIndex = 0;
        this.filteredWords = [];
        this.sessionStartTime = Date.now();
        this.bankCurrentFilter = { topic: 'all', difficulty: 'all', status: 'all' };
        this.quizState = null;
        this.quizConfig = { count: 10, type: 'meaning' };
        this.reminderTimer = null;
        this.todayFilter = 'all';

        this.init();
    }

    // =====================================================================
    //  INITIALIZATION
    // =====================================================================
    async init() {
        lucide.createIcons();

        // Hiện loading state
        await this.loadData();

        // Khởi tạo các phần
        this.buildTopics();
        this.buildBottomNav();
        this.setupEventListeners();
        this.renderDashboard();
        this.updateGlobalStats();
        this.applySettings();
        this.scheduleReminders();
        this.updateTodayBadge();
        this.renderHistoryList();

        // Áp dụng theme đã lưu
        const theme = this.loadStorage('vocab_theme', 'light');
        if (theme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
            document.getElementById('theme-toggle-btn')?.querySelector('svg')?.setAttribute('data-icon', 'sun');
        }

        lucide.createIcons();
    }

    /**
     * Tải dữ liệu từ vựng và file mapping chủ đề
     */
    async loadData() {
        try {
            // Tải dữ liệu từ vựng chính
            const vocabRes = await fetch('tuvungnew.json');
            this.words = await vocabRes.json();
            this.filteredWords = [...this.words];
            console.log(`✅ Đã tải ${this.words.length} từ vựng.`);
        } catch (err) {
            console.error('❌ Không thể tải dữ liệu từ vựng:', err);
            this.showToast('Lỗi tải dữ liệu', 'Không thể tải tuvungnew.json', 'warning');
        }

        try {
            // Tải file mapping chủ đề: part_id -> { set_name, test_name, test_id }
            const mappingRes = await fetch('topic_mapping.json');
            const mappingData = await mappingRes.json();
            // Lưu mapping để buildTopics sử dụng
            this.topicMapping = mappingData.mapping || {};
            console.log(`✅ Đã tải mapping chủ đề: ${Object.keys(this.topicMapping).length} parts.`);
        } catch (err) {
            // Không bắt buộc - app vẫn chạy được với tên mặc định
            console.warn('⚠️ Không thể tải topic_mapping.json, dùng tên mặc định.', err);
            this.topicMapping = {};
        }
    }

    /**
     * Nhóm từ vựng theo chủ đề (test_id) dựa trên topic_mapping.json
     * Các part cùng test_id được gộp lại thành một chủ đề duy nhất
     */
    buildTopics() {
        // Bảng màu gradient và emoji theo bộ đề
        const setEmojis = {
            '600 TỪ VỰNG TOEIC': { emoji: '💼', base: '#6366f1' },
            'ETS 2026':          { emoji: '🔥', base: '#ef4444' },
            'ETS 2024':          { emoji: '⭐', base: '#f59e0b' },
            'ETS 2023':          { emoji: '📚', base: '#3b82f6' },
            'TOEIC MASTER':      { emoji: '🏆', base: '#10b981' },
        };

        // Bảng gradient phụ để phân biệt các test trong cùng bộ
        const gradientVariants = [
            '135deg', '120deg', '150deg', '160deg', '110deg',
            '145deg', '125deg', '155deg', '115deg', '140deg',
        ];

        this.topics = {};   // test_id -> [words]
        this.topicMeta = {};

        // Bộ đếm để tạo màu biến thể cho mỗi test trong cùng bộ
        const setCounter = {};

        // Gộp từ vựng theo test_id (thay vì part_id)
        this.words.forEach(word => {
            const pid = word.part_id;
            if (!pid) return;

            // Lấy thông tin chủ đề từ mapping
            const mapInfo = this.topicMapping[pid];
            // Dùng test_id làm key chủ đề; nếu không có mapping thì dùng part_id
            const groupKey = mapInfo ? mapInfo.test_id : pid;

            if (!this.topics[groupKey]) {
                this.topics[groupKey] = [];
            }
            this.topics[groupKey].push(word);

            // Lưu thông tin metadata nếu chưa có
            if (!this.topicMeta[groupKey] && mapInfo) {
                const setInfo = setEmojis[mapInfo.set_name] || { emoji: '🎯', base: '#a855f7' };
                const cnt = setCounter[mapInfo.set_name] || 0;
                setCounter[mapInfo.set_name] = cnt + 1;
                const deg = gradientVariants[cnt % gradientVariants.length];
                const baseColor = setInfo.base;

                // Lưu sortKey từ mapping để sắp xếp đúng thứ tự chude.json
                this.topicMeta[groupKey] = {
                    id: groupKey,
                    name: mapInfo.test_name,
                    setName: mapInfo.set_name,
                    emoji: setInfo.emoji,
                    gradient: `linear-gradient(${deg}, ${baseColor}, ${baseColor}cc)`,
                    sortKey: mapInfo.sort_key || 999999,  // sort_key từ topic_mapping.json
                    count: 0,   // cập nhật sau
                    words: []
                };
            }
        });

        // Cập nhật count và words cho topicMeta
        const palettes = [
            { gradient: 'linear-gradient(135deg,#6366f1,#8b5cf6)', emoji: '🎯' },
            { gradient: 'linear-gradient(135deg,#10b981,#34d399)', emoji: '🌿' },
            { gradient: 'linear-gradient(135deg,#f59e0b,#fbbf24)', emoji: '⭐' },
        ];
        Object.keys(this.topics).forEach((groupKey, idx) => {
            const words = this.topics[groupKey];
            if (this.topicMeta[groupKey]) {
                this.topicMeta[groupKey].count = words.length;
                this.topicMeta[groupKey].words = words;
            } else {
                // Fallback cho part_id không có trong mapping — hiển thị sau cùng
                const p = palettes[idx % palettes.length];
                this.topicMeta[groupKey] = {
                    id: groupKey,
                    name: `Chủ đề ?`,
                    setName: 'Khác',
                    emoji: p.emoji,
                    gradient: p.gradient,
                    sortKey: 999999 + idx,   // Hiển thị sau cùng
                    count: words.length,
                    words: words
                };
            }
        });

        // Sắp xếp topicMeta theo sort_key từ mapping (đúng thứ tự chude.json)
        this.topicMetaSorted = Object.values(this.topicMeta)
            .sort((a, b) => (a.sortKey || 999999) - (b.sortKey || 999999));

        // Cập nhật select filter topic ở Word Bank
        const select = document.getElementById('filter-topic');
        if (select) {
            // Xóa các option cũ (trừ option đầu "Tất cả")
            while (select.options.length > 1) select.remove(1);

            // Nhóm theo set_name, giữ nguyên thứ tự sort_key
            const bySet = {};
            const setOrder = [];
            this.topicMetaSorted.forEach(t => {
                const key = t.setName || 'Khác';
                if (!bySet[key]) {
                    bySet[key] = [];
                    setOrder.push(key);
                }
                bySet[key].push(t);
            });

            // Render optgroup theo đúng thứ tự bộ đề
            setOrder.forEach(setName => {
                const group = document.createElement('optgroup');
                group.label = setName;
                bySet[setName].forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.id;
                    opt.textContent = `${t.emoji} ${t.name} (${t.count})`;
                    group.appendChild(opt);
                });
                select.appendChild(group);
            });
        }
    }

    // =====================================================================
    //  LOCAL STORAGE HELPERS
    // =====================================================================
    loadStorage(key, defaultVal) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : defaultVal;
        } catch { return defaultVal; }
    }

    saveStorage(key, val) {
        try {
            localStorage.setItem(key, JSON.stringify(val));
        } catch (e) {
            console.warn('LocalStorage error:', e);
        }
    }

    /**
     * Tải dữ liệu học hôm nay - reset nếu đã qua ngày mới
     */
    loadTodayData() {
        const today = this.getTodayKey();
        const raw = this.loadStorage('vocab_today', null);

        if (!raw || raw.date !== today) {
            // Ngày mới - lưu lịch sử ngày hôm qua nếu có
            if (raw && raw.date) {
                const hist = this.loadStorage('vocab_history', {});
                hist[raw.date] = { count: raw.learned.length, duration: raw.duration || 0, sessions: raw.sessions || 0 };
                this.saveStorage('vocab_history', hist);
            }
            const freshData = { date: today, learned: [], sessions: 0, duration: 0 };
            this.saveStorage('vocab_today', freshData);
            return freshData;
        }
        return raw;
    }

    saveTodayData() {
        // Cập nhật thời gian học tích lũy
        this.todayData.duration = Math.round((Date.now() - this.sessionStartTime) / 60000) + (this.todayData.duration || 0);
        this.saveStorage('vocab_today', this.todayData);
    }

    getTodayKey() {
        return new Date().toISOString().split('T')[0];
    }

    // =====================================================================
    //  EVENT LISTENERS
    // =====================================================================
    setupEventListeners() {
        // ---- Tab Navigation (Desktop sidebar) ----
        document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
            item.addEventListener('click', e => {
                e.preventDefault();
                this.switchTab(item.getAttribute('data-tab'));
                // Đóng sidebar mobile nếu đang mở
                this.closeMobileSidebar();
            });
        });

        // ---- Mobile Menu Button ----
        document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
            this.toggleMobileSidebar();
        });

        // ---- Mobile Sidebar Overlay ----
        document.getElementById('sidebar-overlay')?.addEventListener('click', () => {
            this.closeMobileSidebar();
        });

        // ---- Sidebar Toggle (Desktop) ----
        document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('collapsed');
        });

        // ---- Search ----
        const searchInput = document.getElementById('global-search');
        searchInput?.addEventListener('input', e => {
            const q = e.target.value.trim();
            document.getElementById('search-clear').classList.toggle('hidden', !q);
            if (q.length > 0) {
                this.filterBank(q);
                if (this.currentTab !== 'bank') this.switchTab('bank');
            } else {
                this.filterBank('');
            }
        });
        document.getElementById('search-clear')?.addEventListener('click', () => {
            searchInput.value = '';
            document.getElementById('search-clear').classList.add('hidden');
            this.filterBank('');
        });

        // ---- Word Bank Filters ----
        document.getElementById('filter-topic')?.addEventListener('change', () => this.applyBankFilters());
        document.getElementById('filter-difficulty')?.addEventListener('change', () => this.applyBankFilters());
        document.getElementById('filter-status')?.addEventListener('change', () => this.applyBankFilters());
        document.getElementById('btn-reset-filter')?.addEventListener('click', () => this.resetBankFilters());

        // ---- Dashboard: Shuffle featured words ----
        document.getElementById('btn-shuffle-featured')?.addEventListener('click', () => this.renderDashboard());

        // ---- Main Learn Controls ----
        document.getElementById('btn-again')?.addEventListener('click', () => this.nextFlashcard(false));
        document.getElementById('btn-easy')?.addEventListener('click', () => this.nextFlashcard(true));

        // ---- Topic Learn Controls ----
        document.getElementById('topic-btn-again')?.addEventListener('click', () => this.nextTopicFlashcard(false));
        document.getElementById('topic-btn-easy')?.addEventListener('click', () => this.nextTopicFlashcard(true));

        // ---- Topic Sub-tabs ----
        document.querySelectorAll('.subtab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const sub = btn.getAttribute('data-subtab');
                document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('topic-flashcard-section').classList.toggle('hidden', sub !== 'flashcard');
                document.getElementById('topic-wordlist-section').classList.toggle('hidden', sub !== 'wordlist');
            });
        });

        // ---- Back button (topic detail) ----
        document.getElementById('btn-back-topics')?.addEventListener('click', () => this.switchTab('topics'));

        // ---- Modal close ----
        const modal = document.getElementById('word-modal');
        modal?.addEventListener('click', e => {
            if (e.target === modal) this.closeModal();
        });

        // ---- Today filters ----
        document.querySelectorAll('.today-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.today-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.todayFilter = btn.getAttribute('data-filter');
                this.renderTodayList();
            });
        });

        // ---- Reminder Bell ----
        document.getElementById('btn-reminder-bell')?.addEventListener('click', () => {
            this.switchTab('reminder');
            document.getElementById('bell-dot')?.classList.add('hidden');
        });

        // ---- Reminder Popup ----
        document.getElementById('reminder-close-btn')?.addEventListener('click', () => {
            document.getElementById('reminder-popup').classList.add('hidden');
        });
        document.getElementById('remind-later-btn')?.addEventListener('click', () => {
            document.getElementById('reminder-popup').classList.add('hidden');
            // Nhắc lại sau interval đã cài
            setTimeout(() => this.showReminderPopup(), this.settings.reviewInterval * 60 * 1000);
        });
        document.getElementById('remind-now-btn')?.addEventListener('click', () => {
            document.getElementById('reminder-popup').classList.add('hidden');
            this.switchTab('learn');
        });

        // ---- Theme Toggle ----
        document.getElementById('theme-toggle-btn')?.addEventListener('click', () => this.toggleTheme());

        // ---- Reminder Settings ----
        this.setupReminderSettingsListeners();

        // ---- Save Settings ----
        document.getElementById('btn-save-settings')?.addEventListener('click', () => this.saveUserSettings());

        // ---- Keyboard Shortcuts ----
        document.addEventListener('keydown', e => {
            // Không xử lý khi đang gõ vào input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // Đóng modal bằng Escape
            if (e.code === 'Escape') {
                const m = document.getElementById('word-modal');
                if (m && !m.classList.contains('hidden')) { this.closeModal(); return; }
                // Đóng sidebar mobile
                if (document.getElementById('sidebar')?.classList.contains('mobile-open')) {
                    this.closeMobileSidebar(); return;
                }
            }

            // Phím tắt học flashcard chính
            if (this.currentTab === 'learn' && this.currentLearnPool.length > 0) {
                this.handleFlashcardKey(e, 'main');
            }
            // Phím tắt học flashcard chủ đề
            if (this.currentTab === 'topic-detail' && this.topicLearnPool.length > 0) {
                this.handleFlashcardKey(e, 'topic');
            }

            // Phím tắt quiz
            if (this.currentTab === 'quiz' && this.quizState) {
                if (['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) {
                    const idx = parseInt(e.code.replace('Digit', '')) - 1;
                    const opts = document.querySelectorAll('.quiz-option');
                    if (opts[idx] && !opts[idx].disabled) opts[idx].click();
                }
            }
        });
    }

    handleFlashcardKey(e, mode) {
        const flashcard = document.querySelector('.flashcard');
        const word = mode === 'main'
            ? this.currentLearnPool[this.currentLearnIndex]
            : this.topicLearnPool[this.topicLearnIndex];
        if (!word) return;

        switch (e.code) {
            case 'Space':
                e.preventDefault();
                if (flashcard) {
                    flashcard.classList.toggle('is-flipped');
                    if (flashcard.classList.contains('is-flipped')) this.playAudio(word.audio_us);
                }
                break;
            case 'ArrowRight':
                if (mode === 'main') this.nextFlashcard(true);
                else this.nextTopicFlashcard(true);
                break;
            case 'ArrowLeft':
                if (mode === 'main') this.nextFlashcard(false);
                else this.nextTopicFlashcard(false);
                break;
            case 'KeyA': this.playAudio(word.audio_us); break;
            case 'KeyS': this.playAudio(word.audio_uk); break;
        }
    }

    setupReminderSettingsListeners() {
        // Toggle daily reminder
        document.getElementById('daily-reminder-toggle')?.addEventListener('change', e => {
            this.settings.enableDailyReminder = e.target.checked;
        });

        // Toggle review reminder
        document.getElementById('review-reminder-toggle')?.addEventListener('change', e => {
            this.settings.enableReviewReminder = e.target.checked;
            if (e.target.checked) this.scheduleReminders();
            else if (this.reminderTimer) clearInterval(this.reminderTimer);
        });

        // Goal options
        document.querySelectorAll('.goal-opt').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.goal-opt').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.settings.dailyGoal = parseInt(btn.getAttribute('data-goal'));
                document.getElementById('goal-custom').value = '';
                this.updateTodayProgress();
            });
        });

        // Goal custom
        document.getElementById('goal-custom')?.addEventListener('input', e => {
            const val = parseInt(e.target.value);
            if (val > 0) {
                this.settings.dailyGoal = val;
                document.querySelectorAll('.goal-opt').forEach(b => b.classList.remove('active'));
                this.updateTodayProgress();
            }
        });

        // Interval options
        document.querySelectorAll('.interval-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.interval-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.settings.reviewInterval = parseInt(btn.getAttribute('data-interval'));
                if (this.reminderTimer) clearInterval(this.reminderTimer);
                this.scheduleReminders();
            });
        });

        // Day picker
        document.querySelectorAll('.day-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.classList.toggle('active');
                const day = parseInt(btn.getAttribute('data-day'));
                if (btn.classList.contains('active')) {
                    if (!this.settings.studyDays.includes(day)) this.settings.studyDays.push(day);
                } else {
                    this.settings.studyDays = this.settings.studyDays.filter(d => d !== day);
                }
            });
        });
    }

    // =====================================================================
    //  BOTTOM NAV (Mobile)
    // =====================================================================
    buildBottomNav() {
        const tabs = [
            { id: 'dashboard', icon: 'layout-dashboard', label: 'Tổng quan' },
            { id: 'topics', icon: 'layers', label: 'Chủ đề' },
            { id: 'learn', icon: 'book-open', label: 'Học' },
            { id: 'today', icon: 'calendar-check', label: 'Hôm nay', badge: true },
            { id: 'bank', icon: 'database', label: 'Kho từ' },
        ];

        const nav = document.createElement('nav');
        nav.className = 'bottom-nav';
        nav.id = 'bottom-nav';

        nav.innerHTML = tabs.map(t => `
            <button class="bottom-nav-item ${t.id === 'dashboard' ? 'active' : ''}" data-tab="${t.id}">
                <i data-lucide="${t.icon}"></i>
                <span>${t.label}</span>
                ${t.badge ? `<span class="bottom-nav-badge hidden" id="bottom-badge-${t.id}"></span>` : ''}
            </button>
        `).join('');

        document.querySelector('.main-content')?.appendChild(nav);

        // Gắn sự kiện click cho bottom nav
        nav.querySelectorAll('.bottom-nav-item').forEach(item => {
            item.addEventListener('click', () => {
                this.switchTab(item.getAttribute('data-tab'));
            });
        });

        lucide.createIcons();
    }

    updateBottomNav(tabId) {
        document.querySelectorAll('.bottom-nav-item').forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-tab') === tabId);
        });
    }

    // =====================================================================
    //  TAB SWITCHING
    // =====================================================================
    switchTab(tabId) {
        this.currentTab = tabId;

        // Update sidebar nav
        document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-tab') === tabId);
        });

        // Update bottom nav (mobile)
        this.updateBottomNav(tabId);

        // Ẩn tất cả tabs
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));

        // Hiện tab được chọn
        const target = document.getElementById(`tab-${tabId}`);
        if (target) target.classList.remove('hidden');

        // Render tùy theo tab
        switch (tabId) {
            case 'dashboard': this.renderDashboard(); break;
            case 'today': this.renderTodayTab(); break;
            case 'topics': this.renderTopics(); break;
            case 'learn': this.startLearning(); break;
            case 'bank': this.renderWordBank(); break;
            case 'quiz': this.renderQuizStart(); break;
            case 'reminder': this.applySettingsToUI(); break;
        }

        lucide.createIcons();
    }

    // =====================================================================
    //  MOBILE SIDEBAR
    // =====================================================================
    toggleMobileSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        sidebar?.classList.toggle('mobile-open');
        overlay?.classList.toggle('hidden');
    }

    closeMobileSidebar() {
        document.getElementById('sidebar')?.classList.remove('mobile-open');
        document.getElementById('sidebar-overlay')?.classList.add('hidden');
    }

    // =====================================================================
    //  GLOBAL STATS & PROGRESS
    // =====================================================================
    updateGlobalStats() {
        const todayCount = this.todayData.learned.length;
        const totalLearned = this.learnedIds.length;
        const reviewCount = Math.max(0, this.settings.dailyGoal - todayCount);

        document.getElementById('stat-total').textContent = this.words.length.toLocaleString('vi-VN');
        document.getElementById('stat-today').textContent = todayCount.toLocaleString('vi-VN');
        document.getElementById('stat-review').textContent = reviewCount.toLocaleString('vi-VN');
        document.getElementById('stat-learned').textContent = totalLearned.toLocaleString('vi-VN');

        // Progress bar sidebar
        const progress = this.words.length > 0 ? Math.min(100, (totalLearned / this.words.length) * 100) : 0;
        document.getElementById('weekly-progress-bar')?.style.setProperty('width', `${progress}%`);
        document.getElementById('weekly-percent').textContent = `${Math.round(progress)}%`;

        // Streak
        document.getElementById('streak-count').textContent = this.streak;

        this.updateTodayProgress();
    }

    updateTodayProgress() {
        const todayCount = this.todayData.learned.length;
        const goal = this.settings.dailyGoal;
        const pct = Math.min(100, (todayCount / goal) * 100);

        document.getElementById('today-prog-bar').style.width = `${pct}%`;
        document.getElementById('today-prog-label').textContent = `${todayCount} / ${goal} từ đã học hôm nay`;
        document.getElementById('today-prog-percent').textContent = `${Math.round(pct)}%`;
        document.getElementById('daily-goal-text').textContent = goal;
    }

    updateTodayBadge() {
        const count = this.todayData.learned.length;
        const badgeEl = document.getElementById('today-nav-badge');
        if (badgeEl) {
            badgeEl.textContent = count;
            badgeEl.classList.toggle('hidden', count === 0);
        }
        const bottomBadge = document.getElementById('bottom-badge-today');
        if (bottomBadge) {
            bottomBadge.textContent = count;
            bottomBadge.classList.toggle('hidden', count === 0);
        }
    }

    // =====================================================================
    //  DASHBOARD
    // =====================================================================
    renderDashboard() {
        // Greeting dựa theo giờ
        const hour = new Date().getHours();
        let greet = hour < 12 ? 'Buổi sáng tốt lành! ☀️' : hour < 18 ? 'Buổi chiều tuyệt vời! 🌤️' : 'Buổi tối vui vẻ! 🌙';
        const remaining = Math.max(0, this.settings.dailyGoal - this.todayData.learned.length);
        document.getElementById('greeting-subtitle').textContent =
            remaining > 0
                ? `${greet} Bạn cần học thêm ${remaining} từ để đạt mục tiêu hôm nay.`
                : `${greet} Bạn đã hoàn thành mục tiêu hôm nay! 🎉`;

        // Quick topics (6 topics đầu)
        const topicKeys = Object.keys(this.topicMeta).slice(0, 6);
        document.getElementById('quick-topics-grid').innerHTML = topicKeys.map(pid => {
            const t = this.topicMeta[pid];
            const learned = t.words.filter(w => this.learnedIds.includes(w.id)).length;
            const pct = Math.round((learned / t.count) * 100);
            return `
                <div class="quick-topic-card" onclick="app.openTopicDetail('${pid}')">
                    <span class="qtc-icon">${t.emoji}</span>
                    <div class="qtc-name">${t.name}</div>
                    <div class="qtc-count">${t.count} từ • ${pct}%</div>
                    <div class="qtc-progress">
                        <div class="qtc-progress-bar" style="width:${pct}%"></div>
                    </div>
                </div>
            `;
        }).join('');

        // Gợi ý từ vựng ngẫu nhiên
        const random = [...this.words].sort(() => 0.5 - Math.random()).slice(0, 6);
        document.getElementById('featured-words').innerHTML =
            random.map(w => this.createWordCard(w)).join('');

        this.updateGlobalStats();
        lucide.createIcons();
    }

    // =====================================================================
    //  TODAY TAB
    // =====================================================================
    renderTodayTab() {
        // Hiển thị ngày hôm nay
        const now = new Date();
        const days = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
        document.getElementById('today-date-display').textContent =
            `${days[now.getDay()]}, ${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;

        const count = this.todayData.learned.length;
        document.getElementById('today-learned-count').textContent = count;
        document.getElementById('today-nav-badge').textContent = count;
        document.getElementById('today-nav-badge').classList.toggle('hidden', count === 0);

        // Mini stats
        const dur = this.todayData.duration || 0;
        document.getElementById('today-duration').textContent = dur < 1 ? '<1 phút' : `${dur} phút`;
        document.getElementById('today-sessions').textContent = this.todayData.sessions || 0;

        const learnedInDay = this.todayData.learned.filter(e => e.status === 'learned').length;
        const totalInDay = this.todayData.learned.length;
        document.getElementById('today-accuracy').textContent = totalInDay > 0
            ? `${Math.round((learnedInDay / totalInDay) * 100)}%`
            : '-';

        this.renderTodayList();
    }

    renderTodayList() {
        const container = document.getElementById('today-word-list');
        const empty = document.getElementById('today-empty');

        let items = [...this.todayData.learned];
        // Lọc theo filter
        if (this.todayFilter === 'learned') items = items.filter(e => e.status === 'learned');
        if (this.todayFilter === 'review') items = items.filter(e => e.status !== 'learned');

        if (items.length === 0) {
            container.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }

        empty.classList.add('hidden');
        container.innerHTML = items.map(entry => {
            const word = this.words.find(w => w.id === entry.id);
            if (!word) return '';
            const meaning = word.meanings[0]?.meaning || '---';
            const isLearned = entry.status === 'learned';
            const time = new Date(entry.time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

            return `
                <div class="today-word-item" onclick="app.showWordDetail('${word.id}')">
                    <div class="today-word-status ${isLearned ? 'learned' : 'review'}">
                        <i data-lucide="${isLearned ? 'check' : 'rotate-ccw'}"></i>
                    </div>
                    <div class="today-word-info">
                        <div class="today-word-name">${word.word}</div>
                        <div class="today-word-meaning">${meaning}</div>
                    </div>
                    <div class="today-word-time">${time}</div>
                </div>
            `;
        }).join('');

        lucide.createIcons();
    }

    // =====================================================================
    //  TOPICS TAB
    // =====================================================================
    renderTopics() {
        const grid = document.getElementById('topics-grid');
        if (!grid) return;

        // Dùng topicMetaSorted đã sắp xếp đúng thứ tự chude.json
        const topicsToRender = this.topicMetaSorted || Object.values(this.topicMeta);
        grid.innerHTML = topicsToRender.map(t => {
            const learned = t.words.filter(w => this.learnedIds.includes(w.id)).length;
            const pct = Math.round((learned / t.count) * 100);
            // Hiển thị tên bộ đề dưới tên chủ đề để người dùng biết nguồn gốc
            const setLabel = t.setName
                ? `<span class="topic-set-badge">${t.setName}</span>`
                : '';
            return `
                <div class="topic-card" onclick="app.openTopicDetail('${t.id}')">
                    <div class="topic-card-banner" style="background:${t.gradient}">
                        <span style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.2))">${t.emoji}</span>
                    </div>
                    <div class="topic-card-body">
                        ${setLabel}
                        <div class="topic-card-name">${t.name}</div>
                        <div class="topic-card-meta">${t.count} từ vựng • ${learned} đã học</div>
                        <div class="topic-card-progress">
                            <div class="topic-card-progress-bar" style="width:${pct}%"></div>
                        </div>
                        <div class="topic-progress-label">
                            <span>${learned}/${t.count}</span>
                            <span>${pct}%</span>
                        </div>
                    </div>
                    <div class="topic-card-action">
                        <button class="btn-topic-start">
                            <i data-lucide="play"></i>
                            Học ngay
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        lucide.createIcons();
    }

    /**
     * Mở tab học chi tiết theo chủ đề
     */
    openTopicDetail(topicId) {
        const t = this.topicMeta[topicId];
        if (!t) return;

        this.currentTopicId = topicId;

        // Cập nhật header
        document.getElementById('topic-detail-header').innerHTML = `
            <div class="topic-detail-name">${t.emoji} ${t.name}</div>
            <div class="topic-detail-meta">${t.count} từ vựng • ${t.words.filter(w => this.learnedIds.includes(w.id)).length} đã học</div>
        `;

        // Khởi tạo pool học (ưu tiên từ chưa học trong chủ đề này)
        const unlearned = t.words.filter(w => !this.learnedIds.includes(w.id));
        this.topicLearnPool = unlearned.length > 0 ? unlearned : [...t.words];
        this.topicLearnIndex = 0;

        // Render word list cho sub-tab
        document.getElementById('topic-word-grid').innerHTML =
            t.words.map(w => this.createWordCard(w)).join('');

        // Reset về sub-tab flashcard
        document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('subtab-flash').classList.add('active');
        document.getElementById('topic-flashcard-section').classList.remove('hidden');
        document.getElementById('topic-wordlist-section').classList.add('hidden');

        this.renderTopicFlashcard();
        this.switchTab('topic-detail');
    }

    // =====================================================================
    //  TOPIC FLASHCARD
    // =====================================================================
    renderTopicFlashcard() {
        const container = document.getElementById('topic-flashcard-container');
        const word = this.topicLearnPool[this.topicLearnIndex];

        if (!word) {
            const t = this.topicMeta[this.currentTopicId];
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon"><i data-lucide="party-popper"></i></div>
                    <h3 class="empty-text">Hoàn thành chủ đề!</h3>
                    <p class="empty-subtext">Bạn đã học xong tất cả từ trong ${t?.name || 'chủ đề này'}.</p>
                    <button class="btn-primary-action" onclick="app.switchTab('topics')">
                        <i data-lucide="arrow-left"></i> Chọn chủ đề khác
                    </button>
                </div>
            `;
            document.getElementById('topic-learn-controls').style.display = 'none';
            lucide.createIcons();
            return;
        }

        document.getElementById('topic-learn-controls').style.display = '';

        const count = this.topicLearnIndex + 1;
        const total = this.topicLearnPool.length;
        document.getElementById('topic-learn-counter').textContent = `${count}/${total}`;
        const pct = (count / total) * 100;
        document.getElementById('topic-progress-bar').style.width = `${pct}%`;

        container.innerHTML = this.buildFlashcardHTML(word);
        lucide.createIcons();

        if (word.audio_us) setTimeout(() => this.playAudio(word.audio_us), 300);
    }

    nextTopicFlashcard(isLearned) {
        const word = this.topicLearnPool[this.topicLearnIndex];
        if (!word) return;

        if (isLearned) {
            // Đã thuộc: đánh dấu học và tiến sang từ kế tiếp
            this.markWordLearned(word, true);
            this.topicLearnIndex++;
        } else {
            // Xem lại: đưa từ này vào cuối pool để ôn lại sau, không đánh dấu learned
            this.markWordLearned(word, false); // Ghi nhận trạng thái "cần ôn lại"
            this.topicLearnPool.push(word);    // Thêm vào cuối để xem lại
            this.topicLearnIndex++;            // Sang từ tiếp theo

            // Hiển thị thông báo nhỏ
            this.showToast('📌 Đã đánh dấu xem lại', `"${word.word}" sẽ xuất hiện lại ở cuối.`, 'info');
        }

        this.renderTopicFlashcard();
    }

    // =====================================================================
    //  MAIN FLASHCARD (tab Learn All)
    // =====================================================================
    startLearning() {
        this.todayData.sessions = (this.todayData.sessions || 0) + 1;
        this.sessionStartTime = Date.now();

        // Pool: ưu tiên từ chưa học, nếu hết thì lấy ngẫu nhiên
        const unlearned = this.words.filter(w => !this.learnedIds.includes(w.id));
        const goal = this.settings.dailyGoal;
        this.currentLearnPool = unlearned.length > 0
            ? unlearned.slice(0, goal)
            : [...this.words].sort(() => Math.random() - 0.5).slice(0, goal);
        this.currentLearnIndex = 0;
        this.renderFlashcard();
    }

    renderFlashcard() {
        const container = document.getElementById('flashcard-container');
        const word = this.currentLearnPool[this.currentLearnIndex];

        if (!word) {
            this.saveTodayData();
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon"><i data-lucide="party-popper"></i></div>
                    <h3 class="empty-text">Xuất sắc! 🎉</h3>
                    <p class="empty-subtext">Bạn đã hoàn thành ${this.settings.dailyGoal} từ hôm nay!</p>
                    <button class="btn-primary-action" onclick="app.switchTab('today')">
                        <i data-lucide="calendar-check"></i> Xem từ đã học hôm nay
                    </button>
                </div>
            `;
            document.getElementById('learn-controls').style.display = 'none';
            this.showToast('Hoàn thành! 🎉', `Bạn đã học ${this.settings.dailyGoal} từ hôm nay.`, 'success');
            lucide.createIcons();
            return;
        }

        document.getElementById('learn-controls').style.display = '';

        const count = this.currentLearnIndex + 1;
        const total = this.currentLearnPool.length;
        document.getElementById('learn-counter').textContent = `${count}/${total}`;
        document.getElementById('learn-progress-bar').style.width = `${(count / total) * 100}%`;

        container.innerHTML = this.buildFlashcardHTML(word);
        lucide.createIcons();

        if (word.audio_us) setTimeout(() => this.playAudio(word.audio_us), 300);
    }

    nextFlashcard(isLearned) {
        const word = this.currentLearnPool[this.currentLearnIndex];
        if (!word) return;

        if (isLearned) {
            // Đã thuộc: đánh dấu học và tiến sang từ kế tiếp
            this.markWordLearned(word, true);
            this.currentLearnIndex++;
        } else {
            // Xem lại: đưa từ này vào cuối pool để ôn lại sau, không đánh dấu learned
            this.markWordLearned(word, false); // Ghi nhận trạng thái "cần ôn lại"
            this.currentLearnPool.push(word);  // Thêm vào cuối để xem lại
            this.currentLearnIndex++;          // Sang từ tiếp theo

            // Hiển thị thông báo nhỏ
            this.showToast('📌 Đã đánh dấu xem lại', `"${word.word}" sẽ xuất hiện lại ở cuối.`, 'info');
        }

        this.renderFlashcard();
    }

    /**
     * Template HTML của flashcard (dùng chung cho cả 2 mode)
     */
    buildFlashcardHTML(word) {
        const m = word.meanings[0] || {};
        const exEn = m.example ? m.example.replace(/\s*\(.*?\)\s*$/, '').trim() : 'Chưa có ví dụ.';
        const exVi = m.example ? (m.example.match(/\(([^)]+)\)/)?.[1] || '') : '';

        return `
            <div class="flashcard" onclick="this.classList.toggle('is-flipped'); if(this.classList.contains('is-flipped')) app.playAudio('${word.audio_us}')">
                <div class="flashcard-inner">
                    <div class="flashcard-front">
                        <span class="card-badge">Từ vựng</span>
                        <div class="tag-pos">${m.pos || 'n/a'}</div>
                        <h2 class="word-main font-outfit">${word.word}</h2>
                        <div class="ipa-text">${word.ipa || '---'}</div>
                        <div class="audio-group">
                            <button class="audio-action us" onclick="event.stopPropagation(); app.playAudio('${word.audio_us}')">
                                <i data-lucide="volume-2"></i> <span>US</span>
                            </button>
                            <button class="audio-action uk" onclick="event.stopPropagation(); app.playAudio('${word.audio_uk}')">
                                <i data-lucide="volume-2"></i> <span>UK</span>
                            </button>
                        </div>
                        <p style="position:absolute;bottom:1.5rem;font-size:0.7rem;color:var(--text-muted);font-weight:600">
                            Nhấn thẻ hoặc Space để lật
                        </p>
                    </div>
                    <div class="flashcard-back">
                        <span class="card-badge">Định nghĩa</span>
                        <h3 class="meaning-text">${m.meaning || '---'}</h3>
                        <div class="example-box-premium">
                            <div class="ex-en">"${exEn}"</div>
                            ${exVi ? `<div class="ex-vi">${exVi}</div>` : ''}
                        </div>
                        ${word.image_url ? `<img src="${word.image_url}" class="card-img-premium" alt="${word.word}">` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    // =====================================================================
    //  MARK WORD LEARNED
    // =====================================================================
    markWordLearned(word, isLearned) {
        // Thêm vào danh sách đã học (không trùng lặp)
        if (!this.learnedIds.includes(word.id)) {
            this.learnedIds.push(word.id);
            this.saveStorage('vocab_learned_ids', this.learnedIds);
        }

        // Ghi nhận vào danh sách học hôm nay
        const existing = this.todayData.learned.find(e => e.id === word.id);
        const entry = { id: word.id, time: Date.now(), status: isLearned ? 'learned' : 'review' };
        if (!existing) {
            this.todayData.learned.push(entry);
        } else {
            existing.status = isLearned ? 'learned' : 'review';
            existing.time = Date.now();
        }

        this.saveTodayData();
        this.updateGlobalStats();
        this.updateTodayBadge();
    }

    // =====================================================================
    //  WORD BANK
    // =====================================================================
    renderWordBank() {
        this.applyBankFilters();
    }

    applyBankFilters() {
        const topic = document.getElementById('filter-topic')?.value || 'all';
        const diff = document.getElementById('filter-difficulty')?.value || 'all';
        const status = document.getElementById('filter-status')?.value || 'all';
        const query = document.getElementById('global-search')?.value?.toLowerCase() || '';

        this.filteredWords = this.words.filter(w => {
            // Filter theo chủ đề
            const matchTopic = topic === 'all' || w.part_id === topic;
            // Filter theo độ khó
            const matchDiff = diff === 'all' || w.difficulty_level?.toString() === diff;
            // Filter theo trạng thái học
            const matchStatus = status === 'all'
                || (status === 'learned' && this.learnedIds.includes(w.id))
                || (status === 'new' && !this.learnedIds.includes(w.id));
            // Filter theo search query
            const matchQuery = !query
                || w.word.toLowerCase().includes(query)
                || (w.meanings[0]?.meaning || '').toLowerCase().includes(query);

            return matchTopic && matchDiff && matchStatus && matchQuery;
        });

        const grid = document.getElementById('word-list-grid');
        if (grid) {
            grid.innerHTML = this.filteredWords.slice(0, 500).map(w => this.createWordCard(w)).join('');
            document.getElementById('bank-count-label').textContent =
                `Đang hiển thị ${Math.min(this.filteredWords.length, 500)} / ${this.filteredWords.length} từ`;
            lucide.createIcons();
        }
    }

    filterBank(query) {
        document.getElementById('global-search').value = query;
        this.applyBankFilters();
    }

    resetBankFilters() {
        document.getElementById('filter-topic').value = 'all';
        document.getElementById('filter-difficulty').value = 'all';
        document.getElementById('filter-status').value = 'all';
        document.getElementById('global-search').value = '';
        document.getElementById('search-clear').classList.add('hidden');
        this.applyBankFilters();
    }

    /**
     * Tạo HTML card từ vựng hàng ngang
     */
    createWordCard(word) {
        const meaning = word.meanings[0]?.meaning || '---';
        const pos = word.meanings[0]?.pos || '';
        const isLearned = this.learnedIds.includes(word.id);

        return `
            <div class="word-bank-card" onclick="app.showWordDetail('${word.id}')">
                <div class="card-icon-preview">${word.word.charAt(0).toUpperCase()}</div>
                <div class="card-info">
                    <div class="word-title">
                        ${word.word}
                        <span style="font-size:0.7rem;font-weight:800;padding:2px 8px;background:rgba(99,102,241,0.1);color:var(--primary);border-radius:6px;margin-left:6px;text-transform:uppercase">${pos}</span>
                    </div>
                    <div class="word-meaning-preview">${meaning}</div>
                </div>
                ${isLearned ? '<div class="card-learned-badge"><i data-lucide="check"></i></div>' : ''}
            </div>
        `;
    }

    // =====================================================================
    //  WORD DETAIL MODAL
    // =====================================================================
    showWordDetail(id) {
        const word = this.words.find(w => w.id === id);
        if (!word) return;

        const m = word.meanings[0] || {};
        const exEn = m.example ? m.example.replace(/\s*\(.*?\)\s*$/, '').trim() : '';
        const exVi = m.example ? (m.example.match(/\(([^)]+)\)/)?.[1] || '') : '';
        const isLearned = this.learnedIds.includes(word.id);

        const modal = document.getElementById('word-modal');
        modal.querySelector('.modal-content').innerHTML = `
            <div class="detail-card custom-scrollbar">
                <button onclick="app.closeModal()" class="close-modal"><i data-lucide="x"></i></button>

                <div class="modal-word-header">
                    <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
                        <h2 class="modal-word-title font-outfit">${word.word}</h2>
                        <span style="padding:4px 14px;background:rgba(99,102,241,0.1);color:var(--primary);border-radius:10px;font-size:0.8rem;font-weight:800;text-transform:uppercase">${m.pos || ''}</span>
                        ${isLearned ? '<span style="padding:4px 12px;background:#dcfce7;color:#16a34a;border-radius:10px;font-size:0.8rem;font-weight:800">✓ Đã học</span>' : ''}
                    </div>
                    <div class="modal-word-ipa">${word.ipa || ''}</div>
                </div>

                <div class="modal-section">
                    <span class="section-label">Định nghĩa & Nghĩa</span>
                    <div class="modal-meaning">${m.meaning || '---'}</div>
                    ${exEn ? `
                    <div class="modal-example">
                        <div class="modal-example-en">"${exEn}"</div>
                        ${exVi ? `<div class="modal-example-vi">${exVi}</div>` : ''}
                    </div>` : ''}
                </div>

                <div class="modal-section">
                    <span class="section-label">Phát âm (Native Voices)</span>
                    <div class="modal-audio-group">
                        <button class="audio-action-btn us" onclick="app.playAudio('${word.audio_us}')">
                            <i data-lucide="play-circle"></i> <span>US Voice</span>
                        </button>
                        <button class="audio-action-btn uk" onclick="app.playAudio('${word.audio_uk}')">
                            <i data-lucide="play-circle"></i> <span>UK Voice</span>
                        </button>
                    </div>
                </div>

                ${word.image_url ? `
                <div class="modal-section modal-image">
                    <span class="section-label">Hình ảnh minh họa</span>
                    <img src="${word.image_url}" alt="${word.word}" loading="lazy">
                </div>` : ''}

                <div style="margin-top:1.5rem;display:flex;gap:0.75rem">
                    ${!isLearned
                ? `<button onclick="app.markFromModal('${word.id}',true)" style="flex:1;padding:0.875rem;background:var(--primary-gradient);color:white;border-radius:var(--r-full);font-weight:800;font-size:0.9rem;box-shadow:var(--shadow-primary);transition:var(--transition)">
                            ✓ Đánh dấu đã học
                           </button>`
                : `<button onclick="app.unmarkLearned('${word.id}')" style="flex:1;padding:0.875rem;background:var(--bg-app);color:var(--text-secondary);border:1.5px solid var(--border);border-radius:var(--r-full);font-weight:700;font-size:0.9rem;transition:var(--transition)">
                            Đặt lại chưa học
                           </button>`
            }
                </div>
            </div>
        `;

        modal.classList.remove('hidden');
        lucide.createIcons();
    }

    markFromModal(id, isLearned) {
        const word = this.words.find(w => w.id === id);
        if (word) {
            this.markWordLearned(word, isLearned);
            this.showWordDetail(id); // Refresh modal
            this.showToast('Đã cập nhật', `"${word.word}" đã được đánh dấu đã học.`, 'success');
        }
    }

    unmarkLearned(id) {
        this.learnedIds = this.learnedIds.filter(lid => lid !== id);
        this.saveStorage('vocab_learned_ids', this.learnedIds);
        this.todayData.learned = this.todayData.learned.filter(e => e.id !== id);
        this.saveTodayData();
        this.updateGlobalStats();
        this.updateTodayBadge();
        const word = this.words.find(w => w.id === id);
        if (word) {
            this.showWordDetail(id);
            this.showToast('Đã cập nhật', `"${word.word}" đã được đặt lại chưa học.`, 'info');
        }
    }

    closeModal() {
        document.getElementById('word-modal').classList.add('hidden');
    }

    // =====================================================================
    //  QUIZ TAB
    // =====================================================================
    renderQuizStart() {
        const learnedWords = this.words.filter(w => this.learnedIds.includes(w.id));
        const hasEnough = learnedWords.length >= 4;

        document.getElementById('quiz-content').innerHTML = `
            <div class="quiz-start-screen">
                <div class="quiz-icon">🧠</div>
                <h2 class="quiz-title font-outfit">Luyện tập từ vựng</h2>
                <p class="quiz-desc">Chọn hình thức phù hợp để luyện tập hiệu quả nhất</p>
                ${!hasEnough
                ? `<p style="color:#f59e0b;font-weight:700;margin-bottom:1.5rem">⚠️ Bạn cần học ít nhất 4 từ trước khi luyện tập.</p>
                       <button class="btn-start-quiz" onclick="app.switchTab('learn')">Bắt đầu học ngay</button>`
                : `
                    <div id="quiz-count-section" style="margin-bottom:1.5rem">
                        <p style="font-weight:700;color:var(--text-secondary);margin-bottom:0.75rem">Số câu hỏi:</p>
                        <div class="quiz-config">
                            <button class="quiz-config-btn" data-quiz-count="5">5 câu</button>
                            <button class="quiz-config-btn active" data-quiz-count="10">10 câu</button>
                            <button class="quiz-config-btn" data-quiz-count="20">20 câu</button>
                        </div>
                    </div>
                    <div style="margin-bottom:2rem">
                        <p style="font-weight:700;color:var(--text-secondary);margin-bottom:0.75rem">Hình thức luyện tập:</p>
                        <div class="quiz-type-cards">
                            <button class="quiz-type-card active" data-quiz-type="meaning">
                                <div class="quiz-type-icon">🔤→📖</div>
                                <div class="quiz-type-label">Từ → Nghĩa</div>
                                <div class="quiz-type-desc">Nhìn từ, chọn nghĩa đúng</div>
                            </button>
                            <button class="quiz-type-card" data-quiz-type="word">
                                <div class="quiz-type-icon">📖→🔤</div>
                                <div class="quiz-type-label">Nghĩa → Từ</div>
                                <div class="quiz-type-desc">Nhìn nghĩa, chọn từ đúng</div>
                            </button>
                            <button class="quiz-type-card" data-quiz-type="typing">
                                <div class="quiz-type-icon">⌨️</div>
                                <div class="quiz-type-label">Điền từ</div>
                                <div class="quiz-type-desc">Gõ từ tiếng Anh chính xác</div>
                            </button>
                            <button class="quiz-type-card" data-quiz-type="matching">
                                <div class="quiz-type-icon">🔗</div>
                                <div class="quiz-type-label">Ghép cặp</div>
                                <div class="quiz-type-desc">Nối từ với nghĩa tương ứng</div>
                            </button>
                        </div>
                    </div>
                    <button class="btn-start-quiz" onclick="app.startQuiz()">
                        <i data-lucide="play"></i> Bắt đầu luyện tập
                    </button>
                    `
            }
            </div>
        `;

        // Gắn sự kiện số câu
        document.querySelectorAll('[data-quiz-count]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-quiz-count]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.quizConfig.count = parseInt(btn.getAttribute('data-quiz-count'));
            });
        });

        // Gắn sự kiện loại quiz: ẩn số câu khi chọn matching
        document.querySelectorAll('[data-quiz-type]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-quiz-type]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.quizConfig.type = btn.getAttribute('data-quiz-type');
                const sec = document.getElementById('quiz-count-section');
                if (sec) sec.style.display = this.quizConfig.type === 'matching' ? 'none' : '';
            });
        });

        lucide.createIcons();
    }

    startQuiz() {
        const learnedWords = this.words.filter(w => this.learnedIds.includes(w.id));

        // Chế độ ghép cặp - render riêng, không cần pool trắc nghiệm
        if (this.quizConfig.type === 'matching') {
            this.renderMatchingGame();
            return;
        }

        const pool = [...learnedWords].sort(() => Math.random() - 0.5).slice(0, this.quizConfig.count);
        this.quizState = {
            pool: pool,
            current: 0,
            score: 0,
            type: this.quizConfig.type,
            wrongList: [] // Lưu từ trả lời sai để hiển thị kết quả
        };

        this.renderQuizQuestion();
    }

    renderQuizQuestion() {
        const { pool, current, score, type } = this.quizState;
        const container = document.getElementById('quiz-content');

        if (current >= pool.length) {
            this.renderQuizResult();
            return;
        }

        const word = pool[current];
        const m = word.meanings[0] || {};
        const pct = Math.round((current / pool.length) * 100);
        const audioUrl = word.audio_us || word.audio_uk;

        // Header tiến trình - dùng chung cho tất cả loại
        const progressHTML = `
            <div class="quiz-progress">
                <div style="display:flex;justify-content:space-between;margin-bottom:0.75rem">
                    <span style="font-size:0.8rem;font-weight:700;color:var(--text-muted)">Câu ${current + 1}/${pool.length}</span>
                    <span style="font-size:0.8rem;font-weight:700;color:var(--primary)">${score} điểm</span>
                </div>
                <div class="modern-progress"><div class="modern-progress-bar" style="width:${pct}%"></div></div>
            </div>`;

        // --- Chế độ Điền từ (Typing) ---
        if (type === 'typing') {
            const exEn = m.example ? m.example.replace(/\s*\(.*?\)\s*$/, '').trim() : '';
            // Câu ví dụ với từ bị ẩn bằng "_____"
            const exampleHint = exEn
                ? exEn.replace(new RegExp(word.word, 'i'), '<strong style="color:var(--primary)">_____</strong>')
                : '';

            // Ô chữ: hiển thị số ký tự dạng _ _ _ _ _
            const letterBoxes = word.word.split('').map((ch, i) =>
                ch === ' '
                    ? `<span class="letter-box space"></span>`
                    : `<span class="letter-box" id="lb-${i}">_</span>`
            ).join('');

            // Mức gợi ý hiện tại (số chữ cái đã lộ)
            const hintLevel = this.quizState.hintLevel || 0;

            container.innerHTML = `
                <div style="max-width:680px;margin:0 auto">
                    ${progressHTML}
                    <div class="quiz-question-card">
                        <div style="font-size:0.8rem;font-weight:700;color:var(--text-muted);margin-bottom:0.5rem;text-transform:uppercase;letter-spacing:0.1em">Gõ từ tiếng Anh</div>
                        <div class="quiz-question-word font-outfit" style="font-size:1.9rem">${m.meaning || '---'}</div>

                        <!-- Gợi ý 1: loại từ + số ký tự + audio -->
                        <div class="typing-meta-row">
                            ${m.pos ? `<span class="typing-pos-badge">${m.pos}</span>` : ''}
                            <span class="typing-length-badge">${word.word.replace(/ /g, '').length} ký tự</span>
                            ${audioUrl ? `<button class="typing-audio-btn" onclick="app.playAudio('${audioUrl}')" title="Nghe phát âm">
                                <i data-lucide="volume-2"></i> Nghe
                            </button>` : ''}
                        </div>

                        <!-- Gợi ý 2: IPA -->
                        ${word.ipa ? `<div class="typing-ipa">🔊 ${word.ipa}</div>` : ''}

                        <!-- Gợi ý 3: ô chữ số ký tự (luôn hiện) -->
                        <div class="letter-boxes" id="letter-boxes">${letterBoxes}</div>

                        <!-- Gợi ý 4: câu ví dụ (hiện nếu đã dùng hint) -->
                        ${hintLevel >= 1 && exampleHint
                            ? `<div class="quiz-typing-hint">💡 ${exampleHint}</div>`
                            : ''}
                    </div>

                    <!-- Khu vực nhập -->
                    <div class="quiz-typing-area">
                        <input type="text" id="quiz-typing-input" class="quiz-typing-input"
                            placeholder="Nhập từ tiếng Anh..." autocomplete="off" autocapitalize="off" spellcheck="false">
                        <button class="btn-quiz-submit" onclick="app.submitTypingAnswer()">
                            <i data-lucide="send"></i> Kiểm tra
                        </button>
                    </div>

                    <!-- Nút gợi ý theo tầng -->
                    <div class="typing-hint-bar">
                        ${hintLevel === 0 && exampleHint
                            ? `<button class="btn-hint-reveal" onclick="app.revealTypingHint('example')">
                                💡 Xem câu ví dụ <span class="hint-cost">(-0 điểm thưởng)</span>
                               </button>`
                            : ''}
                        ${hintLevel <= 1
                            ? `<button class="btn-hint-reveal secondary" onclick="app.revealTypingHint('letter')">
                                🔤 Tiết lộ 1 chữ cái <span class="hint-cost">(-0 điểm thưởng)</span>
                               </button>`
                            : ''}
                    </div>
                </div>`;

            lucide.createIcons();

            // Áp dụng các chữ cái đã gợi ý (nếu đang ở mức hint > 1)
            if (hintLevel >= 2) this.applyLetterHints();

            const inp = document.getElementById('quiz-typing-input');
            inp?.focus();
            // Cập nhật ô chữ theo thời gian thực khi gõ
            inp?.addEventListener('input', () => app.syncLetterBoxes());
            inp?.addEventListener('keydown', e => { if (e.key === 'Enter') app.submitTypingAnswer(); });
            return;
        }


        // --- Chế độ trắc nghiệm (meaning / word) ---
        if (type === 'meaning') setTimeout(() => this.playAudio(audioUrl), 300);

        const wrongWords = this.words.filter(w => w.id !== word.id)
            .sort(() => Math.random() - 0.5).slice(0, 3);

        const options = type === 'meaning'
            ? [{ text: m.meaning || '---', correct: true },
               ...wrongWords.map(w => ({ text: w.meanings[0]?.meaning || '---', correct: false }))]
               .sort(() => Math.random() - 0.5)
            : [{ text: word.word, correct: true },
               ...wrongWords.map(w => ({ text: w.word, correct: false }))]
               .sort(() => Math.random() - 0.5);

        container.innerHTML = `
            <div style="max-width:680px;margin:0 auto">
                ${progressHTML}
                <div class="quiz-question-card">
                    ${type === 'meaning'
                    ? `<div style="font-size:0.8rem;font-weight:700;color:var(--text-muted);margin-bottom:0.5rem;text-transform:uppercase;letter-spacing:0.1em">Nghĩa của từ</div>
                       <div class="quiz-question-word font-outfit" style="display:flex;align-items:center;justify-content:center;gap:1.5rem">
                           ${word.word}
                           ${audioUrl ? `<button class="quiz-audio-btn" onclick="app.playAudio('${audioUrl}')" title="Nghe"><i data-lucide="volume-2"></i></button>` : ''}
                       </div>
                       <div class="quiz-question-hint">${word.ipa || ''} • ${m.pos || ''}</div>`
                    : `<div style="font-size:0.8rem;font-weight:700;color:var(--text-muted);margin-bottom:0.5rem;text-transform:uppercase;letter-spacing:0.1em">Từ tiếng Anh của</div>
                       <div class="quiz-question-word font-outfit">${m.meaning || '---'}</div>`}
                </div>
                <div class="quiz-options">
                    ${options.map(opt => `
                        <button class="quiz-option" data-correct="${opt.correct}" onclick="app.answerQuiz(this, ${opt.correct})">
                            ${opt.text}
                        </button>`).join('')}
                </div>
            </div>`;

        lucide.createIcons();
    }

    answerQuiz(btn, isCorrect) {
        // Vô hiệu hóa tất cả option
        document.querySelectorAll('.quiz-option').forEach(opt => {
            opt.disabled = true;
            if (opt.getAttribute('data-correct') === 'true') {
                opt.classList.add('correct');
            }
        });

        if (isCorrect) {
            this.quizState.score++;
            btn.classList.add('correct');
            this.showToast('Chính xác! ✓', null, 'success');
        } else {
            btn.classList.add('wrong');
            this.showToast('Sai rồi!', null, 'warning');
        }

        // Chuyển câu tiếp theo sau 1.2 giây
        setTimeout(() => {
            this.quizState.current++;
            this.renderQuizQuestion();
        }, 1200);
    }

    renderQuizResult() {
        const { pool, score, type } = this.quizState;
        const totalQ = pool.length;
        const pct = Math.round((score / totalQ) * 100);

        let emoji = pct >= 80 ? '🏆' : pct >= 60 ? '👍' : '📚';
        let msg = pct >= 80 ? 'Xuất sắc! Bạn nhớ rất tốt.' : pct >= 60 ? 'Khá tốt! Tiếp tục cố lên.' : 'Cần ôn thêm một chút nhé.';

        document.getElementById('quiz-content').innerHTML = `
            <div class="quiz-result-screen">
                <div style="font-size:4rem;margin-bottom:1rem">${emoji}</div>
                <div class="quiz-score-big">${score}/${totalQ}</div>
                <div class="quiz-score-label">${msg}</div>
                <div style="font-size:2rem;font-weight:900;color:var(--primary);margin-bottom:1.5rem">${pct}%</div>
                <div style="display:flex;gap:1rem;justify-content:center">
                    <button onclick="app.startQuiz()" class="btn-primary-action">
                        <i data-lucide="refresh-cw"></i> Làm lại
                    </button>
                    <button onclick="app.renderQuizStart()" style="padding:0.875rem 2rem;background:var(--bg-card);border:1.5px solid var(--border);border-radius:var(--r-full);font-weight:700;font-size:0.9rem;transition:var(--transition)">
                        Cấu hình khác
                    </button>
                </div>
            </div>
        `;

        lucide.createIcons();
    }

    // =====================================================================
    //  TYPING QUIZ - Xử lý điền từ & gợi ý
    // =====================================================================

    // Tiết lộ gợi ý theo tầng
    revealTypingHint(hintType) {
        if (!this.quizState) return;

        if (hintType === 'example') {
            // Tầng 1: Hiện câu ví dụ
            this.quizState.hintLevel = 1;
        } else if (hintType === 'letter') {
            // Tầng 2+: Tiết lộ từng chữ cái
            this.quizState.hintLevel = (this.quizState.hintLevel || 0) + 1;
            this.applyLetterHints();
            return; // applyLetterHints cập nhật DOM trực tiếp, không cần re-render toàn bộ
        }

        // Re-render câu hỏi để cập nhật gợi ý mới
        this.renderQuizQuestion();
    }

    // Áp dụng gợi ý chữ cái vào ô chữ: tiết lộ (hintLevel - 1) chữ đầu tiên
    applyLetterHints() {
        const word = this.quizState?.pool[this.quizState.current];
        if (!word) return;
        const revealCount = (this.quizState.hintLevel || 1) - 1; // số ký tự đã lộ
        let charIdx = 0;
        word.word.split('').forEach((ch, i) => {
            if (ch === ' ') return;
            const box = document.getElementById(`lb-${i}`);
            if (box) {
                // Chỉ lộ nếu chưa người dùng gõ đúng vào ô đó
                box.textContent = charIdx < revealCount ? ch.toUpperCase() : '_';
                if (charIdx < revealCount) {
                    box.classList.add('revealed');
                }
            }
            charIdx++;
        });

        // Ẩn nút "Tiết lộ chữ cái" nếu đã lộ hết
        const totalLetters = word.word.replace(/ /g, '').length;
        if (revealCount >= totalLetters - 1) {
            document.querySelectorAll('.btn-hint-reveal.secondary')
                .forEach(b => b.style.display = 'none');
        }
    }

    // Đồng bộ ô chữ theo nội dung người dùng đang gõ
    syncLetterBoxes() {
        const inp = document.getElementById('quiz-typing-input');
        const word = this.quizState?.pool[this.quizState.current];
        if (!inp || !word) return;

        const typed = inp.value;
        let charIdx = 0;
        word.word.split('').forEach((ch, i) => {
            if (ch === ' ') return;
            const box = document.getElementById(`lb-${i}`);
            if (box && !box.classList.contains('revealed')) {
                const typedChar = typed[charIdx];
                box.textContent = typedChar ? typedChar.toUpperCase() : '_';
                box.style.color = typedChar
                    ? (typedChar.toLowerCase() === ch.toLowerCase() ? '#10b981' : '#ef4444')
                    : '';
            }
            charIdx++;
        });
    }

    // Xử lý nộp bài điền từ
    submitTypingAnswer() {
        const inp = document.getElementById('quiz-typing-input');
        if (!inp) return;

        const answer = inp.value.trim().toLowerCase();
        const word = this.quizState.pool[this.quizState.current];
        if (!word) return;

        const correct = word.word.toLowerCase();
        const isExact = answer === correct;
        // Chấp nhận lỗi typo 1 ký tự (Levenshtein distance = 1)
        const isClose = !isExact && this.levenshtein(answer, correct) === 1;
        const isCorrect = isExact || isClose;

        // Vô hiệu hoá input để tránh nhập thêm
        inp.disabled = true;
        document.querySelector('.btn-quiz-submit')?.setAttribute('disabled', '');

        if (isCorrect) {
            this.quizState.score++;
            inp.style.borderColor = '#10b981';
            inp.style.background = 'rgba(16,185,129,0.08)';
            this.showToast(isExact ? 'Chính xác! ✓' : 'Gần đúng! ✓ (typo nhỏ)', `"${word.word}"`, 'success');
        } else {
            inp.style.borderColor = '#ef4444';
            inp.style.background = 'rgba(239,68,68,0.08)';
            // Hiển thị đáp án đúng bên dưới
            const area = document.querySelector('.quiz-typing-area');
            if (area) {
                const hint = document.createElement('div');
                hint.style.cssText = 'margin-top:0.75rem;color:#ef4444;font-weight:700;font-size:0.95rem;text-align:center';
                hint.innerHTML = `Đáp án: <strong>"${word.word}"</strong>`;
                area.appendChild(hint);
            }
            this.showToast('Chưa đúng!', `Đáp án: "${word.word}"`, 'warning');
        }

        // Reset hintLevel, chuyển câu tiếp sau 1.5 giây
        setTimeout(() => {
            this.quizState.hintLevel = 0;
            this.quizState.current++;
            this.renderQuizQuestion();
        }, 1500);
    }

    // Tính Levenshtein distance để phát hiện typo nhỏ
    levenshtein(a, b) {
        const m = a.length, n = b.length;
        const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        for (let i = 1; i <= m; i++)
            for (let j = 1; j <= n; j++)
                dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
                    : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
        return dp[m][n];
    }


    scheduleReminders() {
        if (this.reminderTimer) clearInterval(this.reminderTimer);

        if (!this.settings.enableReviewReminder) return;

        // Nhắc nhở ôn lại sau mỗi interval
        const intervalMs = this.settings.reviewInterval * 60 * 1000;
        this.reminderTimer = setInterval(() => {
            // Chỉ nhắc nếu người dùng đã học ít nhất 1 từ hôm nay
            if (this.todayData.learned.length > 0 && document.hidden === false) {
                this.showReminderPopup();
            }
        }, intervalMs);
    }

    showReminderPopup() {
        const popup = document.getElementById('reminder-popup');
        const count = this.todayData.learned.length;
        document.getElementById('reminder-count').textContent = count;
        document.getElementById('reminder-msg').innerHTML =
            `Bạn đã học <strong>${count}</strong> từ hôm nay. ${count < this.settings.dailyGoal ? `Còn <strong>${this.settings.dailyGoal - count}</strong> từ nữa để đạt mục tiêu!` : 'Hãy ôn lại để không quên nhé!'}`;
        popup.classList.remove('hidden');

        // Hiển thị dot trên bell
        document.getElementById('bell-dot')?.classList.remove('hidden');
    }

    // Kiểm tra xem có cần nhắc nhở theo giờ không (dùng check mỗi phút)
    checkDailyReminder() {
        if (!this.settings.enableDailyReminder) return;

        const now = new Date();
        const dayOfWeek = now.getDay();
        if (!this.settings.studyDays.includes(dayOfWeek)) return;

        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        if (currentTime === this.settings.morningTime || currentTime === this.settings.eveningTime) {
            this.showReminderPopup();
        }
    }

    // Lịch sử học tập
    renderHistoryList() {
        const hist = this.loadStorage('vocab_history', {});
        const keys = Object.keys(hist).sort((a, b) => b.localeCompare(a)).slice(0, 7);
        const maxCount = Math.max(...keys.map(k => hist[k].count), 1);

        const container = document.getElementById('history-list');
        if (!container) return;

        if (keys.length === 0) {
            container.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted);text-align:center;padding:1rem">Chưa có lịch sử học tập.</p>';
            return;
        }

        container.innerHTML = keys.map(k => {
            const d = hist[k];
            const pct = Math.round((d.count / maxCount) * 100);
            const [y, m, day] = k.split('-');
            return `
                <div class="history-item">
                    <div class="history-date">${day}/${m}/${y}</div>
                    <div class="history-bar-wrap">
                        <div class="history-bar" style="width:${pct}%"></div>
                    </div>
                    <div class="history-count">${d.count} từ</div>
                </div>
            `;
        }).join('');
    }

    // =====================================================================
    //  SETTINGS
    // =====================================================================
    applySettings() {
        // Áp dụng các giá trị đã lưu vào UI
        document.getElementById('daily-reminder-toggle').checked = this.settings.enableDailyReminder;
        document.getElementById('review-reminder-toggle').checked = this.settings.enableReviewReminder;
        document.getElementById('morning-time').value = this.settings.morningTime;
        document.getElementById('evening-time').value = this.settings.eveningTime;

        // Goal options
        document.querySelectorAll('.goal-opt').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.getAttribute('data-goal')) === this.settings.dailyGoal);
        });

        // Interval options
        document.querySelectorAll('.interval-btn').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.getAttribute('data-interval')) === this.settings.reviewInterval);
        });

        // Day picker
        document.querySelectorAll('.day-btn').forEach(btn => {
            const day = parseInt(btn.getAttribute('data-day'));
            btn.classList.toggle('active', this.settings.studyDays.includes(day));
        });
    }

    applySettingsToUI() {
        this.applySettings();
        this.renderHistoryList();
    }

    saveUserSettings() {
        // Cập nhật settings từ UI
        this.settings.enableDailyReminder = document.getElementById('daily-reminder-toggle').checked;
        this.settings.enableReviewReminder = document.getElementById('review-reminder-toggle').checked;
        this.settings.morningTime = document.getElementById('morning-time').value;
        this.settings.eveningTime = document.getElementById('evening-time').value;

        this.saveStorage('vocab_settings', this.settings);
        this.scheduleReminders();
        this.showToast('Đã lưu cài đặt! ✅', 'Tất cả tùy chọn nhắc nhở đã được cập nhật.', 'success');
        this.updateTodayProgress();
        this.updateGlobalStats();
    }

    // =====================================================================
    //  THEME
    // =====================================================================
    toggleTheme() {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        if (isDark) {
            document.documentElement.removeAttribute('data-theme');
            this.saveStorage('vocab_theme', 'light');
        } else {
            document.documentElement.setAttribute('data-theme', 'dark');
            this.saveStorage('vocab_theme', 'dark');
        }
        lucide.createIcons();
    }

    // =====================================================================
    //  STREAK
    // =====================================================================
    calcStreak() {
        const hist = this.loadStorage('vocab_history', {});
        const today = this.getTodayKey();
        let streak = 0;
        let check = new Date();

        // Tính chuỗi ngày liên tiếp
        while (true) {
            const key = check.toISOString().split('T')[0];
            if (key === today ? this.todayData?.learned?.length > 0 : hist[key]?.count > 0) {
                streak++;
                check.setDate(check.getDate() - 1);
            } else {
                break;
            }
        }
        return streak;
    }

    // =====================================================================
    //  TOAST NOTIFICATIONS
    // =====================================================================
    showToast(title, msg, type = 'info') {
        const icons = { success: 'check-circle-2', info: 'info', warning: 'alert-triangle' };
        const container = document.getElementById('toast-container');

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <div class="toast-icon"><i data-lucide="${icons[type] || 'info'}"></i></div>
            <div class="toast-body">
                <div class="toast-title">${title}</div>
                ${msg ? `<div class="toast-msg">${msg}</div>` : ''}
            </div>
        `;

        container.appendChild(toast);
        lucide.createIcons();

        // Tự ẩn sau 3.5 giây
        setTimeout(() => {
            toast.classList.add('hiding');
            setTimeout(() => toast.remove(), 350);
        }, 3500);
    }

    // =====================================================================
    //  AUDIO
    // =====================================================================
    playAudio(url) {
        if (!url || url === 'null') return;
        const audio = new Audio(url);
        audio.play().catch(() => { });
    }

    // =====================================================================
    //  TYPING QUIZ - Xử lý điền từ
    // =====================================================================
    submitTypingAnswer() {
        const inp = document.getElementById('quiz-typing-input');
        if (!inp) return;

        const answer = inp.value.trim().toLowerCase();
        const word = this.quizState.pool[this.quizState.current];
        if (!word) return;

        const correct = word.word.toLowerCase();

        // Kiểm tra khớp chính xác hoặc gần đúng (1 ký tự sai - typo tolerance)
        const isExact = answer === correct;
        const isClose = !isExact && this.levenshtein(answer, correct) === 1;
        const isCorrect = isExact || isClose;

        // Vô hiệu hoá input để tránh nhập thêm
        inp.disabled = true;
        document.querySelector('.btn-quiz-submit')?.setAttribute('disabled', '');

        if (isCorrect) {
            this.quizState.score++;
            inp.style.borderColor = '#10b981';
            inp.style.background = 'rgba(16,185,129,0.08)';
            this.showToast(isExact ? 'Chính xác! ✓' : 'Gần đúng! ✓ (typo nhỏ)', `"${word.word}"`, 'success');
        } else {
            inp.style.borderColor = '#ef4444';
            inp.style.background = 'rgba(239,68,68,0.08)';
            // Hiển thị đáp án đúng bên dưới input
            const area = document.querySelector('.quiz-typing-area');
            if (area) {
                const hint = document.createElement('div');
                hint.style.cssText = 'margin-top:0.75rem;color:#ef4444;font-weight:700;font-size:0.95rem';
                hint.textContent = `Đáp án: "${word.word}"`;
                area.appendChild(hint);
            }
            this.showToast('Chưa đúng!', `Đáp án đúng: "${word.word}"`, 'warning');
        }

        // Chuyển câu tiếp sau 1.5 giây
        setTimeout(() => {
            this.quizState.current++;
            this.renderQuizQuestion();
        }, 1500);
    }

    // Tính khoảng cách Levenshtein để chấp nhận typo nhỏ
    levenshtein(a, b) {
        const m = a.length, n = b.length;
        const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        for (let i = 1; i <= m; i++)
            for (let j = 1; j <= n; j++)
                dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
                    : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
        return dp[m][n];
    }

    // =====================================================================
    //  MATCHING GAME - Trò chơi ghép cặp từ - nghĩa
    // =====================================================================
    renderMatchingGame() {
        const learnedWords = this.words.filter(w => this.learnedIds.includes(w.id));
        if (learnedWords.length < 4) { this.renderQuizStart(); return; }

        const count = Math.min(6, learnedWords.length);
        const selected = [...learnedWords].sort(() => Math.random() - 0.5).slice(0, count);

        // Xáo trộn riêng hai cột để không trùng thứ tự
        const leftItems  = [...selected].sort(() => Math.random() - 0.5);
        const rightItems = [...selected].sort(() => Math.random() - 0.5);

        this.matchingState = {
            words: selected,
            leftItems,
            rightItems,
            selectedLeft: null,   // id từ đang chọn bên trái
            selectedRight: null,  // id từ đang chọn bên phải
            matched: new Set(),   // set id đã ghép đúng
            attempts: 0,
            startTime: Date.now()
        };

        this.renderMatchingBoard();
    }

    renderMatchingBoard() {
        const { words, leftItems, rightItems, matched } = this.matchingState;
        const container = document.getElementById('quiz-content');
        container.innerHTML = `
            <div class="matching-game">
                <div class="matching-header">
                    <h3 class="font-outfit">🔗 Ghép cặp từ - nghĩa</h3>
                    <div class="matching-stats">
                        <span>${matched.size}/${words.length} cặp</span>
                        <span>${this.matchingState.attempts} lượt</span>
                    </div>
                </div>
                <p style="font-size:0.85rem;color:var(--text-muted);text-align:center;margin-bottom:1.25rem">
                    Chọn một từ bên trái rồi chọn nghĩa tương ứng bên phải
                </p>
                <div class="matching-board">
                    <div class="matching-col">
                        ${leftItems.map(w => `
                            <button class="matching-item${matched.has(w.id) ? ' matched' : ''}"
                                data-id="${w.id}" data-side="left"
                                onclick="app.selectMatchingItem('left','${w.id}')"
                                ${matched.has(w.id) ? 'disabled' : ''}>
                                ${w.word}
                            </button>`).join('')}
                    </div>
                    <div class="matching-col">
                        ${rightItems.map(w => `
                            <button class="matching-item${matched.has(w.id) ? ' matched' : ''}"
                                data-id="${w.id}" data-side="right"
                                onclick="app.selectMatchingItem('right','${w.id}')"
                                ${matched.has(w.id) ? 'disabled' : ''}>
                                ${w.meanings[0]?.meaning || '---'}
                            </button>`).join('')}
                    </div>
                </div>
                <button onclick="app.renderQuizStart()" class="matching-quit-btn">
                    <i data-lucide="arrow-left"></i> Chọn chế độ khác
                </button>
            </div>`;
        lucide.createIcons();
    }

    selectMatchingItem(side, id) {
        const state = this.matchingState;

        if (side === 'left') {
            // Bỏ chọn cũ, chọn mới bên trái
            document.querySelectorAll('.matching-item[data-side="left"]')
                .forEach(el => el.classList.remove('selected'));
            state.selectedLeft = id;
            document.querySelector(`.matching-item[data-side="left"][data-id="${id}"]`)
                ?.classList.add('selected');
        } else {
            state.selectedRight = id;
            document.querySelectorAll('.matching-item[data-side="right"]')
                .forEach(el => el.classList.remove('selected'));
            document.querySelector(`.matching-item[data-side="right"][data-id="${id}"]`)
                ?.classList.add('selected');
        }

        // Khi đã chọn cả hai bên → kiểm tra
        if (state.selectedLeft && state.selectedRight) {
            state.attempts++;
            const correct = state.selectedLeft === state.selectedRight;

            if (correct) {
                // Ghép đúng: đánh dấu matched
                state.matched.add(state.selectedLeft);
                document.querySelectorAll(`.matching-item[data-id="${state.selectedLeft}"]`)
                    .forEach(el => { el.classList.add('matched'); el.classList.remove('selected'); el.disabled = true; });
                this.showToast('✅ Đúng!', null, 'success');

                // Cập nhật counter
                const statsEl = document.querySelector('.matching-stats span');
                if (statsEl) statsEl.textContent = `${state.matched.size}/${state.words.length} cặp`;

                if (state.matched.size === state.words.length) {
                    setTimeout(() => this.showMatchingResult(), 700);
                }
            } else {
                // Sai: flash red rồi bỏ chọn
                document.querySelectorAll('.matching-item.selected').forEach(el => {
                    el.classList.add('wrong');
                    setTimeout(() => el.classList.remove('wrong', 'selected'), 700);
                });
                this.showToast('❌ Chưa khớp!', 'Thử lại nhé!', 'warning');
            }

            state.selectedLeft = null;
            state.selectedRight = null;

            // Cập nhật lượt
            const attemptsEl = document.querySelectorAll('.matching-stats span')[1];
            if (attemptsEl) attemptsEl.textContent = `${state.attempts} lượt`;
        }
    }

    showMatchingResult() {
        const { words, attempts, startTime } = this.matchingState;
        const secs = Math.round((Date.now() - startTime) / 1000);
        const accuracy = Math.round((words.length / Math.max(attempts, words.length)) * 100);
        const emoji = accuracy === 100 ? '🏆' : accuracy >= 70 ? '🎯' : '💪';

        document.getElementById('quiz-content').innerHTML = `
            <div class="quiz-result-screen">
                <div style="font-size:4rem;margin-bottom:1rem">${emoji}</div>
                <div class="quiz-score-big">${words.length}/${words.length}</div>
                <div class="quiz-score-label">Đã ghép đủ tất cả ${words.length} cặp!</div>
                <div style="display:flex;gap:2rem;justify-content:center;margin:1rem 0;color:var(--text-secondary);font-weight:600;font-size:0.9rem">
                    <span>⏱ ${secs}s</span>
                    <span>🎯 ${attempts} lượt</span>
                    <span>✅ ${accuracy}% chính xác</span>
                </div>
                <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap">
                    <button onclick="app.renderMatchingGame()" class="btn-primary-action">
                        <i data-lucide="refresh-cw"></i> Chơi lại
                    </button>
                    <button onclick="app.renderQuizStart()" style="padding:0.875rem 2rem;background:var(--bg-card);border:1.5px solid var(--border);border-radius:var(--r-full);font-weight:700;font-size:0.9rem;cursor:pointer">
                        Chọn chế độ khác
                    </button>
                </div>
            </div>`;
        lucide.createIcons();
    }
}

// Khởi động ứng dụng khi trang đã tải
const app = new VocabApp();

// Nhắc nhở theo giờ (kiểm tra mỗi phút)
setInterval(() => app.checkDailyReminder(), 60000);
