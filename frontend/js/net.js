const Net = {
    socket: null,
    isOnline: false,   // Флаг, что мы играем в сети
    myColor: null,     // 'white' или 'black'
    lobbyId: null,     // ID комнаты
    myPlayerIndex: -1,
    playerToken: null, // Токен игрока для переподключения
    lastGameLobbyId: null, // LobbyId последней завершенной игры (для реванша)
    lastTimeControl: null, // {base, inc} последнего поиска (для New Game)
    lastIsRanked: false,   // флаг ranked последнего поиска

    init() {
        // 1. Пытаемся получить сохраненный токен
        this.playerToken = localStorage.getItem('quoridor_token');
        console.log('[NET] Local token:', this.playerToken || 'none');

        // 2. Подключаемся, передавая токен (если есть)
        // Use absolute URL so it works in Capacitor WebView
        const serverUrl = window.location.origin || 'https://playquor.org';
        this.socket = io(serverUrl, {
            transports: ['websocket', 'polling'],
            extraHeaders: {
                "ngrok-skip-browser-warning": "any-value"
            },
            auth: {
                token: this.playerToken
            }
        });

        // 3. Слушаем назначение нового токена от сервера
        this.socket.on('assignToken', (data) => {
            this.playerToken = data.token;
            localStorage.setItem('quoridor_token', this.playerToken);
            console.log('[NET] Server assigned NEW token:', this.playerToken);

            // Если нужно - обновляем auth для будущих реконнектов сокета
            this.socket.auth.token = this.playerToken;
        });



        this.socket.on('connect', () => {
            console.log('[NET] Socket connected:', this.socket.id);
            // Пытаемся вернуться в игру при переподключении
            this.socket.emit('rejoinGame', { token: this.playerToken });
        });

        this.socket.on('gameStart', (data) => {
            console.log(`[NET] Игра началась! Вы: ${data.color}, Лобби: ${data.lobbyId}`);
            const lobbyCode = data.lobbyCode || data.lobbyId;

            this.isOnline = true;
            this.myColor = data.color;
            this.lobbyId = lobbyCode;
            this.myPlayerIndex = data.color === 'white' ? 0 : 1;
            UI.hideSearch(false);
            UI.currentRoomCode = null; // Сбрасываем код, так как он использован
            UI.updateLobbyRoute(lobbyCode);

            Game.startOnline(data.color, this.myPlayerIndex, data.initialTime, { me: data.me, opponent: data.opponent });
        });

        // Обработка восстановления игры
        this.socket.on('gameResumed', (data) => {
            console.log(`[NET] ИГРА ВОССТАНОВЛЕНА! Лобби: ${data.lobbyId}`);
            const lobbyCode = data.lobbyCode || data.lobbyId;
            this.isOnline = true;
            this.myColor = data.color;
            this.lobbyId = lobbyCode;
            this.myPlayerIndex = data.myPlayerIndex;

            UI.hideSearch(false);
            UI.showScreen('gameScreen');
            UI.updateLobbyRoute(lobbyCode, true);

            // Восстанавливаем состояние локально
            Game.myPlayerIndex = this.myPlayerIndex;

            // Restore notation for history (server doesn't store it)
            if (data.state.history) {
                data.state.history.forEach(item => {
                    if (!item.notation && Game.getNotation) {
                        item.notation = Game.getNotation(item.move);
                    }
                });
            }

            Game.state = data.state;
            if (data.profiles) Game.state.playerProfiles = data.profiles; // Restore profiles
            Game.timers = data.timers; // Синхронизируем таймеры

            Game.draw();
            Game.updateTurnDisplay();
            Game.updateTimerDisplay();
            Game.updateTurnDisplay();
            Game.updateTimerDisplay();
            Game.startTimer();
            if (Game.state.history && UI.renderHistory) {
                UI.renderHistory(Game.state.history);
            }
        });

        this.socket.on('opponentDisconnected', () => {
            console.log('[NET] Противник отключился. Ждем...');
            UI.showToast(UI.translate('toast_opponent_disconnected'), 'warning', 30000);
        });

        this.socket.on('opponentReconnected', () => {
            console.log('[NET] Противник вернулся!');
            // Тост удален, чтобы избежать спама уведомлениями
        });

        this.socket.on('gameOver', (data) => {
            console.log(`[NET] Игра окончена! Победитель: ${data.winnerIdx}, Причина: ${data.reason}`);

            // Если мы уже не в игре или в главном меню, игнорируем (защита от поздних событий)
            if (!this.lobbyId && !Game.isOnlineGame) return;

            // Save lobbyId for rematch
            this.lastGameLobbyId = this.lobbyId;

            this.isOnline = false;
            this.lobbyId = null;
            this.myColor = null;
            UI.clearLobbyRoute();

            Game.handleGameOver(data.winnerIdx, data.reason, data.ratingChanges);
        });

        this.socket.on('rematchStarted', (data) => {
            console.log(`[NET] Реванш начался! Вы: ${data.color}, Лобби: ${data.lobbyId}`);
            // Close result modal if still open
            const modal = document.getElementById('resultModal');
            if (modal) modal.classList.add('hidden');
            this.isOnline = true;
            this.myColor = data.color;
            this.lobbyId = data.lobbyCode || data.lobbyId;
            this.myPlayerIndex = data.color === 'white' ? 0 : 1;
            this.lastGameLobbyId = null;
            UI.hideSearch(false);
            UI.currentRoomCode = null;
            UI.updateLobbyRoute(this.lobbyId);
            Game.startOnline(data.color, this.myPlayerIndex, data.initialTime, { me: data.me, opponent: data.opponent });
        });

        this.socket.on('rematchFailed', (data) => {
            console.log('[NET] Реванш не удался:', data.reason);
            UI.showToast(data.reason, 'error');
            UI.showRematchBtn(true);
        });

        this.socket.on('opponentWantsRematch', () => {
            console.log('[NET] Противник хочет реванш!');
            UI.showToast(UI.translate('toast_opponent_wants_rematch') || 'Opponent wants a rematch!', 'info', 5000);
            // Re-enable rematch button in case it was disabled
            UI.showRematchBtn(true);
        });
        this.socket.on('serverMove', (data) => {
            Game.applyServerMove(data);
        });

        this.socket.on('moveRejected', (data) => {
            console.warn('[NET] Ход отклонен сервером:', data.reason);
            UI.showToast(UI.translate('toast_invalid_move'), 'error');
        });

        this.socket.on('timerUpdate', (data) => {
            Game.syncTimers(data.timers);
        });

        this.socket.on('forceDisconnect', (data) => {
            console.log('[NET] Force Disconnected:', data.reason);
            // alert('Соединение разорвано: Вы открыли игру в другой вкладке.');
            this.socket.disconnect();
            this.isOnline = false;
            // location.reload(); // <--- УБРАЛИ АВТОРЕЛОАД
            UI.showDisconnectOverlay(); // <--- ПОКАЗЫВАЕМ ОВЕРЛЕЙ
        });

        this.socket.on('findGameFailed', (data) => {
            console.log('[NET] Find Game Failed:', data.reason);
            const reasonMsg = data.reason === 'Already in game' ? UI.translate('toast_already_in_game') : data.reason;
            UI.showToast(UI.translate('toast_search_error') + ': ' + reasonMsg, 'error');
            UI.hideSearch(false);
        });

        this.socket.on('roomCreated', (data) => {
            console.log('[NET] Room created:', data.roomCode);
            UI.onRoomCreated(data.roomCode);
        });

        this.socket.on('joinRoomFailed', (data) => {
            console.log('[NET] Join Room Failed:', data.reason);
            UI.showToast(UI.translate('toast_join_error') + ': ' + data.reason, 'error');
            UI.hideRoomJoining();
        });

        // Online stats update (users online, games in progress, lists)
        this.socket.on('onlineStats', (data) => {
            UI.updateOnlineStats(data);
        });
    },

    surrender() {
        if (this.isOnline && this.lobbyId) {
            console.log('[NET] Отправка запроса на сдачу...');
            this.socket.emit('surrender', { lobbyId: this.lobbyId });
        }
    },

    findGame(timeData, isRanked) {
        // isRanked passed from UI
        this.lastTimeControl = timeData;
        this.lastIsRanked = !!isRanked;
        this.socket.emit('findGame', {
            token: this.playerToken,
            timeControl: timeData,
            isRanked: !!isRanked
        });
        console.log('[NET] Ищу игру с контролем:', timeData, 'Ranked:', isRanked);
    },

    cancelFindGame() {
        this.socket.emit('cancelSearch', { token: this.playerToken });
        console.log('[NET] Поиск отменен.');
    },

    sendMove(moveData) {
        if (!this.isOnline) return;
        this.socket.emit('playerMove', {
            lobbyId: this.lobbyId,
            move: moveData
        });
    },

    requestRematch() {
        if (this.lastGameLobbyId) {
            console.log('[NET] Requesting rematch for lobby:', this.lastGameLobbyId);
            this.socket.emit('requestRematch', { lobbyId: this.lastGameLobbyId, token: this.playerToken });
            UI.showRematchBtn(false);
        }
    },

    startNewGame() {
        const modal = document.getElementById('resultModal');
        if (modal) modal.classList.add('hidden');
        UI.showNewGameBtn(false);
        UI.showRematchBtn(false);

        if (!this.lastTimeControl) return;

        if (this.lastIsRanked && !UI.currentUser) {
            UI.showToast(UI.translate('toast_ranked_requires_login') || 'Login required for ranked', 'warning');
            UI.openAuthModal();
            return;
        }

        UI.backToMenu();
        UI.showSearch(this.lastTimeControl, this.lastIsRanked);
    },

    createRoom() {
        this.socket.emit('createRoom', { token: this.playerToken });
        console.log('[NET] Creating room...');
    },

    joinRoom(roomCode) {
        this.socket.emit('joinRoom', { roomCode, token: this.playerToken });
        console.log('[NET] Joining room:', roomCode);
    },

    rejoinLobbyByCode(lobbyCode) {
        if (!lobbyCode) return;
        this.socket.emit('rejoinLobby', { lobbyCode, token: this.playerToken });
    }
};

Net.reconnectSocket = function () {
    if (this.socket) {
        this.socket.disconnect();
        this.socket.removeAllListeners();
        this.socket = null;
    }
    this.init();
};

Net.init();