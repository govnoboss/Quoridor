require('dotenv').config();

// Sentry.init должен выполниться ДО require('@sentry/node')... нет, до require('express'):
// в v10 auto-instrumentation цепляется при require модулей, и если express/createApp
// случаются раньше init, HTTP-трейсинг не включается ([Sentry] express is not instrumented).
const Sentry = require('@sentry/node');
Sentry.init({
    dsn: process.env.SENTRY_DSN || '',
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.5 : 0.0,
    enabled: !!process.env.SENTRY_DSN,
});

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const Shared = require('./core/shared.js');
const { RULES_FILE } = require('../quoridor-engine/rules/paths');
const { buildAiV1Bundle } = require('./core/ai-v1-bundle');
const Redis = require('./storage/redis.js');
const Clock = require('../frontend/js/game-clock');
const withLobbyLock = require('./core/lobby-lock')(Redis);
const { normalizeBotSettings, complaintTransition } = require('./admin/policy');
const { loadProductMetrics } = require('./analytics/product-metrics');
const BotManager = require('./bots/BotManager');
const log = require('./utils/logger');
const { sendPasswordResetEmail, sendSupportReplyEmail } = require('./utils/mailer');
const { verifyGoogleIdToken, verifyFreshGoogleReauth } = require('./auth/google');
const Report = require('./models/Report');
const geoip = require('geoip-lite');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const app = express();
// --- MAINTENANCE MODE (временная заглушка на 1 день) ---
// Включается env MAINTENANCE_MODE=1. Регистрируется ДО /health и всех маршрутов.
if (process.env.MAINTENANCE_MODE === '1') {
  app.use((req, res) => {
    if (req.path === '/health') return res.status(200).json({ status: 'maintenance' });
    return res.status(503).sendFile(path.join(__dirname, '../frontend/maintenance.html'));
  });
}
app.set('trust proxy', 1);

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// Enforce HTTPS when behind a reverse proxy
app.use((req, res, next) => {
    const host = req.headers.host || '';
    const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(host);
    if (req.protocol !== 'https' && process.env.NODE_ENV === 'production' && !isLocal) {
        return res.redirect(301, 'https://' + host + req.url);
    }
    next();
});

app.disable('x-powered-by');

// --- DATABASE & AUTH SETUP ---
const connectDB = require('./storage/db');
const User = require('./models/User');
const GameResult = require('./models/GameResult'); // Архив игр
const AnalyticsEvent = require('./models/AnalyticsEvent');
const BotSettings = require('./models/BotSettings');
const BotPresenceManager = require('./bots/BotPresenceManager');
const { syncBotPopulation } = require('./simulation/PopulationManager');

const bcrypt = require('bcryptjs');

// Фиктивный bcrypt-хеш: выравнивает время ответа логина, когда у пользователя
// нет пароля (аккаунт только с Google) или пользователь не найден.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('quoridor-placeholder-not-a-real-password', 10);
const jwt = require('jsonwebtoken');
const redisPkg = require('redis');
const session = require('express-session');
const { RedisStore } = require('connect-redis');
const path = require('path');
const Friendship = require('./models/Friendship');
const Notification = require('./models/Notification');

const sessionRedisClient = redisPkg.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: { connectTimeout: 5000 }
});

const sessionMiddleware = session({
    store: new RedisStore({ client: sessionRedisClient }),
    secret: process.env.SESSION_SECRET || 'super_secret_quoridor_key_change_me',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV !== 'test',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
});

app.use(express.json()); // Для парсинга JSON тела запросов
app.use(sessionMiddleware);

// --- SESSION VERSION (инвалидация ранее выданных сессий) ---
// sessionVersion хранится в User, а его значение — в сессии (req.session.sv).
// Инкремент версии закрывает все старые сессии (слияние аккаунтов, смена/сброс пароля).
// Значение кешируется на 60 секунд, чтобы не ходить в БД на каждый запрос.
const SV_CACHE_TTL = 60000;
const svCache = new Map(); // userId -> { value, expires }

function setCachedSessionVersion(userId, value) {
    svCache.set(String(userId), { value, expires: Date.now() + SV_CACHE_TTL });
}

function clearSessionVersionCache() {
    svCache.clear();
}

async function getSessionVersion(userId) {
    const key = String(userId);
    const cached = svCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    try {
        const user = await resolveUserById(userId, 'sessionVersion banned banReason banExpires');
        if (!user || (await isUserBanned(user)).banned) return -2;
        const value = (user && user.sessionVersion) || 0;
        svCache.set(key, { value, expires: Date.now() + SV_CACHE_TTL });
        return value;
    } catch (err) {
        console.error('[SESSION VERSION] Lookup failed:', err);
        return -1; // fail-open: не блокируем пользователя при сбое БД
    }
}

async function bumpSessionVersion(user) {
    user.sessionVersion = (user.sessionVersion || 0) + 1;
    await user.save();
    setCachedSessionVersion(user._id, user.sessionVersion);
    return user.sessionVersion;
}

// Отзывает сессии, чья версия не совпадает с текущей версией пользователя.
app.use(async (req, res, next) => {
    if (!req.session || !req.session.userId) return next();
    const current = await getSessionVersion(req.session.userId);
    if (current === -1) return next();
    if ((req.session.sv || 0) !== current) {
        req.session.userId = undefined;
        req.session.username = undefined;
        req.session.avatarUrl = undefined;
        req.session.sv = undefined;
        res.clearCookie('connect.sid');
    }
    next();
});

// --- HTTP RATE LIMITING ---
const rateLimit = require('express-rate-limit');

// Auth rate limiter: 20 requests per 15 minutes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 20, // Максимум 20 запросов
    message: { error: 'Too many requests. Try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    // В тестах jest гонит десятки логинов с одного IP — лимитер не тестируем.
    skip: () => process.env.NODE_ENV === 'test',
});

// Apply to auth routes
app.use('/api/auth/', authLimiter);

// Global HTTP rate limiter: 200 requests per minute
const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    message: { error: 'Too many requests. Try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
});
app.use(globalLimiter);

// Serve Core Modules for Frontend
// The browser runs the same v3 engine as the server bots and the arena. src/core/ai-v1-bundle.js
// assembles it on the fly from quoridor-engine sources, resolving the rules to the global `Shared` that
// /shared.js already published, so there is exactly one rules implementation and one engine in prod.
// The URL keeps its historical /js/ai-v1.js name; clients version it with ?v= in index.html.
app.get('/js/ai-v1.js', (req, res) => {
    res.type('application/javascript');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buildAiV1Bundle());
});
app.get('/js/ai-core.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'core', 'ai-core.js'));
});
// Also serve shared.js if not served otherwise (backup).
// NOTE: the canonical rules live in quoridor-engine/rules/quoridor-rules.js (same file for Node and
// the browser). src/core/shared.js is only a Node re-export of it, so the browser must be pointed at
// the canonical file, not at the shim.
app.get('/shared.js', (req, res) => {
    res.sendFile(RULES_FILE);
});

// --- COUNTRY DETECTION HELPERS ---

// Реальный IP клиента. Сайт за Cloudflare: реальный адрес (включая IPv6)
// приходит в `CF-Connecting-IP`, тогда как `X-Forwarded-For` содержит
// edge-IP Cloudflare (часто США) — по нему определять страну нельзя.
function getClientIp(req) {
    try {
        const cf = req.headers['cf-connecting-ip'];
        if (typeof cf === 'string' && cf.trim() && cf !== 'unknown') return cf.trim();
        return req.ip || '';
    } catch (err) {
        return req.ip || '';
    }
}

function detectCountry(ip) {
    try {
        if (typeof ip !== 'string' || !ip) return 'XX';
        return geoip.lookup(ip)?.country || 'XX';
    } catch (err) {
        return 'XX';
    }
}

// Восполняет страну пользователя, если она неизвестна ('XX') или не задана.
// Вызывается при каждом заходе (см. /api/auth/me и /api/user/profile),
// чтобы не требовать от игрока повторный логин.
async function ensureUserCountry(user, ip) {
    try {
        if (!user) return 'XX';
        if (user.country && user.country !== 'XX') return user.country;
        const detected = detectCountry(ip);
        if (detected !== 'XX') {
            user.country = detected;
            await user.save();
        }
        return detected;
    } catch (err) {
        console.error('[COUNTRY] Failed to save detected country:', err);
        return (user && user.country) || 'XX';
    }
}

// --- AUTH API ROUTES ---

// register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
        if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3-20 chars' });
        if (password.length < 6) return res.status(400).json({ error: 'Password too short (min 6)' });

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) return res.status(400).json({ error: 'Invalid email format' });

        const trimmedEmail = email.trim().toLowerCase();
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ error: 'Username taken' });

        const existingEmail = await User.findOne({ email: trimmedEmail });
        if (existingEmail) return res.status(400).json({ error: 'Email already in use' });

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        // Определяем страну по IP (один раз при регистрации — дальше VPN/IP не влияют)
        const country = detectCountry(getClientIp(req));

        const newUser = new User({ username, email: trimmedEmail, passwordHash, country });
        await newUser.save();
        await AnalyticsEvent.insertMany([{ name: 'register-complete', userId: newUser._id, props: { method: 'password' } }]).catch(err => console.error('[ANALYTICS] Registration:', err.message));

        // Auto login
        req.session.userId = newUser._id;
        req.session.username = newUser.username;
        req.session.avatarUrl = newUser.avatarUrl;
        req.session.sv = newUser.sessionVersion || 0;

        res.status(201).json({ message: 'User created', user: { username: newUser.username, email: newUser.email, id: newUser._id } });
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
        // Сравниваем с фиктивным хешем, если пароля нет (Google-аккаунт) или
        // пользователь не найден, чтобы время ответа не выдавало это.
        const hash = (user && user.passwordHash) ? user.passwordHash : DUMMY_PASSWORD_HASH;
        const isMatch = await bcrypt.compare(password, hash);
        if (!user || !user.passwordHash || !isMatch) return res.status(400).json({ error: 'Invalid credentials' });

        const ban = await isUserBanned(user);
        if (ban.banned) {
            const expires = ban.expires
                ? ` until ${ban.expires.toISOString()}`
                : '';
            return res.status(403).json({
                error: `Account banned${expires}`,
                code: 'ACCOUNT_BANNED',
                reason: ban.reason,
                expires: ban.expires
            });
        }

        // Ленивый бэдфилл страны для аккаунтов, созданных до появления geo-фичи:
        // если страна неизвестна ("XX"), определяем по текущему IP и сохраняем один раз.
        await ensureUserCountry(user, getClientIp(req));

        // Create session
        req.session.userId = user._id;
        req.session.username = user.username;
        req.session.avatarUrl = user.avatarUrl;
        req.session.sv = user.sessionVersion || 0;

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
            if (user) {
                const ban = await isUserBanned(user);
                if (ban.banned) {
                    req.session.destroy(() => {});
                    return res.json({
                        isAuthenticated: false,
                        banned: true,
                        banReason: ban.reason,
                        banExpires: ban.expires
                    });
                }
                // Принудительно восполняем страну при каждом заходе (без повторного логина)
                await ensureUserCountry(user, getClientIp(req));

                // Наружу отдаём только булев флаг, сам хеш — никогда.
                const pwDoc = await User.findById(req.session.userId).select('passwordHash');
                const userObj = typeof user.toObject === 'function' ? user.toObject() : { ...user };
                userObj.hasPassword = !!(pwDoc && pwDoc.passwordHash);
                return res.json({ isAuthenticated: true, user: userObj });
            }
            res.json({ isAuthenticated: true, user });
        } catch (err) {
            res.json({ isAuthenticated: false });
        }
    } else {
        res.json({ isAuthenticated: false });
    }
});

// Публичный конфиг для клиента: какие внешние входы включены.
app.get('/api/auth/config', (req, res) => {
    res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
});

// Собирает уникальное имя пользователя (3-20 симв.) из имени/почты Google.
async function generateUniqueUsername(email, name) {
    const base = String(name || email.split('@')[0] || 'player')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 20) || 'player';
    let candidate = base.length >= 3 ? base : base.padEnd(3, '0');
    let n = 0;
    while (await User.findOne({ username: candidate })) {
        n += 1;
        const suffix = String(n);
        candidate = base.slice(0, 20 - suffix.length) + suffix;
    }
    return candidate;
}

