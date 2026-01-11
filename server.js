const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const Shared = require('./shared.js');

const app = express();
app.set('trust proxy', 1); // Доверяем заголовкам от Nginx ( Cloudflare)

// Request Logger (Optional: keep for debugging, or remove for prod)
app.use((req, res, next) => {
    // console.log(`[REQ] ${req.method} ${req.url} from ${req.ip}`);
    next();
});

// --- SECURITY MIDDLEWARE ---

app.disable('x-powered-by');

// LAN-friendly Helmet Configuration
app.use(helmet({
    generateContentSecurityPolicy: false, // We customize it below
    hsts: false, // Disable HSTS to allow HTTP on LAN
}));

app.use(helmet.contentSecurityPolicy({
    useDefaults: false,
    directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'", "https://cdn.socket.io"],
        "script-src-attr": ["'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:"],
        "media-src": ["'self'", "data:"],
        "connect-src": ["'self'", "ws:", "wss:", "http:", "https:", "https://cdn.socket.io"]
    }
}));



const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'file://' // For local testing without server if needed, though usually not recommended for production
];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1 || origin.startsWith('http://localhost')) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST'],
    credentials: true
}));

const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST'],
        credentials: true
    },
    transports: ['polling', 'websocket'], // 👈 важно
    allowUpgrades: true,
    pingTimeout: 60000
});

let searchQueues = {}; // key: "base+inc" -> array players
let lobbyCounter = 1;
let activeGames = {}; // lobbyId -> GameState
let privateRooms = {}; // roomCode -> { players: [{ socketId, token }], createdAt }

/**
 * Генерирует короткий уникальный код комнаты.
 */
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}


app.use(express.static(__dirname));


function createInitialState(timeControl) {
    const base = timeControl?.base || 600;
    const inc = timeControl?.inc || 0;
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
        timers: [base, base],
        increment: inc,
        lastMoveTimestamp: Date.now()
    };
}
function checkVictory(state) {
    if (state.players[0].pos.r === 0) return 0;
    if (state.players[1].pos.r === 8) return 1;
    if (state.timers[state.currentPlayer] <= 0) return state.currentPlayer;
    return -1;
}

// ============================================================
// INPUT VALIDATION UTILITIES
// ============================================================

/**
 * Проверяет, что токен — непустая строка.
 */
function isValidToken(token) {
    return typeof token === 'string' && token.length > 0;
}

/**
 * Проверяет формат lobbyId: 'lobby-<number>'.
 */
// Валидация типов данных и границ перенесена в Shared.js для консистентности.

const rateLimits = new Map(); // socketId -> { type: { count, resetTime } }

/**
 * Проверяет лимиты запросов.
 * @param {string} socketId - ID сокета
 * @param {string} type - Тип действия ('findGame', 'move')
 * @param {number} limit - Максимум запросов
 * @param {number} windowMs - Окно времени в мс
 * @returns {boolean} true если лимит не превышен
 */
function checkRateLimit(socketId, type, limit, windowMs) {
    const now = Date.now();

    // Инициализация хранилища для сокета
    if (!rateLimits.has(socketId)) {
        rateLimits.set(socketId, {});
    }

    const socketLimits = rateLimits.get(socketId);

    // Инициализация/сброс окна для конкретного типа действия
    if (!socketLimits[type] || now > socketLimits[type].resetTime) {
        socketLimits[type] = {
            count: 1,
            resetTime: now + windowMs
        };
        return true;
    }

    // Инкремент и проверка
    socketLimits[type].count++;
    return socketLimits[type].count <= limit;
}

const crypto = require('crypto');

