const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const Shared = require('./shared.js'); // Подключаем общую логику

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
    
let searchQueue = [];
let lobbyCounter = 1;
let activeGames = {}; 

app.use(express.static(__dirname));


function createInitialState() {
    return {
        hWalls: Array.from({length:8},()=>Array(8).fill(false)),
        vWalls: Array.from({length:8},()=>Array(8).fill(false)),
        players: [
            {color:'white', pos:{r:8, c:4}, wallsLeft:10},
            {color:'black', pos:{r:0, c:4}, wallsLeft:10}
        ],
        currentPlayer: 0,
        playerSockets: [null, null],
        timers: [5, 5],
        lastmoveTimestamp: Date.now()
    };
}
function checkVictory(state) {
    if (state.players[0].pos.r === 0) return 0;
    if (state.players[1].pos.r === 8) return 1;
    if (game.timers[game.currentPlayer] <= 0) return game.currentPlayer;
    return -1; 
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
    socket.on('cancelSearch', () => {
        const index = searchQueue.indexOf(socket.id);
        if (index > -1) {
            searchQueue.splice(index, 1);
            console.log(`[QUEUE] Игрок ${socket.id} покинул очередь.`);
        }
    });
    // --- ОБРАБОТКА ХОДА (SERVER AUTHORITATIVE) ---
    socket.on('playerMove', (data) => {
        const { lobbyId, move } = data;
        const game = activeGames[lobbyId];
        const now = Date.now();
        const elapsed = Math.floor((now - game.lastMoveTimestamp) / 1000);

        game.timers[game.currentPlayer] -= elapsed;
        game.lastMoveTimestamp = now;

        if (game.timers[playerIdx] < 0) {
            io.to(lobbyId).emit('gameOver', { 
                winnerIdx: 1 - playerIdx, 
                reason: 'Time out' 
            });
            delete activeGames[lobbyId];
            return;
        }

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
                    
                    // --- НОВАЯ ЛОГИКА: ПРОВЕРКА ПОБЕДЫ ---
                    const winnerIdx = checkVictory(game);
                    if (winnerIdx !== -1) {
                        console.log(`[GAME OVER] Лобби ${lobbyId}: Игрок ${winnerIdx} победил, достигнув цели.`);
                        
                        io.to(lobbyId).emit('gameOver', { 
                            winnerIdx: winnerIdx, 
                            reason: 'Goal reached' 
                        });
                        delete activeGames[lobbyId];
                        return; 
                    }
                    // ----------------------------------------

                    // Переключаем ход (если игра не окончена)
                    game.currentPlayer = 1 - game.currentPlayer;

                    // Отправляем подтверждение всем
                    io.to(lobbyId).emit('serverMove', {
                        playerIdx: playerIdx,
                        move: move,
                        nextPlayer: game.currentPlayer,
                        newState: game,
                        move: data,
                        timers: game.timers
                    });
                }
        else {
            console.log(`[MOVE INVALID] Лобби ${lobbyId}, Ход отклонен.`);
            socket.emit('moveRejected', { reason: 'Invalid move' });
        }
    });

    socket.on('disconnect', () => {
        console.log(`[DISCONNECT] Пользователь отключен: ${socket.id}`);
        
        // (Очистка очереди поиска...)
        const index = searchQueue.indexOf(socket.id);
        if (index > -1) searchQueue.splice(index, 1);
        
        // --- НОВАЯ ЛОГИКА: ОБРАБОТКА ВЫХОДА ИЗ АКТИВНОЙ ИГРЫ ---
        for (const lobbyId in activeGames) {
            const game = activeGames[lobbyId];
            const disconnectedIdx = game.playerSockets.indexOf(socket.id);

            if (disconnectedIdx !== -1) {
                // Если отключившийся игрок найден в активной игре
                const winnerIdx = 1 - disconnectedIdx; 
                const winnerSocketId = game.playerSockets[winnerIdx];
                
                console.log(`[RAGE QUIT] Лобби ${lobbyId}: Игрок ${disconnectedIdx} отключился. Игрок ${winnerIdx} победил.`);
                
                // Уведомляем оставшегося игрока
                io.to(winnerSocketId).emit('gameOver', { 
                    winnerIdx: winnerIdx, 
                    reason: 'Opponent disconnected' 
                });
                
                // Очищаем серверное состояние
                delete activeGames[lobbyId];
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;

setInterval(() => {
    const now = Date.now();
    for (const lobbyId in activeGames) {
        const game = activeGames[lobbyId];
        const activeIdx = game.currentPlayer;
        
        const elapsedSinceLastMove = Math.floor((now - game.lastMoveTimestamp) / 1000);
        const timeLeft = game.timers[activeIdx] - elapsedSinceLastMove;

        if (timeLeft <= 0) {
            console.log(`[TIMEOUT] Лобби ${lobbyId}: Игрок ${activeIdx} проиграл по времени.`);
            io.to(lobbyId).emit('gameOver', { 
                winnerIdx: 1 - activeIdx, 
                reason: 'Time out' 
            });
            delete activeGames[lobbyId];
        }
    }
}, 2000);

server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});