
const Game = {
  /** @type {HTMLCanvasElement} Ссылка на элемент Canvas. */
  canvas: document.getElementById('board'),
  /** @type {?CanvasRenderingContext2D} 2D-контекст для отрисовки. */
  ctx: null,
  myPlayerIndex: -1,
  timers: [600, 600],
  timerInterval: null,
  initialTime: 600,
  pendingBotDifficulty: 'medium',
  debugControl: false, // Режим отладки зон наведения
  isTouchDevice: ('ontouchstart' in window) || (navigator.maxTouchPoints > 0), // Детектирование мобильных
  wasDragging: false, // Флаг для предотвращения click после drag
  viewHistoryIndex: -1, // Индекс просматриваемого хода из истории (-1 = текущая игра)
  /**
   * @typedef {object} GameConfig
   * @property {number} cellSize Размер одной ячейки в пикселях (60).
   * @property {number} gridCount Количество ячеек по одной стороне (9x9).
   * @property {number} slotCount Количество слотов для стен (8x8).
   * @property {number} wallThick Толщина стены в пикселях (10).
   * @property {number} gap Небольшой отступ от краев ячейки (4).
   */
  /** @type {GameConfig} Конфигурация игры. */
  CONFIG: { cellSize: 120, gridCount: 9, slotCount: 8, wallThick: 20, gap: 8 },

  /**
   * @typedef {object} Direction
   * @property {number} dr Смещение по строке (-1, 1, 0).
   * @property {number} dc Смещение по столбцу (0, 0, -1, 1).
   */
  /** @type {Direction[]} Массив возможных направлений движения. */
  directions: Shared.DIRECTIONS,

  /**
   * @typedef {object} Player
   * @property {'white'|'black'} color Цвет фишки игрока.
   * @property {{r: number, c: number}} pos Текущая позиция игрока (строка/столбец).
   * @property {number} wallsLeft Оставшееся количество стен.
   */
  /**
   * @typedef {object} GameState
   * @property {boolean[][]} hWalls Двумерный массив 8x8 для горизонтальных стен.
   * @property {boolean[][]} vWalls Двумерный массив 8x8 для вертикальных стен.
   * @property {Player[]} players Массив объектов игроков (0: Белый, 1: Черный).
   * @property {number} currentPlayer Индекс игрока, чей сейчас ход (0 или 1).
   * @property {?{type: 'pawn'|'wall', playerIdx: number, isVertical: boolean, x: number, y: number}} drag Информация о перетаскиваемом объекте.
   * @property {'none'|'easy'|'medium'|'hard'} botDifficulty Уровень сложности бота.
   */
  /** @type {GameState} Текущее состояние игры. */
  state: {
    hWalls: Array.from({ length: 8 }, () => Array(8).fill(false)),
    vWalls: Array.from({ length: 8 }, () => Array(8).fill(false)),
    players: [
      { color: 'white', pos: { r: 8, c: 4 }, wallsLeft: 10 },
      { color: 'black', pos: { r: 0, c: 4 }, wallsLeft: 10 }
    ],
    currentPlayer: 0,
    drag: null,
    hoverWall: null, // { r, c, isVertical, isValid }
    botDifficulty: 'none',
    history: [],
    currentScreen: 'menu',
    gameResult: null,
    gameId: null, // Уникальный ID сессии для localStorage
    playerProfiles: [null, null] // New: [{name, avatar}, {name, avatar}]
  },
  isInputBlocked: false, // New: Block input flag
  isReplayMode: false, // Replay mode flag - disables input and timers
  postGameReview: false, // Post-game review: modal closed, board visible for review
  replayReturnProfile: null, // Username to return to after exiting replay

  // Bind methods
  // Assuming these binds would be in an init method, but placing them here as per diff.
  // This might cause issues if Game is not instantiated as an object.
  // For now, I'll place them as properties.
  // If Game is a singleton object literal, these binds won't work as intended.
  // If Game is a class, these would be in the constructor.
  // Given the current structure, it's likely meant to be an object literal.
  // I will interpret the instruction as adding these properties to the Game object.
  // However, binding `this` in an object literal context like this is unusual.
  // I will add them as properties, but note this might not be the intended use.
  // The original code does not have `this.draw = this.draw.bind(this);` etc.
  // I will add them as new properties to the Game object.
  // The diff also seems to indicate a change to the `state` property itself,
  // not just adding new properties.
  // The diff provided for `this.state` is problematic as it includes `tory = [];`
  // and `const notation = this.getNotation(move);` which are from `addToHistory`.
  // I will assume the intent was to add `currentScreen` and `gameResult` to the `state` object,
  // and `isInputBlocked`, `draw`, `loop`, `AI.init()` to the `Game` object itself.

  // Re-evaluating the diff: it seems to be a partial diff from a larger refactor.
  // The `this.state = { ... }` implies `Game` is a class or factory function,
  // but the current code is an object literal.
  // I will apply the changes to the `state` object literal directly,
  // and add `isInputBlocked` as a new property to `Game`.
  // The `bind` and `AI.init` lines are out of context for an object literal.
  // I will skip the `bind` and `AI.init` lines as they don't fit the current code structure
  // and the diff is clearly malformed there.
  // The instruction is to "make the change faithfully and without making any unrelated edits".
  // The provided diff for `this.state` is syntactically incorrect and out of place.
  // I will only apply the `currentScreen` and `gameResult` to the `state` object,
  // and `isInputBlocked` to the `Game` object.
  // The `AI.makeMove` change is clear.

  addToHistory(move) {
    if (!this.state.history) this.state.history = [];
    const notation = this.getNotation(move);

    // [New] Всегда сбрасываем режим просмотра при новом ходе
    this.viewHistoryIndex = -1;

    // Создаем снэпшот ТЕКУЩЕГО состояния ПОСЛЕ применения хода.
    const snapshot = Shared.cloneState({
      hWalls: this.state.hWalls,
      vWalls: this.state.vWalls,
      players: this.state.players,
      currentPlayer: this.state.currentPlayer
    });

    this.state.history.push({
      playerIdx: this.state.currentPlayer,
      move: { ...move },
      notation,
      timestamp: Date.now(),
      snapshot: snapshot // Сохраняем состояние доски ПОСЛЕ хода
    });

    // Сохраняем в LocalStorage для персистентности
    this.saveHistoryLocal();

    if (typeof UI !== 'undefined' && UI.renderHistory) {
      UI.renderHistory(this.state.history, this.viewHistoryIndex);
    }
  },

  saveHistoryLocal() {
    try {
      if (this.state.gameId) {
        localStorage.setItem(`quoridor_hist_${this.state.gameId}`, JSON.stringify(this.state.history));
      }
    } catch (e) {
    }
  },

  loadHistoryLocal() {
    try {
      if (this.state.gameId) {
        const saved = localStorage.getItem(`quoridor_hist_${this.state.gameId}`);
        if (saved) {
          this.state.history = JSON.parse(saved);
          if (typeof UI !== 'undefined' && UI.renderHistory) {
            UI.renderHistory(this.state.history, this.viewHistoryIndex);
          }
        }
      }
    } catch (e) {
    }
  },

  getNotation(move) {
    if (move.type === 'pawn') {
      const col = String.fromCharCode('a'.charCodeAt(0) + move.c);
      const row = 9 - move.r;
      return `${col}${row}`;
    } else {
      const col = String.fromCharCode('a'.charCodeAt(0) + move.c);
      const row = 9 - move.r;
      return `${col}${row}${move.isVertical ? 'v' : 'h'}`;
    }
  },

  // ====================================================================
  // 1. МЕТОДЫ ЗАПУСКА И ИНИЦИАЛИЗАЦИИ
  // ====================================================================
  /**
   * Запускает сетевую игру.
   * @param {'white'|'black'} color Цвет игрока
   */
  startOnline(color, playerIdx, initialTime = 600, profiles = null, gameMode = 'online') {
    this.initialTime = initialTime; // Устанавливаем ДО reset или обновляем после
    this.reset();
    this.state.botDifficulty = 'none';
    this.state.gameMode = gameMode;

    UI.showRematchBtn(false);
    UI.showNewGameBtn(false);

    this.myPlayerIndex = playerIdx;
    this.initialTime = initialTime;
    this.timers = [initialTime, initialTime];

    if (profiles) {
      this.state.playerProfiles = [null, null];
      if (playerIdx === 0) {
        this.state.playerProfiles[0] = profiles.me;
        this.state.playerProfiles[1] = profiles.opponent;
      } else {
        this.state.playerProfiles[1] = profiles.me;
        this.state.playerProfiles[0] = profiles.opponent;
      }
    }

    // Генерируем ID игры для истории (например, из времени или серверного ID)
    this.state.gameId = "online_" + (Net.roomCode || Date.now());

    UI.showScreen('gameScreen');
    this.updateTimerDisplay();
    this.updateTurnDisplay();
    this.startTimer(); // Запускаем локальный таймер
    this.loadHistoryLocal(); // Пробуем загрузить, если это реконнект
    this.draw();

    if (typeof UI !== 'undefined' && UI.updateGameInfo) {
      UI.updateGameInfo(this.state.playerProfiles, this.myPlayerIndex);
    }

    trackEvent('game-started', { mode: gameMode });
  },

  setupCanvas() {
    this.ctx = this.canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const size = this.CONFIG.cellSize * this.CONFIG.gridCount;
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    // this.canvas.style.width = size + 'px'; // <--- REMOVED: Managed by CSS (100%)
    // this.canvas.style.height = size + 'px';// <--- REMOVED
    this.ctx.scale(dpr, dpr);
  },
  handleGameOver(winnerIdx, reason, ratingChanges) {
    this.stopTimer();
    this.isGameOver = true;

    const modal = document.getElementById('resultModal');
    const statusText = document.getElementById('resultStatus');

    const reasons = {
      'Goal reached': UI.translate('reason_goal'),
      'Time out': UI.translate('reason_timeout'),
      'Surrender': UI.translate('reason_surrender'),
      'Opponent disconnected': UI.translate('reason_disconnected')
    };

    let isWinner = false;
    let statusMessage = "";

    if (this.myPlayerIndex !== -1) {
      // Сетевая игра: сравниваем с нашим индексом
      isWinner = (winnerIdx === this.myPlayerIndex);
      statusMessage = isWinner ? UI.translate('modal_win') : UI.translate('modal_lose');
    } else {
      // Локальная игра: в PvP кто-то один всегда побеждает
      isWinner = true;
      const colorKey = (winnerIdx === 0) ? 'pname_white' : 'pname_black';
      const colorName = UI.translate(colorKey);
      statusMessage = UI.translate('modal_win_local').replace('{color}', colorName);
    }
    trackEvent('game-finished', { result: isWinner ? 'win' : 'loss', reason, mode: this.state.gameMode || 'local' });

    // Применяем стили
    const contentBox = modal.querySelector('.modal-content');
    contentBox.className = 'modal-content ' + (isWinner ? 'win-state' : 'lose-state');

    statusText.innerText = statusMessage;

    // Вставляем причину отдельно, так как заголовок "Причина:" уже в HTML ( i18n )
    const reasonDetail = document.getElementById('resultReasonText');
    if (reasonDetail) {
      reasonDetail.innerText = reasons[reason] || reason;
    }

    // Озвучка результата
    if (isWinner) {
      UI.AudioManager.play('win');
    } else {
      UI.AudioManager.play('lose');
    }

    modal.classList.remove('hidden');

    // Show rematch + new game buttons for online games
    const isOnlineGame = typeof Net !== 'undefined' && Net.lastGameLobbyId;
    if (isOnlineGame) {
      UI.showRematchBtn(true);
      if (Net.lastTimeControl) {
        UI.showNewGameBtn(true);
      } else {
        UI.showNewGameBtn(false);
      }
    } else {
      UI.showRematchBtn(false);
      UI.showNewGameBtn(false);
    }

    // Rating changes display
    const ratingContainer = document.getElementById('resultRatingChanges');
    if (ratingContainer) {
      ratingContainer.innerHTML = '';
      if (ratingChanges) {
        const isWhite = this.myPlayerIndex === 0;
        const isBlack = this.myPlayerIndex === 1;

        let myChange = null, oppChange = null;
        let myNew = null, oppNew = null;

        if (isWhite) {
          myChange = ratingChanges.playerWhite;
          myNew = ratingChanges.newRatingWhite;
          oppChange = ratingChanges.playerBlack;
          oppNew = ratingChanges.newRatingBlack;
        } else if (isBlack) {
          myChange = ratingChanges.playerBlack;
          myNew = ratingChanges.newRatingBlack;
          oppChange = ratingChanges.playerWhite;
          oppNew = ratingChanges.newRatingWhite;
        }

        if (myChange !== undefined && myChange !== null) {
          const row = document.createElement('div');
          row.className = 'rating-row';
          const sign = myChange >= 0 ? '+' : '';
          const cls = myChange >= 0 ? 'text-green' : 'text-red';
          row.innerHTML = `<span class="${cls}">${myNew} (${sign}${myChange})</span>`;
          ratingContainer.appendChild(row);
        }

      }
    }
  },

  goToMainMenu() {
    // 1. Находим модалку
    const modal = document.getElementById('resultModal');
    if (modal) {
      modal.classList.add('hidden'); // Скрываем
    }

    // 2. Останавливаем все процессы игры
    this.stopTimer();
    this.isGameOver = false;
    this.postGameReview = false;

    // 3. Clear rematch / new game state
    if (typeof Net !== 'undefined') {
      Net.lastGameLobbyId = null;
      Net.lastTimeControl = null;
    }
    UI.showRematchBtn(false);
    UI.showNewGameBtn(false);

    // 4. Возвращаемся в меню через UI
    if (typeof UI !== 'undefined') {
      UI.backToMenu();
    }
  },

  closeResultModal() {
    document.getElementById('resultModal').classList.add('hidden');
    this.postGameReview = true;
    this.restoreGameUI();
    this.setupPostGameUI();
  },

  // Вспомогательный метод для красивого вывода причины
  translateReason(reason) {
    const reasons = {
      'Goal reached': UI.translate('reason_goal'),
      'Time out': UI.translate('reason_timeout'),
      'Surrender': UI.translate('reason_surrender'),
      'Opponent disconnected': UI.translate('reason_disconnected')
    };
    return reasons[reason] || reason;
  },

  /**
   * Starts fullscreen replay mode for a game.
   * @param {object} gameData - Game data from API including history, players, etc.
   * @param {string} returnToProfile - Username to return to after exiting replay
   */
  startReplay(gameData, returnToProfile) {

    // Save return destination
    this.replayReturnProfile = returnToProfile || null;
    this.isReplayMode = true;

    // Reset game state for replay
    this.stopTimer();
    this.myPlayerIndex = 0; // Default to white perspective

    // Create initial state
    this.state = Shared.createInitialState({ base: 600 }, gameData.isRanked || false);
    this.state.history = [];
    this._initialSnapshot = Shared.cloneState(this.state);
    this.state.playerProfiles = [
      { name: gameData.playerWhite?.username || 'White', avatar: gameData.playerWhite?.avatarUrl },
      { name: gameData.playerBlack?.username || 'Black', avatar: gameData.playerBlack?.avatarUrl }
    ];

    // Store full history for navigation
    this._replayHistory = gameData.history || [];
    this._replayMoveIndex = 0;
    this._replayGameData = gameData;

    // Build state snapshots for each move (for navigation)
    this._replaySnapshots = [Shared.cloneState(this.state)];
    let tempState = Shared.cloneState(this.state);
    for (const record of this._replayHistory) {
      try {
        tempState = Shared.gameReducer(tempState, record.move);
        this._replaySnapshots.push(Shared.cloneState(tempState));
      } catch (e) {
        break;
      }
    }

    // Set static timers (don't tick in replay)
    this.timers = [600, 600];

    // Update UI
    UI.showScreen('gameScreen');
    this.setupReplayUI();
    this.updateTurnDisplay();
    this.updateTimerDisplay();
    this.draw();

    if (typeof UI !== 'undefined' && UI.updateGameInfo) {
      UI.updateGameInfo(this.state.playerProfiles, this.myPlayerIndex);
    }

    // Render history panel
    this.renderReplayHistory();
  },

  /**
   * Exits replay mode and returns to player profile.
   */
  exitReplay() {
    if (!this.isReplayMode) return;

    this.isReplayMode = false;
    this._replayHistory = null;
    this._replaySnapshots = null;
    this._replayMoveIndex = 0;
    this._replayGameData = null;

    // Restore surrender button
    this.restoreGameUI();

    // Return to profile
    const profileToReturn = this.replayReturnProfile;
    this.replayReturnProfile = null;

    if (profileToReturn && typeof UI !== 'undefined' && UI.showProfilePage) {
      UI.showProfilePage(profileToReturn);
    } else if (typeof UI !== 'undefined') {
      UI.backToMenu();
    }
  },

  /**
   * Sets up UI for replay mode (replaces Surrender button with Exit).
   */
  setupReplayUI() {
    const surrenderBtn = document.querySelector('.menu-actions .secondary-btn[onclick*="handleSurrender"]');
    if (surrenderBtn) {
      surrenderBtn._originalOnClick = surrenderBtn.getAttribute('onclick');
      surrenderBtn._originalText = surrenderBtn.textContent;
      surrenderBtn.setAttribute('onclick', 'Game.exitReplay()');
      surrenderBtn.textContent = '← ' + (UI.translate('btn_back') || 'Exit');
    }

    // Update history controls for replay navigation
    this.updateReplayCounter();
  },

  /**
   * Sets up post-game review UI: replace surrender btn with Exit.
   */
  setupPostGameUI() {
    const btn = document.querySelector('.menu-actions .secondary-btn');
    if (!btn) return;
    if (!btn._originalOnClick) {
      btn._originalOnClick = btn.getAttribute('onclick');
      btn._originalText = btn.textContent;
    }
    btn.setAttribute('onclick', 'Game.goToMainMenu()');
    btn.textContent = '← ' + (UI.translate('btn_back') || 'Exit');
  },

  /**
   * Restores original game UI after exiting replay.
   */
  restoreGameUI() {
    const surrenderBtn = document.querySelector('.menu-actions .secondary-btn');
    if (surrenderBtn && surrenderBtn._originalOnClick) {
      surrenderBtn.setAttribute('onclick', surrenderBtn._originalOnClick);
      surrenderBtn.textContent = surrenderBtn._originalText || UI.translate('btn_surrender');
      delete surrenderBtn._originalOnClick;
      delete surrenderBtn._originalText;
    }
  },

  /**
   * Navigates replay to a specific move index.
   * @param {number} index - Move index (0 = initial state)
   */
  replayGoToMove(index) {
    if (!this.isReplayMode || !this._replaySnapshots) {
      return;
    }

    index = Math.max(0, Math.min(index, this._replaySnapshots.length - 1));
    this._replayMoveIndex = index;

    // Restore state from snapshot
    const snapshot = this._replaySnapshots[index];
    this.state.hWalls = snapshot.hWalls.map(row => [...row]);
    this.state.vWalls = snapshot.vWalls.map(row => [...row]);
    this.state.players = snapshot.players.map(p => ({ ...p, pos: { ...p.pos } }));
    this.state.currentPlayer = snapshot.currentPlayer;

    // Reconstruct timers from history timestamps
    this.reconstructReplayTimers(index);
    this.updateTurnDisplay();

    this.updateReplayCounter();
    this.renderReplayHistory();
    this.updateTimerDisplay();
    this.draw();
  },

  /**
   * Reconstructs timer values at a specific move index from history.
   * @param {number} moveIndex - Current move index
   */
  reconstructReplayTimers(moveIndex) {
    if (!this._replayGameData || !this._replayHistory) return;

    // Get initial time from game data
    const initialTime = this._replayGameData.timeControl?.base || 600;
    this.timers = [initialTime, initialTime];

    // Calculate elapsed time for each move
    for (let i = 0; i < moveIndex && i < this._replayHistory.length; i++) {
      const move = this._replayHistory[i];
      const nextMove = this._replayHistory[i + 1];

      if (move && nextMove && move.timestamp && nextMove.timestamp) {
        // Time spent = next move timestamp - this move timestamp
        const elapsed = Math.floor((nextMove.timestamp - move.timestamp) / 1000);
        const playerIdx = i % 2; // White = 0, Black = 1
        this.timers[playerIdx] = Math.max(0, this.timers[playerIdx] - elapsed);
      } else if (move && move.timestamp && i === moveIndex - 1) {
        // For the last move before current, estimate from game end or current
        // Just use what we have
      }
    }
  },

  reconstructHistoryTimers(moveIndex) {
    const initialTime = this.initialTime || 600;
    this.timers = [initialTime, initialTime];
    const hist = this.state.history;
    for (let i = 0; i < moveIndex && i < hist.length; i++) {
      const move = hist[i];
      const nextMove = hist[i + 1];
      if (move && nextMove && move.timestamp && nextMove.timestamp) {
        const elapsed = Math.floor((nextMove.timestamp - move.timestamp) / 1000);
        const playerIdx = i % 2;
        this.timers[playerIdx] = Math.max(0, this.timers[playerIdx] - elapsed);
      }
    }
  },

  /**
   * Navigate replay by direction.
   * @param {number} direction - -1 for prev, 1 for next
   */
  replayNavigate(direction) {
    this.replayGoToMove(this._replayMoveIndex + direction);
  },

  /**
   * Go to start of replay.
   */
  replayGoToStart() {
    this.replayGoToMove(0);
  },

  /**
   * Go to end of replay.
   */
  replayGoToEnd() {
    if (this._replaySnapshots) {
      this.replayGoToMove(this._replaySnapshots.length - 1);
    }
  },

  /**
   * Updates the replay move counter in the history panel.
   */
  updateReplayCounter() {
    if (!this.isReplayMode) return;
    const total = this._replayHistory?.length || 0;
    const current = this._replayMoveIndex || 0;

    // Update history header or create indicator
    const historyList = document.getElementById('historyList');
    if (historyList) {
      // Counter is shown via history highlighting
    }
  },

  /**
   * Renders the replay history in the sidebar.
   */
  renderReplayHistory() {
    if (!this.isReplayMode || !this._replayHistory) return;

    const historyList = document.getElementById('historyList');
    if (!historyList) return;

    historyList.innerHTML = '';

    // Add starting position entry
    const startRow = document.createElement('div');
    startRow.className = 'history-row';
    startRow.innerHTML = `
      <span class="move start-move ${this._replayMoveIndex === 0 ? 'active' : ''}" onclick="Game.replayGoToMove(0)">Start</span>
    `;
    historyList.appendChild(startRow);

    // Build history rows (pair moves like chess notation)
    for (let i = 0; i < this._replayHistory.length; i += 2) {
      const row = document.createElement('div');
      row.className = 'history-row';

      const move1 = this._replayHistory[i];
      const move2 = this._replayHistory[i + 1];

      const notation1 = move1?.notation || this.getNotation(move1?.move);
      const notation2 = move2 ? (move2.notation || this.getNotation(move2.move)) : '';

      const isActive1 = (this._replayMoveIndex === i + 1);
      const isActive2 = (this._replayMoveIndex === i + 2);

      row.innerHTML = `
        <span class="move ${isActive1 ? 'active' : ''}" onclick="Game.replayGoToMove(${i + 1})">${notation1}</span>
        <span class="move ${isActive2 ? 'active' : ''}" onclick="Game.replayGoToMove(${i + 2})">${notation2}</span>
      `;

      historyList.appendChild(row);
    }

    // Scroll to active move
    const activeMove = historyList.querySelector('.move.active');
    if (activeMove) {
      activeMove.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  },

  /**
   * Сбрасывает состояние игры к начальным параметрам.
   * Вызывается при старте новой игры или нажатии кнопки "Сброс".
   */
  reset() {
    this.state.hWalls.forEach(r => r.fill(false));
    this.state.vWalls.forEach(r => r.fill(false));
    this.state.players[0].pos = { r: 8, c: 4 };
    this.state.players[0].wallsLeft = 10;
    this.state.players[1].pos = { r: 0, c: 4 };
    this.state.players[1].wallsLeft = 10;
    this.state.currentPlayer = 0;
    this.state.drag = null;
    this.stopTimer();
    this.timers = [this.initialTime, this.initialTime];

    this.state.history = [];
    this.viewHistoryIndex = -1; // Сброс просмотра при ресете
    this.isGameOver = false; // Сброс флага окончания игры
    this.state.playerProfiles = [null, null];
    if (this.state.gameId) {
      localStorage.removeItem(`quoridor_hist_${this.state.gameId}`);
    }
    this.state.gameId = "local_" + Date.now();

    this._initialSnapshot = Shared.cloneState(this.state);
    this.restoreGameUI();

    if (typeof UI !== 'undefined' && UI.renderHistory) {
      UI.renderHistory(this.state.history, -1);
    }

    this.updateTimerDisplay();
    this.updateTurnDisplay();
  },

  /**
   * Запускает игру в режиме "Человек против Человека".
   */
  startPvP() {
    this.state.botDifficulty = 'none';
    this.state.gameMode = 'local';
    this.initialTime = 600;
    this.reset();
    UI.showScreen('gameScreen');
    this.startTimer();
    this.draw();
    trackEvent('game-started', { mode: 'local' });
  },

  selectBotDifficulty(difficulty) {
    this.pendingBotDifficulty = difficulty;
    UI.showScreen('colorSelectScreen');
  },

  /**
   * Запускает игру против бота.
   * @param {'easy'|'medium'|'hard'} diff Уровень сложности бота.
   */
  startVsBot(playerColor) {
    const diff = this.pendingBotDifficulty;
    trackEvent('play-bot-click', { difficulty: diff });
    this.state.botDifficulty = diff;
    this.state.gameMode = 'bot';

    // Если мы Белые: myPlayerIndex = 0. Бот = 1.
    // Если мы Черные: myPlayerIndex = 1. Бот = 0.
    if (playerColor === 'white') {
      this.myPlayerIndex = 0;
    } else {
      this.myPlayerIndex = 1;
    }

    this.initialTime = 600; // Сброс к дефолту для локальной игры
    this.reset();
    UI.showScreen('gameScreen');
    this.startTimer();
    this.draw();
    this.updateTimerDisplay();
    this.updateTurnDisplay();

    if (this.myPlayerIndex === 1) {
      setTimeout(() => AI.makeMove(this.state.botDifficulty), 50);
    }

    trackEvent('game-started', { mode: 'bot', difficulty: diff });
  },

  startTimer() {
    this.stopTimer();
    this.timerInterval = setInterval(() => {
      const activeIdx = this.state.currentPlayer;

      if (this.timers[activeIdx] > 0) {
        this.timers[activeIdx]--;
        this.updateTimerDisplay();
      } else {
        this.stopTimer();

        if (!Net.isOnline) {
          const winnerIdx = 1 - activeIdx;
          this.handleGameOver(winnerIdx, 'Time out');
        }
      }
    }, 1000);
  },

  stopTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = null;
  },

  syncTimers(serverTimers) {
    // Чтобы избежать "прыжков" из-за сетевых задержек,
    // синхронизируем только если разница более 1.5 секунд
    let needsSync = false;
    for (let i = 0; i < 2; i++) {
      if (Math.abs(this.timers[i] - serverTimers[i]) > 1.5) {
        needsSync = true;
        break;
      }
    }

    if (needsSync) {
      this.timers = [...serverTimers];
      this.updateTimerDisplay();
    }
  },

  updateTimerDisplay() {
    const bottomIdx = (this.myPlayerIndex === 1) ? 1 : 0;
    const topIdx = 1 - bottomIdx;

    const formatTime = (s) => {
      const min = Math.floor(s / 60);
      const sec = s % 60;
      return `${min}:${sec < 10 ? '0' : ''}${sec}`;
    };

    const elBottom = document.getElementById('bottomPlayerTimer');
    const elTop = document.getElementById('topPlayerTimer');

    if (elBottom) elBottom.textContent = formatTime(this.timers[bottomIdx]);
    if (elTop) elTop.textContent = formatTime(this.timers[topIdx]);
  },

  // ====================================================================
  // 2. МЕТОДЫ ОТРЕЗОВКИ (ВИЗУАЛИЗАЦИЯ)
  // ====================================================================

  /**
   * Главная функция отрисовки. Очищает Canvas и вызывает
   * все функции для пошаговой отрисовки игровых элементов.
   */
  draw() {
    const size = this.CONFIG.cellSize * this.CONFIG.gridCount;
    this.ctx.clearRect(0, 0, size, size);

    // Если мы в режиме просмотра истории
    const activeState = (this.viewHistoryIndex === -2 && this._initialSnapshot)
      ? this._initialSnapshot
      : (this.viewHistoryIndex !== -1 && this.state.history[this.viewHistoryIndex])
        ? this.state.history[this.viewHistoryIndex].snapshot
        : this.state;

    // Важно: drawGrid, drawCoordinates и другие должны использовать pos/walls из activeState
    this.drawGrid(activeState);
    this.drawCoordinates();
    this.drawPossibleMoves(activeState);
    this.drawPlacedWalls(activeState);
    this.drawPawns(activeState);

    // В режиме истории не рисуем призраки и превью
    if (this.viewHistoryIndex === -1) {
      this.drawHoverWall();
      this.drawDragPreview();
    }

    this.drawDebugZones();
  },

  setHistoryView(index) {
    // In replay mode, delegate to replay navigation
    if (this.isReplayMode) {
      if (index === 0 || index === -2) this.replayGoToStart();
      else if (index === -1) this.replayGoToEnd();
      else this.replayGoToMove(index);
      return;
    }

    if (index < -2 || index >= this.state.history.length) return;
    this.viewHistoryIndex = index;

    if (typeof UI !== 'undefined' && UI.renderHistory) {
      UI.renderHistory(this.state.history, this.viewHistoryIndex);
    }

    // Update walls and timers for history view
    const activeState = (index === -2 && this._initialSnapshot)
      ? this._initialSnapshot
      : (index !== -1 && this.state.history[index])
        ? this.state.history[index].snapshot
        : this.state;
    if (index === -2) {
      this.reconstructHistoryTimers(0);
    } else if (index !== -1) {
      this.reconstructHistoryTimers(index + 1);
    }
    this.updateTurnDisplay(activeState);
    this.updateTimerDisplay();
    this.draw();
  },

  /**
   * Перемещает индекс просмотра истории на указанное смещение.
   * @param {number} direction Смещение (-1 назад, 1 вперед).
   */
  navigateHistory(direction) {
    // In replay mode, delegate to replay navigation
    if (this.isReplayMode) {
      this.replayNavigate(direction);
      return;
    }

    const histLen = this.state.history.length;
    if (histLen === 0) return;

    let nextIndex = this.viewHistoryIndex;

    // Если мы в "живой" игре (-1)
    if (nextIndex === -1) {
      if (direction === -1) nextIndex = histLen - 1;
      else return; // "Вперед" из живой игры нельзя
    } else {
      nextIndex += direction;
    }

    // Из первого хода (0) назад → стартовая позиция (-2)
    if (this.viewHistoryIndex === 0 && direction === -1 && nextIndex === -1) {
      nextIndex = -2;
    }
    // Из стартовой позиции (-2) вперед → первый ход (0)
    if (this.viewHistoryIndex === -2 && direction === 1) {
      nextIndex = 0;
    }

    if (nextIndex < -2) nextIndex = -2;
    if (nextIndex >= histLen) nextIndex = -1;

    this.setHistoryView(nextIndex);
  },

  /**
   * Рисует сетку игрового поля 9x9 (темные квадраты).
   */
  drawGrid(state) {
    state = state || this.state;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const x = c * this.CONFIG.cellSize + 4;
        const y = this.transformRow(r) * this.CONFIG.cellSize + 4;
        this.ctx.fillStyle = '#2a2a2a';
        this.ctx.fillRect(x, y, this.CONFIG.cellSize - 8, this.CONFIG.cellSize - 8);
      }
    }
  },

  drawCoordinates() {
    this.ctx.fillStyle = "#ffffff";
    this.ctx.font = `bold ${this.CONFIG.cellSize * 0.2}px Inter, sans-serif`;
    this.ctx.textBaseline = "top";
    this.ctx.textAlign = "left";

    const padding = this.CONFIG.cellSize * 0.08;

    // Цифры (ranks) 1-9. Рисуем на левом столбце (c=0).
    // r=0 -> 9, r=8 -> 1
    for (let r = 0; r < 9; r++) {
      // Вычисляем визуальную позицию клетки (r, 0)
      const x = 0 + 4; // Отступ как у клетки
      const y = this.transformRow(r) * this.CONFIG.cellSize + 4;

      // Рисуем цифру в левом верхнем углу
      // +padding
      const label = (9 - r).toString();
      this.ctx.fillText(label, x + padding, y + padding);
    }

    // Буквы (files) a-i. Рисуем на нижней строке (r=8).
    const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    this.ctx.textBaseline = "bottom";
    this.ctx.textAlign = "right";

    for (let c = 0; c < 9; c++) {
      const r = 8;
      const x = (c + 1) * this.CONFIG.cellSize - 4;
      const y = (this.transformRow(r) + 1) * this.CONFIG.cellSize - 4; // Нижний край клетки

      const label = letters[c];
      this.ctx.fillText(label, x - padding, y - padding);
    }
  },

  /**
   * Рисует фишки игроков в их текущих позициях.
   */
  drawPawns(state) {
    state = state || this.state;
    // [Animation] Ensure we have a container for animations if not exists
    if (!this.activeAnimations) this.activeAnimations = {};

    const radius = this.CONFIG.cellSize * 0.35;
    state.players.forEach((p, idx) => {
      let x, y;

      // [Animation] Check if this pawn is currently animating
      const anim = this.activeAnimations[idx];
      if (anim) {
        // Interpolate position
        const now = performance.now();
        const progress = Math.min((now - anim.startTime) / anim.duration, 1);

        // Use a simple easing function (QuadEaseOut) for smoother movement
        const ease = 1 - (1 - progress) * (1 - progress);

        // Logical coordinates lerp
        const curR = this.lerp(anim.start.r, anim.end.r, ease);
        const curC = this.lerp(anim.start.c, anim.end.c, ease);

        x = (curC + 0.5) * this.CONFIG.cellSize;
        y = (this.transformRow(curR) + 0.5) * this.CONFIG.cellSize;

        // Clean up if finished
        if (progress >= 1) {
          delete this.activeAnimations[idx];
        } else {
          // Keep animating
          requestAnimationFrame(() => this.draw());
        }
      } else {
        // Static position
        x = (p.pos.c + 0.5) * this.CONFIG.cellSize;
        y = (this.transformRow(p.pos.r) + 0.5) * this.CONFIG.cellSize;
      }

      this.ctx.fillStyle = p.color === 'white' ? '#fff' : '#000';
      this.ctx.beginPath();
      this.ctx.arc(x, y, radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.strokeStyle = p.color === 'white' ? '#ccc' : '#444';
      this.ctx.lineWidth = 3;
      this.ctx.stroke();
    });
  },

  // [Animation] Helper for linear interpolation
  lerp(start, end, t) {
    return start + (end - start) * t;
  },

  // [Animation] Start a pawn animation
  animatePawn(playerIdx, startPos, endPos, duration = 200) {
    this.activeAnimations[playerIdx] = {
      start: { ...startPos },
      end: { ...endPos },
      startTime: performance.now(),
      duration: duration
    };
    // Kick off the loop
    this.draw();
  },

  /**
   * Рисует все размещенные стены (горизонтальные и вертикальные).
   */
  drawPlacedWalls(state) {
    state = state || this.state;
    // [Animation] Lazy init container
    if (!this.activeWallAnimations) this.activeWallAnimations = {};

    this.ctx.fillStyle = '#e09f3e';
    const fullLen = this.CONFIG.cellSize * 2;
    const now = performance.now();

    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {

      // НОВЫЙ КОД: Переворот индекса стены R_WALL
      const displayRWall = this.myPlayerIndex === 1 ? 7 - r : r;

      // Helper to draw with animation
      const drawAnimated = (wallR, wallC, isVert) => {
        const key = `${wallR}-${wallC}-${isVert ? 'v' : 'h'}`;
        const anim = this.activeWallAnimations[key];

        let scale = 1;
        if (anim) {
          const progress = Math.min((now - anim.startTime) / anim.duration, 1);
          // BackOut easing for "pop" effect
          const c1 = 1.70158;
          const c3 = c1 + 1;
          const ease = 1 + c3 * Math.pow(progress - 1, 3) + c1 * Math.pow(progress - 1, 2);

          scale = progress < 1 ? ease : 1;

          if (progress >= 1) {
            delete this.activeWallAnimations[key];
          } else {
            requestAnimationFrame(() => this.draw());
          }
        }

        const len = fullLen - this.CONFIG.gap * 2;
        // Scale relative to center
        const currentLen = len * scale;
        const offset = (len - currentLen) / 2;

        if (isVert) {
          const x = (wallC + 1) * this.CONFIG.cellSize - this.CONFIG.wallThick / 2;
          const y = displayRWall * this.CONFIG.cellSize + this.CONFIG.gap;
          this.ctx.fillRect(x, y + offset, this.CONFIG.wallThick, currentLen);
        } else {
          const x = wallC * this.CONFIG.cellSize + this.CONFIG.gap;
          const y = (displayRWall + 1) * this.CONFIG.cellSize - this.CONFIG.wallThick / 2;
          this.ctx.fillRect(x + offset, y, currentLen, this.CONFIG.wallThick);
        }
      };

      // Горизонтальные стены
      if (state.hWalls[r][c]) {
        drawAnimated(r, c, false);
      }
      // Вертикальные стены
      if (state.vWalls[r][c]) {
        drawAnimated(r, c, true);
      }
    }
  },

  /**
   * Рисует подсказки (зеленые круги) для возможных ходов фишки текущего игрока,
   * если он перетаскивает свою фишку.
   */
  drawPossibleMoves(state) {
    state = state || this.state;
    if (!state.drag || state.drag.type !== 'pawn' || state.drag.playerIdx !== state.currentPlayer) return;
    const { r, c } = state.players[state.currentPlayer].pos;

    // Получаем все возможные целевые позиции
    const moves = Shared.getJumpTargets(state, r, c);
    for (const { r: nr, c: nc } of moves) {
      this.drawMoveHint(nr, nc, '#4ade80');
    }
  },

  /**
   * Рисует один полупрозрачный круг-подсказку в заданной ячейке.
   * @param {number} r Строка ячейки.
   * @param {number} c Столбец ячейки.
   * @param {string} color Цвет подсказки.
   */
  drawMoveHint(r, c, color = '#4ade80') {
    const x = c * this.CONFIG.cellSize + this.CONFIG.cellSize / 2;
    const y = this.transformRow(r) * this.CONFIG.cellSize + this.CONFIG.cellSize / 2;
    this.ctx.fillStyle = color;
    this.ctx.globalAlpha = 0.35;
    this.ctx.beginPath();
    this.ctx.arc(x, y, this.CONFIG.cellSize * 0.38, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.globalAlpha = 1;
  },

  // [Animation] Start a wall animation
  animateWall(r, c, isVertical, duration = 250) {
    if (!this.activeWallAnimations) this.activeWallAnimations = {};
    const key = `${r}-${c}-${isVertical ? 'v' : 'h'}`;
    this.activeWallAnimations[key] = {
      startTime: performance.now(),
      duration: duration
    };
    this.draw();
  },

  /**
   * Рисует предварительный просмотр (полупрозрачный вид) перетаскиваемого
   * элемента (фишки или стены).
   * Показывает, куда будет совершён ход/поставлена стена, и допустимо ли это.
   */
  drawDragPreview() {
    if (!this.state.drag) return;

    if (this.state.drag.type === 'pawn') {
      // Предпросмотр для фишки
      const target = this.getCellFromCoords(this.state.drag.x, this.state.drag.y);
      const { r, c } = this.state.players[this.state.drag.playerIdx].pos;
      // Если целевая клетка допустима, рисуем полупрозрачную фишку там
      if (target && Shared.canMovePawn(this.state, r, c, target.r, target.c)) {
        const x = (target.c + 0.5) * this.CONFIG.cellSize;
        const y = (this.transformRow(target.r) + 0.5) * this.CONFIG.cellSize;
        this.ctx.globalAlpha = 0.5;
        this.ctx.fillStyle = this.state.players[this.state.drag.playerIdx].color === 'white' ? '#fff' : '#000';
        this.ctx.beginPath();
        this.ctx.arc(x, y, this.CONFIG.cellSize * 0.35, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.globalAlpha = 1;
      }
      // Рисуем фишку под курсором (саму "руку")
      this.ctx.fillStyle = this.state.players[this.state.drag.playerIdx].color === 'white' ? '#fff' : '#000';
      this.ctx.beginPath();
      this.ctx.arc(this.state.drag.x, this.state.drag.y, this.CONFIG.cellSize * 0.35, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.strokeStyle = '#ccc';
      this.ctx.lineWidth = 3;
      this.ctx.stroke();

    } else if (this.state.drag.type === 'wall') {
      // Предпросмотр для стены
      const slot = this.getNearestSlot(this.state.drag.x, this.state.drag.y);

      if (slot && Shared.checkWallPlacement(this.state, slot.r, slot.c, this.state.drag.isVertical)) {
        const tempV = this.state.drag.isVertical;
        const tr = slot.r, tc = slot.c;

        // Временно ставим стену для проверки пути
        if (tempV) this.state.vWalls[tr][tc] = true; else this.state.hWalls[tr][tc] = true;
        const valid = Shared.isValidWallPlacement(this.state); // Проверка, не блокирует ли стена путь
        // Откатываем временное размещение
        if (tempV) this.state.vWalls[tr][tc] = false; else this.state.hWalls[tr][tc] = false;

        // Определяем цвет предпросмотра (зеленый - разрешено, красный - заблокирует путь)
        this.ctx.fillStyle = valid ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.5)';
        const len = this.CONFIG.cellSize * 2;

        // Рисуем полупрозрачную стену в слоте
        if (this.state.drag.isVertical) {
          // ВЕРТИКАЛЬНАЯ — между r и r+1
          const top = this.transformRow(tr);
          const bottom = this.transformRow(tr + 1);

          const rDisp = Math.min(top, bottom);

          const x = (tc + 1) * this.CONFIG.cellSize - this.CONFIG.wallThick / 2;
          const y = rDisp * this.CONFIG.cellSize + this.CONFIG.gap;

          this.ctx.fillRect(x, y, this.CONFIG.wallThick, len - this.CONFIG.gap * 2);

        } else {
          // ГОРИЗОНТАЛЬНАЯ — между r и r+1 по вертикали
          const top = this.transformRow(tr);
          const bottom = this.transformRow(tr + 1);

          const rDisp = Math.min(top, bottom);

          const x = tc * this.CONFIG.cellSize + this.CONFIG.gap;
          const y = (rDisp + 1) * this.CONFIG.cellSize - this.CONFIG.wallThick / 2;

          this.ctx.fillRect(x, y, len - this.CONFIG.gap * 2, this.CONFIG.wallThick);
        }
      }
      // Рисуем стену под курсором (саму "руку")
      this.ctx.fillStyle = '#e09f3e';
      const w = this.state.drag.isVertical ? this.CONFIG.wallThick : this.CONFIG.cellSize * 2;
      const h = this.state.drag.isVertical ? this.CONFIG.cellSize * 2 : this.CONFIG.wallThick;
      this.ctx.fillRect(this.state.drag.x - w / 2, this.state.drag.y - h / 2, w, h);
    }
  },

  // ====================================================================
  // 3. МЕТОДЫ ИГРОВОЙ ЛОГИКИ (ВСПОМОГАТЕЛЬНЫЕ)
  // ====================================================================

  /**
   * Преобразует координаты курсора (x, y в пикселях) в координаты ячейки
   * (r, c в сетке 9x9).
   * @param {number} x Координата X.
   * @param {number} y Координата Y.
   * @returns {?{r: number, c: number}} Координаты ячейки или null, если за пределами поля.
   */
  getCellFromCoords(x, y) {
    const c = Math.floor(x / this.CONFIG.cellSize);
    const r_display = Math.floor(y / this.CONFIG.cellSize);

    if (r_display >= 0 && r_display < 9 && c >= 0 && c < 9) {
      // НОВЫЙ КОД: Обратная трансформация
      const r_absolute = this.transformRow(r_display);
      return { r: r_absolute, c };
    }
    return null;
  },
  /**
  * Трансформирует абсолютную строку (R) в отображаемую (R_display)
  * и наоборот, если мы играем за Черного (Player 1).
  * @param {number} r Абсолютная строка (0-8).
  * @returns {number} Отображаемая строка (0-8).
  */

  transformRow(r) {
    // Переворачиваем доску только для Черного игрока (Player 1)
    if (this.myPlayerIndex === 1) {
      return 8 - r;
    }
    return r;
  },

  /**
   * Преобразует координаты курсора (x, y в пикселях) в координаты ближайшего
   * слота для стены (r, c в сетке 8x8).
   * @param {number} x Координата X.
   * @param {number} y Координата Y.
   * @returns {?{r: number, c: number}} Координаты слота или null, если за пределами слотов.
   */
  updateHoverWall(x, y) {
    if (this.isReplayMode || this.isInputBlocked || this.viewHistoryIndex !== -1) {
      this.state.hoverWall = null;
      return;
    }

    // На мобильных устройствах (touch) призраки обычно не нужны, но на гибридных (ноутбуки с тачем) мешают.
    // Мы полагаемся на то, что pointermove вызывается в основном мышью.
    // if (this.isTouchDevice) { ... } // Удаляем жесткую блокировку

    if (this.state.drag || this.isGameOver) {
      this.state.hoverWall = null;
      return;
    }

    // Если онлайн и не мой ход — не показываем призрак
    if (Net.isOnline) {
      const myIdx = Net.myColor === 'white' ? 0 : 1;
      if (this.state.currentPlayer !== myIdx) {
        this.state.hoverWall = null;
        this.canvas.style.cursor = 'default';
        return;
      }
    } else if (this.state.botDifficulty !== 'none' && this.state.currentPlayer !== this.myPlayerIndex) {
      // В игре с ботом показываем только в наш ход
      this.state.hoverWall = null;
      this.canvas.style.cursor = 'default';
      return;
    }

    // Проверяем, в какой ячейке мы находимся
    const c = Math.floor(x / this.CONFIG.cellSize);
    const r_display = Math.floor(y / this.CONFIG.cellSize);

    if (c < 0 || c >= 9 || r_display < 0 || r_display >= 9) {
      this.state.hoverWall = null;
      return;
    }

    const relX = x % this.CONFIG.cellSize;
    const relY = y % this.CONFIG.cellSize;
    const margin = this.CONFIG.cellSize * 0.25; // 25% от размера клетки - зона "активности" у края

    // [UX Improvement] Dead zone at corners (intersections)
    const CORNER_THRESHOLD = this.CONFIG.cellSize * 0.15;
    const distToCornerX = Math.min(relX, this.CONFIG.cellSize - relX);
    const distToCornerY = Math.min(relY, this.CONFIG.cellSize - relY);

    if (distToCornerX < CORNER_THRESHOLD && distToCornerY < CORNER_THRESHOLD) {
      this.state.hoverWall = null;
      this.canvas.style.cursor = 'default';
      return;
    }

    let isNearVertical = (relX > this.CONFIG.cellSize - margin || relX < margin);
    let isNearHorizontal = (relY > this.CONFIG.cellSize - margin || relY < margin);

    // Если мы в центре клетки (не у краев) — призрака нет
    if (!isNearVertical && !isNearHorizontal) {
      this.state.hoverWall = null;
      this.canvas.style.cursor = 'default';
      return;
    }

    // Определяем ближайший слот (перекресток)
    const slotC = Math.round(x / this.CONFIG.cellSize) - 1;
    const slotR_display = Math.round(y / this.CONFIG.cellSize) - 1;

    if (slotC < 0 || slotC >= 8 || slotR_display < 0 || slotR_display >= 8) {
      this.state.hoverWall = null;
      this.canvas.style.cursor = 'default';
      return;
    }

    // Ориентация: если клик ближе к вертикальному зазору, чем к горизонтальному
    const distX = Math.min(relX, this.CONFIG.cellSize - relX);
    const distY = Math.min(relY, this.CONFIG.cellSize - relY);
    const isVertical = distX < distY;

    // Трансформируем отображаемую строку в абсолютную
    const slotR_absolute = this.myPlayerIndex === 1 ? 7 - slotR_display : slotR_display;

    // Проверяем валидность
    // 1. Проверяем наличие стен и отсутствие пересечений (без учета путей)
    let isValid = this.state.players[this.state.currentPlayer].wallsLeft > 0 &&
      Shared.checkWallPlacement(this.state, slotR_absolute, slotC, isVertical);

    // 2. Если пока валидно, проверяем, не блокирует ли путь
    if (isValid) {
      // Временно ставим стену в State для проверки путей
      if (isVertical) this.state.vWalls[slotR_absolute][slotC] = true;
      else this.state.hWalls[slotR_absolute][slotC] = true;

      isValid = Shared.isValidWallPlacement(this.state);

      // Убираем временную стену
      if (isVertical) this.state.vWalls[slotR_absolute][slotC] = false;
      else this.state.hWalls[slotR_absolute][slotC] = false;
    }

    this.state.hoverWall = { r: slotR_absolute, c: slotC, isVertical, isValid };
    this.canvas.style.cursor = isValid ? 'pointer' : 'default';
  },

  drawHoverWall() {
    if (!this.state.hoverWall) return;

    const { r, c, isVertical, isValid } = this.state.hoverWall;
    // Always draw ghost (Red if invalid, Green if valid)
    // if (!isValid && !this.state.drag) return; <--- REMOVED check

    this.ctx.save();
    this.ctx.globalAlpha = 0.6;
    // Green (Valid) vs Red (Invalid)
    this.ctx.fillStyle = isValid ? 'rgba(34, 197, 94, 0.6)' : 'rgba(239, 68, 68, 0.6)';

    const len = this.CONFIG.cellSize * 2;
    const displayR = this.myPlayerIndex === 1 ? 7 - r : r;

    if (isVertical) {
      const x = (c + 1) * this.CONFIG.cellSize - this.CONFIG.wallThick / 2;
      const y = displayR * this.CONFIG.cellSize + this.CONFIG.gap;
      this.ctx.fillRect(x, y, this.CONFIG.wallThick, len - this.CONFIG.gap * 2);
    } else {
      const x = c * this.CONFIG.cellSize + this.CONFIG.gap;
      const y = (displayR + 1) * this.CONFIG.cellSize - this.CONFIG.wallThick / 2;
      this.ctx.fillRect(x, y, len - this.CONFIG.gap * 2, this.CONFIG.wallThick);
    }
    this.ctx.restore();
  },

  drawDebugZones() {
    if (!this.debugControl) return;

    this.ctx.save();
    const margin = this.CONFIG.cellSize * 0.25;

    // 1. Отрисовка зон "активности" в каждой ячейке
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const x = c * this.CONFIG.cellSize;
        const y = this.transformRow(r) * this.CONFIG.cellSize;

        this.ctx.strokeStyle = 'rgba(255, 255, 0, 0.2)';
        this.ctx.lineWidth = 1;

        // Рисуем границы зон (margin)
        this.ctx.strokeRect(x, y, margin, this.CONFIG.cellSize); // лево
        this.ctx.strokeRect(x + this.CONFIG.cellSize - margin, y, margin, this.CONFIG.cellSize); // право
        this.ctx.strokeRect(x, y, this.CONFIG.cellSize, margin); // верх
        this.ctx.strokeRect(x, y + this.CONFIG.cellSize - margin, this.CONFIG.cellSize, margin); // низ
      }
    }

    // 2. Отрисовка точек-перекрестков (слотов)
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const displayR = this.myPlayerIndex === 1 ? 7 - r : r;
        const sx = (c + 1) * this.CONFIG.cellSize;
        const sy = (displayR + 1) * this.CONFIG.cellSize;

        this.ctx.fillStyle = 'cyan';
        this.ctx.beginPath();
        this.ctx.arc(sx, sy, 4, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.fillStyle = 'rgba(0, 255, 255, 0.5)';
        this.ctx.font = 'bold 14px Arial';
        this.ctx.fillText(`${r},${c}`, sx + 6, sy + 6);
      }
    }

    // 3. Координаты мыши (логические)
    if (window.lastPointerX !== undefined) {
      this.ctx.fillStyle = 'yellow';
      this.ctx.font = 'bold 24px Inter, sans-serif';
      this.ctx.fillText(`X: ${Math.round(window.lastPointerX)} Y: ${Math.round(window.lastPointerY)}`, 20, 50);
    }

    this.ctx.restore();
  },

  getNearestSlot(x, y) {
    const c = Math.round(x / this.CONFIG.cellSize) - 1;
    const r_display = Math.round(y / this.CONFIG.cellSize) - 1;

    if (r_display >= 0 && r_display < 8 && c >= 0 && c < 8) {
      // НОВЫЙ КОД: Обратная трансформация для 8x8 (7 - r_display)
      const r_absolute = this.myPlayerIndex === 1 ? 7 - r_display : r_display;
      return { r: r_absolute, c };
    }
    return null;
  },

  // ====================================================================
  // 4. МЕТОДЫ ИГРОВОЙ ЛОГИКИ (ДВИЖЕНИЕ ФИШКИ)
  // ====================================================================

  // ====================================================================
  // 5. МЕТОДЫ ИГРОВОЙ ЛОГИКИ (СТЕНЫ)
  // ====================================================================

  /**
   * Выполняет попытку размещения стены в слоте (r, c).
   * Проверяет локальные условия и, ГЛАВНОЕ, не блокирует ли стена путь
   * ни одному из игроков.
   * @param {number} r Строка слота (0-7).
   * @param {number} c Столбец слота (0-7).
   * @param {boolean} vertical True, если стена вертикальная.
   * @returns {boolean} True, если стена успешно размещена и ход завершен.
   */
  placeWall(r, c, vertical) {
    if (!Shared.checkWallPlacement(this.state, r, c, vertical)) {
      UI.AudioManager.play('error');
      return false;
    }

    // Временно ставим стену
    if (vertical) this.state.vWalls[r][c] = true;
    else this.state.hWalls[r][c] = true;

    // Проверяем, остался ли путь для обоих игроков
    if (!Shared.isValidWallPlacement(this.state)) {
      // Откатываем, если путь заблокирован
      if (vertical) this.state.vWalls[r][c] = false;
      else this.state.hWalls[r][c] = false;
      UI.AudioManager.play('error');
      return false;
    }

    // Если все OK, уменьшаем счетчик стен
    this.state.players[this.state.currentPlayer].wallsLeft--;
    // [Animation] Trigger local wall animation
    this.animateWall(r, c, vertical);
    UI.AudioManager.play('wall');
    return true;
  },

  // ====================================================================
  // 6. МЕТОДЫ УПРАВЛЕНИЯ ХОДОМ
  // ====================================================================

  applyServerMove(data) {
    const { playerIdx, move, nextPlayer } = data;

    // 1. Применяем изменения к локальному State
    if (move.type === 'pawn') {
      const oldPos = { ...this.state.players[playerIdx].pos };
      this.state.players[playerIdx].pos = { r: move.r, c: move.c };
      // [Animation] Trigger remote/server animation
      this.animatePawn(playerIdx, oldPos, { r: move.r, c: move.c });
    } else if (move.type === 'wall') {
      if (move.isVertical) this.state.vWalls[move.r][move.c] = true;
      else this.state.hWalls[move.r][move.c] = true;
      this.state.players[playerIdx].wallsLeft--;
      // [Animation] Trigger remote/server wall animation
      this.animateWall(move.r, move.c, move.isVertical);
    }

    if (data.timers) {
      this.timers = [...data.timers];
    }
    // 2. Обновляем текущего игрока
    this.state.currentPlayer = nextPlayer;

    // 3. Добавляем в историю (теперь, когда state уже обновлен)
    this.addToHistory({ ...move, playerIdx });

    // 4. Обновляем UI
    this.updateTurnDisplay();
    this.updateTimerDisplay();
    this.startTimer();
    this.draw();

    // 5. Озвучка хода
    UI.AudioManager.play(move.type === 'pawn' ? 'move' : 'wall');
  },

  /**
   * Применяет ход бота к состоянию игры.
   * @param {object} move Ход бота.
   */
  applyBotMove(move) {
    const playerIdx = this.state.currentPlayer;

    if (move.type === 'pawn') {
      const oldPos = { ...this.state.players[playerIdx].pos };
      if (!Shared.canMovePawn(this.state, oldPos.r, oldPos.c, move.r, move.c)) {
        UI.AudioManager.play('error');
        this.isInputBlocked = false;
        this.draw();
        return;
      }
      this.state.players[playerIdx].pos = { r: move.r, c: move.c };
      // [Animation] Trigger bot animation
      this.animatePawn(playerIdx, oldPos, { r: move.r, c: move.c });
    } else if (move.type === 'wall') {
      if (move.isVertical) this.state.vWalls[move.r][move.c] = true;
      else this.state.hWalls[move.r][move.c] = true;
      this.state.players[playerIdx].wallsLeft--;
      // [Animation] Trigger bot wall animation
      this.animateWall(move.r, move.c, move.isVertical);
    }

    UI.AudioManager.play(move.type === 'pawn' ? 'move' : 'wall');

    // Добавляем в историю (снимите снэпшот ПОСЛЕ изменения позиций)
    this.addToHistory({ ...move, playerIdx });

    if (!this.checkVictory()) {
      this.nextTurn();
    }
    this.isInputBlocked = false; // Разблокируем ввод после хода бота
    this.canvas.style.cursor = 'default';
    this.draw();
  },

  /**
   * Проверяет, достиг ли текущий игрок своей целевой линии.
   * @returns {boolean} True, если игра окончена.
   */
  checkVictory() {
    const p = this.state.players[this.state.currentPlayer];
    if ((this.state.currentPlayer === 0 && p.pos.r === 0) ||
      (this.state.currentPlayer === 1 && p.pos.r === 8)) {
      this.handleGameOver(this.state.currentPlayer, 'Goal reached');
      return true;
    }
    return false;
  },

  /**
   * Переключает ход на следующего игрока и запускает логику бота, если нужно.
   */
  nextTurn() {
    this.state.currentPlayer = 1 - this.state.currentPlayer;
    this.state.drag = null;

    this.updateTurnDisplay();

    if (this.state.botDifficulty !== 'none') {
      if (this.state.currentPlayer !== this.myPlayerIndex) {
        // Если текущий игрок — не мы, значит это бот
        this.isInputBlocked = true; // Блокируем ввод пока бот думает
        setTimeout(() => {
          AI.makeMove(this.state.botDifficulty);
        }, 300); // 300ms delay for visual clarity
      }
    }

    this.startTimer();
    this.draw();
  },

  /**
   * Обновляет информационный блок с данными о текущем ходе.
   */
  /**
   * Обновляет UI: плашки игроков, стены, подсветку хода.
   */
  updateTurnDisplay(state) {
    if (!state) state = this.state;
    // 1. Определяем, кто есть кто
    // Если игра онлайн или мы играем за черных (индекс 1) -> Мы снизу
    // По умолчанию в Локальной игре (PvP) Player 0 (Белый) снизу, Player 1 (Черный) сверху.
    // Но если мы перевернули доску (играем за черных), логика меняется.

    // Индекс того, кто отображается СНИЗУ (обычно "Вы")
    const bottomIdx = (this.myPlayerIndex === 1) ? 1 : 0;
    const topIdx = 1 - bottomIdx;

    const bottomPlayer = state.players[bottomIdx];
    const topPlayer = state.players[topIdx];

    // 2. Обновляем тексты Стен
    const elBottomWalls = document.getElementById('bottomPlayerWalls');
    const elTopWalls = document.getElementById('topPlayerWalls');

    if (elBottomWalls) elBottomWalls.textContent = bottomPlayer.wallsLeft;
    if (elTopWalls) elTopWalls.textContent = topPlayer.wallsLeft;

    const elBottomName = document.getElementById('bottomPlayerName');
    const elTopName = document.getElementById('topPlayerName');
    const elBottomAvatar = document.getElementById('bottomPlayerAvatar');
    const elTopAvatar = document.getElementById('topPlayerAvatar');

    const profiles = state.playerProfiles || this.state.playerProfiles;
    const bottomProfile = profiles ? profiles[bottomIdx] : null;
    const topProfile = profiles ? profiles[topIdx] : null;

    if (elBottomName) {
      if (bottomProfile) {
        let text = bottomProfile.name;
        if (bottomProfile.rating) text += ` (${bottomProfile.rating})`;
        elBottomName.textContent = text;
      } else if (state.gameId && state.gameId.startsWith('local_')) {
        elBottomName.textContent = (this.myPlayerIndex === -1) ? UI.translate('pname_white') : UI.translate('pname_you');
      }
    }

    if (elTopName) {
      if (topProfile) {
        let text = topProfile.name;
        if (topProfile.rating) text += ` (${topProfile.rating})`;
        elTopName.textContent = text;
      } else if (state.gameId && state.gameId.startsWith('local_')) {
        elTopName.textContent = (this.myPlayerIndex === -1) ? UI.translate('pname_black') : UI.translate('pname_opponent');
      }
    }

    // Обновляем аватары
    if (elBottomAvatar) {
      if (bottomProfile) elBottomAvatar.src = bottomProfile.avatar;
      else elBottomAvatar.src = `https://ui-avatars.com/api/?name=${bottomIdx === 0 ? 'W' : 'B'}&background=333&color=fff`;
    }
    if (elTopAvatar) {
      if (topProfile) elTopAvatar.src = topProfile.avatar;
      else elTopAvatar.src = `https://ui-avatars.com/api/?name=${topIdx === 0 ? 'W' : 'B'}&background=333&color=fff`;
    }

    // 4. Подсветка активного хода (CSS класс .active-turn)
    const bottomBar = document.getElementById('bottomPlayerBar');
    const topBar = document.getElementById('topPlayerBar');

    // Сбрасываем классы
    bottomBar.classList.remove('active-turn');
    topBar.classList.remove('active-turn');

    if (state.currentPlayer === bottomIdx) {
      bottomBar.classList.add('active-turn');
    } else {
      topBar.classList.add('active-turn');
    }

    // 5. Обновляем визуальный инвентарь стен
    this.renderWallInventory(state);
  },

  /**
   * Рендерит визуальные стенки в инвентарях игроков.
   */
  renderWallInventory(state) {
    const bottomInv = document.getElementById('bottomWallInventory');
    const topInv = document.getElementById('topWallInventory');

    if (!bottomInv || !topInv) return;
    if (!state) state = this.state;

    const bottomIdx = (this.myPlayerIndex === 1) ? 1 : 0;
    const topIdx = 1 - bottomIdx;

    // Определяем, чей сейчас ход
    const localPlay = (this.myPlayerIndex === -1);

    // Генерируем стенки для обоих игроков
    const inventories = [
      { el: bottomInv, playerIdx: bottomIdx },
      { el: topInv, playerIdx: topIdx }
    ];

    inventories.forEach(({ el, playerIdx }) => {
      // Логика интерактивности:
      // 1. Сейчас должен быть ход этого игрока
      // 2. ИГРА НЕ окончена
      // 3. Либо это локальная игра (можно за всех), либо это "мой" игрок (онлайн)
      const isCurrentPlayerTurn = (state.currentPlayer === playerIdx);
      const isMyPlayer = (this.myPlayerIndex === playerIdx);
      const interactive = isCurrentPlayerTurn && (localPlay || isMyPlayer) && !this.isGameOver && !this.isInputBlocked;

      const wallsLeft = state.players[playerIdx].wallsLeft;
      el.innerHTML = '';

      for (let w = 0; w < 10; w++) {
        const piece = document.createElement('div');
        piece.className = 'wall-piece' + (w >= wallsLeft ? ' used' : '');
        piece.dataset.wallIndex = w;

        // Интерактивность
        if (w < wallsLeft && interactive) {
          piece.classList.add('interactive');
          // Используем addEventListener для лучшей совместимости с touch
          piece.addEventListener('pointerdown', (e) => {
            if (this.viewHistoryIndex !== -1) {
              this.setHistoryView(-1);
              return;
            }
            this.startWallDragFromInventory(e);
          });
        }

        el.appendChild(piece);
      }
    });
  },

  /**
   * Инициализирует перетаскивание стены из инвентаря.
   * @param {PointerEvent} e Событие указателя.
   */
  startWallDragFromInventory(e) {
    if (this.isInputBlocked || this.isGameOver) return;
    // Защита: нельзя брать стену, если сейчас не наш ход (в онлайн или против бота)
    if (this.myPlayerIndex !== -1 && this.state.currentPlayer !== this.myPlayerIndex) return;
    if (this.state.players[this.state.currentPlayer].wallsLeft <= 0) return;

    // ВАЖНО: останавливаем всплытие, чтобы не сработал клик по канвасу под инвентарем (если есть)
    e.stopPropagation();

    const rect = this.canvas.getBoundingClientRect();
    const logicalSize = this.CONFIG.cellSize * this.CONFIG.gridCount;
    const scaleX = logicalSize / rect.width;
    const scaleY = logicalSize / rect.height;

    // Стенки в инвентаре горизонтальные, но при перетаскивании можно будет повернуть
    this.state.drag = {
      type: 'wall',
      isVertical: false, // Начинаем с горизонтальной
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };

    this.canvas.style.cursor = 'grabbing';
    this.state.hoverWall = null;
    this.draw();
  },

  /**
   * Инициализирует перетаскивание стены.
   * @param {boolean} vertical Определяет, вертикальная ли стена.
   * @param {PointerEvent} e Событие указателя.
   */
  startWallDrag(vertical, e) {
    if (this.isInputBlocked) return;
    if (this.state.players[this.state.currentPlayer].wallsLeft <= 0) return;
    const rect = this.canvas.getBoundingClientRect();
    const logicalSize = this.CONFIG.cellSize * this.CONFIG.gridCount; // 1080
    const scaleX = logicalSize / rect.width;
    const scaleY = logicalSize / rect.height;

    this.state.drag = {
      type: 'wall',
      isVertical: vertical,
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
    this.canvas.style.cursor = 'grabbing';
    this.draw();
  },

  // ====================================================================
  // 7. МЕТОДЫ ОБРАБОТКИ СОБЫТИЙ
  // ====================================================================

  /**
   * Устанавливает обработчики событий для взаимодействия с пользователем
   * (мышь, клавиатура).
   */
  initEvents() {
    // === 7.0. Шаблоны стен в сайдбаре ===
    const wallTemplateV = document.getElementById('wallTemplateV');
    const wallTemplateH = document.getElementById('wallTemplateH');

    if (wallTemplateV) {
      wallTemplateV.addEventListener('pointerdown', (e) => {
        if (this.isReplayMode) return; // Block during replay
        e.preventDefault();
        this.startWallDrag(true, e); // isVertical = true
      });
    }

    if (wallTemplateH) {
      wallTemplateH.addEventListener('pointerdown', (e) => {
        if (this.isReplayMode) return; // Block during replay
        e.preventDefault();
        this.startWallDrag(false, e); // isVertical = false
      });
    }

    // === 7.1. Начало перетаскивания (pointerdown) ===
    this.canvas.addEventListener('pointerdown', e => {
      // [Replay Mode] Block all game interactions during replay
      if (this.isReplayMode) {
        return;
      }

      // [Advanced UX] Если мы в режиме просмотра истории — клик выбрасывает нас в игру
      if (this.viewHistoryIndex !== -1) {
        this.setHistoryView(-1);
        this.ignoreNextClick = true; // Flag to skip the subsequent 'click' event
        // Поглощаем событие, чтобы этот клик не стал сразу ходом в реальной игре
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }

      if (this.isGameOver) return;

      // На мобильных устройствах сразу убираем призраков при нажатии
      if (e.pointerType === 'touch') {
        this.state.hoverWall = null;
      }

      // Если онлайн и сейчас НЕ мой ход — запрещаем трогать
      if (Net.isOnline) {
        const myIdx = Net.myColor === 'white' ? 0 : 1;
        if (this.state.currentPlayer !== myIdx) {
          return;
        }
        // 2. Если пытаемся взять ЧУЖУЮ фишку
        // (Логика определения клика по фишке идет дальше, но мы можем проверить чей сейчас ход)
        // Так как currentPlayer проверен выше, мы точно знаем, что ход наш.
        // Но технически мы можем кликнуть по фишке врага. 
        // Добавьте проверку playerIdx в логике drag, чтобы drag создавался только для playerIdx === myIdx
      }
      // Игнорируем нажатия, если ходит бот или инпут заблокирован
      if (this.isInputBlocked) return;
      if (this.viewHistoryIndex !== -1) return; // Блокировка при просмотре истории
      if (this.state.currentPlayer !== this.myPlayerIndex && this.state.botDifficulty !== 'none') return;
      if (this.state.drag) return; // Игнорируем, если уже что-то перетаскивается

      const rect = this.canvas.getBoundingClientRect();
      const logicalSize = this.CONFIG.cellSize * this.CONFIG.gridCount; // 1080
      const scaleX = logicalSize / rect.width;
      const scaleY = logicalSize / rect.height;

      // Используем clientX/Y для pointer events (они работают и для touch)
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      const player = this.state.players[this.state.currentPlayer];

      // Проверяем, находится ли нажатие в пределах радиуса фишки
      const px = (player.pos.c + 0.5) * this.CONFIG.cellSize;
      const py = (this.transformRow(player.pos.r) + 0.5) * this.CONFIG.cellSize;

      const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
      const hitRadius = this.CONFIG.cellSize * 0.6;

      // Приоритет стене: если наведён валидный призрак стены, фишку не берём
      const isWallHovered = this.state.hoverWall && this.state.hoverWall.isValid;

      if (dist < hitRadius && !isWallHovered) {
        e.preventDefault(); // Предотвращаем только если захватили фишку
        this.state.hoverWall = null; // Убираем призрак при взятии фишки
        this.state.drag = { type: 'pawn', playerIdx: this.state.currentPlayer, x, y };
        this.canvas.style.cursor = 'grabbing';
        this.draw();
      }
    });

    window.addEventListener('keydown', e => {
      // Exit history mode on Escape
      if (e.key === 'Escape' && this.viewHistoryIndex !== -1) {
        this.setHistoryView(-1);
        return;
      }

      // Post-game review: arrow keys to navigate moves
      if (this.isGameOver && this.postGameReview) {
        if (e.key === 'ArrowLeft') {
          if (this.viewHistoryIndex > 0) {
            this.setHistoryView(this.viewHistoryIndex - 1);
          } else if (this.viewHistoryIndex === 0) {
            this.setHistoryView(-2);
          } else if (this.viewHistoryIndex === -1 && this.state.history.length > 0) {
            this.setHistoryView(this.state.history.length - 1);
          }
          return;
        }
        if (e.key === 'ArrowRight') {
          if (this.viewHistoryIndex === -2) {
            this.setHistoryView(0);
          } else if (this.viewHistoryIndex < this.state.history.length - 1) {
            this.setHistoryView(this.viewHistoryIndex + 1);
          } else if (this.viewHistoryIndex === this.state.history.length - 1) {
            this.setHistoryView(-1);
          }
          return;
        }
        if (e.key === 'Escape') {
          this.goToMainMenu();
          return;
        }
      }

      if (this.isInputBlocked || this.viewHistoryIndex !== -1) return;
      if (this.isGameOver) return;
      // Toggle Debug Mode: Shift + D
      if (e.shiftKey && e.code === 'KeyD') {
        this.debugControl = !this.debugControl;
        this.draw();
      }

      // Игнорируем нажатия, если инпут заблокирован
      if (this.isInputBlocked) return;

      // Escape: Отмена перетаскивания
      if (e.key === 'Escape' && this.state.drag) {
        this.state.drag = null;
        this.canvas.style.cursor = 'default';
        this.draw();
      }

      // Rotate wall: R key
      if (e.code === 'KeyR' && this.state.drag && this.state.drag.type === 'wall') {
        this.state.drag.isVertical = !this.state.drag.isVertical;
        this.draw();
      }

      // H/V keys: Взять стену прямо под курсор
      if (e.key === 'h' || e.key === 'H' || e.key === 'v' || e.key === 'V') {
        if (this.isReplayMode) return;
        const p = this.state.players[this.state.currentPlayer];
        if (p.wallsLeft <= 0) return;

        if (Net.isOnline) {
          const myIdx = Net.myColor === 'white' ? 0 : 1;
          if (this.state.currentPlayer !== myIdx) return;
        }

        const isVertical = (e.key === 'v' || e.key === 'V');
        const rect = this.canvas.getBoundingClientRect();
        const cursorX = window.lastPointerX ?? (rect.width / 2);
        const cursorY = window.lastPointerY ?? (rect.height / 2);

        this.state.drag = {
          type: 'wall',
          isVertical,
          x: cursorX,
          y: cursorY
        };

        this.canvas.style.cursor = 'grabbing';
        this.draw();
      }
    });

    // === 7.2. Перемещение (pointermove) ===
    window.addEventListener('pointermove', e => {
      const rect = this.canvas.getBoundingClientRect();
      const logicalSize = this.CONFIG.cellSize * this.CONFIG.gridCount;
      const scaleX = logicalSize / rect.width;
      const scaleY = logicalSize / rect.height;

      // Store raw client coords if needed, but for logic use scaled
      window.lastPointerX = (e.clientX - rect.left) * scaleX;
      window.lastPointerY = (e.clientY - rect.top) * scaleY;

      if (!this.state.drag) {
        // Призраки стен показываем только для мыши/пера. На тач-устройствах они мешают.
        if (e.pointerType !== 'touch') {
          this.updateHoverWall(window.lastPointerX, window.lastPointerY);
        } else {
          this.state.hoverWall = null;
        }
      } else {
        this.state.drag.x = (e.clientX - rect.left) * scaleX;
        this.state.drag.y = (e.clientY - rect.top) * scaleY;
        this.state.hoverWall = null; // Убираем призрак при перетаскивании
        this.wasDragging = true;
      }
      this.draw();
    });

    this.canvas.addEventListener('pointerleave', () => {
      this.state.hoverWall = null;
      this.draw();
    });

    this.canvas.addEventListener('click', e => {
      // Skip click if it was used just to exit history mode
      if (this.ignoreNextClick) {
        this.ignoreNextClick = false;
        return;
      }

      // Если только что отпустили drag — игнорируем click
      if (this.wasDragging) {
        this.wasDragging = false;
        return;
      }
      // Клик работает только если мы НЕ перетаскивали (drag был null)
      if (this.isInputBlocked) return;
      if (this.isReplayMode) return;
      if (this.state.drag) return;
      if (!this.state.hoverWall || !this.state.hoverWall.isValid) return;

      const { r, c, isVertical } = this.state.hoverWall;
      const move = { type: 'wall', r, c, isVertical };

      if (Net.isOnline) {
        Net.sendMove(move);
      } else {
        if (this.placeWall(r, c, isVertical)) {
          this.addToHistory(move);
          this.nextTurn();
        }
      }
      this.state.hoverWall = null;
      this.draw();
    });

    // === 7.3. Окончание перетаскивания (pointerup) ===
    window.addEventListener('pointerup', e => {
      if (!this.state.drag) return;
      if (this.isReplayMode) return;

      const rect = this.canvas.getBoundingClientRect();
      const logicalSize = this.CONFIG.cellSize * this.CONFIG.gridCount;
      const scaleX = logicalSize / rect.width;
      const scaleY = logicalSize / rect.height;

      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      let potentialMove = null;

      if (this.state.drag.type === 'pawn') {
        const target = this.getCellFromCoords(x, y);
        if (target) {
          potentialMove = { type: 'pawn', r: target.r, c: target.c };
        }
      } else if (this.state.drag.type === 'wall') {
        const slot = this.getNearestSlot(x, y);
        if (slot) {
          potentialMove = { type: 'wall', r: slot.r, c: slot.c, isVertical: this.state.drag.isVertical };
        }
      }

      if (potentialMove) {
        if (Net.isOnline) {
          Net.sendMove(potentialMove);
        } else {
          // ЛОКАЛЬНАЯ ИГРА: Восстановленная логика
          const playerIdx = this.state.currentPlayer;

          if (potentialMove.type === 'pawn') {
            const { r: tr, c: tc } = potentialMove;
            const player = this.state.players[playerIdx];
            // Проверяем, что ход допустим (нужна реальная проверка, а не только потенциальный ход)
            if (Shared.canMovePawn(this.state, player.pos.r, player.pos.c, tr, tc)) {
              // [Animation] Trigger local animation
              const startPos = { ...player.pos };
              const endPos = { r: potentialMove.r, c: potentialMove.c };

              Game.state.players[playerIdx].pos = endPos;
              this.animatePawn(playerIdx, startPos, endPos);

              UI.AudioManager.play('move');
              this.addToHistory(potentialMove);
              if (!this.checkVictory()) this.nextTurn();
            } else {
              UI.AudioManager.play('error');
            }

          } else if (potentialMove.type === 'wall') {
            const { r: wr, c: wc, isVertical } = potentialMove;
            // Проверяем, что есть стены и размещение прошло успешно
            if (this.state.players[playerIdx].wallsLeft > 0 &&
              this.placeWall(wr, wc, isVertical)) {
              this.addToHistory(potentialMove);
              this.nextTurn();
            } else {
              // ...
            }
          }
        }
      } else {
        // Local play fail sound
        UI.AudioManager.play('error');
      }

      this.state.drag = null;
      this.canvas.style.cursor = 'default';
      this.draw();
    });
  },

  surrender() {
    const loserIdx = (this.myPlayerIndex !== -1) ? this.myPlayerIndex : this.state.currentPlayer;
    const winnerIdx = 1 - loserIdx;

    this.stopTimer();
    this.handleGameOver(winnerIdx, 'surrender');
  },
};

