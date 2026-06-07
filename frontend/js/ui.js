const UI = {
  // Добавленные переменные для таймера
  searchTimerInterval: null,
  searchTime: 0,
  currentLang: 'en',
  currentRoomCode: null,
  selectedTime: null,

  translations: {
    ru: {
      menu_howtoplay: "Как играть",
      menu_play_online: "Играть онлайн",
      howto_title: "Как играть в Quoridor",
      howto_goal_title: "Цель игры",
      howto_goal_text: "Проведите свою пешку на противоположную сторону доски. Белые стартуют снизу и движутся вверх, чёрные — сверху вниз.",
      howto_move_title: "Ходы",
      howto_move_text: "За ход можно либо передвинуть пешку на одну соседнюю клетку (вверх, вниз, влево, вправо), либо поставить стену. Если пешка соперника стоит вплотную, можно перепрыгнуть через неё.",
      howto_wall_title: "Стены",
      howto_wall_text: "У каждого игрока по 10 стен. Стены блокируют проход, но нельзя перекрывать единственный путь к цели соперника. Стены ставятся между клетками.",
      howto_tip_title: "Совет",
      howto_tip_text: "Стены можно использовать не только для защиты, но и чтобы направить соперника в длинный обход, пока вы сами двигаетесь к цели.",
      panel_play_online_title: "Играть онлайн",
      panel_play_ranked: "Рейтинговая",
      panel_play_normal: "Обычная",
      tooltip_ranked_requires_login: "Для рейтинговых игр необходима регистрация",
      menu_cancel_search: "Отменить поиск",
      menu_local_game: "Локальная игра",
      menu_settings: "Настройки",
      pname_opponent: "Оппонент",
      pname_you: "Вы",
      pname_white: "Белый",
      pname_black: "Черный",
      info_online_list_title: "Онлайн",
      info_games_list_title: "Матчи",
      presence_empty: "Пока никого",
      presence_no_games: "Нет активных партий",

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
      label_lang: "Язык:",
      label_sound: "Звук:",
      sound_on: "Вкл",
      sound_off: "Выкл",
      btn_save: "Сохранить",
      modal_win: "ПОБЕДА",
      modal_lose: "ПОРАЖЕНИЕ",
      modal_win_local: "ПОБЕДИЛИ {color}!",
      modal_reason: "Причина: ",
      reason_goal: "Цель достигнута",
      reason_timeout: "Время истекло",
      reason_surrender: "Противник сдался",
      reason_disconnected: "Противник покинул игру",
      btn_to_menu: "В меню",
      btn_rematch: "Реванш",
      btn_new_game: "Новая игра",
      toast_opponent_wants_rematch: "Противник хочет реванш!",
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
      menu_play_friend: "Играть с другом",
      screen_room_title: "Игра с другом",
      header_sign_in: "Войти",
      header_sign_up: "Регистрация",
      btn_create_room: "Создать комнату",
      btn_join_room: "Войти",
      room_created_msg: "Код комнаты создан! Отправьте его другу:",
      room_waiting: "Ожидание подключения противника...",
      label_or: "или",
      menu_searching: "Поиск игры...",
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
      btn_start_search: "Найти игру",
      // Auth & Profile
      toast_login_success: "Вход выполнен!",
      toast_invalid_credentials: "Неверный логин или пароль",
      toast_network_error: "Ошибка сети",
      toast_password_too_short: "Пароль должен быть не менее 8 символов",
      toast_password_no_spaces: "Пароль не должен содержать пробелы",
      toast_username_length_error: "Имя пользователя должно быть от 3 до 20 символов",
      toast_register_success: "Регистрация успешна!",
      toast_register_failed: "Ошибка регистрации",
      toast_logged_out: "Вы вышли из аккаунта",
      toast_profile_load_error: "Ошибка загрузки профиля",
      toast_status_updated: "Статус обновлен",
      toast_avatar_updated: "Аватар обновлен",
      toast_user_not_found: "Пользователь не найден",
      toast_profile_error: "Не удалось загрузить профиль",
      toast_ranked_requires_login: "Для рейтинговых игр нужна регистрация",
      label_ranked: "Играть на рейтинг",
      auth_login: "Вход",
      link_forgot_pass: "Забыли пароль?",
      btn_login_submit: "Войти",
      text_no_account: "Нет аккаунта?",
      link_register: "Зарегистрироваться",
      btn_reg_submit: "Зарегистрироваться",
      text_has_account: "Уже есть аккаунт?",
      link_login_back: "Войти",
      info_online: "Онлайн",
      info_playing: "В матче",
      btn_color_white: "Белые",
      btn_color_black: "Чёрные",
      lang_ru: "Русский",
      lang_en: "English",
      auth_register: "Создание аккаунта",
      auth_tos_accept: "Я принимаю",
      auth_tos_link: "Условия использования",
      auth_and: "и",
      auth_privacy_link: "Политику конфиденциальности",
      profile_archive_title: "Архив партий",
      profile_status_placeholder: "Введите статус...",
      profile_join_date: "Регистрация:",
      profile_logout: "Выйти из системы",
      profile_rating: "Рейтинг",
      th_type: "Тип",
      th_players: "Игроки",
      th_result: "Результат",
      th_moves: "Ходы",
      th_date: "Дата",
      placeholder_username: "Имя пользователя",
      placeholder_password: "Пароль",
      placeholder_username_long: "Имя пользователя (минимум 3 символа)",
      placeholder_password_long: "Пароль (минимум 8 символов)",
      loading_text: "Загрузка...",
      menu_found_bug: "Нашли баг?"
    },
    en: {
      menu_howtoplay: "How to Play",
      howto_title: "How to Play Quoridor",
      howto_goal_title: "Goal",
      howto_goal_text: "Move your pawn to the opposite side of the board. White starts at the bottom and moves up, Black starts at the top and moves down.",
      howto_move_title: "Moves",
      howto_move_text: "On your turn, either move your pawn one square (up, down, left, right) or place a wall. If an opponent's pawn is adjacent, you can jump over it.",
      howto_wall_title: "Walls",
      howto_wall_text: "Each player has 10 walls. Walls block passage, but you cannot completely block the opponent's only path to their goal. Walls are placed between squares.",
      howto_tip_title: "Tip",
      howto_tip_text: "Use walls not only for defense, but also to force your opponent into a long detour while you advance toward your goal.",
      menu_play_online: "Play Online",
      panel_play_online_title: "Play Online",
      panel_play_ranked: "Ranked",
      panel_play_normal: "Normal",
      tooltip_ranked_requires_login: "Registration required for ranked games",
      menu_cancel_search: "Cancel Search",
      menu_local_game: "Local Game",
      menu_settings: "Settings",
      pname_opponent: "Opponent",
      pname_you: "You",
      pname_white: "White",
      pname_black: "Black",
      info_online_list_title: "Online",
      info_games_list_title: "Live games",
      presence_empty: "Nobody here yet",
      presence_no_games: "No active games",

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
      label_lang: "Language:",
      label_sound: "Sound:",
      sound_on: "On",
      sound_off: "Off",
      btn_save: "Save",
      modal_win: "VICTORY",
      modal_lose: "DEFEAT",
      modal_win_local: "{color} WON!",
      modal_reason: "Reason: ",
      reason_goal: "Goal reached",
      reason_timeout: "Time out",
      reason_surrender: "Opponent surrendered",
      reason_disconnected: "Opponent disconnected",
      btn_to_menu: "Exit",
      btn_rematch: "Rematch",
      btn_new_game: "New Game",
      toast_opponent_wants_rematch: "Opponent wants a rematch!",
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
      menu_play_friend: "Play with Friend",
      screen_room_title: "Play with Friend",
      header_sign_in: "Sign In",
      header_sign_up: "Sign Up",
      btn_create_room: "Create Room",
      btn_join_room: "Join",
      room_created_msg: "Room code created! Send it to your friend:",
      room_waiting: "Waiting for opponent to connect...",
      label_or: "or",
      menu_searching: "Searching for game...",
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
      btn_start_search: "Find Game",
      // Auth & Profile
      toast_login_success: "Login successful!",
      toast_invalid_credentials: "Invalid username or password",
      toast_network_error: "Network error",
      toast_password_too_short: "Password must be at least 8 characters",
      toast_password_no_spaces: "Password must not contain spaces",
      toast_username_length_error: "Username must be between 3 and 20 characters",
      toast_register_success: "Registration successful!",
      toast_register_failed: "Registration failed",
      toast_logged_out: "Logged out",
      toast_profile_load_error: "Failed to load profile",
      toast_status_updated: "Status updated",
      toast_avatar_updated: "Avatar updated",
      toast_user_not_found: "User not found",
      toast_profile_error: "Failed to load profile",
      toast_ranked_requires_login: "Registration required for ranked games",
      label_ranked: "Play Ranked",
      auth_login: "Login",
      link_forgot_pass: "Forgot Password?",
      btn_login_submit: "Login",
      text_no_account: "No account?",
      link_register: "Register",
      btn_reg_submit: "Register",
      text_has_account: "Already have an account?",
      link_login_back: "Login",
      info_online: "Online",
      info_playing: "In Game",
      btn_color_white: "White",
      btn_color_black: "Black",
      lang_ru: "Russian",
      lang_en: "English",
      auth_register: "Create account",
      auth_tos_accept: "I accept",
      auth_tos_link: "Terms of Service",
      auth_and: "and",
      auth_privacy_link: "Privacy Policy",
      profile_archive_title: "Game Archive",
      profile_status_placeholder: "Enter status...",
      profile_join_date: "Joined:",
      profile_logout: "Log Out",
      profile_rating: "Rating",
      th_type: "Type",
      th_players: "Players",
      th_result: "Result",
      th_moves: "Moves",
      th_date: "Date",
      placeholder_username: "Username",
      placeholder_password: "Password",
      placeholder_username_long: "Username (at least 3 characters)",
      placeholder_password_long: "Password (at least 8 characters)",
      loading_text: "Loading...",
      menu_found_bug: "Found a bug?"
    }
  },

  escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  escapeJsString(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  },

  // Function to update online stats display and presence lists
  updateOnlineStats(data) {
    const payload = (typeof data === 'object' && data !== null)
      ? data
      : { online: data, playing: arguments[1] || 0 };

    const onlineEl = document.getElementById('statsOnlineCount');
    const playingEl = document.getElementById('statsPlayingCount');
    if (onlineEl) onlineEl.textContent = payload.online || 0;
    if (playingEl) playingEl.textContent = payload.playing || 0;

    this.renderPresenceLists(payload);
  },

  renderPresenceLists(data) {
    const onlineList = document.getElementById('onlinePlayersList');
    const gamesList = document.getElementById('liveGamesList');

    const entries = [
      ...(data.humans || []),
      ...(data.bots || []),
    ];

    if (!entries.length) {
      onlineList.innerHTML = `<li class="presence-empty">${this.escapeHtml(this.translate('presence_empty'))}</li>`;
    } else {
      onlineList.innerHTML = entries.map((entry) => {
        const queue = entry.inQueue ? '<span class="presence-queue">…</span>' : '';
        return `<li class="presence-row" onclick="UI.showProfilePage('${this.escapeJsString(entry.name)}')">
          <span class="presence-name">${this.escapeHtml(entry.name)}</span>${queue}
        </li>`;
      }).join('');
    }

    if (gamesList) {
      const games = data.liveGames || [];
      if (!games.length) {
        gamesList.innerHTML = `<li class="presence-empty">${this.escapeHtml(this.translate('presence_no_games'))}</li>`;
      } else {
        gamesList.innerHTML = games.map((game) => {
          const left = game.players[0];
          const right = game.players[1];
          return `<li class="presence-game">
            <span onclick="UI.showProfilePage('${this.escapeJsString(left.name)}')">${this.escapeHtml(left.name)}</span>
            <span class="presence-vs">vs</span>
            <span onclick="UI.showProfilePage('${this.escapeJsString(right.name)}')">${this.escapeHtml(right.name)}</span>
          </li>`;
        }).join('');
      }
    }
  },

  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    this.updateHeaderVisibility();
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
  // showTimeSelection deleted
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

  quickMatch(isRanked = false) {
    if (isRanked && !this.currentUser) {
      this.showToast(this.translate('toast_ranked_requires_login'), 'warning');
      window.location.href = '/login';
      return;
    }

    this.showSearch({ base: 300, inc: 0 }, isRanked);
    trackEvent('search-started', { mode: isRanked ? 'ranked' : 'normal' });
  },

  showPlayOnlinePanel() {
    trackEvent('play-online-click');
    this.showDynamicPanel('panelPlayOnline');
    const rankedBtn = document.getElementById('panelRankedBtn');
    if (rankedBtn) {
      if (!this.currentUser) {
        rankedBtn.classList.add('btn-disabled');
        rankedBtn.title = this.translate('tooltip_ranked_requires_login');
      } else {
        rankedBtn.classList.remove('btn-disabled');
        rankedBtn.title = '';
      }
    }
  },

  onRankedClick() {
    if (!this.currentUser) {
      this.showToast(this.translate('toast_ranked_requires_login'), 'warning');
      window.location.href = '/login';
      return;
    }
    this.quickMatch(true);
  },

  onPlayFriendClick() {
    trackEvent('play-friend-click');
    this.showDynamicPanel('panelRoom');
  },

  onPlayLocalClick() {
    trackEvent('play-local-click');
    this.showDynamicPanel('panelMode');
  },

  showSettings() { this.showDynamicPanel('panelSettings'); },

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
    this.updateHeaderVisibility();
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
    this.updateHeaderVisibility();
  },

  updateHeaderVisibility() {
    const header = document.getElementById('mainHeader');
    if (!header) return;

    const dynamicPanel = document.getElementById('dynamicPanel');
    const isPanelOpen = dynamicPanel && !dynamicPanel.classList.contains('empty');
    const activeScreen = document.querySelector('.screen.active');
    const isMainMenu = activeScreen && activeScreen.id === 'mainMenu';
    const isProfileModalOpen = document.getElementById('profileModal') && !document.getElementById('profileModal').classList.contains('hidden');

    const isMobile = window.innerWidth <= 768;

    if (isProfileModalOpen) {
      header.classList.add('hidden');
      return;
    }

    if (!isMainMenu) {
      header.classList.add('hidden');
      return;
    }

    if (isMobile && isPanelOpen) {
      header.classList.add('hidden');
    } else {
      header.classList.remove('hidden');
    }
  },

  setLanguage(lang) {
    this.currentLang = lang;
    const dict = this.translations[lang];

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (dict[key]) {
        if (el.tagName === 'INPUT') {
          el.placeholder = dict[key];
        } else {
          el.innerHTML = dict[key];
        }
      }
    });

    // Обновляем атрибут lang у html
    document.getElementById('htmlTag').lang = lang;

    // Sync header language selector
    const headerLang = document.getElementById('headerLang');
    if (headerLang) headerLang.value = lang;
  },

  changeLanguage(lang) {
    this.setLanguage(lang);
    localStorage.setItem('quoridor-lang', lang);
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

  showSearch(timeData, isRanked = false) {
    // 1. Изменение UI
    this.disableAll();
    const btnOnline = document.getElementById('playOnlineBtn');
    if (btnOnline) btnOnline.classList.add('hidden');
    document.getElementById('cancelSearchBtn').classList.remove('hidden');
    document.getElementById('cancelSearchBtn').disabled = false;
    const header = document.getElementById('mainHeader');
    if (header) header.classList.add('hidden');

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
      Net.findGame(timeData, isRanked);
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
    const btnOnline = document.getElementById('playOnlineBtn');
    if (btnOnline) btnOnline.classList.remove('hidden');
    document.getElementById('cancelSearchBtn').classList.add('hidden');
    const header = document.getElementById('mainHeader');
    if (header) header.classList.remove('hidden');

    const container = document.getElementById('dynamicPanel');
    const overlay = document.getElementById('searchOverlay');
    if (overlay) overlay.classList.add('hidden');
    container.classList.remove('searching');

    // Возвращаемся в меню выбора времени или просто закрываем панель
    // Всегда закрываем панель поиска и возвращаемся в меню
    this.hideDynamicPanel();
  },

  showRematchBtn(show) {
    const btn = document.getElementById('rematchBtn');
    if (btn) {
      if (show) {
        btn.classList.remove('hidden');
      } else {
        btn.classList.add('hidden');
      }
    }
  },

  showNewGameBtn(show) {
    const btn = document.getElementById('newGameBtn');
    if (btn) {
      if (show) {
        btn.classList.remove('hidden');
      } else {
        btn.classList.add('hidden');
      }
    }
  },

  showReplayBtn(show) {
    const btn = document.getElementById('replayBtn');
    if (btn) {
      if (show) {
        btn.classList.remove('hidden');
      } else {
        btn.classList.add('hidden');
      }
    }
  },

  renderHistory(history, currentViewIndex = -1) {
    const list = document.getElementById('historyList');
    if (!list) return;
    list.innerHTML = '';

    // Стартовая позиция
    const startRow = document.createElement('div');
    startRow.className = 'history-row start-row';
    const startSpan = document.createElement('span');
    startSpan.className = 'move start-move' + (currentViewIndex === -2 ? ' active' : '');
    startSpan.textContent = UI.translate('btn_start') || 'Start';
    startSpan.onclick = () => Game.setHistoryView(-2);
    startRow.appendChild(startSpan);
    list.appendChild(startRow);

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
      btnFirst.disabled = (histLen === 0 || currentViewIndex === -2);
      btnPrev.disabled = (histLen === 0 || currentViewIndex === -2);
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
        trackEvent('surrender-click');
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
    // this.updateLanguage(); // REMOVED: Resets all dynamic text (names)
  },

  // Force update current screen language
  updateLanguage() {
    this.setLanguage(this.currentLang);
  },


  // --- NOTIFICATIONS (Toasts) ---
  showToast(msg, type = 'info', duration = 3000, onClick = null) {
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

    if (onClick) {
      toast.classList.add('clickable');
      toast.addEventListener('click', () => {
        onClick();
        toast.classList.add('fading');
        toast.addEventListener('animationend', () => toast.remove());
      });
    }

    container.appendChild(toast);

    if (duration > 0 && !onClick) {
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
    trackEvent('room-created');
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
    trackEvent('room-joined');
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
  UI.showDynamicPanel('panelColorSelect');
};

// --- AUTHENTICATION ---
UI.currentUser = null;

// --- LOADING SCREEN ---
UI.loadingTimeout = null;

// New Loading state management
UI.appLoaded = {
  dom: false,
  session: false
};

UI.tryHideLoading = function () {
  if (this.appLoaded.dom && this.appLoaded.session) {
    this.hideLoadingScreen();
  }
};

UI.initLoadingScreen = function () {
  // Set 10s timeout
  this.loadingTimeout = setTimeout(() => {
    const spinner = document.querySelector('#loadingScreen .spinner');
    const text = document.querySelector('#loadingScreen .loading-text');
    const error = document.getElementById('loadingError');

    // Only show error if still loading
    const screen = document.getElementById('loadingScreen');
    if (screen && !screen.classList.contains('hidden')) {
      if (spinner) spinner.style.display = 'none';
      if (text) text.textContent = 'Connection Issue';
      if (error) {
        error.classList.remove('hidden');
        error.querySelector('p').textContent = 'Server took too long to respond.';
      }
    }
  }, 10000);

  // 1. Wait for DOM/Resources
  window.addEventListener('load', () => {
    this.appLoaded.dom = true;
    this.tryHideLoading();
  });
};

UI.hideLoadingScreen = function () {
  if (this.loadingTimeout) clearTimeout(this.loadingTimeout);

  const screen = document.getElementById('loadingScreen');
  if (screen) {
    screen.classList.add('hidden');
    setTimeout(() => {
      // cleanup if needed
    }, 500);
  }
};

// Start loading logic immediately
UI.initLoadingScreen();

UI.logout = async function () {
  await fetch('/api/auth/logout', { method: 'POST' });
  this.currentUser = null;
  this.updateAuthUI();
  this.showToast(this.translate('toast_logged_out'), 'info');
  this.backToMenu();
  window.location.href = '/';
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
  } finally {
    // MARK SESSION AS LOADED
    this.appLoaded.session = true;
    this.tryHideLoading();
  }
};

UI.handleAuthSuccess = function (user) {
  this.currentUser = user;
  this.updateAuthUI();
  // Re-enable ranked button in play online panel if open
  const rankedBtn = document.getElementById('panelRankedBtn');
  if (rankedBtn) {
    rankedBtn.classList.remove('btn-disabled');
    rankedBtn.title = '';
  }
};

UI.updateAuthUI = function () {
  const headerAuth = document.getElementById('headerAuth');
  const headerProfile = document.getElementById('headerProfile');
  const usernameEl = document.getElementById('headerUsername');
  const avatarImg = document.getElementById('headerAvatarImg');

  if (this.currentUser) {
    if (headerAuth) headerAuth.classList.add('hidden');
    if (headerProfile) headerProfile.classList.remove('hidden');
    if (usernameEl) usernameEl.textContent = this.currentUser.username;
    if (avatarImg && this.currentUser.avatarUrl) {
      avatarImg.src = this.currentUser.avatarUrl;
    }
  } else {
    if (headerAuth) headerAuth.classList.remove('hidden');
    if (headerProfile) headerProfile.classList.add('hidden');
  }
};

UI.updateGameInfo = function (profiles, myIndex) {
  if (!profiles) return;

  // Calculate indices based on perspective
  const bottomProfile = profiles[myIndex];
  const topProfile = profiles[1 - myIndex];

  const bottomName = document.getElementById('bottomPlayerName');
  const topName = document.getElementById('topPlayerName');
  const bottomAvatar = document.getElementById('bottomPlayerAvatar');
  const topAvatar = document.getElementById('topPlayerAvatar');

  if (bottomProfile) {
    let text = "Вы";
    if (bottomProfile.name) text = bottomProfile.name;
    if (bottomProfile.rating) text += ` (${bottomProfile.rating})`;
    if (bottomName) bottomName.textContent = text;
    if (bottomAvatar && bottomProfile.avatar) bottomAvatar.src = bottomProfile.avatar;
  }

  if (topProfile) {
    let text = "Оппонент";
    if (topProfile.name) text = topProfile.name;
    if (topProfile.rating) text += ` (${topProfile.rating})`;
    if (topName) topName.textContent = text;
    if (topAvatar && topProfile.avatar) topAvatar.src = topProfile.avatar;
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

    // Fil Ratings
    const ratingEl = document.getElementById('modalRating');
    if (ratingEl) ratingEl.textContent = user.rating || 1200;

    // Load History
    this.loadGameHistory();

    // Open Modal
    document.getElementById('profileModal').classList.remove('hidden');
    // Call visibility update
    this.updateHeaderVisibility();
  } catch (err) {
    console.error('[PROFILE ERROR]', err);
    this.showToast(this.translate('toast_profile_load_error'), 'error');
  }
};

UI.closeProfileModal = function () {
  const modal = document.getElementById('profileModal');
  if (modal) modal.classList.add('hidden');
  // Call visibility update
  UI.updateHeaderVisibility();
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
      this.showToast(this.translate('toast_status_updated'), 'success');
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
        document.getElementById('headerAvatarImg').src = newUrl;
        this.currentUser.avatarUrl = newUrl;
        this.showToast(this.translate('toast_avatar_updated'), 'success');
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
        <td><button class="mini-btn" onclick="UI.openReplayModal('${game._id}')">👁️</button></td>
      `;
      tbody.appendChild(row);
    });
  } catch (err) {
    console.error('[HISTORY ERROR]', err);
  }
};

// --- NEW PROFILE PAGE LOGIC ---

UI.openMyProfile = function () {
  if (this.currentUser && this.currentUser.username) {
    this.showProfilePage(this.currentUser.username);
  } else {
    window.location.href = '/login';
  }
};

UI.showProfilePage = async function (username, pushState = true) {
  try {
    // 0. Show Screen Immediately (Skeleton / Loading State) to avoid FOUC
    this.showScreen('profileScreen');

    // Track current profile for replay return
    this._currentViewingProfile = username;

    // Optional: Reset UI to "Loading" state if needed
    // document.getElementById('ppUsername').textContent = 'Loading...';

    // 1. Fetch Profile Data
    const res = await fetch(`/api/profiles/${username}`);
    if (!res.ok) {
      this.showToast(this.translate('toast_user_not_found'), 'error');
      return;
    }
    const user = await res.json();

    // 2. Fetch Games History
    const gamesRes = await fetch(`/api/profiles/${username}/games?limit=20`);
    const history = await gamesRes.json();

    // 3. Update UI
    document.getElementById('ppUsername').textContent = user.username;
    document.getElementById('ppBio').textContent = user.bio || 'No bio available.';
    document.getElementById('ppJoinedDate').textContent = new Date(user.createdAt).toLocaleDateString();

    const avatarImg = document.getElementById('ppAvatar');
    avatarImg.src = user.avatarUrl || `https://ui-avatars.com/api/?name=${user.username}`;

    // Stats
    const stats = user.stats || {};
    document.getElementById('ppTotalGames').textContent = stats.totalGames || 0;
    const wins = stats.wins || 0;
    const losses = stats.losses || 0;
    document.getElementById('ppWins').innerHTML = `<span class="text-green">${wins}</span>/<span class="text-red">${losses}</span>`;

    const winrate = stats.totalGames ? Math.round((stats.wins / stats.totalGames) * 100) : 0;
    document.getElementById('ppWinrate').textContent = winrate + '%';

    if (user.rating !== undefined) {
      document.getElementById('ppRating').textContent = user.rating;
    }

    // Setup action buttons (logout only for own profile)
    const actionsContainer = document.getElementById('ppActions');
    actionsContainer.innerHTML = '';

    const isOwnProfile = this.currentUser && this.currentUser.username === username;
    if (isOwnProfile) {
      const logoutBtn = document.createElement('button');
      logoutBtn.className = 'pp-logout-btn';
      const label = UI.translate('profile_logout') || 'Log Out';
      logoutBtn.textContent = label;
      logoutBtn.onclick = () => this.logout();
      actionsContainer.appendChild(logoutBtn);
    }

    // Render History
    const historyBody = document.getElementById('ppHistoryBody');
    historyBody.innerHTML = '';

    if (!history || history.length === 0) {
      historyBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px; color: #666;">No games played yet</td></tr>';
    } else {
      history.forEach(game => {
        const row = document.createElement('tr');
        row.style.cursor = 'pointer';
        row.onclick = () => UI.openReplayModal(game._id);

        const isWhite = game.playerWhite && game.playerWhite.username === user.username; // Robust check
        // Handle missing player objects if schema changed or legacy data
        const opponentName = isWhite ?
          (game.playerBlack ? game.playerBlack.username : 'Unknown') :
          (game.playerWhite ? game.playerWhite.username : 'Unknown');

        let resultKey = 'draw';
        let resultLabel = 'Draw';

        if (game.winner !== -1) {
          const iWon = (isWhite && game.winner === 0) || (!isWhite && game.winner === 1);
          resultKey = iWon ? 'win' : 'loss';
          resultLabel = iWon ? 'WON' : 'LOST';
        }

        // Calculate rating change for the profile owner
        let ratingChangeDisplay = '—';
        let ratingClass = 'neutral';

        if (game.isRanked) {
          const myRatingChange = isWhite
            ? (game.playerWhite?.ratingChange || 0)
            : (game.playerBlack?.ratingChange || 0);

          if (myRatingChange > 0) {
            ratingChangeDisplay = `+${myRatingChange}`;
            ratingClass = 'positive';
          } else if (myRatingChange < 0) {
            ratingChangeDisplay = `${myRatingChange}`;
            ratingClass = 'negative';
          } else {
            ratingChangeDisplay = '0';
            ratingClass = 'neutral';
          }
        }

        // Create clickable link for opponent (skip if Unknown)
        const opponentLink = opponentName !== 'Unknown'
          ? `<a href="javascript:void(0)" class="opponent-link" onclick="UI.showProfilePage('${opponentName}')">${opponentName}</a>`
          : opponentName;

        row.innerHTML = `
                <td>${new Date(game.date).toLocaleDateString()}</td>
                <td>vs ${opponentLink}</td>
                <td><span class="history-result-badge ${resultKey}">${resultLabel}</span></td>
                <td><span class="rating-change ${ratingClass}">${ratingChangeDisplay}</span></td>
                <td>${game.turns}</td>
            `;
        historyBody.appendChild(row);
      });
    }

    // 4. Show Screen
    this.showScreen('profileScreen');

    // 5. Update URL
    if (pushState) {
      window.history.pushState({ screen: 'profile', username: username }, '', '/profiles/' + username);
    }
  } catch (err) {
    console.error('Error loading profile:', err);
    this.showToast(this.translate('toast_profile_error'), 'error');
  }
};