// sign in with Google
app.post('/api/auth/google', async (req, res) => {
    try {
        const { credential } = req.body || {};
        let profile;
        try {
            profile = await verifyGoogleIdToken(credential);
        } catch (err) {
            if (err.code === 'EMAIL_NOT_VERIFIED') {
                return res.status(400).json({ error: 'Google email is not verified' });
            }
            return res.status(401).json({ error: 'Invalid Google credential' });
        }

        let user = await User.findOne({ googleId: profile.googleId });
        let created = false;

        if (!user) {
            // Привязка к существующему аккаунту по email (Google подтвердил владение почтой).
            user = await User.findOne({ email: profile.email });
            if (user) {
                // Защита от захвата аккаунта: если аккаунт зарегистрирован по email, но почта
                // не подтверждена, пароль мог поставить злоумышленник, заранее занявший адрес.
                // Google подтвердил владение почтой — сбрасываем такой пароль.
                if (user.emailVerified !== true) {
                    user.passwordHash = undefined;
                    if (Array.isArray(user.authProviders)) {
                        user.authProviders = user.authProviders.filter(p => p !== 'password');
                    }
                }
                user.googleId = profile.googleId;
                if (!Array.isArray(user.authProviders)) user.authProviders = [];
                if (!user.authProviders.includes('google')) user.authProviders.push('google');
                user.emailVerified = true;
                // При слиянии всегда повышаем версию сессий: закрываем все ранее
                // выданные сессии (в т.ч. авто-логин при регистрации злоумышленником).
                await bumpSessionVersion(user);
            }
        }

        if (!user) {
            const username = await generateUniqueUsername(profile.email, profile.name);
            const country = detectCountry(getClientIp(req));
            user = new User({
                username,
                email: profile.email,
                googleId: profile.googleId,
                authProviders: ['google'],
                emailVerified: true,
                country,
                avatarUrl: profile.picture || undefined
            });
            await user.save();
            created = true;
            await AnalyticsEvent.insertMany([{ name: 'register-complete', userId: user._id, props: { method: 'google' } }]).catch(err => console.error('[ANALYTICS] Registration:', err.message));
        }

        const ban = await isUserBanned(user);
        if (ban.banned) {
            const expires = ban.expires ? ` until ${ban.expires.toISOString()}` : '';
            return res.status(403).json({
                error: `Account banned${expires}`,
                code: 'ACCOUNT_BANNED',
                reason: ban.reason,
                expires: ban.expires
            });
        }

        await ensureUserCountry(user, getClientIp(req));

        req.session.userId = user._id;
        req.session.username = user.username;
        req.session.avatarUrl = user.avatarUrl;
        req.session.sv = user.sessionVersion || 0;

        res.json({ message: 'Logged in', created, user: { username: user.username, id: user._id } });
    } catch (err) {
        console.error('[GOOGLE AUTH ERROR]', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- РЕ-АВТОРИЗАЦИЯ ЧЕРЕЗ GOOGLE (одноразовый nonce) ---
// Для удаления аккаунта и установки пароля у аккаунтов без пароля требуется свежий
// Google-токен. nonce выдаёт сервер, клиент передаёт его в GIS, а мы сверяем и гасим.
const REAUTH_NONCE_TTL_MS = 5 * 60 * 1000;

app.post('/api/auth/reauth-challenge', (req, res) => {
    if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const nonce = crypto.randomBytes(16).toString('hex');
    req.session.reauthNonce = nonce;
    req.session.reauthNonceExpires = Date.now() + REAUTH_NONCE_TTL_MS;
    res.json({ nonce });
});

// Возвращает ожидаемый nonce и сразу его гасит (одноразовое использование).
function consumeReauthNonce(req) {
    const nonce = req.session && req.session.reauthNonce;
    const expires = req.session && req.session.reauthNonceExpires;
    if (req.session) {
        req.session.reauthNonce = undefined;
        req.session.reauthNonceExpires = undefined;
    }
    if (!nonce || !expires || Date.now() > expires) return null;
    return nonce;
}

app.get('/api/game/active', async (req, res) => {
    try {
        const token = req.headers['x-player-token'];
        let lobbyCode = null;

        if (req.session?.userId) {
            lobbyCode = await Redis.getActiveLobbyForUser(req.session.userId);
        }

        if (!lobbyCode && typeof token === 'string' && token.trim()) {
            lobbyCode = await Redis.getLobbyByToken(token.trim());
        }

        if (!lobbyCode) {
            return res.json({ hasActiveGame: false });
        }

        const game = await Redis.getGame(lobbyCode);
        if (!game) {
            return res.json({ hasActiveGame: false });
        }

        res.json({ hasActiveGame: true, lobbyCode });
    } catch (err) {
        console.error('[ACTIVE GAME API ERROR]', err);
        res.status(500).json({ error: 'Server error' });
    }
});

async function resolveUserById(userId, fields = null) {
    const query = User.findById(userId);
    if (query && typeof query.select === 'function') {
        return await query.select(fields || '');
    }
    return await query;
}

// Проверяет, активен ли бан у пользователя. Если временный бан истёк — авторазбан.
async function isUserBanned(user) {
    if (!user) return { banned: false };
    if (!user.banned) return { banned: false };
    if (user.banExpires && user.banExpires <= new Date()) {
        user.banned = false;
        user.banReason = '';
        user.banExpires = null;
        user.bannedAt = null;
        user.bannedBy = null;
        await user.save();
        return { banned: false };
    }
    const expires = user.banExpires ? new Date(user.banExpires) : null;
    return { banned: true, reason: user.banReason || 'Account banned', expires };
}

async function isTokenBanned(token) {
    const ownerId = await Redis.getUserIdByToken(token);
    if (!ownerId) return false;
    const owner = await resolveUserById(ownerId, 'banned banReason banExpires');
    return !owner || (await isUserBanned(owner)).banned;
}

async function requireAdmin(req, res, next) {
    if (!req.session?.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const user = await resolveUserById(req.session.userId, 'username isAdmin banned banReason banExpires');
        if (!user?.isAdmin) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        if ((await isUserBanned(user)).banned) return res.status(403).json({ error: 'Account banned' });
        req.adminUser = user;
        next();
    } catch (err) {
        console.error('[ADMIN] Auth check failed:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

function botSettingsFromEnv() {
    const integer = (name, fallback) => {
        const raw = process.env[name];
        const value = raw && raw.trim() ? Number(raw) : NaN;
        return Number.isSafeInteger(value) && value >= 0 && value <= 2147483647 ? value : fallback;
    };
    return normalizeBotSettings({}, {
        key: 'global',
        enabled: ['1', 'true', 'yes', 'on'].includes(String(process.env.BOTS_ENABLED || 'false').toLowerCase()),
        rankedEnabled: ['1', 'true', 'yes', 'on'].includes(String(process.env.BOT_RANKED_ENABLED || 'false').toLowerCase()),
        fallbackMinWaitMs: integer('BOT_FALLBACK_MIN_WAIT_MS', 15000),
        fallbackMaxWaitMs: integer('BOT_FALLBACK_MAX_WAIT_MS', 25000),
        maxActiveGames: integer('BOT_MAX_ACTIVE_GAMES', 15),
        moveMinDelayMs: integer('BOT_MOVE_MIN_DELAY_MS', 800),
        moveMaxDelayMs: integer('BOT_MOVE_MAX_DELAY_MS', 2500),
        maxRecentMatches: integer('BOT_MAX_RECENT_MATCHES', 3),
        recentWindowMs: integer('BOT_RECENT_WINDOW_MS', 3600000),
    });
}

function sanitizeBotSettings(input, defaults = botSettingsFromEnv()) {
    return normalizeBotSettings(input, defaults);
}

function settingsForBotManager(settings) {
    return {
        enabled: settings.enabled,
        rankedEnabled: settings.rankedEnabled,
        fallbackMinWaitMs: settings.fallbackMinWaitMs,
        fallbackMaxWaitMs: settings.fallbackMaxWaitMs,
        maxActiveGames: settings.maxActiveGames,
        moveMinDelayMs: settings.moveMinDelayMs,
        moveMaxDelayMs: settings.moveMaxDelayMs,
        maxRecentMatches: settings.maxRecentMatches,
        recentWindowMs: settings.recentWindowMs,
    };
}

async function getOrCreateBotSettings({ persist = true } = {}) {
    let settings = await BotSettings.findOne({ key: 'global' });
    const envDefaults = botSettingsFromEnv();
    if (!settings) {
        settings = new BotSettings(envDefaults);
        if (persist) await settings.save();
    }
    return settings;
}

async function applyPersistedBotSettings() {
    const settings = await getOrCreateBotSettings();
    botManager.setRuntimeConfig(settingsForBotManager(settings));
    return settings;
}

async function seedBotAccounts(password = null) {
    const result = await syncBotPopulation(User, password);
    return result;
}

app.get('/admin/bots', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/admin-bots.html'));
});

app.get('/api/admin/bots', requireAdmin, async (req, res) => {
    try {
        const settings = await getOrCreateBotSettings({ persist: false });

        const bots = await User.find({ isBot: true }).sort({ rating: -1 });
        res.json({
            settings,
            runtime: botManager.getRuntimeStats(),
            presence: botPresenceManager ? botPresenceManager.getStats() : { totalBots: 0, online: 0 },
            bots: bots.map(bot => ({
                id: bot._id,
                username: bot.username,
                rating: bot.rating,
                avatarUrl: bot.avatarUrl,
                country: bot.country,
                stats: bot.stats || {},
                seedId: bot.seedId,
            })),
        });
    } catch (err) {
        console.error('[ADMIN] Failed to load bot panel data:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/admin/bots/settings', requireAdmin, async (req, res) => {
    try {
        const current = await getOrCreateBotSettings({ persist: false });
        const nextSettings = sanitizeBotSettings(req.body, current);
        nextSettings.updatedBy = req.adminUser._id;

        const settings = await BotSettings.findOneAndUpdate(
            { key: 'global' },
            { $set: nextSettings },
            { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
        );

        botManager.setRuntimeConfig(settingsForBotManager(settings));
        res.json({ settings, runtime: botManager.getRuntimeStats() });
    } catch (err) {
        console.error('[ADMIN] Failed to update bot settings:', err);
        res.status(err.status === 400 ? 400 : 500).json({ error: err.status === 400 ? err.message : 'Server error' });
    }
});

app.post('/api/admin/bots/seed', requireAdmin, async (req, res) => {
    try {
        const result = await seedBotAccounts(req.body?.password || null);
        const bots = await User.find({ isBot: true });
        res.json({
            ...result,
            bots: bots.map(bot => ({
                id: bot._id,
                username: bot.username,
                rating: bot.rating,
                avatarUrl: bot.avatarUrl,
                country: bot.country,
            })),
        });
    } catch (err) {
        console.error('[ADMIN] Failed to seed bot accounts:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/bots/rename', requireAdmin, async (req, res) => {
    try {
        const { id, username } = req.body;
        if (!id || !username) return res.status(400).json({ error: 'Missing id or username' });
        if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3-20 chars' });

        const bot = await User.findOne({ _id: id, isBot: true });
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        const existing = await User.findOne({ username });
        if (existing && existing._id.toString() !== id) return res.status(409).json({ error: 'Username taken' });

        bot.username = username;
        await bot.save();

        res.json({ success: true, username });
    } catch (err) {
        console.error('[ADMIN] Failed to rename bot:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/bots/recalc', requireAdmin, async (req, res) => {
    try {
        const updated = await recalculateBotRatings();
        const bots = await User.find({ isBot: true }).sort({ rating: -1 });
        res.json({
            updated,
            bots: bots.map(bot => ({
                id: bot._id,
                username: bot.username,
                rating: bot.rating,
                avatarUrl: bot.avatarUrl,
                country: bot.country,
                stats: bot.stats || {},
                seedId: bot.seedId,
            })),
        });
    } catch (err) {
        console.error('[ADMIN] Failed to recalculate bot ratings:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- PROFILE API ---

// Public Profile Data
app.get('/api/profiles/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const user = await User.findOne({ username }).select('-passwordHash -__v -email -isBot -isAdmin');

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        let friendshipStatus = null;
        if (req.session?.userId) {
            if (String(req.session.userId) === String(user._id)) {
                friendshipStatus = 'self';
            } else {
                const friendship = await Friendship.findOne({
                    $or: [
                        { requester: req.session.userId, recipient: user._id },
                        { requester: user._id, recipient: req.session.userId }
                    ]
                });
                if (friendship) {
                    if (friendship.status === 'accepted') friendshipStatus = 'friends';
                    else if (String(friendship.requester) === String(req.session.userId)) friendshipStatus = 'requested';
                    else friendshipStatus = 'received';
                } else {
                    friendshipStatus = 'none';
                }
            }
        }

        const result = user.toObject();
        result.friendshipStatus = friendshipStatus;

        // Rank (profile card «Rank #N»): 1 + number of better-rated non-admin players.
        if (!user.isAdmin && typeof user.rating === 'number') {
            try {
                const better = await User.countDocuments({ isAdmin: { $ne: true }, rating: { $gt: user.rating } });
                result.rank = better + 1;
            } catch (_e) { /* rank is optional */ }
        }

        res.json(result);
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

        const filter = {
            $or: [
                { 'playerWhite.id': user._id, 'playerWhite.isGuest': false },
                { 'playerBlack.id': user._id, 'playerBlack.isGuest': false }
            ]
        };

        const [history, total] = await Promise.all([
            GameResult.find(filter)
                .sort({ date: -1 })
                .skip(skip)
                .limit(limit),
            GameResult.countDocuments(filter)
        ]);

        res.json({ games: history, total, page, limit });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Rating History for Chart
app.get('/api/profiles/:username/rating-history', async (req, res) => {
    try {
        const { username } = req.params;
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const games = await GameResult.find({
            isRanked: true,
            $or: [{ 'playerWhite.id': user._id }, { 'playerBlack.id': user._id }]
        }).sort({ date: 1 }).select('date playerWhite playerBlack');

        const history = [];
        let rating = 1200;

        for (const game of games) {
            const isWhite = game.playerWhite && game.playerWhite.id && game.playerWhite.id.toString() === user._id.toString();
            const change = isWhite
                ? (game.playerWhite?.ratingChange || 0)
                : (game.playerBlack?.ratingChange || 0);
            rating += change;
            history.push({ date: game.date, ratingAfter: rating });
        }

        res.json(history);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==== Leaderboard API (ТЗ этапа 3, tz-03-leaderboard.md §4) ====

// §4.1: winrate-сортировка только для игроков с достаточным числом партий.
const MIN_GAMES_WINRATE = 10;

const LB_HASH = require('crypto');

// Кэш delta7 (§4.2): Redis ключ lb:delta7, TTL 5 мин; in-memory — запасной
// вариант. В тестах redis замокан: любой сбой хранилища тихо игнорируется.
const lbCache = { delta7: { data: null, ts: 0 } };

// Для отчётной чистоты тестов: сброс кэша между сценариями.
function clearLeaderboardCache() {
    lbCache.delta7 = { data: null, ts: 0 };
}

// delta7 — сумма ratingChange за ранговые партии за последние 7 суток (UTC),
// по обоим цветам, одним агрегационным запросом на всех игроков (§4.2).
async function getDelta7Map() {
    const cached = lbCache.delta7;
    if (cached.data && Date.now() - cached.ts < 5 * 60 * 1000) {
        return cached.data;
    }

    let map = null;
    // NODE_ENV=test: redis из тестового окружения слишком реален (запущенный
    // в Docker инстанс переживает запуски тестов) — кэш только in-memory,
    // иначе между тестами протекают результаты прошлого прогона.
    if (process.env.NODE_ENV !== 'test') {
        try {
            const raw = await sessionRedisClient.get('lb:delta7');
            if (raw) map = JSON.parse(raw);
        } catch (e) { /* нет redis — считаем по БД */ }
    }

    if (!map) {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        // Один запрос: whites + blacks одним конвейером, гости/null отфильтрованы.
        const rows = await GameResult.aggregate([
            { $match: { isRanked: true, date: { $gte: since } } },
            { $group: { _id: null, whites: { $push: '$playerWhite' }, blacks: { $push: '$playerBlack' } } },
            { $project: { players: { $concatArrays: ['$whites', '$blacks'] } } },
            { $unwind: '$players' },
            { $match: { 'players.id': { $ne: null }, 'players.isGuest': { $ne: true } } },
            { $group: { _id: '$players.id', delta: { $sum: '$players.ratingChange' } } },
        ]);
        map = {};
        rows.forEach((r) => { map[String(r._id)] = r.delta; });
        try {
            await sessionRedisClient.setEx('lb:delta7', 300, JSON.stringify(map));
        } catch (e) { /* in-memory кэша достаточно */ }
    }

    lbCache.delta7 = { data: map, ts: Date.now() };
    return map;
}

// Приватность §4.4: в публичных ответах никогда не отдавать email.
// username может содержать адрес (старые регистрации) — displayName: часть
// до '@' (≤12 симв.); коллизии баз разруливаем '…' + 2 символа хеша id.
function lbBaseName(username) {
    const raw = String(username || '');
    if (!raw.includes('@')) return raw;
    const base = raw.split('@')[0].slice(0, 12);
    return base || 'player';
}

function applyDisplayNames(list) {
    const baseCounts = new Map();
    const bases = list.map((u) => lbBaseName(u.username));
    bases.forEach((b) => baseCounts.set(b, (baseCounts.get(b) || 0) + 1));
    list.forEach((u, i) => {
        u.displayName = bases[i];
        if (baseCounts.get(bases[i]) > 1) {
            const hash = LB_HASH.createHash('md5').update(String(u._id)).digest('hex').slice(-2);
            u.displayName = bases[i].slice(0, 10) + '…' + hash;
        }
    });
}

// Заглушки ui-avatars.com не отдаём: фото показываем только для реально
// загруженных файлов (в пути содержится /avatars/), иначе клиент рисует букву.
function lbPublicAvatar(avatarUrl) {
    return (avatarUrl && String(avatarUrl).includes('/avatars/')) ? avatarUrl : null;
}

// Общий набор кандидатов для /api/leaderboard и /api/leaderboard/me (§4.1).
// Сортировки winrate/week — по вычисляемым признакам, поэтому отбор и порядок
// делает JS поверх одной выборки (фильтр — тот же, что и раньше: без админов).
async function loadLbCandidates(deltaMap) {
    const users = await User.find({ isAdmin: { $ne: true } })
        .select('username rating avatarUrl country stats')
        .sort({ rating: -1 });

    return Array.from(users || []).map((u) => {
        const stats = u.stats || {};
        const totalGames = stats.totalGames || 0;
        const wins = stats.wins || 0;
        let losses = stats.losses;
        if (typeof losses !== 'number') losses = Math.max(0, totalGames - wins);
        return {
            _id: String(u._id),
            username: u.username,
            rating: u.rating || 1200,
            avatarUrl: lbPublicAvatar(u.avatarUrl),
            country: u.country || 'XX',
            totalGames,
            wins,
            losses,
            delta7: Object.prototype.hasOwnProperty.call(deltaMap, String(u._id)) ? deltaMap[String(u._id)] : null,
        };
    });
}

// Сортировки по §2.2/§4.1 (rank — позиция в текущей сортировке).
function sortLbCandidates(list, sort) {
    if (sort === 'winrate') {
        return list
            .filter((u) => u.totalGames >= MIN_GAMES_WINRATE)
            .sort((a, b) =>
                (b.wins / b.totalGames) - (a.wins / a.totalGames) ||
                b.wins - a.wins ||
                b.rating - a.rating);
    }
    if (sort === 'week') {
        // «Ненулевой delta7»: есть ранговые партии за 7 дней и итог ≠ 0 (§4.1).
        return list
            .filter((u) => u.delta7 !== null && u.delta7 !== 0)
            .sort((a, b) => b.delta7 - a.delta7 || b.rating - a.rating);
    }
    return list.slice().sort((a, b) => b.rating - a.rating);
}

// «Сколько игроков выше меня» — с учётом равенства значений (общий ранг).
function lbRankOf(me, sorted, sort) {
    let better = 0;
    for (const u of sorted) {
        if (String(u._id) === String(me._id)) continue;
        let cmpFirst = 0;
        if (sort === 'rating') {
            cmpFirst = u.rating - me.rating;
        } else if (sort === 'winrate') {
            const myQualifies = me.totalGames >= MIN_GAMES_WINRATE;
            const myRatio = myQualifies ? me.wins / me.totalGames : null;
            const theirRatio = u.wins / u.totalGames; // все в списке уже ≥ MIN_GAMES_WINRATE
            // Неквалифицированного игрока считаем ниже всех квалифицированных.
            if (!myQualifies) { better += 1; continue; }
            cmpFirst = theirRatio - myRatio || u.wins - me.wins || u.rating - me.rating;
        } else if (sort === 'week') {
            cmpFirst = (u.delta7 || 0) - (me.delta7 || 0);
        }
        if (cmpFirst > 0) better += 1;
    }
    return better + 1;
}

function lbQualifies(me, sort, delta7) {
    if (sort === 'winrate') return me.totalGames >= MIN_GAMES_WINRATE;
    if (sort === 'week') return delta7 !== null && delta7 !== 0;
    return true;
}

app.get('/api/leaderboard', async (req, res) => {
    try {
        const sort = ['rating', 'winrate', 'week'].includes(req.query.sort) ? req.query.sort : 'rating';
        // §4.1: limit по умолчанию 100, максимум 100.
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 100));

        const deltaMap = await getDelta7Map();
        const sorted = sortLbCandidates(await loadLbCandidates(deltaMap), sort);
        applyDisplayNames(sorted);

        res.json(sorted.slice(0, limit).map((u, i) => ({
            rank: i + 1,
            username: u.username,
            displayName: u.displayName,
            rating: u.rating,
            avatarUrl: u.avatarUrl,
            country: u.country,
            stats: { totalGames: u.totalGames, wins: u.wins, losses: u.losses },
            delta7: u.delta7,
        })));
    } catch (err) {
        console.error('[LEADERBOARD] Error:', err);
        res.status(500).json([]);
    }
});

// Собственное место игрока (строка «You», этап 2 §5.1 + этап 3 §4.3).
// rank — в сортировке ?sort=; если игрок не проходит порог вкладки, rank:null.
app.get('/api/leaderboard/me', async (req, res) => {
    try {
        if (!req.session || !req.session.userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const user = await User.findById(req.session.userId).select('username rating isAdmin stats');
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        if (user.isAdmin) {
            return res.status(404).json({ error: 'Not ranked' });
        }

        const sort = ['rating', 'winrate', 'week'].includes(req.query.sort) ? req.query.sort : 'rating';
        const stats = user.stats || {};
        const me = {
            _id: String(user._id),
            username: user.username,
            rating: user.rating || 1200,
            totalGames: stats.totalGames || 0,
            wins: stats.wins || 0,
            delta7: null,
        };

        const deltaMap = await getDelta7Map();
        me.delta7 = Object.prototype.hasOwnProperty.call(deltaMap, me._id) ? deltaMap[me._id] : null;
        let losses = stats.losses;
        if (typeof losses !== 'number') losses = Math.max(0, me.totalGames - me.wins);

        const sorted = sortLbCandidates(await loadLbCandidates(deltaMap), sort);
        const qualifies = lbQualifies(me, sort, me.delta7);
        const rank = qualifies ? lbRankOf(me, sorted, sort) : null;

        const displayName = (() => {
            const list = [{ _id: me._id, username: me.username }];
            applyDisplayNames(list);
            return list[0].displayName;
        })();

        res.json({
            rank,
            total: sorted.length,
            rating: me.rating,
            username: me.username,
            displayName,
            avatarUrl: lbPublicAvatar(user.avatarUrl),
            stats: { totalGames: me.totalGames, wins: me.wins, losses },
            delta7: me.delta7,
        });
    } catch (err) {
        console.error('[LEADERBOARD ME] Error:', err);
        res.status(500).json({ error: 'Server error' });
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

// ==================== SEO: server-rendered meta for SPA routes ====================
// Краулеры и мессенджеры (Telegram/WhatsApp/Discord) не выполняют JS, поэтому для
// индексируемых SPA-маршрутов (/profiles/:username) и шареных ссылок (/lobby/:code)
// мета-теги главной подменяются на сервере до отправки index.html.
const FRONTEND_DIR = path.join(__dirname, '../frontend');
const SEO_SITE_URL = 'https://playquor.org';

let indexHtmlCache = null;
function getIndexHtml() {
    if (indexHtmlCache === null) {
        indexHtmlCache = fs.readFileSync(path.join(FRONTEND_DIR, 'index.html'), 'utf8');
    }
    return indexHtmlCache;
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (ch) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
}

// Подменяет title/description/og:*/canonical в закешированном index.html.
// Регулярки привязаны к точным тегам <head> главной (frontend/index.html).
function renderIndexWithMeta({ title, description, url, robots } = {}) {
    let html = getIndexHtml();
    if (title) {
        html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`);
        html = html.replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${escapeHtml(title)}" />`);
    }
    if (description) {
        html = html.replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeHtml(description)}" />`);
        html = html.replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${escapeHtml(description)}" />`);
    }
    if (url) {
        html = html.replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${escapeHtml(url)}" />`);
        html = html.replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${escapeHtml(url)}" />`);
    }
    if (robots) {
        html = html.replace(/<\/title>/, `</title>\n  <meta name="robots" content="${escapeHtml(robots)}" />`);
    }
    return html;
}

// Честный 404: раньше фолбэк отдавал index.html со статусом 200 (soft-404).
function sendNotFound(res) {
    res.status(404).type('html').sendFile(path.join(FRONTEND_DIR, '404.html'));
}

// Динамический sitemap.xml: статические страницы (lastmod = mtime файла) + топ-профили.
// Статический frontend/sitemap.xml удалён — отвечает этот роут.
const SITEMAP_TTL_MS = 60 * 60 * 1000;
let sitemapCache = { at: 0, xml: null };

function clearSitemapCache() {
    sitemapCache = { at: 0, xml: null };
}

const SEO_STATIC_PAGES = [
    ['/', 'index.html'],
    ['/rules', 'rules.html'],
    ['/faq', 'faq.html'],
    ['/leaderboard', 'leaderboard.html'],
    ['/terms', 'terms.html'],
    ['/privacy', 'privacy.html'],
];

function w3cDate(d) {
    return d.toISOString().slice(0, 10);
}

app.get('/sitemap.xml', async (req, res) => {
    try {
        const now = Date.now();
        if (sitemapCache.xml && now - sitemapCache.at < SITEMAP_TTL_MS) {
            return res.type('application/xml').send(sitemapCache.xml);
        }
        const urls = [];
        for (const [route, file] of SEO_STATIC_PAGES) {
            try {
                const mtime = fs.statSync(path.join(FRONTEND_DIR, file)).mtime;
                urls.push(`  <url><loc>${SEO_SITE_URL}${route}</loc><lastmod>${w3cDate(mtime)}</lastmod></url>`);
            } catch { /* файл пропал — пропускаем страницу */ }
        }
        try {
            // /login и /register в sitemap не входят: они noindex,follow.
            const top = await User.find({ isAdmin: { $ne: true }, isBot: { $ne: true } })
                .select('username')
                .sort({ rating: -1 })
                .limit(50);
            for (const u of top) {
                urls.push(`  <url><loc>${SEO_SITE_URL}/profiles/${encodeURIComponent(u.username)}</loc></url>`);
            }
        } catch (err) {
            console.error('[SITEMAP] profiles query failed:', err.message);
        }
        const xml = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
            ...urls,
            '</urlset>',
            '',
        ].join('\n');
        sitemapCache = { at: now, xml };
        res.type('application/xml').send(xml);
    } catch (err) {
        console.error('[SITEMAP] Error:', err);
        res.status(500).send('Sitemap error');
    }
});

// SPA-роут профилей — с серверным рендером мета-тегов: публичные профили индексируются
// с собственными title/description/OG/canonical вместо метаданных главной.
app.get('/profiles/:username', async (req, res) => {
    try {
        const username = req.params.username;
        const user = await User.findOne({ username }).select('username rating stats');
        if (!user) {
            return sendNotFound(res);
        }
        const rating = typeof user.rating === 'number' ? user.rating : null;
        const totalGames = user.stats && Number.isFinite(user.stats.totalGames) ? user.stats.totalGames : 0;
        let description = `Quoridor profile of ${username} on PlayQuor.`;
        const bits = [];
        if (rating !== null) bits.push(`rating ${rating}`);
        if (totalGames > 0) bits.push(`${totalGames} games played`);
        if (bits.length) description = `Quoridor profile of ${username} — ${bits.join(', ')} on PlayQuor.`;
        description += ' See stats, achievements and recent games.';
        const url = `${SEO_SITE_URL}/profiles/${encodeURIComponent(username)}`;
        res.status(200).type('html').send(renderIndexWithMeta({
            title: `${username} — Quoridor Player Profile | PlayQuor`,
            description,
            url,
        }));
    } catch (err) {
        console.error('[PROFILE PAGE] Error:', err);
        res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
    }
});

app.get('/lobby/:lobbyCode', (req, res) => {
    const { lobbyCode } = req.params;
    if (!Shared.isValidLobbyId((lobbyCode || '').toUpperCase())) {
        return res.redirect('/');
    }
    // Лобби-ссылки одноразовые: noindex + приглашающий сниппет для мессенджеров.
    const code = (lobbyCode || '').toUpperCase();
    res.status(200).type('html').send(renderIndexWithMeta({
        title: 'Join my Quoridor game | PlayQuor',
        description: `A friend invited you to a Quoridor match. Open lobby ${code} and play together on PlayQuor.`,
        url: `${SEO_SITE_URL}/lobby/${code}`,
        robots: 'noindex, nofollow',
    }));
});

// Deprecated or Redirected Enpoints
// Get "My" Profile Data (Legacy support, maybe redirect to /api/profiles/me in future)
app.get('/api/user/profile', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const user = await User.findById(req.session.userId).select('-passwordHash');
        if (user) {
            // Восполняем страну, если она ещё неизвестна
            await ensureUserCountry(user, getClientIp(req));
        }
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

// Update biography
app.patch('/api/user/profile', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { bio } = req.body;
        if (typeof bio !== 'string') return res.status(400).json({ error: 'bio must be a string' });

        // Нормализуем переносы строк (CRLF/CR -> LF), убираем прочие управляющие символы,
        // схлопываем повторяющиеся пробелы и длинные серии пустых строк, обрезаем по краям.
        const cleaned = bio
            .replace(/\r\n?/g, '\n')
            .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
            .replace(/[^\S\n]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[^\n]+/g, (line) => line.trim())
            .trim();
        const final = cleaned.substring(0, 300).replace(/\n{3,}/g, '\n\n');

        await User.findByIdAndUpdate(req.session.userId, { bio: final });
        res.json({ bio: final });
    } catch (err) {
        console.error('[BIO] Failed to update bio:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Allowed avatar URL domains
const ALLOWED_AVATAR_DOMAINS = [
    'ui-avatars.com',
    'i.imgur.com',
    'cdn.discordapp.com',
    'avatars.githubusercontent.com',
    'lh3.googleusercontent.com'
];

// Validate avatar URL
const isValidAvatarUrl = (url) => {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') return false;
        return ALLOWED_AVATAR_DOMAINS.some(domain => parsed.hostname === domain || parsed.hostname.endsWith('.' + domain));
    } catch {
        return false;
    }
};

// Update Avatar (By URL)
app.post('/api/user/update-avatar', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { avatarUrl } = req.body;
        if (!avatarUrl) return res.status(400).json({ error: 'Avatar URL required' });

        if (!isValidAvatarUrl(avatarUrl)) {
            return res.status(400).json({ error: 'Invalid avatar URL. Use allowed image hosts.' });
        }

        await User.findByIdAndUpdate(req.session.userId, { avatarUrl });
        req.session.avatarUrl = avatarUrl;
        res.json({ message: 'Avatar updated' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// --- AVATAR UPLOAD ---
// Храним по одному файлу на пользователя (avatars/<userId>.webp), пережатый и
// уменьшенный сервером. Оригинал не сохраняется — картинки маленькие и безопасные.
const AVATARS_DIR = path.join(__dirname, '..', 'avatars');
fs.mkdirSync(AVATARS_DIR, { recursive: true });

const MAX_AVATAR_FILE_SIZE = 5 * 1024 * 1024; // 5 MB — верхний предел приёма
const AVATAR_OUTPUT = 256;                     // сторона итоговой квадратной аватарки (px)

const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_AVATAR_FILE_SIZE, files: 1 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowed.indexOf(file.mimetype) !== -1) cb(null, true);
        else cb(Object.assign(new Error('Unsupported file type'), { code: 'AVATAR_TYPE' }));
    },
});

// Обёртка: превращает ошибки multer в понятный JSON-ответ
function uploadAvatarMiddleware(req, res, next) {
    avatarUpload.single('avatar')(req, res, (err) => {
        if (!err) return next();
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large (max 5 MB)' });
        if (err.code === 'AVATAR_TYPE') return res.status(400).json({ error: 'Unsupported file type. Use JPEG, PNG or WebP.' });
        console.error('[AVATAR UPLOAD ERROR]', err);
        return res.status(400).json({ error: 'Upload failed' });
    });
}

app.post('/api/user/upload-avatar', uploadAvatarMiddleware, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

    try {
        if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'No image provided' });

        // Декодируем и пережимаем: отклоняет поддельные/SVG файлы и убирает метаданные
        let webp;
        try {
            webp = await sharp(req.file.buffer, { limitInputPixels: 16 * 1000 * 1000 })
                .resize(AVATAR_OUTPUT, AVATAR_OUTPUT, { fit: 'cover' })
                .webp({ quality: 80 })
                .toBuffer();
        } catch (sharpErr) {
            console.error('[AVATAR PROCESSING ERROR]', sharpErr.message);
            return res.status(400).json({ error: 'Invalid or corrupt image file' });
        }

        const fname = `${req.session.userId}.webp`;
        const fpath = path.join(AVATARS_DIR, fname);
        await fs.promises.writeFile(fpath, webp);

        const avatarUrl = `/avatars/${fname}?v=${Date.now()}`;
        await User.findByIdAndUpdate(req.session.userId, { avatarUrl });
        req.session.avatarUrl = avatarUrl;
        res.json({ message: 'Avatar updated', avatarUrl });
    } catch (err) {
        console.error('[AVATAR UPLOAD ERROR]', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Game History for authenticated user (profile modal)
app.get('/api/user/history', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const limit = parseInt(req.query.limit) || 20;
        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * limit;

        const filter = {
            $or: [
                { 'playerWhite.id': req.session.userId, 'playerWhite.isGuest': false },
                { 'playerBlack.id': req.session.userId, 'playerBlack.isGuest': false }
            ]
        };

        const [history, total] = await Promise.all([
            GameResult.find(filter).sort({ date: -1 }).skip(skip).limit(limit),
            GameResult.countDocuments(filter)
        ]);

        res.json({ games: history, total, page, limit });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete Account
app.delete('/api/user/account', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { password, googleCredential } = req.body;

    const user = await User.findById(req.session.userId).select('passwordHash googleId');
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.passwordHash) {
      if (!password) return res.status(400).json({ error: 'Password required' });
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) return res.status(403).json({ error: 'Wrong password' });
    } else {
      // Аккаунт без пароля (Google): подтверждаем свежим Google-токеном.
      const nonce = consumeReauthNonce(req);
      try {
        await verifyFreshGoogleReauth(googleCredential, user.googleId, { nonce });
      } catch (e) {
        return res.status(403).json({ error: 'Google reauthentication failed', code: e.code || 'REAUTH_FAILED' });
      }
    }

    const userId = req.session.userId;

    await Friendship.deleteMany({
      $or: [{ requester: userId }, { recipient: userId }]
    });

    await GameResult.updateMany(
      { 'playerWhite.id': userId },
      { $set: { 'playerWhite.username': '[deleted]', 'playerWhite.id': null } }
    );
    await GameResult.updateMany(
      { 'playerBlack.id': userId },
      { $set: { 'playerBlack.username': '[deleted]', 'playerBlack.id': null } }
    );

    await User.findByIdAndDelete(userId);

    req.session.destroy(err => {
      if (err) console.error('[DELETE ACCOUNT] Session destroy error:', err);
      res.clearCookie('connect.sid');
      res.json({ message: 'Account deleted' });
    });
  } catch (err) {
    console.error('[DELETE ACCOUNT] Error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Set or change the account password.
// - accounts that already have a password: verify currentPassword;
// - accounts without one (Google-only): require a fresh Google credential.
// On success every other session is revoked (sessionVersion bump).
app.post('/api/user/password', async (req, res) => {
    if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { currentPassword, newPassword, googleCredential } = req.body || {};
        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        const user = await User.findById(req.session.userId).select('passwordHash googleId authProviders sessionVersion');
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (user.passwordHash) {
            if (!currentPassword) return res.status(400).json({ error: 'Current password required' });
            const ok = await bcrypt.compare(currentPassword, user.passwordHash);
            if (!ok) return res.status(403).json({ error: 'Wrong password' });
        } else {
            const nonce = consumeReauthNonce(req);
            try {
                await verifyFreshGoogleReauth(googleCredential, user.googleId, { nonce });
            } catch (e) {
                return res.status(403).json({ error: 'Google reauthentication failed', code: e.code || 'REAUTH_FAILED' });
            }
        }

        user.passwordHash = await bcrypt.hash(newPassword, 10);
        if (!Array.isArray(user.authProviders)) user.authProviders = [];
        if (!user.authProviders.includes('password')) user.authProviders.push('password');

        // Установка/смена пароля завершает все прочие сессии, но не текущую.
        const newSv = await bumpSessionVersion(user);
        req.session.sv = newSv;

        res.json({ message: 'Password updated' });
    } catch (err) {
        console.error('[SET PASSWORD] Error:', err);
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

// --- PASSWORD RESET ---

// Separate stricter rate limiter for forgot-password
const forgotLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { error: 'Too many password reset attempts. Try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.post('/api/auth/forgot-password', forgotLimiter, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        // Always return 200 to prevent email enumeration
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (user) {
            // Cooldown: only one reset per 24 hours
            const cooldown = user.resetPasswordRequestedAt;
            if (cooldown && (Date.now() - new Date(cooldown).getTime() < 86400000)) {
                // Still on cooldown — silently return
                return res.json({ message: 'If that email is registered, a reset link has been sent.' });
            }

            const token = crypto.randomBytes(32).toString('hex');
            user.resetPasswordToken = token;
            user.resetPasswordExpires = new Date(Date.now() + 3600000); // 1 hour
            user.resetPasswordRequestedAt = new Date();
            await user.save();

            try {
                await sendPasswordResetEmail(user.email, token);
            } catch (e) {
                console.error('[FORGOT] Failed to send email:', e);
            }
        }

        res.json({ message: 'If that email is registered, a reset link has been sent.' });
    } catch (e) {
        console.error('[FORGOT] Error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { token, password } = req.body;
        if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
        if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

        const user = await User.findOne({
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: new Date() }
        });

        if (!user) return res.status(400).json({ error: 'Invalid or expired reset token' });

        const passwordHash = await bcrypt.hash(password, 10);
        user.passwordHash = passwordHash;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        // Destroy all sessions for this user
        if (req.session.userId === user._id.toString()) {
            req.session.destroy(() => {});
        }

        res.json({ message: 'Password has been reset. You can now log in.' });
    } catch (e) {
        console.error('[RESET] Error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});
// --- FRIENDSHIP API ---

function findSocketByUserId(userId) {
    const sid = String(userId);
    for (const s of io.sockets.sockets.values()) {
        if (s.userId && String(s.userId) === sid) return s;
    }
    return null;
}

function disconnectUserSockets(userId, reason) {
    for (const socket of io.sockets.sockets.values()) {
        if (socket.userId && String(socket.userId) === String(userId)) {
            socket.emit('forceDisconnect', { reason });
            socket.disconnect(true);
        }
    }
}

function findSocketByToken(token) {
    for (const s of io.sockets.sockets.values()) {
        if (s.playerToken === token) return s;
    }
    return null;
}

// Игрок занят, если у него есть активная партия или он в поиске игры
async function isPlayerBusy(token) {
    if (!token) return false;
    const lobbyId = await Redis.getLobbyByToken(token);
    if (lobbyId) return true;
    const sock = findSocketByToken(token);
    if (sock && sock.searchToken) return true;
    return false;
}

// Окно ожидания ответа на реванш
const REMATCH_RESPONSE_WINDOW_MS = 30 * 1000;

// Сброс протухших ожиданий реванша (информируем ожидающих)
async function expireStaleRematchRequests(lobbyId, rematchCtx, waitingTokens) {
    if (!rematchCtx.expiresAt || !waitingTokens || waitingTokens.length === 0) return rematchCtx;
    if (Date.now() < rematchCtx.expiresAt) return rematchCtx;
    for (const t of waitingTokens) {
        const s = findSocketByToken(t);
        if (s) s.emit('rematchExpired', { lobbyId });
    }
    const cleared = { ...rematchCtx, pending: [], expiresAt: null };
    await Redis.saveRematchContext(lobbyId, cleared);
    return cleared;
}

async function getAcceptedFriendIds(userId) {
    const friendships = await Friendship.find({
        $or: [{ requester: userId }, { recipient: userId }],
        status: 'accepted'
    }).select('requester recipient').lean();
    return friendships.map(f => {
        const id = String(f.requester) === String(userId) ? f.recipient : f.requester;
        return String(id);
    });
}

const { createNotificationService, publicNotification } = require('./notifications/service');
const { registerNotificationRoutes } = require('./notifications/routes');
const notificationService = createNotificationService({ User, Report, Notification, getSocket: findSocketByUserId, sendEmail: sendSupportReplyEmail });
async function createNotification(...args) {
    try { return await notificationService.create(...args); }
    catch (_) { console.error('[NOTIFICATION] Create failed'); return null; }
}

// POST /api/friends/request — send friend request
app.post('/api/friends/request', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { recipientId } = req.body;
        if (!recipientId) return res.status(400).json({ error: 'recipientId required' });
        if (String(req.session.userId) === String(recipientId)) return res.status(400).json({ error: 'Cannot add yourself' });

        const recipient = await User.findById(recipientId);
        if (!recipient) return res.status(404).json({ error: 'User not found' });

        const existing = await Friendship.findOne({
            $or: [
                { requester: req.session.userId, recipient: recipientId },
                { requester: recipientId, recipient: req.session.userId }
            ]
        });
        if (existing) return res.status(409).json({ error: 'Request already exists' });

        const friendship = new Friendship({ requester: req.session.userId, recipient: recipientId, status: 'pending' });
        await friendship.save();

        const requester = await User.findById(req.session.userId).select('username avatarUrl');
        await createNotification(recipientId, 'friend_request',
            requester.username + ' wants to be friends',
            '',
            { requesterId: req.session.userId, requesterUsername: requester.username, requesterAvatar: requester.avatarUrl }
        );

        res.json({ message: 'ok', friendship });
    } catch (err) {
        console.error('[FRIENDS REQUEST ERROR]', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/friends/accept — accept friend request
app.post('/api/friends/accept', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { requesterId } = req.body;
        if (!requesterId) return res.status(400).json({ error: 'requesterId required' });

        const friendship = await Friendship.findOne({ requester: requesterId, recipient: req.session.userId, status: 'pending' });
        if (!friendship) return res.status(404).json({ error: 'Request not found' });

        friendship.status = 'accepted';
        await friendship.save();

        await User.findByIdAndUpdate(req.session.userId, { $inc: { friendCount: 1 } });
        await User.findByIdAndUpdate(requesterId, { $inc: { friendCount: 1 } });

        const accepter = await User.findById(req.session.userId).select('username avatarUrl');
        await createNotification(requesterId, 'friend_request_accepted',
            accepter.username + ' accepted your friend request',
            '',
            { requesterId: req.session.userId, requesterUsername: accepter.username }
        );

        res.json({ message: 'ok' });
    } catch (err) {
        console.error('[FRIENDS ACCEPT ERROR]', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/friends/decline — decline friend request
app.post('/api/friends/decline', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { requesterId } = req.body;
        if (!requesterId) return res.status(400).json({ error: 'requesterId required' });

        await Friendship.deleteOne({ requester: requesterId, recipient: req.session.userId, status: 'pending' });

        res.json({ message: 'ok' });
    } catch (err) {
        console.error('[FRIENDS DECLINE ERROR]', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /api/friends/remove/:userId — remove friend
app.delete('/api/friends/remove/:userId', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { userId } = req.params;

        const friendship = await Friendship.findOne({
            $or: [
                { requester: req.session.userId, recipient: userId },
                { requester: userId, recipient: req.session.userId }
            ],
            status: 'accepted'
        });
        if (!friendship) return res.status(404).json({ error: 'Friendship not found' });

        await Friendship.deleteOne({ _id: friendship._id });

        await User.findByIdAndUpdate(req.session.userId, { $inc: { friendCount: -1 } });
        await User.findByIdAndUpdate(userId, { $inc: { friendCount: -1 } });

        res.json({ message: 'ok' });
    } catch (err) {
        console.error('[FRIENDS REMOVE ERROR]', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/friends/list — get friends list
app.get('/api/friends/list', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const userId = req.session.userId;

        const accepted = await Friendship.find({ $or: [{ requester: userId }, { recipient: userId }], status: 'accepted' }).lean();
        const friendIds = accepted.map(f => String(f.requester) === String(userId) ? f.recipient : f.requester);
        const friendUsers = await User.find({ _id: { $in: friendIds } }).select('username avatarUrl online lastSeen').lean();
        const friendMap = {};
        friendUsers.forEach(u => { friendMap[String(u._id)] = u; });
        const friends = accepted.map(f => {
            const fid = String(f.requester) === String(userId) ? f.recipient : f.requester;
            const u = friendMap[fid] || {};
            return {
                _id: fid,
                username: u.username || 'Unknown',
                avatarUrl: u.avatarUrl || '',
                online: u.online || false,
                lastSeen: u.lastSeen || null,
                friendSince: f.createdAt
            };
        });

        const incomingDocs = await Friendship.find({ recipient: userId, status: 'pending' }).populate('requester', 'username avatarUrl').lean();
        const incoming = incomingDocs.map(f => ({
            _id: f.requester._id,
            username: f.requester.username,
            avatarUrl: f.requester.avatarUrl,
            requestedAt: f.createdAt
        }));

        const outgoingDocs = await Friendship.find({ requester: userId, status: 'pending' }).populate('recipient', 'username avatarUrl').lean();
        const outgoing = outgoingDocs.map(f => ({
            _id: f.recipient._id,
            username: f.recipient.username,
            avatarUrl: f.recipient.avatarUrl,
            requestedAt: f.createdAt
        }));

        res.json({ friends, incoming, outgoing });
    } catch (err) {
        console.error('[FRIENDS LIST ERROR]', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// -----------------------

// LAN-friendly Helmet Configuration
app.use(helmet({
    generateContentSecurityPolicy: false,
    hsts: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // GIS popup-поток требует, чтобы popup сохранял window.opener. При значении
    // по умолчанию 'same-origin' Google-попап зависает на белой странице
    // accounts.google.com/gsi/transform, и credential не доставляется.
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
}));

app.use(helmet.contentSecurityPolicy({
    useDefaults: false,
    directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'", "https://cdn.socket.io", "https://analytics.playquor.org", "https://static.cloudflareinsights.com", "https://cdn.jsdelivr.net", "https://accounts.google.com", "https://gsi.gstatic.com", "https://browser.sentry-cdn.com"],
        "script-src-attr": ["'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "https://ui-avatars.com", "https://*.googleusercontent.com"],
        "media-src": ["'self'", "data:", "blob:"],
        "frame-src": ["'self'", "https://accounts.google.com"],
        "connect-src": ["'self'", "ws:", "wss:", "http:", "https:", "https://cdn.socket.io", "https://analytics.playquor.org", "https://accounts.google.com"]
    }
})); // CLOSED Correctly

const allowedOrigins = (() => {
    const origins = [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://62.238.36.105',
        'file://'
    ];
    if (process.env.ALLOWED_ORIGINS) {
        origins.push(...process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()));
    }
    return origins;
})();

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1 || origin.startsWith('http://localhost')) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
}));

// Serve static files.
// Кэш: HTML/robots — короткий (контент правится без пересборки), версионированные
// ассеты (css/js/шрифты/картинки, раздаются с ?v=) — год + immutable.
app.use(express.static(path.join(__dirname, '../frontend'), {
    setHeaders(res, filePath) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.html' || ext === '.txt' || ext === '.xml') {
            res.setHeader('Cache-Control', 'public, max-age=300');
        } else {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }
}));

// Конфиг телеметрии для фронтенда: DSN берётся из env и не коммитится в публичный репозиторий.
// Отдельная переменная SENTRY_FRONTEND_DSN позволяет вести фронт и бэк в разных проектах Sentry;
// по умолчанию фронт шлёт в тот же проект, что и бэкенд.
app.get('/js/telemetry-config.js', (req, res) => {
    res.type('application/javascript');
    res.set('Cache-Control', 'no-store'); // конфиг может измениться без пересборки контейнера
    const dsn = process.env.SENTRY_FRONTEND_DSN || process.env.SENTRY_DSN || '';
    res.send('window.__TELEMETRY = ' + JSON.stringify({ sentryDsn: dsn }) + ';');
});

app.use('/shared.js', express.static(RULES_FILE));
app.use('/js/ai-core.js', express.static(path.join(__dirname, 'core/ai-core.js')));
app.use('/js/mp4-muxer.js', express.static(path.join(__dirname, '../node_modules/mp4-muxer/build/mp4-muxer.js')));

// Загруженные аватарки: вечная кэшируемость (URL содержит ?v= при смене файла)
app.use('/avatars', express.static(AVATARS_DIR, { maxAge: '365d', immutable: true }));
// Если файл ещё не загружен/пропал — мягкий фолбэк на заглушку
app.use('/avatars', (req, res) => {
    res.redirect(301, 'https://ui-avatars.com/api/?name=&background=333&color=fff');
});

// Standalone pages (not SPA)
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../frontend/login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, '../frontend/register.html')));
app.get('/forgot-password', (req, res) => res.sendFile(path.join(__dirname, '../frontend/forgot-password.html')));
app.get('/reset-password', (req, res) => res.sendFile(path.join(__dirname, '../frontend/reset-password.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, '../frontend/terms.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, '../frontend/privacy.html')));
app.get('/report', (req, res) => res.sendFile(path.join(__dirname, '../frontend/report.html')));
app.get('/profile/reports', (req, res) => res.sendFile(path.join(__dirname, '../frontend/reports.html')));
app.get('/admin/reports', requireAdmin, (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin-reports.html')));
app.get('/rules', (req, res) => res.sendFile(path.join(__dirname, '../frontend/rules.html')));
app.get('/how-to-play', (req, res) => res.redirect(301, '/rules'));
app.get('/faq', (req, res) => res.sendFile(path.join(__dirname, '../frontend/faq.html')));
app.get('/replay/:id', (req, res) => res.sendFile(path.join(__dirname, '../frontend/replay.html')));
app.get('/leaderboard', (req, res) => res.sendFile(path.join(__dirname, '../frontend/leaderboard.html')));

// --- BUG REPORT API ---

const reportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { error: 'Too many reports. Try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

registerNotificationRoutes({ app, User, Report, Notification, service: notificationService, reportLimiter, requireAdmin, getClientIp });

// --- ADMIN USER MANAGEMENT ---

const UserReport = require('./models/UserReport');
const AdminLog = require('./models/AdminLog');

async function logAdminAction(adminId, action, targetId, targetUsername, details = {}) {
    try {
        await AdminLog.create({ admin: adminId, action, target: targetId, targetUsername, details });
    } catch (e) {
        console.error('[ADMIN LOG] Error:', e);
    }
}

// GET /api/admin/users — список пользователей с поиском и пагинацией
app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const search = (req.query.search || '').trim();
        const filter = {};
        if (search) {
            filter.$or = [
                { username: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }
        if (req.query.banned === 'true') filter.banned = true;
        if (req.query.banned === 'false') filter.banned = false;
        if (req.query.admins === 'true') filter.isAdmin = true;
        if (req.query.bots === 'true') filter.isBot = true;
        if (req.query.online === 'true') filter.online = true;

        const [users, total] = await Promise.all([
            User.find(filter)
                .select('username email avatarUrl rating isAdmin isBot banned banReason banExpires createdAt lastSeen online stats')
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            User.countDocuments(filter)
        ]);
        res.json({ users, total, page, limit });
    } catch (e) {
        console.error('[ADMIN] List users error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/admin/users/:id — расширенный профиль (IP не храним, но есть username/email/stats)
app.get('/api/admin/users/:id', requireAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id)
            .select('username email avatarUrl rating status bio country isAdmin isBot banned banReason banExpires bannedAt createdAt lastSeen stats achievements')
            .lean();
        if (!user) return res.status(404).json({ error: 'User not found' });
        const recentGames = await GameResult.find({
            $or: [{ 'playerWhite.id': req.params.id }, { 'playerBlack.id': req.params.id }]
        }).sort({ date: -1 }).limit(10).lean();
        const reportsAbout = await UserReport.find({ target: req.params.id }).populate('reporter', 'username').sort({ createdAt: -1 }).limit(10).lean();
        const reportsBy = await UserReport.find({ reporter: req.params.id }).populate('target', 'username').sort({ createdAt: -1 }).limit(10).lean();
        const adminLogs = await AdminLog.find({ target: req.params.id }).populate('admin', 'username').sort({ createdAt: -1 }).limit(10).lean();
        res.json({ user, recentGames, reportsAbout, reportsBy, adminLogs });
    } catch (e) {
        console.error('[ADMIN] Get user error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/admin/users/:id/ban — бан пользователя
app.post('/api/admin/users/:id/ban', requireAdmin, async (req, res) => {
    try {
        if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.status(400).json({ error: 'Invalid user ID' });
        if (String(req.params.id) === String(req.adminUser._id)) {
            return res.status(400).json({ error: 'Cannot ban yourself' });
        }
        if (req.body && (typeof req.body !== 'object' || Array.isArray(req.body))) return res.status(400).json({ error: 'Ban parameters must be an object' });
        const { reason, durationDays } = req.body || {};
        if (reason !== undefined && typeof reason !== 'string') return res.status(400).json({ error: 'Reason must be a string' });
        if (durationDays !== undefined && durationDays !== null &&
            (!Number.isInteger(durationDays) || durationDays < 0 || durationDays > 36500)) {
            return res.status(400).json({ error: 'Duration must be 0–36500 whole days, or null for permanent' });
        }
        const target = await User.findById(req.params.id).select('username banned banReason banExpires isAdmin isBot');
        if (!target) return res.status(404).json({ error: 'User not found' });
        if (target.isAdmin) return res.status(400).json({ error: 'Cannot ban an admin' });
        if (target.isBot) return res.status(400).json({ error: 'Cannot ban a bot' });

        const banExpires = durationDays && durationDays > 0
            ? new Date(Date.now() + durationDays * 86400000)
            : null;

        const bannedUser = await User.findByIdAndUpdate(req.params.id, { $set: {
            banned: true,
            banReason: (reason || '').substring(0, 500),
            banExpires,
            bannedAt: new Date(),
            bannedBy: req.adminUser._id
        }, $inc: { sessionVersion: 1 } }, { new: true });
        if (!bannedUser) return res.status(404).json({ error: 'User not found' });
        setCachedSessionVersion(String(bannedUser._id), bannedUser.sessionVersion);
        disconnectUserSockets(bannedUser._id, 'You have been banned');

        await logAdminAction(req.adminUser._id, 'user_banned', req.params.id, target.username, { reason, durationDays, banExpires });

        res.json({ message: 'User banned', banExpires });
    } catch (e) {
        console.error('[ADMIN] Ban error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/admin/users/:id/unban — разбан
app.post('/api/admin/users/:id/unban', requireAdmin, async (req, res) => {
    try {
        const target = await User.findById(req.params.id).select('username banned');
        if (!target) return res.status(404).json({ error: 'User not found' });
        await User.findByIdAndUpdate(req.params.id, {
            banned: false,
            banReason: '',
            banExpires: null,
            bannedAt: null,
            bannedBy: null
        });
        await logAdminAction(req.adminUser._id, 'user_unbanned', req.params.id, target.username);
        res.json({ message: 'User unbanned' });
    } catch (e) {
        console.error('[ADMIN] Unban error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /api/admin/users/:id/avatar — сброс аватара на дефолтный
app.delete('/api/admin/users/:id/avatar', requireAdmin, async (req, res) => {
    try {
        const target = await User.findById(req.params.id).select('username avatarUrl');
        if (!target) return res.status(404).json({ error: 'User not found' });
        const defaultAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(target.username)}&background=333&color=fff`;
        await User.findByIdAndUpdate(req.params.id, { avatarUrl: defaultAvatar });

        // Удаляем загруженный файл, если был
        const localAvatarPath = path.join(AVATARS_DIR, `${req.params.id}.webp`);
        try { await fs.promises.unlink(localAvatarPath); } catch (_) { /* no local file */ }

        await logAdminAction(req.adminUser._id, 'user_avatar_reset', req.params.id, target.username, { oldUrl: target.avatarUrl, newUrl: defaultAvatar });

        res.json({ message: 'Avatar reset to default', avatarUrl: defaultAvatar });
    } catch (e) {
        console.error('[ADMIN] Reset avatar error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// PATCH /api/admin/users/:id/role — toggle isAdmin
app.patch('/api/admin/users/:id/role', requireAdmin, async (req, res) => {
    try {
        if (String(req.params.id) === String(req.adminUser._id)) {
            return res.status(400).json({ error: 'Cannot change your own role' });
        }
        const target = await User.findById(req.params.id).select('username isAdmin isBot');
        if (!target) return res.status(404).json({ error: 'User not found' });
        if (target.isBot) return res.status(400).json({ error: 'Cannot change role of a bot' });

        const newIsAdmin = !target.isAdmin;
        await User.findByIdAndUpdate(req.params.id, { isAdmin: newIsAdmin });
        await logAdminAction(req.adminUser._id, 'user_role_changed', req.params.id, target.username, { isAdmin: newIsAdmin });

        if (!newIsAdmin) {
            const victimSocket = findSocketByUserId(req.params.id);
            if (victimSocket) victimSocket.emit('forceDisconnect', { reason: 'Admin access removed' });
        }

        res.json({ message: `User ${newIsAdmin ? 'promoted to admin' : 'demoted from admin'}`, isAdmin: newIsAdmin });
    } catch (e) {
        console.error('[ADMIN] Role error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/admin/users/:id/rating — ручная корректировка рейтинга
app.post('/api/admin/users/:id/rating', requireAdmin, async (req, res) => {
    try {
        const { rating } = req.body;
        if (rating === undefined || isNaN(parseInt(rating))) {
            return res.status(400).json({ error: 'Valid rating required' });
        }
        const newRating = Math.max(0, Math.min(4000, parseInt(rating)));
        const target = await User.findById(req.params.id).select('username rating');
        if (!target) return res.status(404).json({ error: 'User not found' });
        const oldRating = target.rating;
        await User.findByIdAndUpdate(req.params.id, { rating: newRating });
        await logAdminAction(req.adminUser._id, 'user_rating_changed', req.params.id, target.username, { oldRating, newRating });
        res.json({ message: 'Rating updated', rating: newRating });
    } catch (e) {
        console.error('[ADMIN] Rating error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/admin/users/:id/delete — удаление аккаунта
app.post('/api/admin/users/:id/delete', requireAdmin, async (req, res) => {
    try {
        if (String(req.params.id) === String(req.adminUser._id)) {
            return res.status(400).json({ error: 'Cannot delete yourself' });
        }
        const target = await User.findById(req.params.id).select('username isAdmin');
        if (!target) return res.status(404).json({ error: 'User not found' });
        if (target.isAdmin) return res.status(400).json({ error: 'Cannot delete an admin account' });

        await Friendship.deleteMany({ $or: [{ requester: req.params.id }, { recipient: req.params.id }] });
        await GameResult.updateMany({ 'playerWhite.id': req.params.id }, { $set: { 'playerWhite.username': '[deleted]', 'playerWhite.id': null } });
        await GameResult.updateMany({ 'playerBlack.id': req.params.id }, { $set: { 'playerBlack.username': '[deleted]', 'playerBlack.id': null } });
        await UserReport.deleteMany({ $or: [{ reporter: req.params.id }, { target: req.params.id }] });
        await User.findByIdAndDelete(req.params.id);

        const localAvatarPath = path.join(AVATARS_DIR, `${req.params.id}.webp`);
        try { await fs.promises.unlink(localAvatarPath); } catch (_) { /* no local file */ }

        await logAdminAction(req.adminUser._id, 'user_deleted', req.params.id, target.username);

        const victimSocket = findSocketByUserId(req.params.id);
        if (victimSocket) victimSocket.emit('forceDisconnect', { reason: 'Account deleted' });

        res.json({ message: 'User deleted' });
    } catch (e) {
        console.error('[ADMIN] Delete user error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/admin/stats — дашборд статистика
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        const [totalUsers, bannedUsers, totalGames, newUsersToday, totalBots] = await Promise.all([
            User.countDocuments({ isBot: { $ne: true } }),
            User.countDocuments({ banned: true }),
            GameResult.countDocuments(),
            User.countDocuments({ createdAt: { $gte: new Date(Date.now() - 86400000) } }),
            User.countDocuments({ isBot: true })
        ]);
        const pendingReports = await UserReport.countDocuments({ status: 'new' });
        const onlineNow = await User.countDocuments({ online: true, isBot: { $ne: true } });
        const recentGames = await GameResult.countDocuments({ date: { $gte: new Date(Date.now() - 86400000) } });
        const recentRegistrations = await User.find({ isBot: { $ne: true } }).select('username createdAt').sort({ createdAt: -1 }).limit(5).lean();
        const topReports = await UserReport.aggregate([
            { $match: { status: 'new' } },
            { $group: { _id: '$target', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
            { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
            { $unwind: '$user' },
            { $project: { username: '$user.username', avatarUrl: '$user.avatarUrl', count: 1 } }
        ]);
        res.json({
            totalUsers, bannedUsers, totalGames, newUsersToday, totalBots,
            pendingReports, onlineNow, recentGames, recentRegistrations, topReports
        });
    } catch (e) {
        console.error('[ADMIN] Stats error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/admin/logs — лог действий админа
app.get('/api/admin/logs', requireAdmin, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const [logs, total] = await Promise.all([
            AdminLog.find().populate('admin', 'username').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            AdminLog.countDocuments()
        ]);
        res.json({ logs, total, page, limit });
    } catch (e) {
        console.error('[ADMIN] Logs error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- USER REPORTS (жалобы на пользователей) ---

const userReportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: 'Too many reports. Try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// POST /api/user-reports — создать жалобу на пользователя
app.post('/api/user-reports', userReportLimiter, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { targetId, reason, description } = req.body;
        if (!targetId || !reason) return res.status(400).json({ error: 'targetId and reason required' });
        if (String(targetId) === String(req.session.userId)) {
            return res.status(400).json({ error: 'Cannot report yourself' });
        }
        const allowedReasons = ['inappropriate_avatar', 'inappropriate_username', 'inappropriate_bio', 'inappropriate_status', 'cheating', 'harassment', 'impersonation', 'other'];
        if (!allowedReasons.includes(reason)) {
            return res.status(400).json({ error: 'Invalid reason' });
        }
        const target = await User.findById(targetId).select('username isBot');
        if (!target) return res.status(404).json({ error: 'User not found' });
        if (target.isBot) {
            // Молча «принимаем» жалобу, не создавая её — игроки не должны знать о существовании ботов.
            return res.status(201).json({ message: 'Report submitted' });
        }

        // Проверяем дубликат — не более 3 активных жалоб от одного пользователя на того же
        const existingCount = await UserReport.countDocuments({
            reporter: req.session.userId,
            target: targetId,
            status: { $in: ['new', 'in_progress'] }
        });
        if (existingCount >= 3) {
            return res.status(400).json({ error: 'You already have 3 active reports on this user' });
        }

        const report = await UserReport.create({
            reporter: req.session.userId,
            target: targetId,
            reason,
            description: (description || '').substring(0, 2000)
        });

        // Уведомляем всех админов
        const adminUsers = await User.find({ isAdmin: true }).select('_id').lean();
        for (const admin of adminUsers) {
            await createNotification(admin._id, 'user_report',
                `New report against ${target.username}`,
                `${reason} — ${(description || '').substring(0, 100)}`,
                { userReportId: report._id, targetUsername: target.username }
            );
        }

        res.status(201).json({ message: 'Report submitted', id: report._id });
    } catch (e) {
        console.error('[USER REPORT] Create error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/admin/user-reports — список жалоб
app.get('/api/admin/user-reports', requireAdmin, async (req, res) => {
    try {
        const status = req.query.status;
        const filter = {};
        if (status && status !== 'all') filter.status = status;
        const reports = await UserReport.find(filter)
            .populate('reporter', 'username avatarUrl')
            .populate('target', 'username avatarUrl')
            .sort({ createdAt: -1 })
            .lean();
        res.json(reports);
    } catch (e) {
        console.error('[USER REPORT] List error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// PATCH /api/admin/user-reports/:id — обработать жалобу (resolve/dismiss)
app.patch('/api/admin/user-reports/:id', requireAdmin, async (req, res) => {
    try {
        if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.status(400).json({ error: 'Invalid report ID' });
        const current = await UserReport.findById(req.params.id);
        if (!current) return res.status(404).json({ error: 'Report not found' });
        const version = req.body?.version;
        if (version !== undefined && (!Number.isSafeInteger(version) || version < 0)) {
            return res.status(400).json({ error: 'Version must be a non-negative integer' });
        }
        const transition = complaintTransition(current, req.body || {}, req.adminUser._id);
        if (transition.unchanged) return res.json(current);
        if (version !== undefined && version !== (current.__v ?? 0)) {
            return res.status(409).json({ error: 'Report changed. Reload it before saving again.' });
        }
        const report = await UserReport.findOneAndUpdate(
            { _id: req.params.id, status: current.status, __v: current.__v },
            { $set: transition.update, $inc: { __v: 1 } },
            { new: true, runValidators: true }
        );
        if (!report) return res.status(409).json({ error: 'Report changed. Reload it before saving again.' });

        await logAdminAction(req.adminUser._id, transition.action,
            report.target, '', { reportId: report._id, reason: report.reason, previousStatus: current.status, status: report.status });

        res.json(report);
    } catch (e) {
        console.error('[USER REPORT] Update error:', e);
        res.status(e.status === 400 ? 400 : 500).json({ error: e.status === 400 ? e.message : 'Server error' });
    }
});

// --- PRODUCT ANALYTICS (события + метрики) ---

const analyticsLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { error: 'Too many analytics events. Slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const ANALYTICS_EVENT_WHITELIST = new Set([
    'register-click', 'register-complete', 'login-complete', 'search-started', 'play-online-click',
    'play-friend-click', 'play-local-click', 'surrender-click', 'room-created',
    'room-joined', 'room-link-copied', 'room-opened-via-link', 'search-cancelled', 'search-matched',
    'search-timeout', 'search-fallback-to-bot', 'screen-view', 'rematch-click', 'game-started',
    'game-abandoned', 'game-finished', 'play-bot-click', 'session-start', 'net-latency', 'app-loaded', 'admin-metrics-viewed', 'room-join-failed'
]);

// POST /api/analytics/events — батч событий от клиента (до 20 за запрос)
app.post('/api/analytics/events', analyticsLimiter, async (req, res) => {
    try {
        let events = Array.isArray(req.body) ? req.body : (req.body && req.body.events) || [];
        if (!Array.isArray(events) || events.length === 0) {
            return res.status(400).json({ error: 'events array required' });
        }
        if (events.length > 20) events = events.slice(0, 20);

        const docs = [];
        for (const ev of events) {
            const name = ev && typeof ev.name === 'string' ? ev.name.trim() : '';
            if (!ANALYTICS_EVENT_WHITELIST.has(name)) continue;
            // Registrations are recorded by auth routes, never trust client counts.
            if (name === 'register-complete') continue;

            let props = {};
            if (ev.props && typeof ev.props === 'object' && !Array.isArray(ev.props)) {
                try {
                    if (JSON.stringify(ev.props).length <= 4096) props = ev.props;
                } catch (e) {
                    props = {};
                }
            }

            const ts = ev.ts ? new Date(ev.ts) : new Date();
            if (Number.isNaN(ts.getTime())) continue;

            docs.push({
                name,
                userId: req.session && req.session.userId ? req.session.userId : null,
                sessionId: typeof (ev.sessionId || req.body.sessionId) === 'string' ? (ev.sessionId || req.body.sessionId).slice(0, 64) : '',
                deviceId: typeof (ev.deviceId || req.body.deviceId) === 'string' ? (ev.deviceId || req.body.deviceId).slice(0, 64) : '',
                platform: (ev.platform || req.body.platform) === 'android' ? 'android' : 'web',
                props,
                timestamp: ts
            });
        }

        if (docs.length > 0) {
            await AnalyticsEvent.insertMany(docs, { ordered: false });
        }
        res.status(204).end();
    } catch (e) {
        console.error('[ANALYTICS] Ingest error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/admin/metrics — агрегированные product-метрики
app.get('/api/admin/metrics', requireAdmin, async (req, res) => {
    try {
        const days = Math.min(30, Math.max(1, parseInt(req.query.days, 10) || 7));
        const since = new Date(Date.now() - days * 86400000);

        const [byName, daily, activeUsers, totalEvents] = await Promise.all([
            AnalyticsEvent.aggregate([
                { $match: { timestamp: { $gte: since } } },
                { $group: { _id: '$name', count: { $sum: 1 }, users: { $addToSet: '$userId' } } },
                { $sort: { count: -1 } }
            ]),
            AnalyticsEvent.aggregate([
                { $match: { timestamp: { $gte: since } } },
                { $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
                    count: { $sum: 1 },
                    users: { $addToSet: '$userId' }
                } },
                { $sort: { _id: 1 } }
            ]),
            AnalyticsEvent.aggregate([
                { $match: { timestamp: { $gte: since } } },
                { $group: { _id: '$userId' } }
            ]),
            AnalyticsEvent.countDocuments({ timestamp: { $gte: since } })
        ]);

        res.json({
            days,
            totalEvents,
            activeUsers: activeUsers.filter((u) => u._id).length,
            byName: byName.map(({ _id, count, users }) => ({
                name: _id,
                count,
                users: (users || []).filter(Boolean).length
            })),
            daily: daily.map(({ _id, count, users }) => ({
                date: _id,
                count,
                users: (users || []).filter(Boolean).length
            })),
            generatedAt: new Date().toISOString()
        });
    } catch (e) {
        console.error('[ANALYTICS] Metrics error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// Separate versioned report: legacy counters retain their existing definitions.
app.get('/api/admin/product-metrics', requireAdmin, async (req, res) => {
    const days = req.query.days === undefined ? 28 : Number(req.query.days);
    if (!Number.isInteger(days) || days < 1 || days > 30) return res.status(400).json({ error: 'days must be an integer from 1 to 30' });
    try {
        const report = await loadProductMetrics({ AnalyticsEvent, User, days });
        res.set('Cache-Control', 'no-store').json(report);
    } catch (err) {
        console.error('[ANALYTICS] Product report failed:', err.message);
        res.status(err.status === 503 ? 503 : 500).json({ error: err.status === 503 ? err.message : 'Product metrics unavailable' });
    }
});

// ADMIN PAGES
app.get('/admin/users', requireAdmin, (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin-users.html')));
app.get('/admin/user-reports', requireAdmin, (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin-user-reports.html')));
app.get('/admin/logs', requireAdmin, (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin-logs.html')));
app.get('/admin/metrics', requireAdmin, (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin-metrics.html')));
app.get('/admin', requireAdmin, (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin.html')));

// /play no longer exists (app back at /); keep old links working, preserving query params
app.get('/play', (req, res) => res.redirect(301, '/' + (req.url.length > 5 ? req.url.slice(5) : '')));

// Legacy /profile → /profiles/<username>: редирект в наше SPA-профильное окружение
app.get('/profile', async (req, res) => {
    try {
        if (req.session && req.session.userId) {
            const user = await User.findById(req.session.userId).select('username');
            if (user) return res.redirect(301, '/profiles/' + encodeURIComponent(user.username));
        }
    } catch (err) {
        console.error('[PROFILE REDIRECT] Error:', err);
    }
    res.redirect(301, '/');
});

// Legacy /profile/<something> → /profiles/<something> (старые ссылки/закладки)
app.get('/profile/:legacyUser', (req, res) => {
    res.redirect(301, '/profiles/' + encodeURIComponent(req.params.legacyUser));
});

// Unknown routes → честный 404 (frontend/404.html). Валидные SPA-маршруты
// (/profiles/:username, /lobby/:code) обработаны выше по коду.
app.get('/{*path}', (req, res) => {
    if (req.originalUrl.startsWith('/api/')) {
        return res.status(404).json({ error: 'Not found' });
    }
    sendNotFound(res);
});

// Sentry error handler (after all routes)
if (process.env.SENTRY_DSN) {
    Sentry.setupExpressErrorHandler(app);
}

// --- SERVER & SOCKET.IO INITIALIZATION ---
const server = http.createServer(app);

const io = socketIo(server, {
    cors: {
        origin: (origin, callback) => {
            if (process.env.NODE_ENV !== 'production') {
                return callback(null, true);
            }
            if (!origin || allowedOrigins.indexOf(origin) !== -1) {
                callback(null, true);
            } else {
                console.warn(`[CORS] Blocked origin: ${origin}`);
                callback(new Error('Not allowed by CORS'));
            }
        },
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        credentials: true
    },
    transports: ['polling', 'websocket'],
    allowUpgrades: true,
    pingTimeout: 60000
});

// Socket.IO Admin UI (разработка/дебаг)
if (process.env.SOCKET_ADMIN_USERNAME && process.env.SOCKET_ADMIN_PASSWORD) {
    const { instrument } = require('@socket.io/admin-ui');
    instrument(io, {
        auth: {
            type: 'basic',
            credentials: {
                username: process.env.SOCKET_ADMIN_USERNAME,
                password: process.env.SOCKET_ADMIN_PASSWORD,
            },
        },
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    });
    log.server('Socket.IO Admin UI enabled at https://admin.socket.io');
}

// Share session with Socket.IO
const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(sessionMiddleware));

io.use((socket, next) => {
    const session = socket.request.session;
    if (session && session.userId) {
        (async () => {
            try {
                let user;
                try {
                    user = await resolveUserById(session.userId, 'banned banReason banExpires sessionVersion');
                } catch (e) {
                    user = await User.findById(session.userId);
                }
                if (!user) {
                    session.destroy(() => {});
                    return next(new Error('unauthorized'));
                }
                // Отзываем сокеты со старой версией сессии (слияние аккаунтов, смена пароля).
                if ((session.sv || 0) !== ((user.sessionVersion) || 0)) {
                    session.destroy(() => {});
                    return next(new Error('unauthorized'));
                }
                const ban = await isUserBanned(user);
                if (ban.banned) {
                    return next(new Error('banned'));
                }
                socket.userId = session.userId;
                socket.username = session.username;
                socket.avatarUrl = session.avatarUrl;
                next();
            } catch (err) {
                console.error('[SOCKET AUTH] Error:', err);
                next(new Error('unauthorized'));
            }
        })();
        return;
    }
    if (!socket.userId) {
        socket.username = `Guest-${socket.id.substr(0, 4)}`;
    }
    next();
});

// A remembered game token must not restore a banned account after cookies are cleared.
io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth?.token;
        if (typeof token === 'string' && await isTokenBanned(token)) return next(new Error('banned'));
        next();
    } catch (err) {
        console.error('[SOCKET TOKEN AUTH]', err.message);
        next(new Error('unauthorized'));
    }
});

/**
 * Генерирует короткий уникальный код комнаты.
 */
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

async function generateUniqueRoomCode(maxAttempts = 30) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const code = generateRoomCode();
        const existing = await Redis.getRoom(code);
        if (!existing) return code;
    }
    throw new Error('Failed to generate unique room code');
}

async function linkPlayersToLobbyByToken(tokens, lobbyId) {
    for (const token of tokens || []) {
        if (!token) continue;
        await Redis.setTokenMapping(token, lobbyId);
        const userId = await Redis.getUserIdByToken(token);
        if (userId) {
            await Redis.setActiveLobbyForUser(userId, lobbyId);
        }
    }
}

async function clearPlayersLobbyLinkByToken(tokens) {
    for (const token of tokens || []) {
        if (!token) continue;
        await Redis.deleteTokenMapping(token);
        const userId = await Redis.getUserIdByToken(token);
        if (userId) {
            await Redis.clearActiveLobbyForUser(userId);
        }
    }
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
                    rating: user.rating,
                    country: user.country || 'XX'
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
async function recalculateBotRatings() {
    try {
        const bots = await User.find({ isBot: true });
        let updated = 0;
        for (const bot of bots) {
            const games = await GameResult.find({
                isRanked: true,
                $or: [{ 'playerWhite.id': bot._id }, { 'playerBlack.id': bot._id }]
            }).sort({ date: 1 }).select('playerWhite playerBlack winner date');

            if (games.length === 0) continue;

            let rating = 1200;
            let totalGames = 0;
            let wins = 0;
            let losses = 0;

            for (const game of games) {
                const isWhite = game.playerWhite && game.playerWhite.id && game.playerWhite.id.toString() === bot._id.toString();
                const change = isWhite
                    ? (game.playerWhite?.ratingChange || 0)
                    : (game.playerBlack?.ratingChange || 0);
                rating += change;
                totalGames++;

                if (game.winner === 0 && isWhite) wins++;
                else if (game.winner === 1 && !isWhite) wins++;
                else if (game.winner !== -1) losses++;
            }

            bot.rating = rating;
            bot.stats = bot.stats || {};
            bot.stats.totalGames = totalGames;
            bot.stats.wins = wins;
            bot.stats.losses = losses;
            await bot.save();
            updated++;
        }
        console.log(`[RATING] Recalculated ratings for ${updated} bots`);
        return updated;
    } catch (err) {
        console.error('[RATING] Recalculation error:', err);
        throw err;
    }
}

function checkVictory(state) {
    if (state.players[0].pos.r === 0) return 0;
    if (state.players[1].pos.r === 8) return 1;
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

async function startBotGame(socket, humanPlayer, bot, isRanked) {
    const swap = Math.random() > 0.5;
    const humanIdx = swap ? 1 : 0;
    const botIdx = 1 - humanIdx;

    const lobbyId = await Redis.generateUniqueLobbyCode();

    const gameState = Shared.createInitialState(humanPlayer.timeControl, isRanked);
    gameState.hasBot = true;
    gameState.botPlayerIdx = botIdx;
    gameState.botDifficulty = bot.difficulty || 'medium';
    // Stable identity is what gives the bot a consistent personality across matches; style is recorded
    // for matchmaking display/serialization and kept on the game so restarts rebuild the same opponent.
    gameState.botIdentity = bot.identity || bot.token;
    gameState.botStyle = bot.style || null;

    gameState.playerSockets[humanIdx] = socket.id;
    gameState.playerSockets[botIdx] = null;
    gameState.playerTokens[humanIdx] = humanPlayer.token;
    gameState.playerTokens[botIdx] = bot.token;
    gameState.playerProfiles[humanIdx] = await getPlayerProfile(humanPlayer.token);
    gameState.playerProfiles[botIdx] = bot.profile;
    socket.searchToken = null;

    prepareNewGame(gameState);
    await Redis.saveGame(lobbyId, gameState);
    await Redis.addActiveGame(lobbyId);
    await scheduleClock(lobbyId, gameState);
    await linkPlayersToLobbyByToken([humanPlayer.token, bot.token], lobbyId);
    if (bot.isAccount && bot.userId) {
        await Redis.setTokenUserMapping(bot.token, bot.userId);
        await Redis.setActiveLobbyForUser(bot.userId, lobbyId);
    }

    socket.join(lobbyId);
    socket.emit('gameStart', {
        lobbyId,
        lobbyCode: lobbyId,
        color: humanIdx === 0 ? 'white' : 'black',
        opponent: gameState.playerProfiles[botIdx],
        me: gameState.playerProfiles[humanIdx],
        ...Clock.payload(gameState, Date.now())
    });

    botManager.scheduleMoveIfNeeded(lobbyId, gameState);
    console.log(`[BOT] Started fallback game ${lobbyId} (${isRanked ? 'ranked' : 'casual'}, bot=${gameState.botDifficulty})`);
    schedulePresenceBroadcast();
    return lobbyId;
}

async function applyBotMove(lobbyId, token, move) {
    return await applyGameMove({ lobbyId, token, move });
}

async function scheduleClock(lobbyId, game) {
    const deadline = Clock.deadline(game);
    if (deadline === null || game.finished) await Redis.clearTurnTimeout(lobbyId);
    else await Redis.setTurnTimeout(lobbyId, deadline);
}

function prepareNewGame(game, mode) {
    if (mode) game.gameMode = mode;
    Clock.start(game, Date.now());
    game.presence = { disconnectedAt: [null, null] };
}

function resumePayload(lobbyId, game, idx, now = Date.now()) {
    return { lobbyId, lobbyCode: lobbyId, color: idx === 0 ? 'white' : 'black',
        myPlayerIndex: idx, state: publicGameState(game), profiles: game.playerProfiles, ...Clock.payload(game, now) };
}

function publicGameState(game) {
    const state = Shared.cloneState(game);
    delete state.playerTokens; delete state.playerSockets; delete state.presence;
    return state;
}

async function resumeGame(socket, lobbyId, token = socket.playerToken) {
    if (await isTokenBanned(token)) return false;
    return withLobbyLock(lobbyId, async () => {
        const game = await Redis.getGame(lobbyId);
        if (!game || game.finished) return resendGameOverIfFinished(socket, lobbyId, game);
        const idx = game.playerTokens.indexOf(token);
        if (idx < 0) return false;
        if (Clock.expired(game, Date.now())) {
            await finalizeGame(lobbyId, 1 - game.currentPlayer, 'Time out');
            return resendGameOverIfFinished(socket, lobbyId);
        }
        game.playerSockets[idx] = socket.id;
        socket.playerToken = token;
        game.presence = game.presence || { disconnectedAt: [null, null] };
        game.presence.disconnectedAt[idx] = null;
        game.abandonedAt = null;
        socket.join(lobbyId);
        await Redis.saveGame(lobbyId, game);
        await updatePresenceDeadline(lobbyId, game);
        socket.emit('gameResumed', resumePayload(lobbyId, game, idx));
        io.to(lobbyId).emit('opponentReconnected');
        botManager.scheduleMoveIfNeeded(lobbyId, game);
        return true;
    });
}

async function applyGameMove({ lobbyId, token, move, rejectSocket = null }) {
    const reject = reason => { if (rejectSocket) rejectSocket.emit('moveRejected', { reason }); return false; };
    if (!Shared.isValidLobbyId(lobbyId) || !Shared.isValidMove(move)) return reject('Invalid move format');
    try {
        return await withLobbyLock(lobbyId, async () => {
            const game = await Redis.getGame(lobbyId);
            if (!game || game.finished) return reject('Game already finished');
            const playerIdx = game.playerTokens.indexOf(token);
            if (playerIdx < 0) return reject('Unauthorized');
            if (await isTokenBanned(token)) return reject('Account banned');
            const now = Date.now();
            if (Clock.expired(game, now)) {
                await finalizeGame(lobbyId, 1 - game.currentPlayer, 'Time out');
                return false;
            }
            if (playerIdx !== game.currentPlayer) return reject('Not your turn');
            const c = Clock.ensure(game);
            const elapsedMs = c.enabled ? Math.max(0, now - c.startedAt) : null;
            Clock.settle(game, now);
            let next;
            try { next = Shared.gameReducer(game, { ...move, playerIdx }); }
            catch (err) { return reject(err.message); }
            Clock.moved(next, playerIdx, now, elapsedMs);
            const winner = checkVictory(next);
            if (winner !== -1) { await finalizeGame(lobbyId, winner, 'Goal reached', next); return true; }
            await Redis.saveGame(lobbyId, next);
            await scheduleClock(lobbyId, next);
            io.to(lobbyId).emit('serverMove', { lobbyId, playerIdx, move, nextPlayer: next.currentPlayer,
                ...Clock.payload(next, Date.now()), state: publicGameState(next) });
            botManager.scheduleMoveIfNeeded(lobbyId, next);
            return true;
        });
    } catch (err) { console.error('[MOVE ERROR]', err); return reject('Server error; resynchronize'); }
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

const botManager = new BotManager({
    Shared,
    Redis,
    User,
    io,
    startBotGame,
    applyBotMove,
});

let botActivitySchedule = null;
let botPresenceManager = null;

async function collectPresenceStats() {
    const gameIds = await Redis.getActiveGameIds();
    const liveGames = [];

    for (const lobbyId of gameIds) {
        const game = await Redis.getGame(lobbyId);
        if (!game?.playerProfiles) continue;

        const player0Name = game.playerProfiles[0]?.name || 'Player';
        const player1Name = game.playerProfiles[1]?.name || 'Player';

        if (player0Name === 'admin-botops' || player1Name === 'admin-botops') continue;

        liveGames.push({
            lobbyId,
            players: [
                { name: player0Name },
                { name: player1Name },
            ],
        });
    }

    const humans = [];
    io.sockets.sockets.forEach((socket) => {
        if (socket.username === 'admin-botops') return;
        humans.push({
            name: socket.username || 'Guest',
            inQueue: Boolean(socket.searchToken),
        });
    });

    let botCount = 0;
    let botEntries = [];

    if (botPresenceManager) {
        botEntries = botPresenceManager.getOnlineBots();
        botCount = botEntries.length;
    }

    const base = {
        online: humans.length + botCount,
        playing: gameIds.length * 2,
        humans,
        bots: botEntries,
        liveGames,
    };

    return base;
}

function schedulePresenceBroadcast() {
    collectPresenceStats()
        .then((stats) => io.emit('onlineStats', stats))
        .catch((err) => console.error('[PRESENCE] Broadcast failed:', err));
}

io.on('connection', (socket) => {
    // --- SINGLE SESSION ENFORCEMENT ---
    if (socket.userId) {
        io.sockets.sockets.forEach((s) => {
            if (s.id !== socket.id && s.userId === socket.userId) {
                console.log(`[AUTH] Kicking old socket ${s.id} for user ${socket.username}`);
                s.emit('forceDisconnect', { reason: 'Logged in from another tab' });
                s.disconnect();
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

    // Online tracking for friends
    if (socket.userId) {
        User.findByIdAndUpdate(socket.userId, { online: true, lastSeen: new Date() }).catch(console.error);
        getAcceptedFriendIds(socket.userId).then(friendIds => {
            for (const fid of friendIds) {
                const fs = findSocketByUserId(fid);
                if (fs) fs.emit('friendOnline', { _id: socket.userId, username: socket.username });
            }
        }).catch(console.error);

        Notification.find({ recipient: socket.userId, read: false }).sort({ createdAt: -1 }).limit(20).lean()
            .then(notifs => {
                socket.emit('notifications:list', (notifs || []).map(n => publicNotification(n)));
            }).catch(console.error);
    }
    socket.on('disconnect', () => {
        rateLimits.delete(socket.id);
        schedulePresenceBroadcast();
    });

    // console.log(`[SOCKET] User connected: ${socket.id}`);

    collectPresenceStats()
        .then((stats) => socket.emit('onlineStats', stats))
        .catch(() => {
            socket.emit('onlineStats', { online: io.sockets.sockets.size, playing: 0, humans: [], bots: [], liveGames: [] });
        });
    schedulePresenceBroadcast();

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
            !Number.isFinite(tc.base) || !Number.isInteger(tc.base) ||
            !Number.isFinite(tc.inc) || !Number.isInteger(tc.inc) ||
            tc.base < MIN_BASE_SEC ||
            tc.base > MAX_BASE_SEC ||
            tc.inc < 0 ||
            tc.inc > MAX_INC_SEC || tc.mode === 'untimed'
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
        socket.searchToken = token;

        try {
            // Удаляем из всех очередей, если игрок там был (защита от дублей)
            await Redis.removeFromAllQueues(token);

            // Добавляем в очередь
            const isGuest = !socket.userId;
            const playerData = {
                socketId: socket.id,
                token: token,
                timeControl: tc,
                queuedAt: Date.now(),
                isGuest: isGuest
            };
            await Redis.addToQueue(tc.base, tc.inc, playerData, isRanked);
            if (socket.searchToken !== token) {
                await Redis.removeFromQueue(tc.base, tc.inc, token, isRanked);
                return;
            }
            // console.log(`[QUEUE] Player ${socket.id} joined queue [${tc.base}+${tc.inc}] (Ranked: ${isRanked})`);

            // Пробуем достать двух игроков
            const pair = await Redis.popTwoFromQueue(tc.base, tc.inc, isRanked);

            if (pair) {
                const [pA, pB] = pair;
                botManager.cancelFallback(pA.token);
                botManager.cancelFallback(pB.token);

                // Randomize White/Black
                const swap = Math.random() > 0.5;
                const p1 = swap ? pB : pA;
                const p2 = swap ? pA : pB;

                const lobbyId = await Redis.generateUniqueLobbyCode();

                const s1 = io.sockets.sockets.get(p1.socketId);
                const s2 = io.sockets.sockets.get(p2.socketId);

                if (s1 && s2) {
                    // Self-match prevention: reject if same authenticated user
                    if (s1.userId && s2.userId && s1.userId.toString() === s2.userId.toString()) {
                        console.log(`[MATCHMAKING] Rejected self-match: userId=${s1.userId}`);
                        // Return both to queue but notify second socket
                        await Redis.addToQueue(tc.base, tc.inc, p1, isRanked);
                        await Redis.addToQueue(tc.base, tc.inc, p2, isRanked);
                        botManager.scheduleFallback(s1, p1, isRanked);
                        botManager.scheduleFallback(s2, p2, isRanked);
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
                    prepareNewGame(gameState);
    await Redis.saveGame(lobbyId, gameState);
                    await Redis.addActiveGame(lobbyId);

                    // Устанавливаем таймер хода
                    await scheduleClock(lobbyId, gameState);

                    // Сохраняем маппинг токенов для Rejoin
                    await linkPlayersToLobbyByToken([p1.token, p2.token], lobbyId);
                    s1.searchToken = null;
                    s2.searchToken = null;

                    s1.join(lobbyId);
                    s2.join(lobbyId);
                    s1.emit('gameStart', {
                        lobbyId,
                        lobbyCode: lobbyId,
                        color: 'white',
                        opponent: gameState.playerProfiles[1], // Pass full profile
                        me: gameState.playerProfiles[0],
                        ...Clock.payload(gameState, Date.now())
                    });
                    s2.emit('gameStart', {
                        lobbyId,
                        lobbyCode: lobbyId,
                        color: 'black',
                        opponent: gameState.playerProfiles[0], // Pass full profile
                        me: gameState.playerProfiles[1],
                        ...Clock.payload(gameState, Date.now())
                    });
                    console.log(`[GAME START] Lobby ${lobbyId} created for ${tc.base}+${tc.inc}. Random Swap: ${swap}`);
                    schedulePresenceBroadcast();
                } else {
                    // Один из игроков отключился — возвращаем в очередь
                    if (s1) {
                        await Redis.addToQueue(tc.base, tc.inc, p1, isRanked);
                        botManager.scheduleFallback(s1, p1, isRanked);
                    }
                    if (s2) {
                        await Redis.addToQueue(tc.base, tc.inc, p2, isRanked);
                        botManager.scheduleFallback(s2, p2, isRanked);
                    }
                }
            } else {
                botManager.scheduleFallback(socket, playerData, isRanked);
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
                botManager.cancelFallback(token);
                if (socket.searchToken === token) socket.searchToken = null;
                // console.log(`[QUEUE] Player ${socket.id} left all queues`);
            }
        } catch (err) {
            console.error('[CANCEL SEARCH ERROR]', err);
        }
    });

    // --- ПРИВАТНЫЕ КОМНАТЫ ---
    socket.on('createRoom', async (data) => {
        if (!checkRateLimit(socket.id, 'createRoom', 5, 60000)) {
            socket.emit('error', { message: 'Too many requests. Please wait.' });
            return;
        }
        const token = data?.token || socket.playerToken;
        if (!isValidToken(token)) return;
        if (socket.searchToken === token) socket.searchToken = null;
        let roomControl;
        try { roomControl = Clock.control(data?.timeControl || { base: 600, inc: 0 }, true); }
        catch (_) { return socket.emit('error', { message: 'Invalid time control' }); }

        try {
            // Удаляем игрока из ВСЕХ очередей поиска, если он там был
            if (await isPlayerBusy(token)) return socket.emit('error', { message: 'Already in game' });
            if (socket.pendingRoom) await Redis.deleteRoom(socket.pendingRoom);
            await Redis.removeFromAllQueues(token);
            botManager.cancelFallback(token);

            const roomCode = await generateUniqueRoomCode();
            await Redis.createRoom(roomCode, {
                players: [{ socketId: socket.id, token: token }], timeControl: roomControl
            });

            socket.join(roomCode);
            socket.pendingRoom = roomCode;
            socket.emit('roomCreated', { roomCode, timeControl: roomControl });
            // console.log(`[ROOM] Created private room: ${roomCode} by ${socket.id}`);
        } catch (err) {
            console.error('[CREATE ROOM ERROR]', err);
            socket.emit('error', { message: 'Failed to create room' });
        }
    });

    socket.on('getRoomInfo', async (data, cb) => {
        if (typeof cb !== 'function' || !checkRateLimit(socket.id, 'roomInfo', 10, 60000)) return;
        const code = String(data?.roomCode || '').trim().toUpperCase();
        if (!Shared.isValidLobbyId(code)) return cb({ error: 'Invalid room code' });
        try {
            const room = await Redis.getRoom(code);
            cb(room ? { roomCode: code, timeControl: room.timeControl || { mode: 'timed', base: 600, inc: 0 } } : { error: 'Room not found' });
        } catch (_) { cb({ error: 'Room unavailable' }); }
    });

    socket.on('joinRoom', async (data) => {
        if (!checkRateLimit(socket.id, 'joinRoom', 5, 60000)) {
            socket.emit('joinRoomFailed', { reason: 'Too many requests. Please wait.' });
            return;
        }
        const { roomCode, token } = data;
        const playerToken = token || socket.playerToken;

        if (!isValidToken(playerToken) || !roomCode) {
            socket.emit('joinRoomFailed', { reason: 'Некорректные данные' });
            return;
        }

        const normalizedCode = roomCode.toUpperCase().trim();
        try {
          await withLobbyLock('room:' + normalizedCode, async () => {
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

            const agreed = room.timeControl || { mode: 'timed', base: 600, inc: 0 };
            if (agreed.mode === 'untimed' && !data.expectedTimeControl) {
                socket.emit('joinRoomFailed', { reason: 'Refresh the page to join a game without a timer.' }); return;
            }
            if (await isPlayerBusy(playerToken) || await isPlayerBusy(room.players[0].token)) {
                socket.emit('joinRoomFailed', { reason: 'Already in game' }); return;
            }
            if (data.expectedTimeControl && JSON.stringify(Clock.control(data.expectedTimeControl, true)) !== JSON.stringify(Clock.control(agreed, true))) {
                socket.emit('joinRoomFailed', { reason: 'Room settings changed. Please join again.' }); return;
            }
            room.players.push({ socketId: socket.id, token: playerToken });
            socket.join(normalizedCode);

            // console.log(`[ROOM] Player ${socket.id} joined room ${normalizedCode}`);

            if (room.players.length === 2) {
                // Randomize who goes first
                const isSwap = Math.random() > 0.5;
                const whitePlayer = isSwap ? room.players[1] : room.players[0];
                const blackPlayer = isSwap ? room.players[0] : room.players[1];

                const lobbyId = normalizedCode;

                const sWhite = io.sockets.sockets.get(whitePlayer.socketId);
                const sBlack = io.sockets.sockets.get(blackPlayer.socketId);

                if (sWhite && sBlack) {
                    sWhite.join(lobbyId);
                    sBlack.join(lobbyId);

                    const gameState = Shared.createInitialState(agreed);
                    gameState.playerSockets[0] = whitePlayer.socketId;
                    gameState.playerSockets[1] = blackPlayer.socketId;
                    gameState.playerTokens[0] = whitePlayer.token;
                    gameState.playerTokens[1] = blackPlayer.token;

                    // Fetch profiles
                    gameState.playerProfiles[0] = await getPlayerProfile(whitePlayer.token);
                    gameState.playerProfiles[1] = await getPlayerProfile(blackPlayer.token);

                    // Сохраняем в Redis
                    prepareNewGame(gameState, 'friend');
    await Redis.saveGame(lobbyId, gameState);
                    await Redis.addActiveGame(lobbyId);

                    // Устанавливаем таймер хода (по умолчанию 600 сек для приватных комнат)
                    await scheduleClock(lobbyId, gameState);

                    // Сохраняем маппинг токенов для Rejoin
                    await linkPlayersToLobbyByToken([whitePlayer.token, blackPlayer.token], lobbyId);

                    sWhite.emit('gameStart', {
                        lobbyId,
                        lobbyCode: lobbyId,
                        color: 'white',
                        opponent: gameState.playerProfiles[1],
                        me: gameState.playerProfiles[0], ...Clock.payload(gameState, Date.now())
                    });
                    sBlack.emit('gameStart', {
                        lobbyId,
                        lobbyCode: lobbyId,
                        color: 'black',
                        opponent: gameState.playerProfiles[0],
                        me: gameState.playerProfiles[1], ...Clock.payload(gameState, Date.now())
                    });

                    console.log(`[GAME START] Лобби ${lobbyId} создано из комнаты ${normalizedCode}. White: ${isSwap ? 'Joiner' : 'Creator'}`);
                    await Redis.deleteRoom(normalizedCode);
                    schedulePresenceBroadcast();
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
          });
        } catch (err) {
            console.error('[JOIN ROOM ERROR]', err);
            socket.emit('joinRoomFailed', { reason: 'Ошибка сервера' });
        }
    });

    // --- REJOIN GAME ---
    socket.on('rejoinGame', async data => {
        const token = data?.token;
        if (!isValidToken(token)) return;
        const lobbyId = await Redis.getLobbyByToken(token);
        if (lobbyId) await resumeGame(socket, lobbyId, token).catch(err => console.error('[RESUME]', err));
    });

    socket.on('rejoinLobby', async (data) => {
        if (!checkRateLimit(socket.id, 'rejoinLobby', 5, 60000)) {
            return;
        }
        const token = data?.token;
        const lobbyCode = (data?.lobbyCode || '').toUpperCase().trim();
        const isReplay = data?.replay === true;
        if (!isValidToken(token) || !Shared.isValidLobbyId(lobbyCode)) return;

        try {
            // 1. Сначала проверяем активную игру
            const game = await Redis.getGame(lobbyCode);
            if (game) {
                const pIdx = game.playerTokens.indexOf(token);
                if (pIdx === -1) {
                    // Игра активна, но токен не совпадает — блокируем доступ
                    socket.emit('gameActiveError', { lobbyCode });
                    return;
                }
                await resumeGame(socket, lobbyCode, token);
                return;
            }

            if (!isReplay && await resendGameOverIfFinished(socket, lobbyCode)) return;
            // Explicit replay visits remain available independently of active-game recovery.
            const finished = await Redis.getFinishedGame(lobbyCode);
            if (finished) {
                socket.emit('gameReplayAvailable', {
                    lobbyCode,
                    history: finished.history || [],
                    playerProfiles: finished.playerProfiles || [],
                    timers: finished.timers || null,
                    timeControl: finished.timeControl || null,
                    finalClock: Clock.snapshot(finished, Date.now()),
                    result: finished.endResult || finished.result || null
                });
                return;
            }

            // 3. Нет ни активной, ни finished — ищем в MongoDB
            const GameResult = require('./models/GameResult');
            const archived = await GameResult.findOne({ lobbyId: lobbyCode });
            if (archived) {
                socket.emit('gameReplayAvailable', {
                    lobbyCode,
                    history: archived.history || [],
                    playerProfiles: [
                        { username: archived.playerWhite?.username || 'White' },
                        { username: archived.playerBlack?.username || 'Black' }
                    ],
                    timers: null,
                    timeControl: archived.timeControl,
                    finalClock: archived.finalClock,
                    result: {
                        winnerIdx: archived.winner,
                        reason: archived.reason
                    }
                });
                return;
            }

            // 4. Ничего не нашли — пускаем в комнату как обычно
            return;
        } catch (err) {
            console.error('[REJOIN LOBBY ERROR]', err);
        }
    });


    // --- ОБРАБОТКА ХОДА (SERVER AUTHORITATIVE) ---
    socket.on('playerMove', async data => {
        if (!checkRateLimit(socket.id, 'move', 5, 1000)) return socket.emit('moveRejected', { reason: 'Too many moves' });
        await applyGameMove({ lobbyId: data?.lobbyId, token: socket.playerToken, move: data?.move, rejectSocket: socket });
    });

    socket.on('requestTimerSync', async (payload, cb) => {
        if (typeof cb !== 'function' || !Shared.isValidLobbyId(payload?.lobbyId)) return;
        try {
            const ok = await resumeGame(socket, payload.lobbyId);
            cb(ok ? { restored: true } : { unavailable: true });
        } catch (_) { cb({ error: 'Recovery failed' }); }
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
                if (game.finished === true) return;

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

    // Игрок сознательно покидает партию (ушёл в меню, сменил маршрут). Завершаем игру
    // как сдачу и отписываем сокет от лобби, чтобы просроченный gameOver не всплывал
    // уходящему игроку поверх главного меню. Иначе партия висела бы до таймаута.
    socket.on('leaveGame', async (data) => {
        if (!data || typeof data !== 'object') return;

        let lobbyId = data.lobbyId;
        if (!Shared.isValidLobbyId(lobbyId) && isValidToken(socket.playerToken)) {
            lobbyId = await Redis.getLobbyByToken(socket.playerToken);
        }
        if (!Shared.isValidLobbyId(lobbyId)) return;

        try {
            const game = await Redis.getGame(lobbyId);
            if (!game || game.finished === true) return;

            const leavingIdx = game.playerTokens.indexOf(socket.playerToken);
            if (leavingIdx === -1) return;

            // Отписываем сокет до финализации: gameOver этому игроку уже не нужен.
            socket.leave(lobbyId);
            await finalizeGame(lobbyId, 1 - leavingIdx, 'Surrender');
        } catch (err) {
            console.error('[LEAVE GAME ERROR]', err);
        }
    });

    // ==== EMOJI REACTIONS ====
    const ALLOWED_REACTIONS = [
      '😂', '😈', '🤭', '🙃', '😜',
      '😮', '🤯', '😱', '👀',
      '🔥', '💪', '🎯', '⚡', '👑',
      '😡', '😅', '🤦', '😤',
      '🤝', '👏', '🙌', '🥹',
      '🧱', '🏁', '⏱️'
    ];

    socket.on('sendReaction', async (data) => {
        if (!data || typeof data !== 'object') return;

        const { lobbyId, emoji } = data;
        if (!Shared.isValidLobbyId(lobbyId)) return;
        if (!ALLOWED_REACTIONS.includes(emoji)) return;
        if (!checkRateLimit(socket.id, 'reaction', 3, 10000)) return;

        try {
            const game = await Redis.getGame(lobbyId);
            if (!game) return;

            const playerIdx = game.playerTokens.indexOf(socket.playerToken);
            if (playerIdx === -1) return;

            io.to(lobbyId).emit('receiveReaction', { emoji, playerIdx });
        } catch (err) {
            console.error('[REACTION ERROR]', err);
        }
    });

    socket.on('requestRematch', async (data) => {
        if (!checkRateLimit(socket.id, 'requestRematch', 5, 10000)) {
            socket.emit('rematchFailed', { reason: 'Too many requests. Please wait.' });
            return;
        }

        const lobbyId = data?.lobbyId;
        const token = data?.token || socket.playerToken;
        if (!lobbyId || !token) {
            socket.emit('rematchFailed', { reason: 'Invalid request' });
            return;
        }

        try {
            let rematchCtx = await Redis.getRematchContext(lobbyId);
            if (!rematchCtx) {
                socket.emit('rematchFailed', { reason: 'Game not found for rematch' });
                return;
            }

            if (!rematchCtx.playerTokens.includes(token)) {
                socket.emit('rematchFailed', { reason: 'Not a player in this game' });
                return;
            }

            // Сбрасываем протухшее окно ожидания
            rematchCtx = await expireStaleRematchRequests(lobbyId, rematchCtx, rematchCtx.pending || []);

            // Уже ждём ответа — дубликаты игнорируем
            if ((rematchCtx.pending || []).includes(token)) {
                return;
            }

            const otherToken = rematchCtx.playerTokens.find(t => t !== token);
            const otherIdx = rematchCtx.playerTokens.indexOf(otherToken);

            // Снимаем собственный отказ (позволяем повторно позвать соперника)
            const declined = (rematchCtx.declined || []).filter(t => t !== token);
            const isFirst = !(rematchCtx.pending || []).length;

            if (isFirst) {
                // Соперник занят партией/поиском — сразу говорим ожидающему
                if (await isPlayerBusy(otherToken)) {
                    await Redis.saveRematchContext(lobbyId, { ...rematchCtx, pending: [], declined });
                    socket.emit('rematchDeclined', { reason: 'busy' });
                    return;
                }

                // Соперник не в сети — мгновенный отказ; нотификация сохраняется на TTL окна
                const otherSock = findSocketByToken(otherToken);
                if (!otherSock) {
                    await Redis.saveRematchContext(lobbyId, { ...rematchCtx, pending: [], declined });
                    socket.emit('rematchDeclined', { reason: 'offline' });
                    const otherUserId = rematchCtx.playerUserIds && rematchCtx.playerUserIds[otherIdx];
                    if (otherUserId) {
                        await createNotification(otherUserId, 'rematch_request',
                            rematchCtx.playerProfiles[1 - otherIdx].name + ' wants a rematch!',
                            '',
                            { requesterUsername: socket.username || null, gameId: lobbyId }
                        );
                    }
                    return;
                }
            }

            // Добавляем запрос
            const pending = [...(rematchCtx.pending || []), token];
            if (pending.length >= 2) {
                // Оба хотят реванш — запускаем
                await startRematchGame(lobbyId, rematchCtx);
                await Redis.deleteRematchContext(lobbyId);
                return;
            }

            await Redis.saveRematchContext(lobbyId, {
                ...rematchCtx,
                pending,
                declined,
                expiresAt: Date.now() + REMATCH_RESPONSE_WINDOW_MS
            });

            // Зовём соперника (тост + уведомление)
            const otherSock = findSocketByToken(otherToken);
            if (otherSock) {
                otherSock.emit('rematchInvite', {
                    lobbyId,
                    requesterName: rematchCtx.playerProfiles[1 - otherIdx].name
                });
                if (otherSock.userId) {
                    await createNotification(otherSock.userId, 'rematch_request',
                        rematchCtx.playerProfiles[1 - otherIdx].name + ' wants a rematch!',
                        '',
                        { requesterId: socket.userId, requesterUsername: socket.username, gameId: lobbyId }
                    );
                }
            }
        } catch (err) {
            console.error('[REMATCH ERROR]', err);
            socket.emit('rematchFailed', { reason: 'Server error' });
        }
    });

    socket.on('respondRematch', async (data) => {
        const lobbyId = data?.lobbyId;
        const token = data?.token || socket.playerToken;
        const accept = Boolean(data?.accept);
        if (!lobbyId || !token) {
            socket.emit('rematchFailed', { reason: 'Invalid request' });
            return;
        }

        try {
            let rematchCtx = await Redis.getRematchContext(lobbyId);
            if (!rematchCtx) {
                socket.emit('rematchFailed', { reason: 'Game not found for rematch' });
                return;
            }

            if (!rematchCtx.playerTokens.includes(token)) {
                socket.emit('rematchFailed', { reason: 'Not a player in this game' });
                return;
            }

            await expireStaleRematchRequests(lobbyId, rematchCtx, rematchCtx.pending || []);
            const freshCtx = rematchCtx.expiresAt && Date.now() >= rematchCtx.expiresAt
                ? await Redis.getRematchContext(lobbyId)
                : rematchCtx;
            rematchCtx = freshCtx || rematchCtx;

            const otherToken = rematchCtx.playerTokens.find(t => t !== token);
            const otherPending = (rematchCtx.pending || []).includes(otherToken);
            if (!otherPending) {
                socket.emit('rematchFailed', { reason: 'No rematch request in progress' });
                return;
            }

            const otherSock = findSocketByToken(otherToken);

            // Отказ
            if (!accept) {
                const declined = [...(rematchCtx.declined || []), token];
                await Redis.saveRematchContext(lobbyId, { ...rematchCtx, pending: [], declined, expiresAt: null });
                if (otherSock) otherSock.emit('rematchDeclined', { reason: 'declined' });
                return;
            }

            // Принятие — проверяем, что оба свободны
            const otherBusy = await isPlayerBusy(otherToken);
            const selfBusy = await isPlayerBusy(token);
            if (otherBusy || selfBusy) {
                await Redis.saveRematchContext(lobbyId, { ...rematchCtx, pending: [], declined: [] });
                socket.emit('rematchFailed', { reason: 'Rematch unavailable: a player is busy' });
                if (otherSock) otherSock.emit('rematchDeclined', { reason: 'busy' });
                return;
            }

            await startRematchGame(lobbyId, rematchCtx);
            await Redis.deleteRematchContext(lobbyId);
        } catch (err) {
            console.error('[REMATCH RESPOND ERROR]', err);
            socket.emit('rematchFailed', { reason: 'Server error' });
        }
    });

    // --- FRIENDS: INVITE TO GAME ---
    socket.on('inviteToGame', async ({ friendId }) => {
        if (!socket.userId) return;
        try {
            const friendship = await Friendship.findOne({
                $or: [
                    { requester: socket.userId, recipient: friendId },
                    { requester: friendId, recipient: socket.userId }
                ],
                status: 'accepted'
            });
            if (!friendship) return;

            await createNotification(friendId, 'game_invite',
                socket.username + ' invites you to play!',
                '',
                { requesterId: socket.userId, requesterUsername: socket.username, requesterAvatar: socket.avatarUrl || '' }
            );
        } catch (err) {
            console.error('[INVITE ERROR]', err);
        }
    });

    const pendingInviteAccepts = new Set();
    socket.on('acceptGameInvite', async ({ fromId, notificationId } = {}, ack) => {
        const respond = result => { if (typeof ack === 'function') ack(result); };
        const fail = reason => { socket.emit('inviteFailed', { reason }); respond({ ok: false, error: reason }); };
        if (!socket.userId) return fail('Sign in to accept invitations');
        if (typeof fromId !== 'string' || !/^[a-f0-9]{24}$/i.test(fromId)) return fail('Invalid invitation sender');
        if (pendingInviteAccepts.has(socket.userId)) return fail('Invitation is already being accepted');
        pendingInviteAccepts.add(socket.userId);
        try {
            const invitation = notificationId && /^[a-f0-9]{24}$/i.test(notificationId)
                ? await Notification.findOne({ _id: notificationId, recipient: socket.userId, type: 'game_invite', 'data.requesterId': fromId })
                : await Notification.findOne({ recipient: socket.userId, type: 'game_invite', 'data.requesterId': fromId, createdAt: { $gte: new Date(Date.now() - 120000) } }).sort({ createdAt: -1 });
            if (!invitation || !publicNotification(invitation).actionable) return fail('Invitation has expired or was already accepted');
            if (await isPlayerBusy(socket.playerToken)) return fail('You are already in a game');
            const friendship = await Friendship.findOne({
                $or: [
                    { requester: socket.userId, recipient: fromId },
                    { requester: fromId, recipient: socket.userId }
                ],
                status: 'accepted'
            });
            if (!friendship) return fail('This player is no longer in your friends list');

            const fromSocket = findSocketByUserId(fromId);
            if (!fromSocket) {
                return fail('Friend is offline');
            }

            if (socket.handshake.auth.clockVersion !== 2 || fromSocket.handshake.auth.clockVersion !== 2) {
                return fail('Both players must refresh the page before starting an untimed game.');
            }

            if (await isPlayerBusy(fromSocket.playerToken)) return fail('Friend is already in a game');
            let inviteStarted = false;
            const roomCode = await generateUniqueRoomCode();
            await Redis.createRoom(roomCode, {
                players: [{ socketId: fromSocket.id, token: fromSocket.playerToken }]
            });
            fromSocket.join(roomCode);
            fromSocket.emit('roomCreated', { roomCode, timeControl: { mode: 'untimed', base: null, inc: 0 } });

            // Second player joins
            const normalizedCode = roomCode;
            const room = await Redis.getRoom(normalizedCode);
            if (room && room.players.length < 2) {
                room.players.push({ socketId: socket.id, token: socket.playerToken });
                socket.join(normalizedCode);

                const isSwap = Math.random() > 0.5;
                const whitePlayer = isSwap ? room.players[1] : room.players[0];
                const blackPlayer = isSwap ? room.players[0] : room.players[1];

                const sWhite = io.sockets.sockets.get(whitePlayer.socketId);
                const sBlack = io.sockets.sockets.get(blackPlayer.socketId);

                if (sWhite && sBlack) {
                    sWhite.join(normalizedCode);
                    sBlack.join(normalizedCode);

                    const gameState = Shared.createInitialState({ mode: 'untimed' });
                    gameState.playerSockets[0] = whitePlayer.socketId;
                    gameState.playerSockets[1] = blackPlayer.socketId;
                    gameState.playerTokens[0] = whitePlayer.token;
                    gameState.playerTokens[1] = blackPlayer.token;
                    gameState.playerProfiles[0] = await getPlayerProfile(whitePlayer.token);
                    gameState.playerProfiles[1] = await getPlayerProfile(blackPlayer.token);

                    prepareNewGame(gameState, 'friend');
                    await Redis.saveGame(normalizedCode, gameState);
                    await Redis.addActiveGame(normalizedCode);
                    await scheduleClock(normalizedCode, gameState);
                    await linkPlayersToLobbyByToken([whitePlayer.token, blackPlayer.token], normalizedCode);

                    sWhite.emit('gameStart', {
                        lobbyId: normalizedCode, lobbyCode: normalizedCode,
                        color: 'white', opponent: gameState.playerProfiles[1], me: gameState.playerProfiles[0], ...Clock.payload(gameState, Date.now())
                    });
                    sBlack.emit('gameStart', {
                        lobbyId: normalizedCode, lobbyCode: normalizedCode,
                        color: 'black', opponent: gameState.playerProfiles[0], me: gameState.playerProfiles[1], ...Clock.payload(gameState, Date.now())
                    });

                    await Redis.deleteRoom(normalizedCode);
                    schedulePresenceBroadcast();
                    inviteStarted = true;
                }
            }
            if (!inviteStarted) {
                await Redis.deleteRoom(normalizedCode);
                return fail('A player disconnected before the game could start');
            }
            await Notification.updateOne({ _id: invitation._id }, { $set: { actionStatus: 'accepted' } });
            await notificationService.markRead(socket.userId, invitation._id);
            respond({ ok: true });
        } catch (err) {
            console.error('[ACCEPT INVITE ERROR]', err);
            fail('Could not accept the invitation. Please try again.');
        } finally { pendingInviteAccepts.delete(socket.userId); }
    });

    socket.on('disconnect', async () => {
        // console.log(`[SOCKET] User disconnected: ${socket.id}`);

        // Offline tracking for friends
        if (socket.userId) {
            User.findByIdAndUpdate(socket.userId, { online: false, lastSeen: new Date() }).catch(console.error);
            getAcceptedFriendIds(socket.userId).then(friendIds => {
                for (const fid of friendIds) {
                    const fs = findSocketByUserId(fid);
                    if (fs) fs.emit('friendOffline', { _id: socket.userId, username: socket.username });
                }
            }).catch(console.error);
        }

        try {
            // Remove from search queues
            if (socket.playerToken) {
                await Redis.removeFromAllQueues(socket.playerToken);
                botManager.cancelFallback(socket.playerToken);
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
                            await withLobbyLock(lobbyId, async () => {
                                const current = await Redis.getGame(lobbyId);
                                if (!current || current.finished || current.playerSockets[disconnectedIdx] !== socket.id) return;
                                current.playerSockets[disconnectedIdx] = null;
                                current.presence = current.presence || { disconnectedAt: [null, null] };
                                current.presence.disconnectedAt[disconnectedIdx] = Date.now();
                                await Redis.saveGame(lobbyId, current);
                                await updatePresenceDeadline(lobbyId, current);
                                io.to(lobbyId).emit('opponentDisconnected');
                            });
                        }
                    }
                }
            }
        } catch (err) {
            console.error('[DISCONNECT ERROR]', err);
        }
    });
});

function present(game, idx) {
    return botManager.isBotSlot(game, idx) || !!io.sockets.sockets.get(game.playerSockets[idx]);
}

async function updatePresenceDeadline(lobbyId, game) {
    const missing = [0, 1].filter(i => !present(game, i));
    if (!missing.length) { await Redis.clearDisconnectTimer(lobbyId); return; }
    game.presence = game.presence || { disconnectedAt: [null, null] };
    for (const i of missing) if (!game.presence.disconnectedAt[i]) game.presence.disconnectedAt[i] = Date.now();
    const grace = Clock.ensure(game).enabled ? 30000 : 120000;
    let until;
    if (missing.length === 2) {
        game.abandonedAt = game.abandonedAt || Date.now();
        until = Clock.deadline(game) ?? game.abandonedAt + 24 * 60 * 60 * 1000;
    } else until = game.presence.disconnectedAt[missing[0]] + grace;
    await Redis.saveGame(lobbyId, game);
    await Redis.setDisconnectTimer(lobbyId, Math.max(0, until - Date.now()));
}

async function handleDisconnectTimeout(lobbyId) {
    return withLobbyLock(lobbyId, async () => {
        const game = await Redis.getGame(lobbyId);
        if (!game || game.finished) { await Redis.clearDisconnectTimer(lobbyId); return; }
        if (Clock.expired(game, Date.now())) return finalizeGame(lobbyId, 1 - game.currentPlayer, 'Time out');
        const a = present(game, 0), b = present(game, 1);
        if (a && b) return Redis.clearDisconnectTimer(lobbyId);
        if (!a && !b) {
            if (game.abandonedAt && Date.now() - game.abandonedAt >= 86400000) return finalizeGame(lobbyId, -1, 'Abandoned');
            return updatePresenceDeadline(lobbyId, game);
        }
        const missing = a ? 1 : 0;
        const since = game.presence?.disconnectedAt[missing] ?? Date.now();
        const grace = Clock.ensure(game).enabled ? 30000 : 120000;
        if (Date.now() - since < grace) return updatePresenceDeadline(lobbyId, game);
        return finalizeGame(lobbyId, a ? 0 : 1, 'Opponent disconnected');
    });
}

async function handleTurnTimeout(lobbyId) {
    return withLobbyLock(lobbyId, async () => {
        const game = await Redis.getGame(lobbyId);
        if (!game || game.finished) { await Redis.clearTurnTimeout(lobbyId); return; }
        if (Clock.expired(game, Date.now())) return finalizeGame(lobbyId, 1 - game.currentPlayer, 'Time out');
        await scheduleClock(lobbyId, game);
    });
}

// --- ARCHIVE HELPER ---
async function archiveGame(game, winnerIdx, reason, lobbyId) {
    try {
        const whiteToken = game.playerTokens[0];
        const blackToken = game.playerTokens[1];

        const uid0 = await Redis.getUserIdByToken(whiteToken);
        const uid1 = await Redis.getUserIdByToken(blackToken);

        // Safety: reject bot-vs-bot games
        if (uid0 && uid1) {
            const [p0, p1] = await Promise.all([
                User.findById(uid0).select('isBot'),
                User.findById(uid1).select('isBot'),
            ]);
            if (p0 && p1 && p0.isBot && p1.isBot) {
                console.warn(`[BLOCKED] Bot-vs-bot game ${lobbyId} rejected`);
                return null;
            }
        }

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


        let gameType = game.gameMode === 'friend' || !game.timeControl ? 'friend' : (game.timeControl.base <= 120 ? 'bullet' : game.timeControl.base <= 420 ? 'blitz' : 'rapid');
        if (game.hasBot) gameType = 'bot';

        const result = new GameResult({
            gameType,
            timeControl: game.timeControl || { base: 600, inc: 0 },
            lobbyId,
            isRanked: !!game.isRanked,
            playerWhite,
            playerBlack,
            winner: winnerIdx,
            reason,
            turns: Math.ceil((game.history?.length || 0) / 2),
            history: game.history || [],
            date: new Date(),
            startedAt: game.startedAt ? new Date(game.startedAt) : null,
            finalClock: Clock.snapshot(game, Date.now()),
            participantTokenHashes: game.playerTokens.map(token => crypto.createHash('sha256').update(token).digest('hex'))
        });

        await result.save();
        console.log(`[ARCHIVE] Game ${lobbyId} saved (Ranked: ${!!game.isRanked})`);

        return {
            gameResultId: result._id,
            white: playerWhite,
            black: playerBlack
        };
    } catch (err) {
        console.error('[ARCHIVE ERROR]', err);
        return null;
    }
}

/**
 * Клиент мог пропустить gameOver (свернутая вкладка, потерянный реконнект).
 * Если игра уже завершена — переотправляем событие этому сокету напрямую.
 * Возвращает true, если событие было отправлено.
 */
async function resendGameOverIfFinished(socket, lobbyId, gameData) {
    const source = gameData || await Redis.getFinishedGame(lobbyId);
    if (!source || !Array.isArray(source.playerTokens)) {
        const query = GameResult.findOne({ lobbyId });
        const archived = await (query?.select ? query.select('+participantTokenHashes') : query);
        if (!archived) return false;
        const uid = socket.userId && String(socket.userId);
        const hash = crypto.createHash('sha256').update(socket.playerToken || '').digest('hex');
        const hashes = archived.participantTokenHashes || [];
        const allowed = (uid && [archived.playerWhite?.id, archived.playerBlack?.id].some(id => id && String(id) === uid)) || hashes.includes(hash);
        if (!allowed) return false;
        const myPlayerIndex = hashes.includes(hash) ? hashes.indexOf(hash) :
            [archived.playerWhite?.id, archived.playerBlack?.id].findIndex(id => id && String(id) === uid);
        socket.emit('gameOver', { lobbyId, winnerIdx: archived.winner, reason: archived.reason, gameResultId: archived._id,
            myPlayerIndex, profiles: [archived.playerWhite, archived.playerBlack],
            clock: archived.finalClock || null, timeControl: archived.timeControl, revision: archived.finalClock?.revision || 0 });
        return true;
    }
    if (!source.playerTokens.includes(socket.playerToken)) return false;

    let endResult = source.endResult || null;
    if (!endResult) {
        const finished = await Redis.getFinishedGame(lobbyId);
        endResult = (finished && finished.endResult) || null;
    }
    if (!endResult) {
        // Фолбэк: архив в MongoDB (игры, завершённые до появления endResult)
        try {
            const GameResult = require('./models/GameResult');
            const archived = await GameResult.findOne({ lobbyId });
            if (archived) {
                endResult = {
                    winnerIdx: archived.winner,
                    reason: archived.reason,
                    gameResultId: archived._id,
                    ratingChanges: null
                };
            }
        } catch (e) {
            console.error('[RESEND GAMEOVER ARCHIVE ERROR]', e.message);
        }
    }
    if (!endResult) return false;

    socket.emit('gameOver', {
        lobbyId,
        myPlayerIndex: source.playerTokens.indexOf(socket.playerToken), profiles: source.playerProfiles,
        winnerIdx: endResult.winnerIdx ?? -1,
        reason: endResult.reason || 'unknown',
        gameResultId: endResult.gameResultId || null,
        hasBot: !!source.hasBot,
        ratingChanges: endResult.ratingChanges || null,
        ...Clock.payload(source, Date.now())
    });
    return true;
}

// Unified Game End Handler
async function finalizeGame(lobbyId, winnerIdx, reason, stateOverride = null) {
    return withLobbyLock(lobbyId, () => finalizeGameLocked(lobbyId, winnerIdx, reason, stateOverride));
}

async function finalizeGameLocked(lobbyId, winnerIdx, reason, stateOverride = null) {
    const game = stateOverride || await Redis.getGame(lobbyId);

    if (!game || game.finished === true) return;

    // Идемпотентность: помечаем игру завершённой ДО долгих операций (архивация в БД),
    // чтобы конкурентный таймаут/дисконнект/двойной ход не заархивировал игру повторно
    // и не пересчитал рейтинг дважды (с разными победителями), обнуляя начисленные очки.
    if (reason !== 'Goal reached' && Clock.expired(game, Date.now())) {
        winnerIdx = 1 - game.currentPlayer; reason = 'Time out';
    }
    Clock.stop(game, reason === 'Goal reached' ? Clock.ensure(game).startedAt : Date.now());
    game.finished = true;
    await Redis.saveGame(lobbyId, game);

    botManager.cancelGame(lobbyId);

    // Clear timers immediately
    await Redis.clearDisconnectTimer(lobbyId);
    await Redis.clearTurnTimeout(lobbyId);

    // Archive and Calc Ratings
    const resultData = await archiveGame(game, winnerIdx, reason, lobbyId);

    const winnerName = winnerIdx === -1 ? 'Draw' : (winnerIdx === 0 ? 'White' : 'Black');
    console.log(`[GAME END] ${lobbyId}: Winner=${winnerName}, Reason=${reason}`);

    const ratingChanges = (resultData && game.isRanked) ? {
        playerWhite: resultData.white.ratingChange,
        playerBlack: resultData.black.ratingChange,
        newRatingWhite: resultData.white.newRating,
        newRatingBlack: resultData.black.newRating
    } : null;

    // Запоминаем результат на объекте игры: копия в saveFinishedGame сохранит его,
    // и requestTimerSync сможет переотправить gameOver сокету, пропустившему событие
    // в фоне (свернутая вкладка / потерянный реконнект).
    game.endResult = {
        winnerIdx: winnerIdx,
        reason: reason,
        gameResultId: resultData?.gameResultId || null,
        ratingChanges: ratingChanges,
        ...Clock.payload(game, Date.now())
    };

    io.to(lobbyId).emit('gameOver', {
        lobbyId,
        state: publicGameState(game),
        winnerIdx: winnerIdx,
        reason: reason,
        gameResultId: resultData?.gameResultId || null,
        hasBot: !!game.hasBot,
        ...game.endResult
    });

    // Save rematch context before deleting game data
    const rematchCtx = {
        playerTokens: game.playerTokens,
        playerSockets: game.playerSockets,
        playerProfiles: game.playerProfiles,
        playerUserIds: game.playerSockets.map((sid) => {
            const s = sid && io.sockets.sockets.get(sid);
            return s && s.userId ? String(s.userId) : null;
        }),
        timeControl: game.timeControl || { base: 600, inc: 0 },
        gameMode: game.gameMode || (game.isRanked ? 'ranked' : 'normal'),
        isRanked: !!game.isRanked,
        hasBot: !!game.hasBot,
        pending: [],
        declined: [],
        expiresAt: null
    };
    await Redis.saveRematchContext(lobbyId, rematchCtx);

    // Сохраняем завершённую игру для реплея (TTL 5 мин)
    await Redis.saveFinishedGame(lobbyId, game);

    await Redis.deleteGame(lobbyId);
    await Redis.removeActiveGame(lobbyId);
    await clearPlayersLobbyLinkByToken(game.playerTokens);
    if (game.hasBot && game.playerTokens?.[game.botPlayerIdx]) {
        await Redis.deleteTokenUserMapping(game.playerTokens[game.botPlayerIdx]);
    }

    schedulePresenceBroadcast();
}


async function startRematchGame(oldLobbyId, rematchCtx) {
    const swap = true;
    const p1 = { socketId: rematchCtx.playerSockets[swap ? 1 : 0], token: rematchCtx.playerTokens[swap ? 1 : 0] };
    const p2 = { socketId: rematchCtx.playerSockets[swap ? 0 : 1], token: rematchCtx.playerTokens[swap ? 0 : 1] };

    // Ищем актуальные сокеты (токен -> живой сокет), защита от реконнекта
    const s1 = findSocketByToken(p1.token) || io.sockets.sockets.get(p1.socketId) || null;
    const s2 = findSocketByToken(p2.token) || io.sockets.sockets.get(p2.socketId) || null;

    if (!s1 || !s2) {
        if (s1) s1.emit('rematchFailed', { reason: 'Opponent disconnected' });
        if (s2) s2.emit('rematchFailed', { reason: 'Opponent disconnected' });
        return;
    }

    // Проверяем, что оба игрока свободны (нет активной партии/поиска)
    const busy1 = await isPlayerBusy(p1.token);
    const busy2 = await isPlayerBusy(p2.token);
    if (busy1 || busy2) {
        s1.emit('rematchFailed', { reason: 'Rematch unavailable: a player is busy' });
        s2.emit('rematchFailed', { reason: 'Rematch unavailable: a player is busy' });
        return;
    }

    const lobbyId = await Redis.generateUniqueLobbyCode();

    const gameState = Shared.createInitialState(rematchCtx.timeControl, rematchCtx.isRanked);
    gameState.playerSockets[0] = s1.id;
    gameState.playerSockets[1] = s2.id;
    gameState.playerTokens[0] = p1.token;
    gameState.playerTokens[1] = p2.token;
    gameState.playerProfiles[0] = rematchCtx.playerProfiles[swap ? 1 : 0];
    gameState.playerProfiles[1] = rematchCtx.playerProfiles[swap ? 0 : 1];

    prepareNewGame(gameState, rematchCtx.gameMode);
    await Redis.saveGame(lobbyId, gameState);
    await Redis.addActiveGame(lobbyId);

    await scheduleClock(lobbyId, gameState);

    await linkPlayersToLobbyByToken([p1.token, p2.token], lobbyId);

    s1.join(lobbyId);
    s2.join(lobbyId);

    s1.emit('rematchStarted', {
        lobbyId,
        lobbyCode: lobbyId,
        color: 'white',
        opponent: gameState.playerProfiles[1],
        me: gameState.playerProfiles[0],
        ...Clock.payload(gameState, Date.now())
    });
    s2.emit('rematchStarted', {
        lobbyId,
        lobbyCode: lobbyId,
        color: 'black',
        opponent: gameState.playerProfiles[0],
        me: gameState.playerProfiles[1],
        ...Clock.payload(gameState, Date.now())
    });

    console.log(`[REMATCH] New game ${lobbyId} from rematch of ${oldLobbyId}`);
}

const PORT = process.env.PORT || 3000;

let pulseRunning = false;
const lastGameTouch = new Map();
async function runGamePulse() {
    if (pulseRunning || !server.listening) return;
    pulseRunning = true;
    try {
        for (const id of await Redis.getExpiredTurnTimeouts()) await handleTurnTimeout(id);
        for (const id of await Redis.getExpiredDisconnectTimers()) await handleDisconnectTimeout(id);
        for (const id of await Redis.getActiveGameIds()) {
            await withLobbyLock(id, async () => {
                const game = await Redis.getGame(id);
                if (!game) { await Redis.removeActiveGame(id); await Redis.clearTurnTimeout(id); await Redis.clearDisconnectTimer(id); lastGameTouch.delete(id); return; }
                if (game.finished) return;
                if (Clock.expired(game, Date.now())) return finalizeGame(id, 1 - game.currentPlayer, 'Time out');
                const missing = !present(game, 0) || !present(game, 1);
                if (missing && !(await Redis.hasDisconnectTimer(id))) await updatePresenceDeadline(id, game);
                else if (!missing) await Redis.clearDisconnectTimer(id);
                if (!missing && Date.now() - (lastGameTouch.get(id) || 0) > 60000) {
                    await Redis.saveGame(id, game);
                    for (let i = 0; i < 2; i++) {
                        const playerSocket = io.sockets.sockets.get(game.playerSockets[i]);
                        if (playerSocket?.userId) await Redis.setTokenUserMapping(game.playerTokens[i], playerSocket.userId);
                    }
                    await linkPlayersToLobbyByToken(game.playerTokens, id);
                    lastGameTouch.set(id, Date.now());
                }
                io.to(id).emit('timerUpdate', { lobbyId: id, ...Clock.payload(game, Date.now()) });
                botManager.scheduleMoveIfNeeded(id, game);
            });
        }
    } catch (err) { console.error('[CLOCK PULSE]', err); }
    finally { pulseRunning = false; }
}
if (process.env.NODE_ENV !== 'test') setInterval(runGamePulse, 1000);

// Broadcast online stats to all clients every 5 seconds (не в тестах)
if (process.env.NODE_ENV !== 'test') setInterval(() => {
    schedulePresenceBroadcast();
}, 5000);

// Инициализация Redis и запуск сервера
/**
 * Очистка "зомби-игр" при старте сервера.
 * Удаляет игры, у которых оба игрока offline (нет активных сокетов).
 */
async function cleanupStaleGames() {
    // Old socket IDs are never evidence that a persisted game is disposable.
    for (const id of await Redis.getActiveGameIds()) {
        await withLobbyLock(id, async () => {
            const game = await Redis.getGame(id);
            if (!game) { await Redis.removeActiveGame(id); await Redis.clearTurnTimeout(id); await Redis.clearDisconnectTimer(id); return; }
            if (game.finished) return;
            game.playerSockets = [null, null];
            game.presence = { disconnectedAt: [Date.now(), Date.now()] };
            await Redis.saveGame(id, game);
            await scheduleClock(id, game);
            await updatePresenceDeadline(id, game);
            botManager.scheduleMoveIfNeeded(id, game);
        });
    }
}

async function startServer() {
    try {
        await connectDB();
        const notificationPulse = async () => {
            try { await notificationService.drain(); await notificationService.deliverEmails(); }
            catch (_) { console.error('[NOTIFICATION] Background delivery deferred'); }
        };
        notificationPulse();
        setInterval(notificationPulse, 15000).unref();

        await Redis.connect();

        await sessionRedisClient.connect();
        console.log('[STARTUP] Session store (Redis) connected successfully');

        await applyPersistedBotSettings();
        console.log('[STARTUP] Loaded bot settings from MongoDB');

        // Очистка зомби-игр при старте (удаляет только игры с обоими offline игроками)


        // Sync all bot population (120 bots)
        const popResult = await syncBotPopulation(User);
        console.log(`[POPULATION] Synced bot population: created=${popResult.created} updated=${popResult.updated}`);

        // Recalculate bot ratings from actual game history
        // Rating maintenance is best effort at startup; the admin operation reports failures.
        await recalculateBotRatings().catch(err => console.error('[STARTUP] Bot rating maintenance failed:', err.message));

        // Initialize bot presence manager for realistic online/offline
        const allBotDocs = await User.find({ isBot: true }).select('_id username');
        if (allBotDocs.length >= 2) {
            botPresenceManager = new BotPresenceManager(allBotDocs);
            botPresenceManager.start();
            console.log(`[PRESENCE] Started bot presence manager with ${allBotDocs.length} bots`);
        } else {
            console.log('[PRESENCE] Skipped — need >=2 bots in DB');
        }

        // Запускаем HTTP сервер
        const port = process.env.PORT || 3000;
        const env = process.env.NODE_ENV || 'development';
        await cleanupStaleGames();
        server.listen(port, '0.0.0.0', async () => {
            log.server('Server started on port %d (env=%s)', port, env);


        });
    } catch (err) {
        console.error('[STARTUP ERROR] Failed to connect:', err);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('[SHUTDOWN] Received SIGTERM, shutting down gracefully...');
    if (botPresenceManager) botPresenceManager.stop();
    await Redis.disconnect();
    await sessionRedisClient.quit();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('[SHUTDOWN] Received SIGINT, shutting down gracefully...');
    if (botPresenceManager) botPresenceManager.stop();
    await Redis.disconnect();
    await sessionRedisClient.quit();
    process.exit(0);
});

// Экспорт для тестов
module.exports = { app, server, io, startServer, clearSessionVersionCache, clearLeaderboardCache, clearSitemapCache, runGamePulse, cleanupStaleGames, applyGameMove, resumeGame, handleTurnTimeout, handleDisconnectTimeout, applyPersistedBotSettings };

// Запуск (если не тесты)
if (process.env.NODE_ENV !== 'test') {
    startServer();
}