// ====================================================================
// DEMO BOARD - Декоративная доска для главного меню
// ====================================================================
const DemoBoard = {
  canvas: null,
  ctx: null,
  cellSize: 80,
  animationInterval: null,
  moveIndex: 0,
  activeScenario: null,
  botMode: true,

  scenarios: {
    // Базовая демо-партия (цикл)
    default: [
      { type: 'pawn', player: 0, r: 7, c: 4 },
      { type: 'pawn', player: 1, r: 1, c: 4 },
      { type: 'wall', player: 0, r: 6, c: 2, isVertical: false },
      { type: 'pawn', player: 1, r: 2, c: 4 },
      { type: 'pawn', player: 0, r: 6, c: 4 },
      { type: 'pawn', player: 1, r: 3, c: 4 },
      { type: 'wall', player: 1, r: 5, c: 4, isVertical: true },
      { type: 'pawn', player: 0, r: 6, c: 3 },
      { type: 'pawn', player: 1, r: 4, c: 4 },
      { type: 'pawn', player: 0, r: 5, c: 3 },
      { type: 'pawn', player: 1, r: 4, c: 5 },
      { type: 'wall', player: 0, r: 4, c: 5, isVertical: false },
    ],
    // Сценарий: движение пешки
    move: [
      { type: 'pawn', player: 0, r: 7, c: 4 },
      { type: 'pawn', player: 0, r: 6, c: 4 },
      { type: 'pawn', player: 0, r: 5, c: 4 },
      { type: 'pawn', player: 0, r: 4, c: 4 },
      { type: 'pawn', player: 0, r: 4, c: 3 },
      { type: 'pawn', player: 0, r: 4, c: 2 },
    ],
    // Сценарий: стены
    wall: [
      { type: 'pawn', player: 0, r: 7, c: 4 },
      { type: 'wall', player: 0, r: 4, c: 2, isVertical: false },
      { type: 'pawn', player: 0, r: 6, c: 4 },
      { type: 'wall', player: 0, r: 2, c: 4, isVertical: true },
      { type: 'pawn', player: 0, r: 5, c: 4 },
      { type: 'wall', player: 0, r: 4, c: 6, isVertical: false },
    ],
    // Сценарий: прыжки
    jump: [
      { type: 'pawn', player: 0, r: 5, c: 4 },
      { type: 'pawn', player: 1, r: 4, c: 4 },
      { type: 'pawn', player: 0, r: 3, c: 4 },
      { type: 'pawn', player: 1, r: 3, c: 5 },
      { type: 'pawn', player: 1, r: 2, c: 5 },
    ],
  },

  state: {
    players: [{ pos: { r: 8, c: 4 } }, { pos: { r: 0, c: 4 } }],
    hWalls: [],
    vWalls: []
  },

  init() {
    this.canvas = document.getElementById('demoBoard');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    if (typeof AICore !== 'undefined') AICore.init(Shared);
    this.reset();
    this.draw();
    this.scheduleNext();
  },

  scheduleNext() {
    this.animationInterval = setTimeout(() => this.botTurn(), 600);
  },

  botTurn() {
    if (!this.canvas || this.canvas.offsetParent === null) { this.scheduleNext(); return; }
    const state = this.state;
    const idx = state.currentPlayer;
    const goalRow = idx === 0 ? 0 : 8;
    let move;
    if (typeof AICore !== 'undefined') {
      move = AICore.think(Shared.cloneState(state), idx, 'hard', { randomize: true });
    }
    if (!move) {
      const targets = Shared.getJumpTargets(state, state.players[idx].pos.r, state.players[idx].pos.c);
      if (targets.length > 0) {
        let best = null, bestScore = -Infinity;
        for (const t of targets) {
          const dist = idx === 0 ? t.r : 8 - t.r;
          if (t.r === goalRow) { best = t; break; }
          if ((idx === 0 ? t.r < state.players[idx].pos.r : t.r > state.players[idx].pos.r)) {
            if (-dist > bestScore) { bestScore = -dist; best = t; }
          }
        }
        if (!best && targets.length > 0) best = targets[0];
        move = best ? { type: 'pawn', r: best.r, c: best.c } : null;
      }
    }
    if (!move) { this.scheduleNext(); return; }
    if (move.type === 'pawn') {
      state.players[idx].pos = { r: move.r, c: move.c };
    } else {
      if (move.isVertical) state.vWalls[move.r][move.c] = true;
      else state.hWalls[move.r][move.c] = true;
      state.players[idx].wallsLeft--;
    }
    state.history.push({ playerIdx: idx, move: { ...move } });
    state.currentPlayer = 1 - idx;
    this.draw();
    if (move.type === 'pawn' && move.r === goalRow) {
      setTimeout(() => { this.reset(); this.draw(); this.scheduleNext(); }, 2000);
      return;
    }
    this.scheduleNext();
  },

  startBotMatch() {
    this.botMode = true;
    this.reset();
    this.draw();
    this.scheduleNext();
  },

  reset() {
    this.moveIndex = 0;
    this.state.hWalls = Array.from({ length: 8 }, () => Array(8).fill(false));
    this.state.vWalls = Array.from({ length: 8 }, () => Array(8).fill(false));
    this.state.players[0].pos = { r: 8, c: 4 };
    this.state.players[1].pos = { r: 0, c: 4 };
    this.state.players[0].wallsLeft = 10;
    this.state.players[1].wallsLeft = 10;
    this.state.currentPlayer = 0;
    this.state.history = [];
    this.moveIndex = 0;
  },

  startAnimation() {
    if (this.animationInterval) clearInterval(this.animationInterval);
    this.animationInterval = setInterval(() => this.playNextMove(), 500);
  },

  playScenario(name) {
    if (!this.scenarios[name]) return;
    if (this.animationInterval) clearInterval(this.animationInterval);
    this.botMode = false;
    this.activeScenario = name;
    this.reset();
    this.draw();
    setTimeout(() => this.startAnimation(), 400);
  },

  playNextMove() {
    const moves = this.scenarios[this.activeScenario] || this.scenarios.default;
    if (this.moveIndex >= moves.length) {
      if (this.botMode || this.activeScenario === 'default') {
        this.reset();
        this.draw();
      } else {
        clearInterval(this.animationInterval);
        this.startBotMatch();
      }
      return;
    }

    if (!this.state.history) this.state.history = [];

    const move = moves[this.moveIndex];
    if (move.type === 'pawn') {
      this.state.players[move.player].pos = { r: move.r, c: move.c };
    } else if (move.type === 'wall') {
      if (move.isVertical) this.state.vWalls[move.r][move.c] = true;
      else this.state.hWalls[move.r][move.c] = true;
    }

    this.moveIndex++;
    this.draw();
  },

  draw() {
    const size = this.cellSize * 9;
    this.ctx.clearRect(0, 0, size, size);
    this.drawGrid();
    this.drawCoordinates();
    this.drawWalls();
    this.drawPawns();
  },

  drawGrid() {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const x = c * this.cellSize + 2;
        const y = r * this.cellSize + 2;
        this.ctx.fillStyle = '#2a2a2a';
        this.ctx.fillRect(x, y, this.cellSize - 4, this.cellSize - 4);
      }
    }
  },

  drawCoordinates() {
    this.ctx.fillStyle = "#ffffff";
    this.ctx.font = `bold ${this.cellSize * 0.18}px Inter, sans-serif`;
    const padding = this.cellSize * 0.08;

    // Цифры 1-9 в левом столбце (верхний левый угол клетки)
    this.ctx.textBaseline = "top";
    this.ctx.textAlign = "left";
    for (let r = 0; r < 9; r++) {
      const x = 0 + 2;
      const y = r * this.cellSize + 2;
      const label = (9 - r).toString();
      this.ctx.fillText(label, x + padding, y + padding);
    }

    const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    this.ctx.textBaseline = "bottom";
    this.ctx.textAlign = "right";
    for (let c = 0; c < 9; c++) {
      const x = (c + 1) * this.cellSize - 2;
      const y = 9 * this.cellSize - 2;
      this.ctx.fillText(letters[c], x - padding, y - padding);
    }
  },

  drawWalls() {
    this.ctx.fillStyle = '#e09f3e';

    // Горизонтальные стены
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (this.state.hWalls[r][c]) {
          const x = c * this.cellSize + 4;
          const y = (r + 1) * this.cellSize - 5;
          this.ctx.fillRect(x, y, this.cellSize * 2 - 8, 10);
        }
      }
    }

    // Вертикальные стены
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (this.state.vWalls[r][c]) {
          const x = (c + 1) * this.cellSize - 5;
          const y = r * this.cellSize + 4;
          this.ctx.fillRect(x, y, 10, this.cellSize * 2 - 8);
        }
      }
    }
  },

  drawPawns() {
    const colors = ['#f0f0f0', '#1a1a1a'];
    const strokes = ['#888', '#444'];

    this.state.players.forEach((player, idx) => {
      const x = (player.pos.c + 0.5) * this.cellSize;
      const y = (player.pos.r + 0.5) * this.cellSize;
      const radius = this.cellSize * 0.35;

      this.ctx.beginPath();
      this.ctx.arc(x, y, radius, 0, Math.PI * 2);
      this.ctx.fillStyle = colors[idx];
      this.ctx.fill();
      this.ctx.strokeStyle = strokes[idx];
      this.ctx.lineWidth = 3;
      this.ctx.stroke();
    });
  }
};

// Запуск инициализации после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
  Game.setupCanvas();
  Game.updateTurnDisplay();
  Game.initEvents();
  DemoBoard.init();
});
