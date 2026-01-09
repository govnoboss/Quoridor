const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const Shared = require('./shared.js'); // Подключаем общую логику

const app = express();

const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    transports: ['polling', 'websocket'], // 👈 важно
    allowUpgrades: true,
    pingTimeout: 60000
});

let searchQueue = []; // Array of { socketId, token }
let lobbyCounter = 1;
let activeGames = {}; // lobbyId -> GameState

app.use(express.static(__dirname));


function createInitialState() {
    return {
        hWalls: Array.from({ length: 8 }, () => Array(8).fill(false)),
        vWalls: Array.from({ length: 8 }, () => Array(8).fill(false)),
        players: [
            { color: 'white', pos: { r: 8, c: 4 }, wallsLeft: 10 },
            { color: 'black', pos: { r: 0, c: 4 }, wallsLeft: 10 }
        ],
        currentPlayer: 0,
        playerSockets: [null, null],
        playerTokens: [null, null], // New: Store tokens
        disconnectTimer: null,      // New: Timer for grace period
        timers: [600, 600],
        lastMoveTimestamp: Date.now()
    };
}
function checkVictory(state) {
    if (state.players[0].pos.r === 0) return 0;
    if (state.players[1].pos.r === 8) return 1;
    if (state.timers[state.currentPlayer] <= 0) return state.currentPlayer;
    return -1;
}