io.on('connection', (socket) => {
    // 1. Получаем токен из handshake (если есть)
    let token = socket.handshake.auth.token;

    // 2. Если токена нет или он невалидный (слишком короткий/старый формат) — генерируем новый
    if (!token || typeof token !== 'string' || token.length < 10) {
        token = crypto.randomUUID(); // Генерируем надежный UUID
        socket.emit('assignToken', { token: token }); // Отправляем клиенту
        console.log(`[AUTH] New player assigned token: ${token.substr(0, 8)}...`);
    } else {
        console.log(`[AUTH] Player returned with token: ${token.substr(0, 8)}...`);
    }

    // Сохраняем токен в сокете для удобства
    socket.playerToken = token;

    // Очистка памяти при отключении
    socket.on('disconnect', () => {
        rateLimits.delete(socket.id);
    });

    console.log(`Пользователь подключен: ${socket.id}`);

    // --- ПОИСК ИГРЫ ---
    socket.on('findGame', (data) => {
        if (!checkRateLimit(socket.id, 'findGame', 2, 5000)) {
            socket.emit('findGameFailed', { reason: 'Too many requests. Please wait.' });
            return;
        }

        const token = data?.token;
        const tc = data?.timeControl || { base: 600, inc: 0 };
        const tcKey = `${tc.base}+${tc.inc}`;

        if (!isValidToken(token)) return;

        // Инициализируем очередь для этого контроля, если её нет
        if (!searchQueues[tcKey]) searchQueues[tcKey] = [];
        const queue = searchQueues[tcKey];

        // Удаляем из других очередей, если он там был (защита от дублей)
        for (const key in searchQueues) {
            const idx = searchQueues[key].findIndex(p => p.token === token);
            if (idx > -1) searchQueues[key].splice(idx, 1);
        }

        queue.push({ socketId: socket.id, token: token, timeControl: tc });
        console.log(`[QUEUE] Player ${socket.id} joined queue [${tcKey}]`);

        if (queue.length >= 2) {
            const p1 = queue.shift();
            const p2 = queue.shift();
            const lobbyId = `lobby-${lobbyCounter++}`;

            const s1 = io.sockets.sockets.get(p1.socketId);
            const s2 = io.sockets.sockets.get(p2.socketId);

            if (s1 && s2) {
                activeGames[lobbyId] = createInitialState(p1.timeControl);
                activeGames[lobbyId].playerSockets[0] = p1.socketId;
                activeGames[lobbyId].playerSockets[1] = p2.socketId;
                activeGames[lobbyId].playerTokens[0] = p1.token;
                activeGames[lobbyId].playerTokens[1] = p2.token;

                s1.join(lobbyId);
                s2.join(lobbyId);
                s1.emit('gameStart', { lobbyId, color: 'white', opponent: p2.token, initialTime: activeGames[lobbyId].timers[0] });
                s2.emit('gameStart', { lobbyId, color: 'black', opponent: p1.token, initialTime: activeGames[lobbyId].timers[1] });
                console.log(`[GAME START] Lobby ${lobbyId} created for ${tcKey}`);
            } else {
                if (s1) queue.unshift(p1);
                if (s2) queue.unshift(p2);
            }
        }
    });

    socket.on('cancelSearch', () => {
        for (const key in searchQueues) {
            const index = searchQueues[key].findIndex(p => p.socketId === socket.id);
            if (index > -1) {
                searchQueues[key].splice(index, 1);
                console.log(`[QUEUE] Player ${socket.id} left queue [${key}]`);
            }
        }
    });

    // --- ПРИВАТНЫЕ КОМНАТЫ ---
    socket.on('createRoom', (data) => {
        const token = data?.token || socket.playerToken;
        if (!isValidToken(token)) return;

        // Удаляем игрока из ВСЕХ очередей поиска, если он там был
        for (const key in searchQueues) {
            const idx = searchQueues[key].findIndex(p => p.socketId === socket.id);
            if (idx > -1) searchQueues[key].splice(idx, 1);
        }

        const roomCode = generateRoomCode();
        privateRooms[roomCode] = {
            players: [{ socketId: socket.id, token: token }],
            createdAt: Date.now()
        };

        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode });
        console.log(`[ROOM] Created private room: ${roomCode} by ${socket.id}`);
    });

    socket.on('joinRoom', (data) => {
        const { roomCode, token } = data;
        const playerToken = token || socket.playerToken;

        if (!isValidToken(playerToken) || !roomCode) {
            socket.emit('joinRoomFailed', { reason: 'Некорректные данные' });
            return;
        }

        const normalizedCode = roomCode.toUpperCase().trim();
        const room = privateRooms[normalizedCode];

        if (!room) {
            socket.emit('joinRoomFailed', { reason: 'Комната не найдена' });
            return;
        }

        if (room.players.length >= 2) {
            socket.emit('joinRoomFailed', { reason: 'Комната полна' });
            return;
        }

        // Проверяем, не пытается ли игрок войти в свою же комнату с тем же токеном
        if (room.players[0].token === playerToken) {
            socket.emit('joinRoomFailed', { reason: 'Вы уже в этой комнате' });
            return;
        }

        room.players.push({ socketId: socket.id, token: playerToken });
        socket.join(normalizedCode);

        console.log(`[ROOM] Player ${socket.id} joined room ${normalizedCode}`);

        if (room.players.length === 2) {
            const p1Data = room.players[0];
            const p2Data = room.players[1];
            const lobbyId = `lobby-${lobbyCounter++}`;

            const s1 = io.sockets.sockets.get(p1Data.socketId);
            const s2 = io.sockets.sockets.get(p2Data.socketId);

            if (s1 && s2) {
                s1.join(lobbyId);
                s2.join(lobbyId);

                activeGames[lobbyId] = createInitialState({ base: 600, inc: 0 }); // Default for private rooms
                activeGames[lobbyId].playerSockets[0] = p1Data.socketId;
                activeGames[lobbyId].playerSockets[1] = p2Data.socketId;
                activeGames[lobbyId].playerTokens[0] = p1Data.token;
                activeGames[lobbyId].playerTokens[1] = p2Data.token;

                s1.emit('gameStart', { lobbyId, color: 'white', opponent: p2Data.token });
                s2.emit('gameStart', { lobbyId, color: 'black', opponent: p1Data.token });

                console.log(`[GAME START] Лобби ${lobbyId} создано из приватной комнаты ${normalizedCode}.`);
                delete privateRooms[normalizedCode];
            } else {
                delete privateRooms[normalizedCode];
                socket.emit('joinRoomFailed', { reason: 'Противник отключился' });
            }
        }
    });

    // --- REJOIN GAME ---
    socket.on('rejoinGame', (data) => {
        const token = data?.token;

        // Валидация входных данных
        if (!isValidToken(token)) {
            console.log(`[VALIDATION] rejoinGame: invalid token from ${socket.id}`);
            return;
        }

        const shortToken = '...' + token.substr(-4);
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
        // Rate Limiting: 5 moves per 1 second
        if (!checkRateLimit(socket.id, 'move', 5, 1000)) {
            socket.emit('moveRejected', { reason: 'Too many moves' });
            return;
        }

        // Валидация структуры запроса
        if (!data || typeof data !== 'object') {
            console.log(`[VALIDATION] playerMove: invalid data from ${socket.id}`);
            socket.emit('moveRejected', { reason: 'Invalid request' });
            return;
        }

        const { lobbyId, move } = data;

        // Валидация lobbyId и хода через Shared логику
        if (!Shared.isValidLobbyId(lobbyId)) {
            socket.emit('moveRejected', { reason: 'Invalid lobby format' });
            return;
        }

        if (!Shared.isValidMove(move)) {
            socket.emit('moveRejected', { reason: 'Invalid move format' });
            return;
        }

        const game = activeGames[lobbyId];

        if (!game) {
            socket.emit('moveRejected', { reason: 'Game not found' });
            return;
        }

        const now = Date.now();
        const elapsed = Math.floor((now - game.lastMoveTimestamp) / 1000);
        const playerIdx = game.playerSockets.indexOf(socket.id);

        game.timers[game.currentPlayer] -= elapsed;
        game.lastMoveTimestamp = now;

        if (game.timers[playerIdx] < 0) {
            if (game.disconnectTimer) clearTimeout(game.disconnectTimer);
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

                if (game.disconnectTimer) clearTimeout(game.disconnectTimer);
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

            // Добавляем инкремент (Fisher)
            if (game.increment > 0) {
                game.timers[playerIdx] += game.increment;
            }

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
        // Валидация входных данных
        if (!data || typeof data !== 'object') {
            console.log(`[VALIDATION] surrender: invalid data from ${socket.id}`);
            return;
        }

        const { lobbyId } = data;

        if (!Shared.isValidLobbyId(lobbyId)) {
            socket.emit('error', { message: 'Invalid lobby format' });
            return;
        }

        const game = activeGames[lobbyId];

        if (game) {
            const surrenderingIdx = game.playerSockets.indexOf(socket.id);

            if (surrenderingIdx !== -1) {
                const winnerIdx = 1 - surrenderingIdx;

                if (game.disconnectTimer) clearTimeout(game.disconnectTimer);

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

        // Remove from search queues
        for (const key in searchQueues) {
            const index = searchQueues[key].findIndex(p => p.socketId === socket.id);
            if (index > -1) searchQueues[key].splice(index, 1);
        }

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
            if (game.disconnectTimer) clearTimeout(game.disconnectTimer);
            console.log(`[TIMEOUT] Лобби ${lobbyId}: Игрок ${activeIdx} проиграл по времени.`);
            io.to(lobbyId).emit('gameOver', {
                winnerIdx: 1 - activeIdx,
                reason: 'Time out'
            });
            delete activeGames[lobbyId];
        } else {
            // Send sync pulse to clients
            const currentTimers = [...game.timers];
            currentTimers[activeIdx] = timeLeft;
            io.to(lobbyId).emit('timerUpdate', { timers: currentTimers });
        }
    }

    // Очистка старых приватных комнат (старше 30 минут)
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
    for (const code in privateRooms) {
        if (privateRooms[code].createdAt < thirtyMinutesAgo) {
            console.log(`[ROOM CLEANUP] Deleting stale room: ${code}`);
            delete privateRooms[code];
        }
    }
}, 1000);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});