UI.backToMenuFromProfile = function () {
  this.backToMenu();
  window.history.pushState({ screen: 'menu' }, '', '/');
};

UI.switchProfileTab = function (tabName, btn) {
  // Hide all contents
  document.querySelectorAll('.pp-tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.pp-tab').forEach(el => el.classList.remove('active'));

  // Show target
  const targetContent = document.getElementById('ppTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
  if (targetContent) targetContent.classList.add('active');

  if (btn) btn.classList.add('active');
};

UI.isValidLobbyCode = function (code) {
  return typeof code === 'string' && /^[A-Z0-9]{5}$/.test(code);
};

UI.getLobbyCodeFromPath = function () {
  const match = window.location.pathname.match(/^\/lobby\/([A-Z0-9]{5})$/i);
  if (!match) return null;
  return match[1].toUpperCase();
};

UI.updateLobbyRoute = function (lobbyCode, replace = false) {
  if (!this.isValidLobbyCode(lobbyCode)) return;
  const target = '/lobby/' + lobbyCode.toUpperCase();
  if (window.location.pathname === target) return;
  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]({ screen: 'lobby', lobbyCode: lobbyCode.toUpperCase() }, '', target);
};

UI.clearLobbyRoute = function () {
  if (window.location.pathname.startsWith('/lobby/')) {
    window.history.pushState({ screen: 'menu' }, '', '/');
  }
};

