const Net = {
    socket: null,
    isOnline: false,   // Флаг, что мы играем в сети
    myColor: null,     // 'white' или 'black'
    lobbyId: null,     // ID комнаты
    myPlayerIndex: -1,
    playerToken: null, // Токен игрока для переподключения

    init() {
        // 1. Получаем или генерируем токен
        this.playerToken = localStorage.getItem('quoridor_token');
        if (!this.playerToken) {
            this.playerToken = 'player_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('quoridor_token', this.playerToken);
            console.log('[NET] New token generated:', this.playerToken);
        } else {
            console.log('[NET] Token exists:', this.playerToken);
        }

        this.socket = io({
            extraHeaders: {
                "ngrok-skip-browser-warning": "any-value"
            },
            auth: {
                token: this.playerToken // Отправляем токен при подключении
            }
        });



        this.socket.on('connect', () => {
            console.log('[NET] Socket connected:', this.socket.id);
            // Пытаемся вернуться в игру при переподключении
            this.socket.emit('rejoinGame', { token: this.playerToken });
        });

        this.socket.on('gameStart', (data) => {
            console.log(`[NET] Игра началась! Вы: ${data.color}, Лобби: ${data.lobbyId}`);

            this.isOnline = true;
            this.myColor = data.color;
            this.lobbyId = data.lobbyId;
            this.myPlayerIndex = data.color === 'white' ? 0 : 1;
            UI.hideSearch();

            Game.startOnline(data.color, this.myPlayerIndex);
        });

        // Обработка восстановления игры
        this.socket.on('gameResumed', (data) => {
            console.log(`[NET] ИГРА ВОССТАНОВЛЕНА! Лобби: ${data.lobbyId}`);
            this.isOnline = true;
            this.myColor = data.color;
            this.lobbyId = data.lobbyId;
            this.myPlayerIndex = data.myPlayerIndex;

            UI.hideSearch();
            UI.showScreen('gameScreen');

            // Восстанавливаем состояние локально
            Game.myPlayerIndex = this.myPlayerIndex;
            Game.state = data.state;
            Game.timers = data.timers; // Синхронизируем таймеры

            Game.draw();
            Game.updateTurnDisplay();
            Game.updateTimerDisplay();
            Game.startTimer();
        });

        this.socket.on('opponentDisconnected', () => {
            console.log('[NET] Противник отключился. Ждем...');
            // Можно добавить UI уведомление тут
            alert('Противник отключился. Ожидаем возвращения... (30сек)');
        });

        this.socket.on('opponentReconnected', () => {
            console.log('[NET] Противник вернулся!');
            alert('Противник вернулся в игру!');
        });

        this.socket.on('gameOver', (data) => {
            console.log(`[NET] Игра окончена! Победитель: ${data.winnerIdx}, Причина: ${data.reason}`);
            this.isOnline = false;
            this.lobbyId = null;
            this.myColor = null;

            Game.handleGameOver(data.winnerIdx, data.reason);
        });
        this.socket.on('serverMove', (data) => {
            Game.applyServerMove(data);
            this.socket.on('moveRejected', (data) => {
                console.warn('[NET] Ход отклонен сервером:', data.reason);
                console.log('Недопустимый ход!');
            });
        });
    },

    surrender() {
        if (this.isOnline && this.lobbyId) {
            console.log('[NET] Отправка запроса на сдачу...');
            this.socket.emit('surrender', { lobbyId: this.lobbyId });
        }
    },

    findGame() {
        this.socket.emit('findGame', { token: this.playerToken }); // Отправляем токен тоже
        console.log('[NET] Ищу игру...');
    },

    cancelFindGame() {
        this.socket.emit('cancelSearch');
        console.log('[NET] Поиск отменен.');
    },

    sendMove(moveData) {
        if (!this.isOnline) return;
        this.socket.emit('playerMove', {
            lobbyId: this.lobbyId,
            move: moveData
        });
    }
};

Net.init();