io.on('connection', (socket) => {
    console.log(`Пользователь подключен: ${socket.id}`);

    // --- ПОИСК ИГРЫ ---
    socket.on('findGame', (data) => {
        const token = data ? data.token : null;
        if (!token) {
            console.log(`[QUEUE REJECT] Игрок ${socket.id} без токена.`);
            return;
        }

        // Check if already in queue
        if (!searchQueue.some(p => p.token === token)) {
            searchQueue.push({ socketId: socket.id, token: token });
            const shortToken = token.length > 4 ? '...' + token.substr(-4) : token;
            console.log(`[QUEUE] Игрок ${socket.id} (Token: ${shortToken}) в очереди.`);

            if (searchQueue.length >= 2) {
                const p1Data = searchQueue.shift();
                const p2Data = searchQueue.shift();
                const lobbyId = `lobby-${lobbyCounter++}`;

                const s1 = io.sockets.sockets.get(p1Data.socketId);
                const s2 = io.sockets.sockets.get(p2Data.socketId);

                if (s1 && s2) {
                    s1.join(lobbyId);
                    s2.join(lobbyId);

                    // 1. Инициализируем состояние на сервере
                    activeGames[lobbyId] = createInitialState();
                    activeGames[lobbyId].playerSockets[0] = p1Data.socketId;
                    activeGames[lobbyId].playerSockets[1] = p2Data.socketId;
                    activeGames[lobbyId].playerTokens[0] = p1Data.token;
                    activeGames[lobbyId].playerTokens[1] = p2Data.token;

                    console.log(`[GAME START] Лобби ${lobbyId} создано.`);

                    s1.emit('gameStart', { lobbyId, color: 'white', opponent: p2Data.token });
                    s2.emit('gameStart', { lobbyId, color: 'black', opponent: p1Data.token });
                } else {
                    // One socket is dead? Put valid one back?
                    // Simple retry logic:
                    if (s1) searchQueue.unshift(p1Data);
                    if (s2) searchQueue.unshift(p2Data);
                }
            }
        }
    });

    socket.on('cancelSearch', () => {
        const index = searchQueue.findIndex(p => p.socketId === socket.id);
        if (index > -1) {
            searchQueue.splice(index, 1);
            console.log(`[QUEUE] Игрок ${socket.id} покинул очередь.`);
        }
    });

    // --- REJOIN GAME ---
    socket.on('rejoinGame', (data) => {
        const { token } = data;
        if (!token) return;

        const shortToken = token.length > 4 ? '...' + token.substr(-4) : token;
        console.log(`[REJOIN] Attempting rejoin for token ${shortToken}`);

        // Find game with this token
        for (const lobbyId in activeGames) {
            const game = activeGames[lobbyId];
            const pIdx = game.playerTokens.indexOf(token);

            if (pIdx !== -1) {
                // Found the game!
                console.log(`[REJOIN] Found active game ${lobbyId} for player ${pIdx}`);

                // 1. Update socket
                game.playerSockets[pIdx] = socket.id;
                socket.join(lobbyId);

                // 2. Clear disconnect timer if it exists
                if (game.disconnectTimer) {
                    clearTimeout(game.disconnectTimer);
                    game.disconnectTimer = null;
                    console.log(`[REJOIN] Disconnect timer cleared for ${lobbyId}`);
                }

                // 3. Send Resume event
                socket.emit('gameResumed', {
                    lobbyId,
                    color: pIdx === 0 ? 'white' : 'black',
                    myPlayerIndex: pIdx,
                    state: game,
                    timers: game.timers
                });

                // 4. Notify opponent
                const opponentSocket = game.playerSockets[1 - pIdx];
                if (opponentSocket) {
                    io.to(opponentSocket).emit('opponentReconnected');
                }
                return;
            }
        }
        console.log(`[REJOIN] No active game found for token.`);
    });


    // --- ОБРАБОТКА ХОДА (SERVER AUTHORITATIVE) ---
    socket.on('playerMove', (data) => {
        const { lobbyId, move } = data;
        const game = activeGames[lobbyId];

        if (!game) {
            // console.error(`[ERROR] Игра ${lobbyId} не найдена!`);
            return;
        }

        const now = Date.now();
        const elapsed = Math.floor((now - game.lastMoveTimestamp) / 1000);
        const playerIdx = game.playerSockets.indexOf(socket.id);

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

        // 1. Проверка очередности хода
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
                timers: game.timers
            });
        }
        else {
            console.log(`[MOVE INVALID] Лобби ${lobbyId}, Ход отклонен.`);
            socket.emit('moveRejected', { reason: 'Invalid move' });
        }
    });

    socket.on('surrender', (data) => {
        const { lobbyId } = data;
        const game = activeGames[lobbyId];

        if (game) {
            const surrenderingIdx = game.playerSockets.indexOf(socket.id);

            if (surrenderingIdx !== -1) {
                const winnerIdx = 1 - surrenderingIdx;

                console.log(`[SURRENDER] Лобби ${lobbyId}: Игрок ${surrenderingIdx} сдался.`);

                io.to(lobbyId).emit('gameOver', {
                    winnerIdx: winnerIdx,
                    reason: 'Surrender'
                });

                delete activeGames[lobbyId];
            }
        } else {
            // console.error(`[SURRENDER ERROR] Игра ${lobbyId} не найдена.`);
        }
    });

    socket.on('disconnect', () => {
        console.log(`[DISCONNECT] Пользователь отключен: ${socket.id}`);

        // Remove from search queue if there
        const index = searchQueue.findIndex(p => p.socketId === socket.id);
        if (index > -1) searchQueue.splice(index, 1);

        // Check active games for disconnects
        for (const lobbyId in activeGames) {
            const game = activeGames[lobbyId];
            const disconnectedIdx = game.playerSockets.indexOf(socket.id);

            if (disconnectedIdx !== -1) {
                console.log(`[GAME SUSPEND] Player ${disconnectedIdx} disconnected from ${lobbyId}. Starting grace period.`);

                // Notify opponent
                const opponentSocket = game.playerSockets[1 - disconnectedIdx];
                if (opponentSocket) {
                    io.to(opponentSocket).emit('opponentDisconnected');
                }

                // Start 30s Grace Period
                if (game.disconnectTimer) clearTimeout(game.disconnectTimer);

                // If BOTH disconnect, kill it immediately to save resources? Or wait? 
                // Let's just wait. If both gone, timer will kill.

                game.disconnectTimer = setTimeout(() => {
                    console.log(`[GAME TIMEOUT] Player took too long to reconnect. Ending game ${lobbyId}.`);

                    const winnerIdx = 1 - disconnectedIdx;
                    const winnerSocketId = game.playerSockets[winnerIdx];

                    // Notify winner if they are still there
                    if (winnerSocketId) {
                        io.to(winnerSocketId).emit('gameOver', {
                            winnerIdx: winnerIdx,
                            reason: 'Opponent disconnected'
                        });
                    }

                    delete activeGames[lobbyId];
                }, 30000); // 30 seconds

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
        // Only tick time if NO ONE is disconnected?? 
        // Or keep ticking? Usually keep ticking or pause?
        // Let's PAUSE timer if someone is disconnected (grace period).
        if (game.disconnectTimer) continue;

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

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});