UI.redirectToActiveLobbyIfNeeded = async function () {
  if (window.location.pathname !== '/') return false;
  const token = localStorage.getItem('quoridor_token');
  try {
    const headers = token ? { 'x-player-token': token } : {};
    const res = await fetch('/api/game/active', { headers });
    if (!res.ok) return false;
    const data = await res.json();
    const lobbyCode = data?.lobbyCode;
    if (data?.hasActiveGame && this.isValidLobbyCode(lobbyCode)) {
      this.updateLobbyRoute(lobbyCode, true);
      return true;
    }
  } catch (err) {
    console.error('[ACTIVE LOBBY REDIRECT ERROR]', err);
  }
  return false;
};

UI.getReplayParam = function () {
  const params = new URLSearchParams(window.location.search);
  return params.get('replay') === 'true';
};

UI.launchReplay = function (data) {
  this.showScreen('gameScreen');
  const gameData = {
    history: data.history || [],
    playerWhite: { username: data.playerProfiles?.[0]?.username || 'White' },
    playerBlack: { username: data.playerProfiles?.[1]?.username || 'Black' }
  };
  Game.startReplay(gameData);
};

UI.initRouting = function () {
  const handleLobbyPath = (lobbyCode, isReplay) => {
    this.showScreen('gameScreen');
    if (!lobbyCode) return;
    Net.rejoinLobbyByCode(lobbyCode, isReplay);
    setTimeout(() => {
      if (Net.isOnline || Net.lobbyId) return;
      if (isReplay) {
        UI.showToast(UI.translate('toast_replay_not_found') || 'Replay not available', 'error');
        UI.clearLobbyRoute();
        UI.showScreen('mainMenu');
      } else {
        Net.joinRoom(lobbyCode);
      }
    }, 500);
  };

  window.addEventListener('popstate', (event) => {
    const path = window.location.pathname;
    const isReplay = this.getReplayParam();
    if (path.startsWith('/profiles/')) {
      const username = path.split('/')[2];
      this.showProfilePage(username, false);
    } else if (path.startsWith('/lobby/')) {
      handleLobbyPath(this.getLobbyCodeFromPath(), isReplay);
    } else {
      this.showScreen('mainMenu');
    }
  });

  // Check initial load
  const path = window.location.pathname;
  const isReplay = this.getReplayParam();
  if (path.startsWith('/profiles/')) {
    const username = path.split('/')[2];
    this.showProfilePage(username, false);
  } else if (path.startsWith('/lobby/')) {
    handleLobbyPath(this.getLobbyCodeFromPath(), isReplay);
  } else {
    this.showScreen('mainMenu');
  }
};

