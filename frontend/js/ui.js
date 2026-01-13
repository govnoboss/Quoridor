const UI = {
  // Добавленные переменные для таймера
  searchTimerInterval: null,
  searchTime: 0,
  currentLang: 'en',
  currentRoomCode: null,
  selectedTime: null,

  translations: {
    ru: {
      menu_play_online: "⚡ Играть онлайн",
      menu_cancel_search: "Отменить поиск",
      menu_local_game: "🎮 Локальная игра",
      menu_rules: "📖 Как играть?",
      menu_settings: "⚙️ Настройки",
      pname_opponent: "Оппонент",
      pname_you: "Вы",
      pname_white: "Белый",
      pname_black: "Черный",
      info_tip_title: "Совет дня",
      info_tip_text: "Стены — ваше главное оружие. Используйте их, чтобы удлинить путь соперника, но не блокируйте себя!",
      info_leaderboard_title: "Лидеры",
      info_hint: "Рейтинг обновляется в реальном времени",
      screen_mode_title: "Выберите режим",
      mode_pvp: "Два игрока (PvP)",
      mode_bot_title: "Игра с ботом",
      mode_bot_easy: "Легкий бот",
      mode_bot_medium: "Средний бот",
      mode_bot_hard: "Сильный бот",
      mode_bot_impossible: "Непобедимый бот",
      btn_back: "Назад",
      screen_color_title: "Выберите сторону",
      color_white_hint: "Белые всегда ходят первыми",
      btn_play_white: "⚪ Играть за Белых",
      btn_play_black: "⚫ Играть за Чёрных",
      btn_surrender: "Сдаться",
      screen_settings_title: "Настройки",
      label_theme: "Тема:",
      theme_dark: "Тёмная",
      theme_light: "Светлая",
      label_lang: "Язык:",
      label_sound: "Звук:",
      sound_on: "Вкл",
      sound_off: "Выкл",
      btn_save: "Сохранить",
      screen_rules_title: "Правила",
      modal_win: "ПОБЕДА 🎉",
      modal_lose: "ПОРАЖЕНИЕ 💀",
      modal_win_local: "ПОБЕДИЛИ {color}!",
      modal_reason: "Причина: ",
      reason_goal: "Цель достигнута",
      reason_timeout: "Время истекло",
      reason_surrender: "Противник сдался",
      reason_disconnected: "Противник покинул игру",
      btn_to_menu: "В меню",
      disconnect_title: "Соединение разорвано",
      disconnect_msg: "Вы открыли игру в другой вкладке или окне.<br>Эта сессия была завершена.",
      btn_reconnect: "Вернуться в игру (Reconnect)",
      confirm_title: "Подтверждение",
      confirm_msg: "Вы уверены?",
      confirm_surrender_title: "Подтверждение сдачи",
      confirm_surrender_msg: "Вы уверены, что хотите сдаться?",
      btn_yes: "Да",
      btn_no: "Отмена",
      toast_not_your_turn: "Сейчас не ваш ход!",
      menu_play_friend: "👥 Играть с другом",
      screen_room_title: "Игра с другом",
      btn_create_room: "Создать комнату",
      btn_join_room: "Войти",
      room_created_msg: "Код комнаты создан! Отправьте его другу:",
      room_waiting: "Ожидание подключения противника...",
      label_or: "или",
      menu_searching: "Поиск игры...",
      rules_goal_title: "🎯 Цель",
      rules_goal_text: "Первым доведите свою фишку до противоположного края доски.",
      rules_turn_title: "🎲 Ход",
      rules_turn_text: "За ход можно: передвинуть фишку на 1 клетку или поставить стену.",
      rules_jump_title: "🚶 Прыжки",
      rules_jump_text: "Если соперник рядом — можно перепрыгнуть через него.",
      rules_wall_title: "🧱 Стены",
      rules_wall_text: "Стена занимает 2 клетки. Нельзя полностью блокировать путь к цели.",
      rules_controls_title: "⌨️ Управление",
      rules_controls_text: "H — горизонтальная стена, V — вертикальная, R — повернуть.",
      toast_settings_saved: "Настройки сохранены!",
      toast_link_copied: "Ссылка скопирована!",
      toast_room_code_from_link: "Код комнаты получен из ссылки",
      toast_opponent_disconnected: "Противник отключился. Ожидаем возвращения... (30сек)",
      toast_opponent_returned: "Противник вернулся в игру!",
      toast_invalid_move: "Недопустимый ход!",
      toast_search_error: "Ошибка поиска",
      toast_join_error: "Ошибка входа",
      toast_already_in_game: "Вы уже в игре!",
      toast_code_copied: "Код скопирован!",
      label_copy_link: "Нажмите на ссылку, чтобы скопировать:",
      toast_copy_error: "Не удалось скопировать",
      toast_copy_not_supported: "Копирование не поддерживается браузером",
      time_select_title: "Контроль времени",
      time_cat_bullet: "Пуля",
      time_cat_blitz: "Блиц",
      time_cat_rapid: "Рапид",
      btn_start_search: "Найти игру"
    },
    en: {
      menu_play_online: "⚡ Play Online",
      menu_cancel_search: "Cancel Search",
      menu_local_game: "🎮 Local Game",
      menu_rules: "📖 How to play?",
      menu_settings: "⚙️ Settings",
      pname_opponent: "Opponent",
      pname_you: "You",
      pname_white: "White",
      pname_black: "Black",
      info_tip_title: "Tip of the Day",
      info_tip_text: "Walls are your main weapon. Use them to lengthen your opponent's path, but don't block yourself!",
      info_leaderboard_title: "Leaderboard",
      info_hint: "Ratings update in real-time",
      screen_mode_title: "Choose Mode",
      mode_pvp: "Two Players (PvP)",
      mode_bot_title: "Play with Bot",
      mode_bot_easy: "Easy Bot",
      mode_bot_medium: "Medium Bot",
      mode_bot_hard: "Strong Bot",
      mode_bot_impossible: "Impossible Bot",
      btn_back: "Back",
      screen_color_title: "Choose Side",
      color_white_hint: "White always moves first",
      btn_play_white: "⚪ Play as White",
      btn_play_black: "⚫ Play as Black",
      btn_surrender: "Surrender",
      screen_settings_title: "Settings",
      label_theme: "Theme:",
      theme_dark: "Dark",
      theme_light: "Light",
      label_lang: "Language:",
      label_sound: "Sound:",
      sound_on: "On",
      sound_off: "Off",
      btn_save: "Save",
      screen_rules_title: "Rules",
      modal_win: "VICTORY 🎉",
      modal_lose: "DEFEAT 💀",
      modal_win_local: "{color} WON!",
      modal_reason: "Reason: ",
      reason_goal: "Goal reached",
      reason_timeout: "Time out",
      reason_surrender: "Opponent surrendered",
      reason_disconnected: "Opponent disconnected",
      btn_to_menu: "To Menu",
      disconnect_title: "Connection Lost",
      disconnect_msg: "You opened the game in another tab or window.<br>This session has ended.",
      btn_reconnect: "Return to Game (Reconnect)",
      confirm_title: "Confirmation",
      confirm_msg: "Are you sure?",
      confirm_surrender_title: "Confirm Surrender",
      confirm_surrender_msg: "Are you sure you want to surrender?",
      btn_yes: "Yes",
      btn_no: "Cancel",
      toast_not_your_turn: "It's not your turn!",
      menu_play_friend: "👥 Play with Friend",
      screen_room_title: "Play with Friend",
      btn_create_room: "Create Room",
      btn_join_room: "Join",
      room_created_msg: "Room code created! Send it to your friend:",
      room_waiting: "Waiting for opponent to connect...",
      label_or: "or",
      menu_searching: "Searching for game...",
      rules_goal_title: "🎯 Goal",
      rules_goal_text: "Be the first to reach the opposite edge of the board.",
      rules_turn_title: "🎲 Turn",
      rules_turn_text: "On your turn: move your pawn 1 square or place a wall.",
      rules_jump_title: "🚶 Jumps",
      rules_jump_text: "If opponent is adjacent — you can jump over them.",
      rules_wall_title: "🧱 Walls",
      rules_wall_text: "Wall covers 2 squares. Cannot completely block path to goal.",
      rules_controls_title: "⌨️ Controls",
      rules_controls_text: "H — horizontal wall, V — vertical, R — rotate.",
      toast_settings_saved: "Settings saved!",
      toast_link_copied: "Link copied!",
      toast_room_code_from_link: "Room code received from link",
      toast_opponent_disconnected: "Opponent disconnected. Waiting for return... (30sec)",
      toast_opponent_returned: "Opponent has returned!",
      toast_invalid_move: "Invalid move!",
      toast_search_error: "Search error",
      toast_join_error: "Join error",
      toast_already_in_game: "You are already in a game!",
      toast_code_copied: "Code copied!",
      label_copy_link: "Click link to copy:",
      toast_copy_error: "Failed to copy",
      toast_copy_not_supported: "Clipboard not supported",
      time_select_title: "Time Control",
      time_cat_bullet: "Bullet",
      time_cat_blitz: "Blitz",
      time_cat_rapid: "Rapid",
      btn_start_search: "Find Game"
    }
  },

  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    this.updateProfileBarVisibility();
  },
  showModeSelect() { this.showScreen('modeScreen'); },
  showRoomScreen() {
    this.showInfoPanel('panelRoom');
    document.getElementById('roomCodeDisplay').classList.add('hidden');
    document.getElementById('createRoomBtn').classList.remove('hidden');
    document.getElementById('roomCodeInput').value = '';
  },
  backToMenu() {
    this.showScreen('mainMenu');
    this.hideDynamicPanel();
  },
  showTimeSelection() {
    this.showDynamicPanel('panelTimeSelect');
    this.selectedTime = null;
    const startBtn = document.getElementById('startSearchBtn');
    if (startBtn) {
      startBtn.classList.add('disabled');
      startBtn.disabled = true;
    }
    document.querySelectorAll('.time-opt').forEach(opt => opt.classList.remove('selected'));
  },
  selectTime(base, inc, el) {
    this.selectedTime = { base, inc };
    document.querySelectorAll('.time-opt').forEach(opt => opt.classList.remove('selected'));
    el.classList.add('selected');

    const startBtn = document.getElementById('startSearchBtn');
    if (startBtn) {
      startBtn.classList.remove('disabled');
      startBtn.disabled = false;
    }
  },
  startOnlineSearch() {
    if (!this.selectedTime) return;
    this.showSearch(this.selectedTime);
  },
  showSettings() { this.showDynamicPanel('panelSettings'); },
  showRules() { this.showDynamicPanel('panelRules'); },

  showInfoPanel(panelId) {
    document.querySelectorAll('.info-content').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById(panelId);
    if (panel) panel.classList.add('active');
  },

  showDynamicPanel(panelId, autoCreate = true) {
    const container = document.getElementById('dynamicPanel');
    document.querySelectorAll('.dynamic-content').forEach(p => p.classList.add('hidden'));
    const panel = document.getElementById(panelId);
    if (panel) {
      panel.classList.remove('hidden');
      container.classList.remove('empty');

      // Auto-create room when opening panelRoom (only if autoCreate is true and no code exists)
      if (panelId === 'panelRoom' && autoCreate && !this.currentRoomCode) {
        this.createPrivateRoom();
      }
    }
    this.updateProfileBarVisibility();
  },

  hideDynamicPanel() {
    const container = document.getElementById('dynamicPanel');

    // Если поиск активен - отменяем его
    if (container.classList.contains('searching')) {
      if (typeof Net !== 'undefined' && Net.cancelFindGame) {
        Net.cancelFindGame();
      }
      this.hideSearch();
      return;
    }

    // В остальных случаях просто очищаем классы и скрываем контент
    document.querySelectorAll('.dynamic-content').forEach(p => p.classList.add('hidden'));
    container.classList.add('empty');
    this.updateProfileBarVisibility();
  },

  updateProfileBarVisibility() {
    const profileBar = document.getElementById('userProfileArea');
    if (!profileBar) return;

    const dynamicPanel = document.getElementById('dynamicPanel');
    const isPanelOpen = dynamicPanel && !dynamicPanel.classList.contains('empty');
    const activeScreen = document.querySelector('.screen.active');
    const isMainMenu = activeScreen && activeScreen.id === 'mainMenu';
    const isProfileModalOpen = document.getElementById('profileModal') && !document.getElementById('profileModal').classList.contains('hidden');

    const isMobile = window.innerWidth <= 768;

    // Rules:
    // 1. If Profile Modal (User profile itself) is open - ALWAYS hide the small bar
    if (isProfileModalOpen) {
      profileBar.classList.add('hidden');
      return;
    }

    // 2. If not in Main Menu (e.g. in Game or Room screen) - ALWAYS hide
    if (!isMainMenu) {
      profileBar.classList.add('hidden');
      return;
    }

    // 3. If in Main Menu:
    //    - On Mobile: Hide if a dynamic sub-panel (Rules, Settings) is open
    //    - On PC: Stay visible even if a panel is open
    if (isMobile && isPanelOpen) {
      profileBar.classList.add('hidden');
    } else {
      profileBar.classList.remove('hidden');
    }
  },

  setLanguage(lang) {
    this.currentLang = lang;
    const dict = this.translations[lang];

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (dict[key]) {
        el.innerHTML = dict[key];
      }
    });

    // Специальная логика для правил (показ нужного блока)
    const ruContent = document.getElementById('rulesContentRu');
    const enContent = document.getElementById('rulesContentEn');
    if (lang === 'en') {
      ruContent.classList.add('hidden');
      enContent.classList.remove('hidden');
    } else {
      enContent.classList.add('hidden');
      ruContent.classList.remove('hidden');
    }

    // Обновляем атрибут lang у html
    document.getElementById('htmlTag').lang = lang;
  },

  saveSettings() {
    const theme = document.getElementById('themeSelect').value;
    const lang = document.getElementById('langSelect').value;
    const sound = document.getElementById('soundSelect').value;

    document.body.className = theme;
    this.setLanguage(lang);
    this.AudioManager.enabled = (sound === 'on');

    localStorage.setItem('quoridor-theme', theme);
    localStorage.setItem('quoridor-lang', lang);
    localStorage.setItem('quoridor-sound', sound);
  },

  saveSettingsInline() {
    const theme = document.getElementById('themeSelectInline').value;
    const lang = document.getElementById('langSelectInline').value;
    const sound = document.getElementById('soundSelectInline').value;

    document.body.className = theme;
    this.setLanguage(lang);
    this.AudioManager.enabled = (sound === 'on');

    localStorage.setItem('quoridor-theme', theme);
    localStorage.setItem('quoridor-lang', lang);
    localStorage.setItem('quoridor-sound', sound);

    this.showToast(this.translate('toast_settings_saved'), 'info');
  },

  translate(key) {
    return this.translations[this.currentLang][key] || key;
  },

  // Отключает все кнопки, кроме тех, что в контейнере поиска
  disableAll(excludeSearch = false) {
    document.querySelectorAll('.menu-buttons button').forEach(b => {
      // Исключаем кнопки, которые должны работать во время поиска
      if (b.id === 'cancelSearchBtn') {
        return;
      }
      b.disabled = true;
    });
  },
  // Включает все кнопки
  enableAll() {
    document.querySelectorAll('button').forEach(b => b.disabled = false);
  },

  updateSearchTimer() {
    this.searchTime++;
    const minutes = Math.floor(this.searchTime / 60);
    const seconds = this.searchTime % 60;
    const timeString = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    document.getElementById('searchTimer').textContent = timeString;
  },

  showSearch(timeData) {
    // 1. Изменение UI
    this.disableAll();
    document.getElementById('playOnlineBtn').classList.add('hidden');
    document.getElementById('cancelSearchBtn').classList.remove('hidden');
    document.getElementById('cancelSearchBtn').disabled = false;

    // 2. Показываем оверлей поиска в динамической панели
    const container = document.getElementById('dynamicPanel');
    const overlay = document.getElementById('searchOverlay');
    document.querySelectorAll('.dynamic-content').forEach(p => p.classList.add('hidden'));
    if (overlay) overlay.classList.remove('hidden');
    container.classList.remove('empty');
    container.classList.add('searching');

    // 3. Запуск таймера
    this.searchTime = 0;
    this.updateSearchTimer();
    if (this.searchTimerInterval) clearInterval(this.searchTimerInterval);
    this.searchTimerInterval = setInterval(() => this.updateSearchTimer(), 1000);

    // 4. Сетевой запрос на поиск игры
    if (typeof Net !== 'undefined') {
      Net.findGame(timeData);
    }
  },

  hideSearch(returnToTimeSelect = true) {
    // Останавливаем таймер
    if (this.searchTimerInterval) {
      clearInterval(this.searchTimerInterval);
      this.searchTimerInterval = null;
    }

    // Возвращаем кнопки в исходное состояние
    this.enableAll();
    document.getElementById('playOnlineBtn').classList.remove('hidden');
    document.getElementById('cancelSearchBtn').classList.add('hidden');

    const container = document.getElementById('dynamicPanel');
    const overlay = document.getElementById('searchOverlay');
    if (overlay) overlay.classList.add('hidden');
    container.classList.remove('searching');

    // Возвращаемся в меню выбора времени или просто закрываем панель
    if (returnToTimeSelect) {
      this.showTimeSelection();
    } else {
      this.hideDynamicPanel();
    }
  },

  renderHistory(history, currentViewIndex = -1) {
    const list = document.getElementById('historyList');
    if (!list) return;
    list.innerHTML = '';

    for (let i = 0; i < history.length; i += 2) {
      const moveW = history[i];
      const moveB = history[i + 1];

      const row = document.createElement('div');
      row.className = 'history-row';

      // Белые
      const cellW = document.createElement('div');
      cellW.className = 'history-cell';
      if (i === currentViewIndex) cellW.classList.add('active');
      cellW.textContent = (moveW.notation || '?');
      cellW.onclick = () => Game.setHistoryView(i);
      row.appendChild(cellW);

      // Черные
      if (moveB) {
        const cellB = document.createElement('div');
        cellB.className = 'history-cell';
        if ((i + 1) === currentViewIndex) cellB.classList.add('active');
        cellB.textContent = (moveB.notation || '?');
        cellB.onclick = () => Game.setHistoryView(i + 1);
        row.appendChild(cellB);
      }

      list.appendChild(row);
    }
    list.scrollTop = list.scrollHeight;

    // Обновляем состояние кнопок управления историей
    const btnFirst = document.getElementById('histFirst');
    const btnPrev = document.getElementById('histPrev');
    const btnNext = document.getElementById('histNext');
    const btnLast = document.getElementById('histLast');

    if (btnFirst && btnPrev && btnNext && btnLast) {
      const histLen = history.length;
      btnFirst.disabled = (histLen === 0 || currentViewIndex === 0);
      btnPrev.disabled = (histLen === 0 || currentViewIndex === 0);
      btnNext.disabled = (histLen === 0 || currentViewIndex === -1);
      btnLast.disabled = (histLen === 0 || currentViewIndex === -1);
    }
  },

  handleSurrender() {
    UI.showConfirm(
      this.translate('confirm_surrender_title'),
      this.translate('confirm_surrender_msg'),
      () => {
        // Пользователь подтвердил сдачу
        if (Net.isOnline) {
          Net.surrender();
        } else {
          Game.handleGameOver(1 - Game.state.currentPlayer, 'Surrender');
        }
      }
    );
  },

  /**
   * Показывает модальное окно подтверждения
   * @param {string} title - Заголовок окна
   * @param {string} message - Текст сообщения
   * @param {function} onConfirm - Callback при нажатии "Да"
   * @param {function} [onCancel] - Callback при нажатии "Отмена" (опционально)
   */
  showConfirm(title, message, onConfirm, onCancel = null) {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const yesBtn = document.getElementById('confirmYes');
    const noBtn = document.getElementById('confirmNo');

    titleEl.textContent = title;
    messageEl.textContent = message;

    // Удаляем старые слушатели (если есть)
    const newYesBtn = yesBtn.cloneNode(true);
    const newNoBtn = noBtn.cloneNode(true);
    yesBtn.parentNode.replaceChild(newYesBtn, yesBtn);
    noBtn.parentNode.replaceChild(newNoBtn, noBtn);

    // Добавляем новые слушатели
    newYesBtn.onclick = () => {
      modal.style.display = 'none';
      if (onConfirm) onConfirm();
    };

    newNoBtn.onclick = () => {
      modal.style.display = 'none';
      if (onCancel) onCancel();
    };

    modal.style.display = 'flex';
    this.updateLanguage(); // Обновить текст кнопок Да/Нет
  },

  // Force update current screen language
  updateLanguage() {
    this.setLanguage(this.currentLang);
  },


  // --- NOTIFICATIONS (Toasts) ---
  showToast(msg, type = 'info', duration = 3000) {
    const container = document.getElementById('notificationContainer');

    // 1. Remove duplicate message (so we can move it to bottom)
    const existing = Array.from(container.children).find(child => child.textContent === msg);
    if (existing) {
      existing.remove();
    }

    // 2. Limit concurrent toasts
    while (container.children.length >= 3) {
      container.removeChild(container.firstChild);
    }

    const toast = document.createElement('div');
    toast.className = `notification-toast ${type}`;
    toast.textContent = msg;

    container.appendChild(toast);

    if (duration > 0) {
      setTimeout(() => {
        toast.classList.add('fading');
        toast.addEventListener('animationend', () => toast.remove());
      }, duration);
    }
    return toast; // Return element in case we want to remove it manually
  },

  // --- DISCONNECT OVERLAY ---
  showDisconnectOverlay() {
    const el = document.getElementById('disconnectModal');
    el.classList.remove('hidden');
  },

  hideDisconnectOverlay() {
    const el = document.getElementById('disconnectModal');
    el.classList.add('hidden');
  },

  // --- PRIVATE ROOMS ---
  createPrivateRoom() {
    Net.createRoom();
  },

  onRoomCreated(code) {
    this.currentRoomCode = code;
    document.getElementById('createRoomBtn').classList.add('hidden');
    document.getElementById('roomCodeDisplay').classList.remove('hidden');
    document.getElementById('roomCodeValue').textContent = code;

    // Update link display
    const link = window.location.origin + window.location.pathname + '?room=' + code;
    const linkDisplay = document.getElementById('roomLinkDisplay');
    if (linkDisplay) {
      linkDisplay.textContent = link;
      linkDisplay.title = link;
    }
  },

  copyRoomCode() {
    const code = document.getElementById('roomCodeValue').textContent;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(() => {
        this.showToast(this.translate('toast_code_copied'), 'info');
      }).catch(err => {
        console.error('Clipboard error:', err);
        this.showToast(this.translate('toast_copy_error'), 'error');
      });
    } else {
      this.showToast(this.translate('toast_copy_not_supported'), 'warning');
    }
  },

  copyRoomLink() {
    const code = document.getElementById('roomCodeValue').textContent;
    const url = window.location.origin + window.location.pathname + '?room=' + code;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        this.showToast(this.translate('toast_link_copied'), 'info');
      }).catch(err => {
        console.error('Clipboard error:', err);
        this.showToast(this.translate('toast_copy_error'), 'error');
      });
    } else {
      this.showToast(this.translate('toast_copy_not_supported'), 'warning');
    }
  },

  validateRoomInput(input) {
    // 1. Force Uppercase
    input.value = input.value.toUpperCase();

    // 2. Validate length to enable/disable button
    const btn = document.getElementById('joinRoomBtn');
    if (input.value.length === 5) {
      btn.disabled = false;
      btn.classList.remove('disabled'); // Optional styling
    } else {
      btn.disabled = true;
      btn.classList.add('disabled');
    }
  },

  joinPrivateRoom() {
    const code = document.getElementById('roomCodeInput').value.trim();
    if (!code) return;
    document.getElementById('joinRoomBtn').disabled = true;
    Net.joinRoom(code);
  },

  hideRoomJoining() {
    document.getElementById('joinRoomBtn').disabled = false;
  },

  // --- AUDIO MANAGER (Web Audio API) ---
  AudioManager: {
    ctx: null,
    enabled: true,

    init() {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
      } catch (e) {
        console.warn('Web Audio API not supported', e);
      }
    },

    resume() {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    },

    play(type) {
      if (!this.ctx || !this.enabled) return;
      this.resume();

      const now = this.ctx.currentTime;

      if (type === 'move') {
        // Мягкий "click" (пластик о дерево)
        this.playSoftClick(now, 400, 0.1);
      } else if (type === 'wall') {
        // Двойной звук для фиксации (клик + глухой тук)
        this.playSoftClick(now, 300, 0.05);
        this.playThud(now + 0.03, 150, 0.15);
      } else if (type === 'error') {
        // Тихий и вежливый "tuk"
        this.playThud(now, 100, 0.1, 0.15);
      } else if (type === 'win') {
        // Минималистичный chime из 2 нот (маримба-стайл)
        this.playChime([659.25, 783.99], 0.15); // E5, G5
      } else if (type === 'lose') {
        // Мягкий нисходящий тон
        this.playThud(now, 150, 0.5, 0.2, true);
      }
    },

    playSoftClick(time, freq, duration) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, time);
      osc.frequency.exponentialRampToValueAtTime(freq / 2, time + duration);

      filter.type = 'lowpass';
      filter.frequency.value = 1000; // Обрезаем высокие для мягкости

      gain.gain.setValueAtTime(0.2, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(time);
      osc.stop(time + duration);
    },

    playThud(time, freq, duration, vol = 0.2, slide = false) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);
      if (slide) osc.frequency.linearRampToValueAtTime(freq / 3, time + duration);

      filter.type = 'lowpass';
      filter.frequency.value = 400;

      gain.gain.setValueAtTime(vol, time);
      gain.gain.linearRampToValueAtTime(0.01, time + duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(time);
      osc.stop(time + duration);
    },

    playChime(freqs, duration) {
      const now = this.ctx.currentTime;
      freqs.forEach((f, i) => {
        const time = now + (i * 0.1);
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.15, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(time);
        osc.stop(time + duration);
      });
    }
  }

};

