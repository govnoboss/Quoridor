const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const Shared = require('./shared.js'); // Подключаем общую логику

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let searchQueue = [];
let lobbyCounter = 1;
// Хранилище активных игр: { lobbyId: GameState }
let activeGames = {}; 

app.use(express.static(__dirname));

// Функция создания начального состояния (копия из game.js)
function createInitialState() {
    return {
        hWalls: Array.from({length:8},()=>Array(8).fill(false)),
        vWalls: Array.from({length:8},()=>Array(8).fill(false)),
        players: [
            {color:'white', pos:{r:8, c:4}, wallsLeft:10},
            {color:'black', pos:{r:0, c:4}, wallsLeft:10}
        ],
        currentPlayer: 0,
        // Связь индексов игроков с Socket ID
        playerSockets: [null, null] 
    };
}

io.on('connection', (socket) => {
    console.log(`Пользователь подключен: ${socket.id}`);

    // --- ПОИСК ИГРЫ ---
    socket.on('findGame', () => {
        if (!searchQueue.includes(socket.id)) {
            searchQueue.push(socket.id);
            console.log(`[QUEUE] Игрок ${socket.id} в очереди.`);
            
            if (searchQueue.length >= 2) {
                const p1 = searchQueue.shift();
                const p2 = searchQueue.shift();
                const lobbyId = `lobby-${lobbyCounter++}`;
                
                const s1 = io.sockets.sockets.get(p1);
                const s2 = io.sockets.sockets.get(p2);
                
                if (s1 && s2) {
                    s1.join(lobbyId);
                    s2.join(lobbyId);
                    
                    // 1. Инициализируем состояние на сервере
                    activeGames[lobbyId] = createInitialState();
                    activeGames[lobbyId].playerSockets[0] = p1;
                    activeGames[lobbyId].playerSockets[1] = p2;

                    console.log(`[GAME START] Лобби ${lobbyId} создано.`);

                    s1.emit('gameStart', { lobbyId, color: 'white', opponent: p2 });
                    s2.emit('gameStart', { lobbyId, color: 'black', opponent: p1 });
                }
            }
        }
    });

    // --- ОБРАБОТКА ХОДА (SERVER AUTHORITATIVE) ---
    socket.on('playerMove', (data) => {
        const { lobbyId, move } = data;
        const game = activeGames[lobbyId];

        if (!game) {
            console.error(`[ERROR] Игра ${lobbyId} не найдена!`);
            return;
        }

        // 1. Проверка очередности хода
        const playerIdx = game.playerSockets.indexOf(socket.id);
        if (playerIdx !== game.currentPlayer) {
            console.log(`[WARN] Игрок ${socket.id} пытался походить не в свою очередь.`);
            socket.emit('moveRejected', { reason: 'Not your turn' });
            return;
        }

        let valid = false;

        // 2. Валидация хода через Shared логику
        if (move.type === 'pawn') {
            const currentPos = game.players[playerIdx].pos;
            if (Shared.canMovePawn(game, currentPos.r, currentPos.c, move.r, move.c)) {
                // Применяем ход к серверному состоянию
                game.players[playerIdx].pos = { r: move.r, c: move.c };
                valid = true;
            }
        } else if (move.type === 'wall') {
            if (game.players[playerIdx].wallsLeft > 0 &&
                Shared.checkWallPlacement(game, move.r, move.c, move.isVertical)) {
                
                // Временно ставим стену для проверки пути
                if (move.isVertical) game.vWalls[move.r][move.c] = true;
                else game.hWalls[move.r][move.c] = true;

                if (Shared.isValidWallPlacement(game)) {
                    game.players[playerIdx].wallsLeft--;
                    valid = true;
                } else {
                    // Откат, если заблокировал путь
                    if (move.isVertical) game.vWalls[move.r][move.c] = false;
                    else game.hWalls[move.r][move.c] = false;
                }
            }
        }

        if (valid) {
            console.log(`[MOVE VALID] Лобби ${lobbyId}, Игрок ${playerIdx}, Ход:`, move);
            
            // Переключаем ход
            game.currentPlayer = 1 - game.currentPlayer;

            // Отправляем подтверждение всем
            io.to(lobbyId).emit('serverMove', {
                playerIdx: playerIdx,
                move: move,
                nextPlayer: game.currentPlayer
            });
        } else {
            console.log(`[MOVE INVALID] Лобби ${lobbyId}, Ход отклонен.`);
            socket.emit('moveRejected', { reason: 'Invalid move' });
        }
    });

    socket.on('disconnect', () => {
        // Простая очистка очереди
        const index = searchQueue.indexOf(socket.id);
        if (index > -1) searchQueue.splice(index, 1);
        // Очистку activeGames можно добавить позже (когда оба игрока вышли)
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});