// Leaderboard loader - fetches top players from API
UI.loadLeaderboard = async function () {
  try {
    const res = await fetch('/api/leaderboard');
    const players = await res.json();
    const container = document.getElementById('leaderboard');
    if (!container) return;

    if (players.length === 0) {
      container.innerHTML = '<div class="leaderboard-row" style="justify-content: center; color: #888;">No players yet</div>';
      return;
    }

    container.innerHTML = players.map((p, i) => `
            <div class="leaderboard-row" onclick="UI.showProfilePage('${UI.escapeJsString(p.username)}')">
                <span class="rank">${i + 1}</span>
                <span class="name">${UI.escapeHtml(p.username)}</span>
                <span class="score">${p.rating}</span>
            </div>
        `).join('');
  } catch (err) {
    console.error('[LEADERBOARD] Failed to load:', err);
  }
};


// --- REPLAY SYSTEM (Fullscreen) ---
// Old modal-based replay replaced with Game.startReplay()

// Track current profile being viewed (for replay return)
UI._currentViewingProfile = null;

/**
 * Open Fullscreen Replay for a specific game.
 * Replaces old modal-based replay.
 */
UI.openReplayModal = function (gameId) {
  window.location.href = `/replay/${gameId}`;
};

UI.closeReplayModal = function () {};

