const Net = {
    socket: null,
    isOnline: false,   // Флаг, что мы играем в сети
    myColor: null,     // 'white' или 'black'
    lobbyId: null,     // ID комнаты

    init() {
        this.socket = io(); 

        this.socket.on('connect', () => console.log('[NET] Socket connected:', this.socket.id));
        
        // 1. Старт игры
        this.socket.on('gameStart', (data) => {
            console.log(`[NET] Игра началась! Вы: ${data.color}, Лобби: ${data.lobbyId}`);
            
            this.isOnline = true;
            this.myColor = data.color;
            this.lobbyId = data.lobbyId;

            UI.hideSearch(); // Убираем меню поиска
            
            // Запускаем игру в режиме Online
            Game.startOnline(data.color);
        });

        // 2. Получение хода соперника
            this.socket.on('serverMove', (data) => {
            // data = { playerIdx, move, nextPlayer }
            Game.applyServerMove(data);
            this.socket.on('moveRejected', (data) => {
            console.warn('[NET] Ход отклонен сервером:', data.reason);
            console.log('Недопустимый ход!');
        });
        });
    },

    findGame() {
        this.socket.emit('findGame');
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