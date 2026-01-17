require('dotenv').config(); // Загружаем переменные окружения из .env

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const Shared = require('./core/shared.js');
const Redis = require('./storage/redis.js'); // Redis wrapper module

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));


const app = express();
app.set('trust proxy', 1); // Доверяем заголовкам от Nginx ( Cloudflare)

// Request Logger (Optional: keep for debugging, or remove for prod)
app.use((req, res, next) => {
    // console.log(`[REQ] ${req.method} ${req.url} from ${req.ip}`);
    next();
});

// --- SECURITY MIDDLEWARE ---

app.disable('x-powered-by');

// --- DATABASE & AUTH SETUP ---
const connectDB = require('./storage/db');
const User = require('./models/User');
const GameResult = require('./models/GameResult'); // Архив игр
const BotManager = require('./services/BotManager'); // Bot Manager
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const { RedisStore } = require('connect-redis'); // connect-redis v7+ named export
const { createClient } = require('redis');
const path = require('path');

// Подключаем MongoDB
connectDB();

const redisSessionClient = createClient({ url: process.env.REDIS_URL });
redisSessionClient.connect().catch(console.error);

// Настройка сессий
const sessionMiddleware = session({
    store: new RedisStore({ client: redisSessionClient, prefix: "sess:" }),
    secret: process.env.SESSION_SECRET || 'super_secret_quoridor_key_change_me',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // ВАЖНО: false для HTTP (localhost), true для HTTPS
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 * 7 // 7 дней
    }
});

app.use(express.json()); // Для парсинга JSON тела запросов
app.use(sessionMiddleware);

// Serve Core Modules for Frontend
app.get('/js/ai-core.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'core', 'ai-core.js'));
});
// Also serve shared.js if not served otherwise (backup)
app.get('/shared.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'core', 'shared.js'));
});

// --- AUTH API ROUTES ---