UI.selectBotDifficulty = function (diff) {
  Game.pendingBotDifficulty = diff;
  UI.showScreen('colorSelectScreen');
};

// --- AUTHENTICATION ---
UI.currentUser = null;

UI.openAuthModal = function () {
  const modal = document.getElementById('authModal');
  if (modal) modal.classList.remove('hidden');
  this.switchAuthTab('login');
};

UI.closeAuthModal = function () {
  const modal = document.getElementById('authModal');
  if (modal) modal.classList.add('hidden');
};

UI.switchAuthTab = function (tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.auth-tab[onclick*="${tab}"]`).classList.add('active');

  document.querySelectorAll('.auth-form').forEach(f => f.classList.add('hidden'));
  document.getElementById(tab + 'Form').classList.remove('hidden');
};

UI.submitLogin = async function () {
  const username = document.getElementById('loginUsername').value;
  const password = document.getElementById('loginPassword').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (res.ok) {
      this.handleAuthSuccess(data.user);
      this.closeAuthModal();
      this.showToast('Login successful!', 'info');
      // Reload to re-establish socket with new session
      setTimeout(() => window.location.reload(), 500);
    } else {
      this.showToast(data.error || 'Login failed', 'error');
    }
  } catch (e) {
    console.error(e);
    this.showToast('Network error', 'error');
  }
};

UI.submitRegister = async function () {
  const username = document.getElementById('regUsername').value;
  const password = document.getElementById('regPassword').value;

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (res.ok) {
      this.handleAuthSuccess(data.user);
      this.closeAuthModal();
      this.showToast('Registration successful!', 'info');
      // Reload to re-establish socket with new session
      setTimeout(() => window.location.reload(), 500);
    } else {
      this.showToast(data.error || 'Registration failed', 'error');
    }
  } catch (e) {
    console.error(e);
    this.showToast('Network error', 'error');
  }
};

UI.logout = async function () {
  await fetch('/api/auth/logout', { method: 'POST' });
  this.currentUser = null;
  this.updateAuthUI();
  this.showToast('Logged out', 'info');
  window.location.reload();
};

UI.checkSession = async function () {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (data.isAuthenticated) {
      this.handleAuthSuccess(data.user);
    } else {
      this.updateAuthUI();
    }
  } catch (e) {
    console.error('Session check failed', e);
  }
};

UI.handleAuthSuccess = function (user) {
  this.currentUser = user;
  this.updateAuthUI();
};

UI.updateAuthUI = function () {
  const authBtn = document.getElementById('authBtn');
  const userInfo = document.getElementById('userInfo');
  const nameDisplay = document.getElementById('userNameDisplay');

  if (authBtn && userInfo && nameDisplay) {
    if (this.currentUser) {
      authBtn.classList.add('hidden');
      userInfo.classList.remove('hidden');
      nameDisplay.textContent = this.currentUser.username;

      // Update global avatar
      const avatarImg = document.getElementById('userAvatarImg');
      if (avatarImg && this.currentUser.avatarUrl) {
        avatarImg.src = this.currentUser.avatarUrl;
      }
    } else {
      authBtn.classList.remove('hidden');
      userInfo.classList.add('hidden');
    }
  }
};

UI.showProfile = async function () {
  try {
    const res = await fetch('/api/user/profile');
    const user = await res.json();
    if (user.error) throw new Error(user.error);

    // Fill Header
    document.getElementById('profileUsername').textContent = user.username;
    document.getElementById('profileAvatarLarge').src = user.avatarUrl || 'https://ui-avatars.com/api/?name=' + user.username + '&background=333&color=fff';
    document.getElementById('profileStatusInput').value = user.status || '';

    const regDate = new Date(user.createdAt).toLocaleDateString();
    document.getElementById('profileRegDate').textContent = regDate;

    // Fill Ratings
    document.getElementById('ratingBullet').textContent = user.ratings?.bullet || 1200;
    document.getElementById('ratingBlitz').textContent = user.ratings?.blitz || 1200;
    document.getElementById('ratingRapid').textContent = user.ratings?.rapid || 1200;

    // Load History
    this.loadGameHistory();

    // Open Modal
    document.getElementById('profileModal').classList.remove('hidden');
    // Call visibility update
    this.updateProfileBarVisibility();
  } catch (err) {
    console.error('[PROFILE ERROR]', err);
    this.showToast('Ошибка загрузки профиля', 'error');
  }
};

UI.closeProfileModal = function () {
  const modal = document.getElementById('profileModal');
  if (modal) modal.classList.add('hidden');
  // Call visibility update
  UI.updateProfileBarVisibility();
};

UI.updateUserStatus = async function () {
  const status = document.getElementById('profileStatusInput').value;
  try {
    const res = await fetch('/api/user/update-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (res.ok) {
      this.showToast('Статус обновлен', 'success');
    }
  } catch (err) {
    console.error('[STATUS UPDATE ERROR]', err);
  }
};

UI.openAvatarPicker = async function () {
  const newUrl = prompt('Введите URL новой аватарки (прямая ссылка на .png/.jpg):', this.currentUser?.avatarUrl || '');
  if (newUrl && newUrl.startsWith('http')) {
    try {
      const res = await fetch('/api/user/update-avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl: newUrl })
      });
      if (res.ok) {
        document.getElementById('profileAvatarLarge').src = newUrl;
        document.getElementById('userAvatarImg').src = newUrl;
        this.currentUser.avatarUrl = newUrl;
        this.showToast('Аватарка обновлена', 'success');
      }
    } catch (err) {
      console.error('[AVATAR UPDATE ERROR]', err);
    }
  }
};

UI.loadGameHistory = async function () {
  try {
    const res = await fetch('/api/user/history');
    const games = await res.json();
    const tbody = document.getElementById('archiveBody');
    tbody.innerHTML = '';

    if (games.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">Партий еще нет</td></tr>';
      return;
    }

    games.forEach(game => {
      const isWhite = game.playerWhite.id === this.currentUser._id;
      const opponent = isWhite ? game.playerBlack.username : game.playerWhite.username;

      let resultText = 'Ничья';
      let resultClass = '';
      if (game.winner !== -1) {
        const iWon = (isWhite && game.winner === 0) || (!isWhite && game.winner === 1);
        resultText = iWon ? 'Победа' : 'Поражение';
        resultClass = iWon ? 'archive-result-win' : 'archive-result-loss';
      }

      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${game.gameType.toUpperCase()}</td>
        <td>${this.currentUser.username} vs ${opponent}</td>
        <td class="${resultClass}">${resultText}</td>
        <td>${game.turns}</td>
        <td>${new Date(game.date).toLocaleDateString()}</td>
        <td><button class="mini-btn disabled">👁️</button></td>
      `;
      tbody.appendChild(row);
    });
  } catch (err) {
    console.error('[HISTORY ERROR]', err);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('quoridor-theme') || 'dark';
  const savedLang = localStorage.getItem('quoridor-lang') || 'ru';
  const savedSound = localStorage.getItem('quoridor-sound') || 'on';

  document.body.className = savedTheme;

  // Sync old settings screen (if exists)
  const themeSelect = document.getElementById('themeSelect');
  if (themeSelect) themeSelect.value = savedTheme;
  const langSelect = document.getElementById('langSelect');
  if (langSelect) langSelect.value = savedLang;
  const soundSelect = document.getElementById('soundSelect');
  if (soundSelect) soundSelect.value = savedSound;

  // Sync inline settings panel
  const themeSelectInline = document.getElementById('themeSelectInline');
  if (themeSelectInline) themeSelectInline.value = savedTheme;
  const langSelectInline = document.getElementById('langSelectInline');
  if (langSelectInline) langSelectInline.value = savedLang;
  const soundSelectInline = document.getElementById('soundSelectInline');
  if (soundSelectInline) soundSelectInline.value = savedSound;

  UI.setLanguage(savedLang);
  UI.AudioManager.enabled = (savedSound === 'on');

  // Инициализация звука
  UI.AudioManager.init();

  // Проверка сессии пользователя
  UI.checkSession();

  // Проверка URL на наличие комнаты
  const urlParams = new URLSearchParams(window.location.search);
  const roomCode = urlParams.get('room');
  if (roomCode && !Net.isOnline && !Net.lobbyId) {
    // Показываем панель, но НЕ создаем новую комнату
    UI.showDynamicPanel('panelRoom', false);

    // Заполняем поле ввода
    document.getElementById('roomCodeInput').value = roomCode.toUpperCase();

    // Пытаемся сразу войти
    // Небольшая задержка, чтобы сокет успел инициализироваться, если это первый запуск
    setTimeout(() => {
      Net.joinRoom(roomCode.toUpperCase());
    }, 500);

    UI.showToast(UI.translate('toast_room_code_from_link'), 'info');

    // Очищаем URL от параметра room, чтобы избежать повторных попыток при перезагрузке
    const newUrl = window.location.pathname + (window.location.hash || '');
    window.history.replaceState({}, document.title, newUrl);
  }

  // Close modals on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      UI.closeProfileModal();
      UI.closeAuthModal();
      UI.hideDisconnectOverlay();
      const confirmModal = document.getElementById('confirmModal');
      if (confirmModal) confirmModal.style.display = 'none';
    }
  });

});