document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('quoridor-theme') || 'dark';
  const savedLang = localStorage.getItem('quoridor-lang') || 'en';
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
  UI.redirectToActiveLobbyIfNeeded();

  // Инициализация роутинга
  UI.initRouting();

  // Load leaderboard data
  UI.loadLeaderboard();

  // Legacy query room support -> canonical lobby path
  const urlParams = new URLSearchParams(window.location.search);
  const roomCode = urlParams.get('room');
  const isReplay = UI.getReplayParam();
  const normalizedRoomCode = (roomCode || '').toUpperCase().trim();
  if (UI.isValidLobbyCode(normalizedRoomCode)) {
    UI.updateLobbyRoute(normalizedRoomCode, true);
    UI.showScreen('gameScreen');
    Net.rejoinLobbyByCode(normalizedRoomCode, isReplay);
    setTimeout(() => {
      if (Net.isOnline || Net.lobbyId) return;
      if (isReplay) {
        UI.showToast(UI.translate('toast_replay_not_found') || 'Replay not available', 'error');
        UI.clearLobbyRoute();
        UI.showScreen('mainMenu');
      } else {
        Net.joinRoom(normalizedRoomCode);
      }
    }, 500);
    UI.showToast(UI.translate('toast_room_code_from_link'), 'info');
  }

  // Ranked option click handler for guests
  const rankedCheckbox = document.getElementById('rankedCheckbox');
  const rankedOption = document.getElementById('rankedOption');
  if (rankedOption) {
    rankedOption.addEventListener('click', (e) => {
      if (!UI.currentUser) {
        e.preventDefault();
        e.stopPropagation();
        if (rankedCheckbox) rankedCheckbox.checked = false;
        UI.showToast(UI.translate('toast_ranked_requires_login'), 'warning');
      }
    });
  }

  // Close modals on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      UI.closeProfileModal();
      UI.hideDisconnectOverlay();
      const confirmModal = document.getElementById('confirmModal');
      if (confirmModal) confirmModal.style.display = 'none';

      // If profile screen is open, go back
      if (document.getElementById('profileScreen').classList.contains('active')) {
        UI.backToMenuFromProfile();
      }
    }
  });

});