// register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'All fields required' });
        if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3-20 chars' });
        if (password.length < 6) return res.status(400).json({ error: 'Password too short (min 6)' });

        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ error: 'Username taken' });

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        const newUser = new User({ username, passwordHash });
        await newUser.save();

        // Auto login
        req.session.userId = newUser._id;
        req.session.username = newUser.username;

        res.status(201).json({ message: 'User created', user: { username: newUser.username, id: newUser._id } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

        const user = await User.findOne({ username });
        if (!user) return res.status(400).json({ error: 'Invalid credentials' });

        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

        // Create session
        req.session.userId = user._id;
        req.session.username = user.username;

        res.json({ message: 'Logged in', user: { username: user.username, id: user._id } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// me
app.get('/api/auth/me', async (req, res) => {
    if (req.session && req.session.userId) {
        try {
            const user = await User.findById(req.session.userId).select('-passwordHash');
            res.json({ isAuthenticated: true, user });
        } catch (err) {
            res.json({ isAuthenticated: false });
        }
    } else {
        res.json({ isAuthenticated: false });
    }
});

// --- PROFILE API ---

// Public Profile Data
app.get('/api/profiles/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const user = await User.findOne({ username }).select('-passwordHash -__v -email');

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Public Game History
app.get('/api/profiles/:username/games', async (req, res) => {
    try {
        const { username } = req.params;
        // Limit query or pagination
        const limit = parseInt(req.query.limit) || 20;
        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * limit;

        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const history = await GameResult.find({
            $or: [{ 'playerWhite.id': user._id }, { 'playerBlack.id': user._id }]
        })
            .sort({ date: -1 })
            .skip(skip)
            .limit(limit);

        res.json(history);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Leaderboard API - returns top players by rating
app.get('/api/leaderboard', async (req, res) => {
    try {
        const topPlayers = await User.find({})
            .select('username rating avatarUrl')
            .sort({ rating: -1 })
            .limit(5);
        res.json(topPlayers);
    } catch (err) {
        console.error('[LEADERBOARD] Error:', err);
        res.status(500).json([]);
    }
});

// Single Game Details (for Replay)
app.get('/api/games/:id', async (req, res) => {
    try {
        const gameId = req.params.id;
        const game = await GameResult.findById(gameId);
        if (!game) {
            return res.status(404).json({ error: 'Game not found' });
        }
        res.json(game);
    } catch (err) {
        console.error('[GAME DETAILS] Error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// SPA Fallback for Profiles
app.get('/profiles/:username', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Deprecated or Redirected Enpoints
// Get "My" Profile Data (Legacy support, maybe redirect to /api/profiles/me in future)
app.get('/api/user/profile', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const user = await User.findById(req.session.userId).select('-passwordHash');
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Update Status
app.post('/api/user/update-status', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { status } = req.body;
        if (status === undefined) return res.status(400).json({ error: 'Status required' });

        await User.findByIdAndUpdate(req.session.userId, { status: status.substring(0, 100) });
        res.json({ message: 'Status updated' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Update Avatar (By URL for now)
app.post('/api/user/update-avatar', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { avatarUrl } = req.body;
        if (!avatarUrl) return res.status(400).json({ error: 'Avatar URL required' });

        await User.findByIdAndUpdate(req.session.userId, { avatarUrl });
        res.json({ message: 'Avatar updated' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Legacy History (Redirect logic or keep for backward compat)
app.get('/api/user/history', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        // Reuse general logic
        const history = await GameResult.find({
            $or: [{ 'playerWhite.id': req.session.userId }, { 'playerBlack.id': req.session.userId }]
        }).sort({ date: -1 }).limit(20);
        res.json(history);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});
app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ error: 'Could not log out' });
        res.clearCookie('connect.sid');
        res.json({ message: 'Logged out' });
    });
});
// -----------------------

// LAN-friendly Helmet Configuration
app.use(helmet({
    generateContentSecurityPolicy: false,
    hsts: false,
}));

app.use(helmet.contentSecurityPolicy({
    useDefaults: false,
    directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'", "https://cdn.socket.io"],
        "script-src-attr": ["'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "https://ui-avatars.com"],
        "media-src": ["'self'", "data:"],
        "connect-src": ["'self'", "ws:", "wss:", "http:", "https:", "https://cdn.socket.io"]
    }
})); // CLOSED Correctly

const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'file://'
];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1 || origin.startsWith('http://localhost') || process.env.NODE_ENV === 'production') {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST'],
    credentials: true
}));

// Serve static files
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/shared.js', express.static(path.join(__dirname, 'core/shared.js')));

// --- ADMIN API (Bots) ---
app.get('/api/admin/bots', (req, res) => {
    res.json(BotManager.getActiveBots());
});

app.post('/api/admin/bots/spawn', async (req, res) => {
    const { difficulty, isRanked } = req.body;
    const result = await BotManager.spawnBot(difficulty, isRanked);
    res.json(result);
});

app.delete('/api/admin/bots/:id', (req, res) => {
    const success = BotManager.killBot(req.params.id);
    res.json({ success });
});

app.post('/api/admin/bots/:id/toggle', (req, res) => {
    const result = BotManager.toggleBot(req.params.id);
    if (result.success) {
        // Find and notify bot
        const botSocket = Array.from(io.sockets.sockets.values()).find(s => s.userId === req.params.id);
        if (botSocket) {
            botSocket.emit('botStateUpdate', { isPaused: result.isPaused });
        }
    }
    res.json(result);
});

// --- SERVER & SOCKET.IO INITIALIZATION ---
// Create server instances FIRST, before using 'io'
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: (origin, callback) => {
            callback(null, true);
        },
        methods: ['GET', 'POST'],
        credentials: true
    },
    transports: ['polling', 'websocket'],
    allowUpgrades: true,
    pingTimeout: 60000
});

// Share session with Socket.IO
const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(sessionMiddleware));

// Socket Auth Middleware
io.use((socket, next) => {
    const session = socket.request.session;
    if (session && session.userId) {
        socket.userId = session.userId;
        socket.username = session.username;
        console.log(`[SOCKET] Authenticated user connected: ${socket.username}`);
    } else {
        // Check JWT in handshake (for Bots)
        const token = socket.handshake.auth.token;
        if (token && typeof token === 'string' && token.length > 30) {
            try {
                const decoded = jwt.verify(token, process.env.SESSION_SECRET || 'super_secret_quoridor_key_change_me');
                if (decoded.id && decoded.username) {
                    socket.userId = decoded.id;
                    socket.username = decoded.username;

                    // Check if I am an active bot and get my state
                    const bots = BotManager.getActiveBots();
                    const me = bots.find(b => b.id === socket.userId);
                    if (me && me.isPaused) {
                        // Delay slightly to ensure client is ready
                        setTimeout(() => socket.emit('botStateUpdate', { isPaused: true }), 500);
                    }

                    console.log(`[SOCKET] Bot authenticated: ${socket.username}`);
                }
            } catch (e) {
                // Ignore invalid JWT, treat as Guest
            }
        }
    }

    if (!socket.userId) {
        socket.username = `Guest-${socket.id.substr(0, 4)}`;
    }

    next();
});

/**
 * Генерирует короткий уникальный код комнаты.
 */
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

/**
 * Получает профиль игрока (имя и аватар) по токену.
 */
async function getPlayerProfile(token) {
    if (!token) return { name: 'Guest', avatar: 'https://ui-avatars.com/api/?name=Guest&background=random' };

    try {
        const userId = await Redis.getUserIdByToken(token);
        if (userId) {
            const user = await User.findById(userId);
            if (user) {
                return {
                    name: user.username,
                    avatar: user.avatarUrl || `https://ui-avatars.com/api/?name=${user.username}&background=random`,
                    rating: user.rating
                };
            }
        }
    } catch (err) {
        console.error('[PROFILE] Error fetching user profile:', err);
    }

    const guestSuffix = token.length > 5 ? token.substr(-4).toUpperCase() : Math.floor(Math.random() * 10000);
    return {
        name: `Guest-${guestSuffix}`,
        avatar: `https://ui-avatars.com/api/?name=Guest&background=random`
    };
}


// 




// ELO Calculation Helper
function calculateEloChange(ratingA, ratingB, scoreA) { // scoreA: 1 (win), 0 (loss), 0.5 (draw)
    const K = 40; // Launch Strategy K-factor
    const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
    return Math.round(K * (scoreA - expectedA));
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
    // --- SINGLE SESSION ENFORCEMENT ---
    if (socket.userId) {
        io.sockets.sockets.forEach((s) => {
            if (s.id !== socket.id && s.userId === socket.userId) {
                console.log(`[AUTH] Kicking old socket ${s.id} for user ${socket.username}`);
                s.emit('forceDisconnect', { reason: 'Logged in from another tab' });
                s.disconnect(true);
            }
        });
    }
    // 1. Получаем токен из handshake (если есть)
    let token = socket.handshake.auth.token;

    // 2. Если токена нет или он невалидный (слишком короткий/старый формат) — генерируем новый
    if (!token || typeof token !== 'string' || token.length < 10) {
        token = crypto.randomUUID(); // Генерируем надежный UUID
        socket.emit('assignToken', { token: token }); // Отправляем клиенту
        // console.log(`[AUTH] New player assigned token: ${token.substr(0, 8)}...`);
    } else {
        // console.log(`[AUTH] Player returned with token: ${token.substr(0, 8)}...`);
    }

    // Сохраняем токен в сокете для удобства
    socket.playerToken = token;

    // Привязываем токен к userId, если игрок авторизован
    if (socket.userId) {
        Redis.setTokenUserMapping(token, socket.userId).catch(console.error);
    }

    // Очистка памяти при отключении
    socket.on('disconnect', () => {
        rateLimits.delete(socket.id);
    });

    // console.log(`[SOCKET] User connected: ${socket.id}`);

    // Send current online stats to newly connected client
    Redis.getActiveGameIds().then(gameIds => {
        socket.emit('onlineStats', {
            online: io.sockets.sockets.size,
            playing: gameIds.length * 2 // Each game has 2 players
        });
    }).catch(() => {
        socket.emit('onlineStats', { online: io.sockets.sockets.size, playing: 0 });
    });

    // --- ПОИСК ИГРЫ ---
    socket.on('findGame', async (data) => {
        if (!checkRateLimit(socket.id, 'findGame', 2, 5000)) {
            socket.emit('findGameFailed', { reason: 'Too many requests. Please wait.' });
            return;
        }

        const token = data?.token || socket.playerToken;
        const tc = data?.timeControl || { base: 600, inc: 0 };
        const isRanked = Boolean(data?.isRanked);

        // Input Validation (Security & Sanity Check)
        const MIN_BASE_SEC = 60;
        const MAX_BASE_SEC = 1800;
        const MAX_INC_SEC = 60;

        if (
            typeof tc.base !== 'number' ||
            typeof tc.inc !== 'number' ||
            tc.base < MIN_BASE_SEC ||
            tc.base > MAX_BASE_SEC ||
            tc.inc < 0 ||
            tc.inc > MAX_INC_SEC
        ) {
            console.warn(`[SECURITY] Invalid time control from ${socket.id}:`, tc);
            socket.emit('findGameFailed', { reason: 'Invalid time limits (60-1800s)' });
            return;
        }

        if (isRanked && !socket.userId) {
            socket.emit('findGameFailed', { reason: 'Ranked play requires login' });
            return;
        }

        if (!isValidToken(token)) return;

        try {
            // Удаляем из всех очередей, если игрок там был (защита от дублей)
            await Redis.removeFromAllQueues(token);

            // Добавляем в очередь
            await Redis.addToQueue(tc.base, tc.inc, {
                socketId: socket.id,
                token: token,
                timeControl: tc
            }, isRanked);
            // console.log(`[QUEUE] Player ${socket.id} joined queue [${tc.base}+${tc.inc}] (Ranked: ${isRanked})`);

            // Пробуем достать двух игроков
            const pair = await Redis.popTwoFromQueue(tc.base, tc.inc, isRanked);

            if (pair) {
                const [pA, pB] = pair;

                // Randomize White/Black
                const swap = Math.random() > 0.5;
                const p1 = swap ? pB : pA;
                const p2 = swap ? pA : pB;

                const nextId = await Redis.incrementLobbyCounter();
                const lobbyId = `lobby-${nextId}`;

                const s1 = io.sockets.sockets.get(p1.socketId);
                const s2 = io.sockets.sockets.get(p2.socketId);

                if (s1 && s2) {
                    // Self-match prevention: reject if same authenticated user
                    if (s1.userId && s2.userId && s1.userId.toString() === s2.userId.toString()) {
                        console.log(`[MATCHMAKING] Rejected self-match: userId=${s1.userId}`);
                        // Return both to queue but notify second socket
                        await Redis.addToQueue(tc.base, tc.inc, p1, isRanked);
                        await Redis.addToQueue(tc.base, tc.inc, p2, isRanked);
                        s2.emit('findGameFailed', { reason: 'Already in a queue' });
                        return;
                    }

                    const gameState = Shared.createInitialState(p1.timeControl, isRanked);
                    gameState.playerSockets[0] = p1.socketId;
                    gameState.playerSockets[1] = p2.socketId;
                    gameState.playerTokens[0] = p1.token;
                    gameState.playerTokens[1] = p2.token;

                    // Fetch profiles
                    gameState.playerProfiles[0] = await getPlayerProfile(p1.token);
                    gameState.playerProfiles[1] = await getPlayerProfile(p2.token);

                    // Сохраняем в Redis
                    await Redis.saveGame(lobbyId, gameState);
                    await Redis.addActiveGame(lobbyId);

                    // Устанавливаем таймер хода
                    const timeoutAt = Date.now() + gameState.timers[0] * 1000;
                    await Redis.setTurnTimeout(lobbyId, timeoutAt);

                    // Сохраняем маппинг токенов для Rejoin
                    await Redis.setTokenMapping(p1.token, lobbyId);
                    await Redis.setTokenMapping(p2.token, lobbyId);

                    s1.join(lobbyId);
                    s2.join(lobbyId);
                    s1.emit('gameStart', {
                        lobbyId,
                        color: 'white',
                        opponent: gameState.playerProfiles[1], // Pass full profile
                        me: gameState.playerProfiles[0],
                        initialTime: gameState.timers[0]
                    });
                    s2.emit('gameStart', {
                        lobbyId,
                        color: 'black',
                        opponent: gameState.playerProfiles[0], // Pass full profile
                        me: gameState.playerProfiles[1],
                        initialTime: gameState.timers[1]
                    });
                    console.log(`[GAME START] Lobby ${lobbyId} created for ${tc.base}+${tc.inc}. Random Swap: ${swap}`);
                } else {
                    // Один из игроков отключился — возвращаем в очередь
                    if (s1) await Redis.addToQueue(tc.base, tc.inc, p1);
                    if (s2) await Redis.addToQueue(tc.base, tc.inc, p2);
                }
            }
        } catch (err) {
            console.error('[QUEUE ERROR]', err);
            socket.emit('findGameFailed', { reason: 'Server error' });
        }
    });

    socket.on('cancelSearch', async (data) => {
        try {
            const token = data?.token || socket.playerToken;
            if (token) {
                await Redis.removeFromAllQueues(token);
                // console.log(`[QUEUE] Player ${socket.id} left all queues`);
            }
        } catch (err) {
            console.error('[CANCEL SEARCH ERROR]', err);
        }
    });

    // --- ПРИВАТНЫЕ КОМНАТЫ ---
    socket.on('createRoom', async (data) => {
        const token = data?.token || socket.playerToken;
        if (!isValidToken(token)) return;

        try {
            // Удаляем игрока из ВСЕХ очередей поиска, если он там был
            await Redis.removeFromAllQueues(token);

            const roomCode = generateRoomCode();
            await Redis.createRoom(roomCode, {
                players: [{ socketId: socket.id, token: token }]
            });

            socket.join(roomCode);
            socket.emit('roomCreated', { roomCode });
            // console.log(`[ROOM] Created private room: ${roomCode} by ${socket.id}`);
        } catch (err) {
            console.error('[CREATE ROOM ERROR]', err);
            socket.emit('error', { message: 'Failed to create room' });
        }
    });

    socket.on('joinRoom', async (data) => {
        const { roomCode, token } = data;
        const playerToken = token || socket.playerToken;

        if (!isValidToken(playerToken) || !roomCode) {
            socket.emit('joinRoomFailed', { reason: 'Некорректные данные' });
            return;
        }

        try {
            const normalizedCode = roomCode.toUpperCase().trim();
            const room = await Redis.getRoom(normalizedCode);

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

            // Self-match prevention: check if same authenticated user
            const creatorSocket = io.sockets.sockets.get(room.players[0].socketId);
            if (socket.userId && creatorSocket?.userId && socket.userId.toString() === creatorSocket.userId.toString()) {
                socket.emit('joinRoomFailed', { reason: 'Нельзя играть с самим собой' });
                console.log(`[ROOM] Rejected self-join: userId=${socket.userId}, room=${normalizedCode}`);
                return;
            }

            room.players.push({ socketId: socket.id, token: playerToken });
            socket.join(normalizedCode);

            // console.log(`[ROOM] Player ${socket.id} joined room ${normalizedCode}`);

            if (room.players.length === 2) {
                // Randomize who goes first
                const isSwap = Math.random() > 0.5;
                const whitePlayer = isSwap ? room.players[1] : room.players[0];
                const blackPlayer = isSwap ? room.players[0] : room.players[1];

                const nextId = await Redis.incrementLobbyCounter();
                const lobbyId = `lobby-${nextId}`;

                const sWhite = io.sockets.sockets.get(whitePlayer.socketId);
                const sBlack = io.sockets.sockets.get(blackPlayer.socketId);

                if (sWhite && sBlack) {
                    sWhite.join(lobbyId);
                    sBlack.join(lobbyId);

                    const gameState = createInitialState({ base: 600, inc: 0 }); // Default for private rooms
                    gameState.playerSockets[0] = whitePlayer.socketId;
                    gameState.playerSockets[1] = blackPlayer.socketId;
                    gameState.playerTokens[0] = whitePlayer.token;
                    gameState.playerTokens[1] = blackPlayer.token;

                    // Fetch profiles
                    gameState.playerProfiles[0] = await getPlayerProfile(whitePlayer.token);
                    gameState.playerProfiles[1] = await getPlayerProfile(blackPlayer.token);

                    // Сохраняем в Redis
                    await Redis.saveGame(lobbyId, gameState);
                    await Redis.addActiveGame(lobbyId);

                    // Устанавливаем таймер хода (по умолчанию 600 сек для приватных комнат)
                    const timeoutAt = Date.now() + 600 * 1000;
                    await Redis.setTurnTimeout(lobbyId, timeoutAt);

                    // Сохраняем маппинг токенов для Rejoin
                    await Redis.setTokenMapping(whitePlayer.token, lobbyId);
                    await Redis.setTokenMapping(blackPlayer.token, lobbyId);

                    sWhite.emit('gameStart', {
                        lobbyId,
                        color: 'white',
                        opponent: gameState.playerProfiles[1],
                        me: gameState.playerProfiles[0]
                    });
                    sBlack.emit('gameStart', {
                        lobbyId,
                        color: 'black',
                        opponent: gameState.playerProfiles[0],
                        me: gameState.playerProfiles[1]
                    });

                    console.log(`[GAME START] Лобби ${lobbyId} создано из комнаты ${normalizedCode}. White: ${isSwap ? 'Joiner' : 'Creator'}`);
                    await Redis.deleteRoom(normalizedCode);
                } else {
                    await Redis.deleteRoom(normalizedCode);
                    if (sWhite) sWhite.emit('gameStartFailed', { reason: 'Противник отключился' });
                    else if (socket.id === whitePlayer.socketId) socket.emit('joinRoomFailed', { reason: 'Противник отключился' });

                    // Fallback catch-all
                    socket.emit('joinRoomFailed', { reason: 'Ошибка подключения' });
                }
            } else {
                // Обновляем комнату с новым игроком
                await Redis.updateRoom(normalizedCode, room);
            }
        } catch (err) {
            console.error('[JOIN ROOM ERROR]', err);
            socket.emit('joinRoomFailed', { reason: 'Ошибка сервера' });
        }
    });

    // --- REJOIN GAME ---
    socket.on('rejoinGame', async (data) => {
        const token = data?.token;

        // Валидация входных данных
        if (!isValidToken(token)) {
            // console.log(`[VALIDATION] rejoinGame: invalid token from ${socket.id}`);
            return;
        }

        const shortToken = '...' + token.substr(-4);
        // console.log(`[REJOIN] Attempting rejoin for token ${shortToken}`);

        try {
            // Ищем lobbyId по токену в Redis
            const lobbyId = await Redis.getLobbyByToken(token);

            if (!lobbyId) {
                // console.log(`[REJOIN] No active game found for token.`);
                return;
            }

            const game = await Redis.getGame(lobbyId);

            if (!game) {
                // console.log(`[REJOIN] Game ${lobbyId} not found in Redis.`);
                return;
            }

            const pIdx = game.playerTokens.indexOf(token);

            if (pIdx !== -1) {
                // Found the game!
                console.log(`[RECONNECT] Player ${pIdx} returned to ${lobbyId}`);

                // 1. Update socket
                game.playerSockets[pIdx] = socket.id;
                socket.join(lobbyId);

                // 2. Таймер дисконнекта теперь обрабатывается пульсом (setInterval).
                // Мы просто обновляем сокет и помечаем игрока как присутствующего.
                await Redis.saveGame(lobbyId, game);

                // 4. Send Resume event
                socket.emit('gameResumed', {
                    lobbyId,
                    color: pIdx === 0 ? 'white' : 'black',
                    myPlayerIndex: pIdx,
                    state: game,
                    timers: game.timers,
                    profiles: game.playerProfiles // Pass saved profiles
                });

                // 5. Notify opponent
                const opponentSocket = game.playerSockets[1 - pIdx];
                if (opponentSocket) {
                    io.to(opponentSocket).emit('opponentReconnected');
                }
            }
        } catch (err) {
            console.error('[REJOIN ERROR]', err);
        }
    });


    // --- ОБРАБОТКА ХОДА (SERVER AUTHORITATIVE) ---
    socket.on('playerMove', async (data) => {
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

        let attempts = 0;
        let locked = false;

        while (attempts < 10) {
            locked = await Redis.acquireLock(lobbyId);
            if (locked) break;
            attempts++;
            await sleep(50);
        }

        if (!locked) {
            socket.emit('moveRejected', { reason: 'Room busy' });
            return;
        }

        try {

            const game = await Redis.getGame(lobbyId);

            if (!game) {
                socket.emit('moveRejected', { reason: 'Game not found' });
                return;
            }

            const playerIdx = game.playerTokens.indexOf(socket.playerToken);
            if (playerIdx === -1) {
                socket.emit('moveRejected', { reason: 'Unauthorized' });
                return;
            }

            const now = Date.now();
            const elapsed = Math.floor((now - game.lastMoveTimestamp) / 1000);

            // 1. Предварительное обновление таймера (уменьшаем время за раздумья)
            game.timers[game.currentPlayer] -= elapsed;
            game.lastMoveTimestamp = now;

            if (game.timers[game.currentPlayer] < 0) {
                await finalizeGame(lobbyId, 1 - game.currentPlayer, 'Time out');
                return;
            }

            // 2. Выполнение хода через Reducer
            try {
                const action = { ...move, playerIdx };
                const nextState = Shared.gameReducer(game, action);

                // 3. Дополнительная серверная логика (инкремент Fisher)
                if (nextState.increment > 0) {
                    nextState.timers[playerIdx] += nextState.increment;
                }

                // 4. Проверка победы (после обновления состояния)
                const winnerIdx = checkVictory(nextState);
                if (winnerIdx !== -1) {
                    await finalizeGame(lobbyId, winnerIdx, 'Goal reached', nextState);
                    return;
                }

                // 5. Сохранение и установка новых таймеров
                await Redis.saveGame(lobbyId, nextState);

                const nextTimeoutAt = Date.now() + nextState.timers[nextState.currentPlayer] * 1000;
                await Redis.setTurnTimeout(lobbyId, nextTimeoutAt);

                io.to(lobbyId).emit('serverMove', {
                    playerIdx: playerIdx,
                    move: move,
                    nextPlayer: nextState.currentPlayer,
                    timers: nextState.timers
                });

            } catch (reducerError) {
                console.log(`[MOVE REJECTED] Lobby ${lobbyId}: ${reducerError.message}`);
                socket.emit('moveRejected', { reason: reducerError.message });
            }
        } catch (err) {
            console.error('[PLAYER MOVE ERROR]', err);
            socket.emit('moveRejected', { reason: 'Server error' });
        } finally {
            await Redis.releaseLock(lobbyId);
        }

    });



    socket.on('surrender', async (data) => {
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

        try {
            const game = await Redis.getGame(lobbyId);

            if (game) {
                const surrenderingIdx = game.playerTokens.indexOf(socket.playerToken);

                if (surrenderingIdx !== -1) {
                    const winnerIdx = 1 - surrenderingIdx;

                    await finalizeGame(lobbyId, winnerIdx, 'Surrender');
                }
            }
        } catch (err) {
            console.error('[SURRENDER ERROR]', err);
        }
    });

    socket.on('disconnect', async () => {
        // console.log(`[SOCKET] User disconnected: ${socket.id}`);

        try {
            // Remove from search queues
            if (socket.playerToken) {
                await Redis.removeFromAllQueues(socket.playerToken);
            }

            // Check active games for disconnects
            // Нужно найти игру по токену игрока
            if (socket.playerToken) {
                const lobbyId = await Redis.getLobbyByToken(socket.playerToken);

                if (lobbyId) {
                    const game = await Redis.getGame(lobbyId);

                    if (game) {
                        const disconnectedIdx = game.playerSockets.indexOf(socket.id);

                        if (disconnectedIdx !== -1) {
                            // Start 30s Grace Period in Redis
                            await Redis.setDisconnectTimer(lobbyId, 30000);
                            // Pause turn timer
                            await Redis.clearTurnTimeout(lobbyId);

                            console.log(`[GAME SUSPEND] Player ${disconnectedIdx} disconnected from ${lobbyId}. Starting grace period.`);

                            // Notify opponent
                            const opponentSocket = game.playerSockets[1 - disconnectedIdx];
                            if (opponentSocket) {
                                io.to(opponentSocket).emit('opponentDisconnected');
                            }

                        }
                    }
                }
            }
        } catch (err) {
            console.error('[DISCONNECT ERROR]', err);
        }
    });
});

// Новый асинхронный хендлер для завершения игры (Disconnect Timeout)
async function handleDisconnectTimeout(lobbyId) {
    console.log(`[GAME TIMEOUT] Player took too long to reconnect. Ending game ${lobbyId}.`);
    const game = await Redis.getGame(lobbyId);
    if (game) {
        const s0 = io.sockets.sockets.get(game.playerSockets[0]);
        const s1 = io.sockets.sockets.get(game.playerSockets[1]);

        let winnerIdx = -1;
        if (s0 && !s1) winnerIdx = 0;
        else if (s1 && !s0) winnerIdx = 1;

        if (winnerIdx !== -1) {
            await finalizeGame(lobbyId, winnerIdx, 'Opponent disconnected');
        } else {
            // Edge case: no winner detected? Should clean up anyway.
            // Original logic just cleaned up.
            await Redis.deleteGame(lobbyId);
            await Redis.removeActiveGame(lobbyId);
            await Redis.deleteTokenMapping(game.playerTokens[0]);
            await Redis.deleteTokenMapping(game.playerTokens[1]);
            await Redis.clearDisconnectTimer(lobbyId);
            await Redis.clearTurnTimeout(lobbyId);
        }
    }
}

// Новый асинхронный хендлер для завершения игры (Turn Timeout)
async function handleTurnTimeout(lobbyId) {
    console.log(`[TIMEOUT] Лобби ${lobbyId}: Время истекло.`);
    const game = await Redis.getGame(lobbyId);

    if (!game) {
        // Game data expired or missing - cleanup stale references
        await Redis.removeActiveGame(lobbyId);
        await Redis.clearTurnTimeout(lobbyId);
        await Redis.clearDisconnectTimer(lobbyId);
        console.log(`[TIMEOUT] Cleaned stale lobby ${lobbyId}`);
        return;
    }

    const winnerIdx = 1 - game.currentPlayer;
    await finalizeGame(lobbyId, winnerIdx, 'Time out');
}

// --- ARCHIVE HELPER ---
async function archiveGame(game, winnerIdx, reason, lobbyId) {
    try {
        const whiteToken = game.playerTokens[0];
        const blackToken = game.playerTokens[1];

        const uid0 = await Redis.getUserIdByToken(whiteToken);
        const uid1 = await Redis.getUserIdByToken(blackToken);

        const playerWhite = { username: "Guest White", isGuest: true };
        const playerBlack = { username: "Guest Black", isGuest: true };

        let u0 = null, u1 = null;

        if (uid0) {
            u0 = await User.findById(uid0);
            if (u0) {
                playerWhite.username = u0.username;
                playerWhite.id = u0._id;
                playerWhite.isGuest = false;
                // Add current rating for history snapshot
                playerWhite.previousRating = u0.rating;
            }
        }
        if (uid1) {
            u1 = await User.findById(uid1);
            if (u1) {
                playerBlack.username = u1.username;
                playerBlack.id = u1._id;
                playerBlack.isGuest = false;
                playerBlack.previousRating = u1.rating;
            }
        }

        // --- STATS UPDATE ---
        if (u0) {
            u0.stats = u0.stats || {};
            u0.stats.totalGames = (u0.stats.totalGames || 0) + 1;
            if (winnerIdx === 0) u0.stats.wins = (u0.stats.wins || 0) + 1;
            else if (winnerIdx === 1) u0.stats.losses = (u0.stats.losses || 0) + 1;
        }
        if (u1) {
            u1.stats = u1.stats || {};
            u1.stats.totalGames = (u1.stats.totalGames || 0) + 1;
            if (winnerIdx === 1) u1.stats.wins = (u1.stats.wins || 0) + 1;
            else if (winnerIdx === 0) u1.stats.losses = (u1.stats.losses || 0) + 1;
        }

        // --- ELO CALCULATION ---
        if (game.isRanked && u0 && u1) {
            let s0 = 0.5;
            if (winnerIdx === 0) s0 = 1;
            else if (winnerIdx === 1) s0 = 0;

            const change0 = calculateEloChange(u0.rating, u1.rating, s0);
            const change1 = calculateEloChange(u1.rating, u0.rating, 1 - s0);

            u0.rating += change0;
            u1.rating += change1;

            playerWhite.ratingChange = change0;
            playerBlack.ratingChange = change1;
            playerWhite.newRating = u0.rating;
            playerBlack.newRating = u1.rating;

            console.log(`[ELO] ${u0.username} (${change0 > 0 ? '+' : ''}${change0}) vs ${u1.username} (${change1 > 0 ? '+' : ''}${change1})`);
        } else {
            // Ensure ratingChange is 0 for unranked
            playerWhite.ratingChange = 0;
            playerBlack.ratingChange = 0;
        }

        // Save updated users (stats + rating)
        if (u0) await u0.save();
        if (u1) await u1.save();


        let gameType = game.timeControl ? (game.timeControl.base <= 120 ? 'bullet' : game.timeControl.base <= 420 ? 'blitz' : 'rapid') : 'friend';
        if (lobbyId.startsWith('bot-')) gameType = 'bot';

        // --- NEW LOGIC: Only save RANKED games ---
        if (!game.isRanked) {
            console.log(`[ARCHIVE] Skipped unranked game ${lobbyId}`);
            return {
                white: playerWhite,
                black: playerBlack
            };
        }

        const result = new GameResult({
            gameType,
            isRanked: true, // We checked it above
            playerWhite,
            playerBlack,
            winner: winnerIdx,
            reason,
            turns: Math.ceil((game.history?.length || 0) / 2),
            history: game.history || [], // Save history
            date: new Date()
        });

        await result.save();
        console.log(`[ARCHIVE] Game ${lobbyId} saved (Ranked: ${!!game.isRanked})`);

        return {
            white: playerWhite,
            black: playerBlack
        };

    } catch (err) {
        console.error('[ARCHIVE ERROR]', err);
        return null;
    }
}

// Unified Game End Handler
async function finalizeGame(lobbyId, winnerIdx, reason, stateOverride = null) {
    const game = stateOverride || await Redis.getGame(lobbyId);

    if (game) {
        // Clear timers immediately
        await Redis.clearDisconnectTimer(lobbyId);
        await Redis.clearTurnTimeout(lobbyId);

        // Archive and Calc Ratings
        const resultData = await archiveGame(game, winnerIdx, reason, lobbyId);

        const winnerName = winnerIdx === -1 ? 'Draw' : (winnerIdx === 0 ? 'White' : 'Black');
        console.log(`[GAME END] ${lobbyId}: Winner=${winnerName}, Reason=${reason}`);

        io.to(lobbyId).emit('gameOver', {
            winnerIdx: winnerIdx,
            reason: reason,
            ratingChanges: (resultData && game.isRanked) ? {
                playerWhite: resultData.white.ratingChange,
                playerBlack: resultData.black.ratingChange,
                newRatingWhite: resultData.white.newRating,
                newRatingBlack: resultData.black.newRating
            } : null
        });

        await Redis.deleteGame(lobbyId);
        await Redis.removeActiveGame(lobbyId);
        if (game.playerTokens?.[0]) await Redis.deleteTokenMapping(game.playerTokens[0]);
        if (game.playerTokens?.[1]) await Redis.deleteTokenMapping(game.playerTokens[1]);
    }
}


const PORT = process.env.PORT || 3000;

// Оптимизированный интервал проверки таймеров
setInterval(async () => {
    try {
        // 1. Проверяем просроченные дисконнекты
        const expiredDisconnects = await Redis.getExpiredDisconnectTimers();
        for (const lobbyId of expiredDisconnects) {
            await handleDisconnectTimeout(lobbyId);
        }

        // 2. Проверяем просроченные ходы
        const expiredTurns = await Redis.getExpiredTurnTimeouts();
        for (const lobbyId of expiredTurns) {
            await handleTurnTimeout(lobbyId);
        }

        // 3. Синхронизация таймеров и проверка коннекта
        const now = Date.now();
        const gameIds = await Redis.getActiveGameIds();
        for (const lobbyId of gameIds) {
            const game = await Redis.getGame(lobbyId);
            if (!game) continue;

            const s0 = io.sockets.sockets.get(game.playerSockets[0]);
            const s1 = io.sockets.sockets.get(game.playerSockets[1]);

            // Если кто-то отсутствует
            if (!s0 || !s1) {
                if (!(await Redis.hasDisconnectTimer(lobbyId))) {
                    console.log(`[PULSE] Lobby ${lobbyId}: Player(s) missing. Starting grace period.`);
                    await Redis.setDisconnectTimer(lobbyId, 30000);
                    await Redis.clearTurnTimeout(lobbyId);
                }
                continue;
            }

            // Если оба на месте, но висел таймер дисконнекта - возобновляем
            if (await Redis.hasDisconnectTimer(lobbyId)) {
                console.log(`[PULSE] Lobby ${lobbyId}: All players reconnected. Resuming game.`);
                await Redis.clearDisconnectTimer(lobbyId);

                // Возобновляем таймер хода
                const nextTimeoutAt = Date.now() + game.timers[game.currentPlayer] * 1000;
                await Redis.setTurnTimeout(lobbyId, nextTimeoutAt);

                // Сбрасываем метку последнего хода на "сейчас", чтобы время не "утекло" за время паузы
                game.lastMoveTimestamp = Date.now();
                await Redis.saveGame(lobbyId, game);

                io.to(lobbyId).emit('opponentReconnected');
            }

            // Обычный пульс времени
            const activeIdx = game.currentPlayer;
            const elapsed = Math.floor((now - game.lastMoveTimestamp) / 1000);
            const currentTimers = [...game.timers];
            currentTimers[activeIdx] -= elapsed;

            io.to(lobbyId).emit('timerUpdate', { timers: currentTimers });
        }
    } catch (err) {
        console.error('[TIMER TICK ERROR]', err);
    }
}, 1000);

// Broadcast online stats to all clients every 5 seconds
setInterval(async () => {
    try {
        const gameIds = await Redis.getActiveGameIds();
        io.emit('onlineStats', {
            online: io.sockets.sockets.size,
            playing: gameIds.length * 2 // Each game has 2 players
        });
    } catch (err) {
        // Silent fail - non-critical feature
    }
}, 5000);

// Инициализация Redis и запуск сервера
/**
 * Очистка "зомби-игр" при старте сервера.
 * Удаляет игры, у которых оба игрока offline (нет активных сокетов).
 */
async function cleanupStaleGames() {
    try {
        const activeGameIds = await Redis.getActiveGameIds();
        console.log(`[Startup] Checking ${activeGameIds.length} active games for stale entries...`);

        let cleaned = 0;
        for (const lobbyId of activeGameIds) {
            const game = await Redis.getGame(lobbyId);

            if (!game) {
                // Игра не существует, но есть в Set — удаляем из Set
                await Redis.removeActiveGame(lobbyId);
                cleaned++;
                continue;
            }

            const whiteSock = game.playerSockets?.[0];
            const blackSock = game.playerSockets?.[1];

            // Проверяем, есть ли эти сокеты среди активных подключений
            const whiteAlive = whiteSock && io.sockets.sockets.has(whiteSock);
            const blackAlive = blackSock && io.sockets.sockets.has(blackSock);

            if (!whiteAlive && !blackAlive) {
                // Оба игрока offline — удаляем игру полностью
                await Redis.deleteGame(lobbyId);
                await Redis.removeActiveGame(lobbyId);
                await Redis.clearDisconnectTimer(lobbyId);
                await Redis.clearTurnTimeout(lobbyId);

                // Очищаем маппинг токенов
                if (game.playerTokens?.[0]) await Redis.deleteTokenMapping(game.playerTokens[0]);
                if (game.playerTokens?.[1]) await Redis.deleteTokenMapping(game.playerTokens[1]);

                console.log(`[Startup] Cleaned stale game: ${lobbyId}`);
                cleaned++;
            }
        }

        console.log(`[Startup] Cleanup complete. Removed ${cleaned} stale games.`);
    } catch (err) {
        console.error('[Startup] Error during stale game cleanup:', err);
    }
}

async function startServer() {
    try {
        // Подключаемся к Redis
        await Redis.connect();
        console.log('[STARTUP] Redis connected successfully');

        // Очистка зомби-игр при старте (удаляет только игры с обоими offline игроками)
        await cleanupStaleGames();
        console.log('[STARTUP] Cleaned stale games. Preserving active games with online players.');

        // Restore Persistent Bots
        await BotManager.restoreBots();

        // Запускаем HTTP сервер
        const port = process.env.PORT || 3000;
        const env = process.env.NODE_ENV || 'development';
        server.listen(port, '0.0.0.0', () => {
            console.log(`[SERVER] Started on port ${port} (env=${env})`);
        });
    } catch (err) {
        console.error('[STARTUP ERROR] Failed to connect to Redis:', err);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('[SHUTDOWN] Received SIGTERM, shutting down gracefully...');
    await Redis.disconnect();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('[SHUTDOWN] Received SIGINT, shutting down gracefully...');
    await Redis.disconnect();
    process.exit(0);
});

// Запуск!
startServer();