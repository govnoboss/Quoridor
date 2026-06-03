require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const Sentry = require('@sentry/node');
const Shared = require('./core/shared.js');
const Redis = require('./storage/redis.js');
const BotManager = require('./bots/BotManager');
const log = require('./utils/logger');
const { sendPasswordResetEmail } = require('./utils/mailer');
const Report = require('./models/Report');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const app = express();
app.set('trust proxy', 1);

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

Sentry.init({
    dsn: process.env.SENTRY_DSN || '',
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.5 : 0.0,
    enabled: !!process.env.SENTRY_DSN,
});

if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

app.disable('x-powered-by');

// --- DATABASE & AUTH SETUP ---
const connectDB = require('./storage/db');
const User = require('./models/User');
const GameResult = require('./models/GameResult'); // Архив игр
const BotSettings = require('./models/BotSettings');
const { ACCOUNT_BOTS } = require('./bots/defaultBots');
const { upsertAccountBot } = require('./bots/botSeed');

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const redisPkg = require('redis');
const session = require('express-session');
const { RedisStore } = require('connect-redis');
const path = require('path');

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

// --- HTTP RATE LIMITING ---
const rateLimit = require('express-rate-limit');

// Auth rate limiter: 20 requests per 15 minutes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 20, // Максимум 20 запросов
    message: { error: 'Too many requests. Try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Apply to auth routes
app.use('/api/auth/', authLimiter);

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

        const newUser = new User({ username, email: trimmedEmail, passwordHash });
        await newUser.save();

        // Auto login
        req.session.userId = newUser._id;
        req.session.username = newUser.username;

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

async function requireAdmin(req, res, next) {
    if (!req.session?.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const user = await resolveUserById(req.session.userId, 'username isAdmin');
        if (!user?.isAdmin) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        req.adminUser = user;
        next();
    } catch (err) {
        console.error('[ADMIN] Auth check failed:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

function botSettingsFromEnv() {
    return {
        key: 'global',
        enabled: ['1', 'true', 'yes', 'on'].includes(String(process.env.BOTS_ENABLED || 'false').toLowerCase()),
        rankedEnabled: ['1', 'true', 'yes', 'on'].includes(String(process.env.BOT_RANKED_ENABLED || 'false').toLowerCase()),
        fallbackMinWaitMs: parseInt(process.env.BOT_FALLBACK_MIN_WAIT_MS, 10) || 15000,
        fallbackMaxWaitMs: parseInt(process.env.BOT_FALLBACK_MAX_WAIT_MS, 10) || 25000,
        maxActiveGames: parseInt(process.env.BOT_MAX_ACTIVE_GAMES, 10) || 15,
        moveMinDelayMs: parseInt(process.env.BOT_MOVE_MIN_DELAY_MS, 10) || 800,
        moveMaxDelayMs: parseInt(process.env.BOT_MOVE_MAX_DELAY_MS, 10) || 2500,
        maxRecentMatches: parseInt(process.env.BOT_MAX_RECENT_MATCHES, 10) || 3,
        recentWindowMs: parseInt(process.env.BOT_RECENT_WINDOW_MS, 10) || 3600000,
    };
}

function sanitizeBotSettings(input) {
    const defaults = botSettingsFromEnv();
    const minWait = Math.max(0, parseInt(input.fallbackMinWaitMs ?? defaults.fallbackMinWaitMs, 10));
    const maxWait = Math.max(minWait, parseInt(input.fallbackMaxWaitMs ?? defaults.fallbackMaxWaitMs, 10));
    const minMoveDelay = Math.max(0, parseInt(input.moveMinDelayMs ?? defaults.moveMinDelayMs, 10));
    const maxMoveDelay = Math.max(minMoveDelay, parseInt(input.moveMaxDelayMs ?? defaults.moveMaxDelayMs, 10));

    return {
        key: 'global',
        enabled: Boolean(input.enabled),
        rankedEnabled: Boolean(input.rankedEnabled),
        fallbackMinWaitMs: minWait,
        fallbackMaxWaitMs: maxWait,
        maxActiveGames: Math.max(0, parseInt(input.maxActiveGames ?? defaults.maxActiveGames, 10)),
        moveMinDelayMs: minMoveDelay,
        moveMaxDelayMs: maxMoveDelay,
        maxRecentMatches: Math.max(0, parseInt(input.maxRecentMatches ?? defaults.maxRecentMatches, 10)),
        recentWindowMs: Math.max(60000, parseInt(input.recentWindowMs ?? defaults.recentWindowMs, 10)),
    };
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

async function getOrCreateBotSettings() {
    let settings = await BotSettings.findOne({ key: 'global' });
    const envDefaults = botSettingsFromEnv();
    if (!settings) {
        settings = new BotSettings(envDefaults);
        await settings.save();
    } else {
        let changed = false;
        if (process.env.BOTS_ENABLED !== undefined) {
            const envEnabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.BOTS_ENABLED).toLowerCase());
            if (settings.enabled !== envEnabled) {
                settings.enabled = envEnabled;
                changed = true;
            }
        }
        if (process.env.BOT_RANKED_ENABLED !== undefined) {
            const envRanked = ['1', 'true', 'yes', 'on'].includes(String(process.env.BOT_RANKED_ENABLED).toLowerCase());
            if (settings.rankedEnabled !== envRanked) {
                settings.rankedEnabled = envRanked;
                changed = true;
            }
        }
        if (process.env.BOT_FALLBACK_MIN_WAIT_MS !== undefined) {
            const envMinWait = parseInt(process.env.BOT_FALLBACK_MIN_WAIT_MS, 10);
            if (!isNaN(envMinWait) && settings.fallbackMinWaitMs !== envMinWait) {
                settings.fallbackMinWaitMs = envMinWait;
                changed = true;
            }
        }
        if (process.env.BOT_FALLBACK_MAX_WAIT_MS !== undefined) {
            const envMaxWait = parseInt(process.env.BOT_FALLBACK_MAX_WAIT_MS, 10);
            if (!isNaN(envMaxWait) && settings.fallbackMaxWaitMs !== envMaxWait) {
                settings.fallbackMaxWaitMs = envMaxWait;
                changed = true;
            }
        }
        if (changed) {
            await settings.save();
        }
    }
    return settings;
}

async function applyPersistedBotSettings() {
    const settings = await getOrCreateBotSettings();
    botManager.setRuntimeConfig(settingsForBotManager(settings));
    return settings;
}

async function seedBotAccounts(password = null) {
    const passwordHash = await bcrypt.hash(
        password || process.env.BOT_ACCOUNT_PASSWORD || `bot-${Date.now()}-${Math.random()}`,
        10
    );
    const result = { created: 0, updated: 0 };

    for (const bot of ACCOUNT_BOTS) {
        const action = await upsertAccountBot(User, bot, passwordHash);
        if (action === 'created') result.created++;
        else result.updated++;
    }

    return result;
}

app.get('/admin/bots', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/admin-bots.html'));
});

app.get('/api/admin/bots', requireAdmin, async (req, res) => {
    try {
        const settings = await getOrCreateBotSettings();
        botManager.setRuntimeConfig(settingsForBotManager(settings));

        const bots = await User.find({ isBot: true });
        res.json({
            settings,
            runtime: botManager.getRuntimeStats(),
            bots: bots.map(bot => ({
                id: bot._id,
                username: bot.username,
                rating: bot.rating,
                avatarUrl: bot.avatarUrl,
                country: bot.country,
                stats: bot.stats || {},
            })),
        });
    } catch (err) {
        console.error('[ADMIN] Failed to load bot panel data:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/admin/bots/settings', requireAdmin, async (req, res) => {
    try {
        const nextSettings = sanitizeBotSettings(req.body || {});
        nextSettings.updatedBy = req.adminUser._id;

        const settings = await BotSettings.findOneAndUpdate(
            { key: 'global' },
            { $set: nextSettings },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        botManager.setRuntimeConfig(settingsForBotManager(settings));
        res.json({ settings, runtime: botManager.getRuntimeStats() });
    } catch (err) {
        console.error('[ADMIN] Failed to update bot settings:', err);
        res.status(500).json({ error: 'Server error' });
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

// --- PROFILE API ---

// Public Profile Data
app.get('/api/profiles/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const user = await User.findOne({ username }).select('-passwordHash -__v -email -isBot -isAdmin');

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

// Leaderboard API - top humans and bot accounts by rating
app.get('/api/leaderboard', async (req, res) => {
    try {
        const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 8));
        const topPlayers = await User.find({ isAdmin: { $ne: true }, isBot: { $ne: true } })
            .select('username rating avatarUrl isBot')
            .sort({ rating: -1 })
            .limit(limit);
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

app.get('/lobby/:lobbyCode', (req, res) => {
    const { lobbyCode } = req.params;
    if (!Shared.isValidLobbyId((lobbyCode || '').toUpperCase())) {
        return res.redirect('/');
    }
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
        "script-src": ["'self'", "'unsafe-inline'", "https://cdn.socket.io", "https://analytics.playquor.org", "https://static.cloudflareinsights.com"],
        "script-src-attr": ["'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "https://ui-avatars.com"],
        "media-src": ["'self'", "data:"],
        "connect-src": ["'self'", "ws:", "wss:", "http:", "https:", "https://cdn.socket.io", "https://analytics.playquor.org"]
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
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    credentials: true
}));

// Serve static files
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/shared.js', express.static(path.join(__dirname, 'core/shared.js')));
app.use('/js/ai-core.js', express.static(path.join(__dirname, 'core/ai-core.js')));

// Standalone pages (not SPA)
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../frontend/login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, '../frontend/register.html')));
app.get('/forgot-password', (req, res) => res.sendFile(path.join(__dirname, '../frontend/forgot-password.html')));
app.get('/reset-password', (req, res) => res.sendFile(path.join(__dirname, '../frontend/reset-password.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, '../frontend/terms.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, '../frontend/privacy.html')));
app.get('/report', (req, res) => res.sendFile(path.join(__dirname, '../frontend/report.html')));
app.get('/admin/reports', requireAdmin, (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin-reports.html')));

// --- BUG REPORT API ---

const reportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { error: 'Too many reports. Try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.post('/api/reports', reportLimiter, async (req, res) => {
    try {
        const { subject, description, contact } = req.body;
        if (!subject || subject.trim().length < 3) {
            return res.status(400).json({ error: 'Subject must be at least 3 characters' });
        }
        if (!description || description.trim().length < 10) {
            return res.status(400).json({ error: 'Description must be at least 10 characters' });
        }

        const report = await Report.create({
            subject: subject.trim(),
            description: description.trim(),
            contact: (contact || '').trim(),
            ip: req.ip || req.connection?.remoteAddress || ''
        });

        res.status(201).json({ message: 'Report submitted' });
    } catch (e) {
        console.error('[REPORT] Create error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/reports', requireAdmin, async (req, res) => {
    try {
        const reports = await Report.find().sort({ createdAt: -1 }).lean();
        res.json(reports);
    } catch (e) {
        console.error('[REPORT] List error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.patch('/api/admin/reports/:id', requireAdmin, async (req, res) => {
    try {
        const { status } = req.body;
        if (!['new', 'in_progress', 'closed'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        const report = await Report.findByIdAndUpdate(
            req.params.id,
            { status },
            { new: true }
        );
        if (!report) return res.status(404).json({ error: 'Report not found' });
        res.json(report);
    } catch (e) {
        console.error('[REPORT] Update error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// SPA fallback — serve index.html for any unrecognized GET route
app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
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
        methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
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
        socket.userId = session.userId;
        socket.username = session.username;
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

async function startBotGame(socket, humanPlayer, bot, isRanked) {
    const swap = Math.random() > 0.5;
    const humanIdx = swap ? 1 : 0;
    const botIdx = 1 - humanIdx;

    const lobbyId = await Redis.generateUniqueLobbyCode();

    const gameState = Shared.createInitialState(humanPlayer.timeControl, isRanked);
    gameState.hasBot = true;
    gameState.botPlayerIdx = botIdx;
    gameState.botDifficulty = bot.difficulty || 'medium';

    gameState.playerSockets[humanIdx] = socket.id;
    gameState.playerSockets[botIdx] = null;
    gameState.playerTokens[humanIdx] = humanPlayer.token;
    gameState.playerTokens[botIdx] = bot.token;
    gameState.playerProfiles[humanIdx] = await getPlayerProfile(humanPlayer.token);
    gameState.playerProfiles[botIdx] = bot.profile;
    socket.searchToken = null;

    await Redis.saveGame(lobbyId, gameState);
    await Redis.addActiveGame(lobbyId);
    await Redis.setTurnTimeout(lobbyId, Date.now() + gameState.timers[gameState.currentPlayer] * 1000);
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
        initialTime: gameState.timers[humanIdx]
    });

    botManager.scheduleMoveIfNeeded(lobbyId, gameState);
    console.log(`[BOT] Started fallback game ${lobbyId} (${isRanked ? 'ranked' : 'casual'}, bot=${gameState.botDifficulty})`);
    schedulePresenceBroadcast();
    return lobbyId;
}

async function applyBotMove(lobbyId, token, move) {
    return await applyGameMove({ lobbyId, token, move });
}

async function applyGameMove({ lobbyId, token, move, rejectSocket = null }) {
    if (!Shared.isValidLobbyId(lobbyId)) {
        if (rejectSocket) rejectSocket.emit('moveRejected', { reason: 'Invalid lobby format' });
        return false;
    }

    if (!Shared.isValidMove(move)) {
        if (rejectSocket) rejectSocket.emit('moveRejected', { reason: 'Invalid move format' });
        return false;
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
        if (rejectSocket) rejectSocket.emit('moveRejected', { reason: 'Room busy' });
        return false;
    }

    try {
        const game = await Redis.getGame(lobbyId);

        if (!game) {
            if (rejectSocket) rejectSocket.emit('moveRejected', { reason: 'Game not found' });
            return false;
        }

        const playerIdx = game.playerTokens.indexOf(token);
        if (playerIdx === -1) {
            if (rejectSocket) rejectSocket.emit('moveRejected', { reason: 'Unauthorized' });
            return false;
        }

        const now = Date.now();
        const elapsed = Math.floor((now - game.lastMoveTimestamp) / 1000);
        game.timers[game.currentPlayer] -= elapsed;
        game.lastMoveTimestamp = now;

        if (game.timers[game.currentPlayer] < 0) {
            await finalizeGame(lobbyId, 1 - game.currentPlayer, 'Time out');
            return true;
        }

        try {
            const action = { ...move, playerIdx };
            const nextState = Shared.gameReducer(game, action);

            if (nextState.increment > 0) {
                nextState.timers[playerIdx] += nextState.increment;
            }

            const winnerIdx = checkVictory(nextState);
            if (winnerIdx !== -1) {
                await finalizeGame(lobbyId, winnerIdx, 'Goal reached', nextState);
                return true;
            }

            await Redis.saveGame(lobbyId, nextState);
            await Redis.setTurnTimeout(lobbyId, Date.now() + nextState.timers[nextState.currentPlayer] * 1000);

            io.to(lobbyId).emit('serverMove', {
                playerIdx,
                move,
                nextPlayer: nextState.currentPlayer,
                timers: nextState.timers
            });

            botManager.scheduleMoveIfNeeded(lobbyId, nextState);
            return true;
        } catch (reducerError) {
            console.log(`[MOVE REJECTED] Lobby ${lobbyId}: ${reducerError.message}`);
            if (rejectSocket) rejectSocket.emit('moveRejected', { reason: reducerError.message });
            return false;
        }
    } catch (err) {
        console.error('[PLAYER MOVE ERROR]', err);
        if (rejectSocket) rejectSocket.emit('moveRejected', { reason: 'Server error' });
        return false;
    } finally {
        await Redis.releaseLock(lobbyId);
    }
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
                {
                    name: player0Name,
                    isBot: Boolean(game.hasBot && game.botPlayerIdx === 0),
                },
                {
                    name: player1Name,
                    isBot: Boolean(game.hasBot && game.botPlayerIdx === 1),
                },
            ],
        });
    }

    const humans = [];
    io.sockets.sockets.forEach((socket) => {
        if (socket.username === 'admin-botops') return;
        humans.push({
            name: socket.username || 'Guest',
            isBot: false,
            inQueue: Boolean(socket.searchToken),
        });
    });

    return {
        online: humans.length,
        playing: gameIds.length * 2,
        humans,
        bots: [],
        liveGames,
    };
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

    // Очистка памяти при отключении
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
        socket.searchToken = token;

        try {
            // Удаляем из всех очередей, если игрок там был (защита от дублей)
            await Redis.removeFromAllQueues(token);

            // Добавляем в очередь
            const playerData = {
                socketId: socket.id,
                token: token,
                timeControl: tc,
                queuedAt: Date.now()
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
                    await Redis.saveGame(lobbyId, gameState);
                    await Redis.addActiveGame(lobbyId);

                    // Устанавливаем таймер хода
                    const timeoutAt = Date.now() + gameState.timers[0] * 1000;
                    await Redis.setTurnTimeout(lobbyId, timeoutAt);

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
                        initialTime: gameState.timers[0]
                    });
                    s2.emit('gameStart', {
                        lobbyId,
                        lobbyCode: lobbyId,
                        color: 'black',
                        opponent: gameState.playerProfiles[0], // Pass full profile
                        me: gameState.playerProfiles[1],
                        initialTime: gameState.timers[1]
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
        const token = data?.token || socket.playerToken;
        if (!isValidToken(token)) return;
        if (socket.searchToken === token) socket.searchToken = null;

        try {
            // Удаляем игрока из ВСЕХ очередей поиска, если он там был
            await Redis.removeFromAllQueues(token);
            botManager.cancelFallback(token);

            const roomCode = await generateUniqueRoomCode();
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

                const lobbyId = normalizedCode;

                const sWhite = io.sockets.sockets.get(whitePlayer.socketId);
                const sBlack = io.sockets.sockets.get(blackPlayer.socketId);

                if (sWhite && sBlack) {
                    sWhite.join(lobbyId);
                    sBlack.join(lobbyId);

                    const gameState = Shared.createInitialState({ base: 600, inc: 0 }); // Default for private rooms
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
                    await linkPlayersToLobbyByToken([whitePlayer.token, blackPlayer.token], lobbyId);

                    sWhite.emit('gameStart', {
                        lobbyId,
                        lobbyCode: lobbyId,
                        color: 'white',
                        opponent: gameState.playerProfiles[1],
                        me: gameState.playerProfiles[0]
                    });
                    sBlack.emit('gameStart', {
                        lobbyId,
                        lobbyCode: lobbyId,
                        color: 'black',
                        opponent: gameState.playerProfiles[0],
                        me: gameState.playerProfiles[1]
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
                    lobbyCode: lobbyId,
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

    socket.on('rejoinLobby', async (data) => {
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
                // Свой игрок переподключается — пускаем
                game.playerSockets[pIdx] = socket.id;
                socket.join(lobbyCode);
                await Redis.saveGame(lobbyCode, game);
                socket.emit('gameResumed', {
                    lobbyId: lobbyCode,
                    lobbyCode,
                    color: pIdx === 0 ? 'white' : 'black',
                    myPlayerIndex: pIdx,
                    state: game,
                    timers: game.timers,
                    profiles: game.playerProfiles
                });
                return;
            }

            // 2. Активной игры нет — проверяем finished-копию (TTL 5 мин)
            const finished = await Redis.getFinishedGame(lobbyCode);
            if (finished) {
                socket.emit('gameReplayAvailable', {
                    lobbyCode,
                    history: finished.history || [],
                    playerProfiles: finished.playerProfiles || [],
                    timers: finished.timers || null,
                    result: finished.result || null
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
                botManager.scheduleMoveIfNeeded(lobbyId, nextState);

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

    socket.on('requestRematch', async (data) => {
        const lobbyId = data?.lobbyId;
        const token = data?.token || socket.playerToken;
        if (!lobbyId || !token) {
            socket.emit('rematchFailed', { reason: 'Invalid request' });
            return;
        }

        try {
            const rematchCtx = await Redis.getRematchContext(lobbyId);
            if (!rematchCtx) {
                socket.emit('rematchFailed', { reason: 'Game not found for rematch' });
                return;
            }

            if (!rematchCtx.playerTokens.includes(token)) {
                socket.emit('rematchFailed', { reason: 'Not a player in this game' });
                return;
            }

            if (!rematchCtx.rematchRequests.includes(token)) {
                rematchCtx.rematchRequests.push(token);
            }

            if (rematchCtx.rematchRequests.length >= 2) {
                await startRematchGame(lobbyId, rematchCtx);
                await Redis.deleteRematchContext(lobbyId);
            } else {
                await Redis.saveRematchContext(lobbyId, rematchCtx);
                const otherSocketId = rematchCtx.playerSockets[
                    rematchCtx.playerTokens.indexOf(
                        rematchCtx.playerTokens.find(t => t !== token)
                    )
                ];
                if (otherSocketId) {
                    io.to(otherSocketId).emit('opponentWantsRematch');
                }
            }
        } catch (err) {
            console.error('[REMATCH ERROR]', err);
            socket.emit('rematchFailed', { reason: 'Server error' });
        }
    });

    socket.on('disconnect', async () => {
        // console.log(`[SOCKET] User disconnected: ${socket.id}`);

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
        const s0 = botManager.isBotSlot(game, 0) ? true : io.sockets.sockets.get(game.playerSockets[0]);
        const s1 = botManager.isBotSlot(game, 1) ? true : io.sockets.sockets.get(game.playerSockets[1]);

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
            await clearPlayersLobbyLinkByToken(game.playerTokens);
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
        if (game.hasBot) gameType = 'bot';

        const result = new GameResult({
            gameType,
            lobbyId,
            isRanked: !!game.isRanked,
            playerWhite,
            playerBlack,
            winner: winnerIdx,
            reason,
            turns: Math.ceil((game.history?.length || 0) / 2),
            history: game.history || [],
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
        botManager.cancelGame(lobbyId);

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

        // Save rematch context before deleting game data
        const rematchCtx = {
            playerTokens: game.playerTokens,
            playerSockets: game.playerSockets,
            playerProfiles: game.playerProfiles,
            timeControl: game.timeControl || { base: 600, inc: 0 },
            isRanked: !!game.isRanked,
            rematchRequests: []
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
}


async function startRematchGame(oldLobbyId, rematchCtx) {
    const swap = true;
    const p1 = { socketId: rematchCtx.playerSockets[swap ? 1 : 0], token: rematchCtx.playerTokens[swap ? 1 : 0] };
    const p2 = { socketId: rematchCtx.playerSockets[swap ? 0 : 1], token: rematchCtx.playerTokens[swap ? 0 : 1] };

    const s1 = io.sockets.sockets.get(p1.socketId);
    const s2 = io.sockets.sockets.get(p2.socketId);

    if (!s1 || !s2) {
        if (s1) s1.emit('rematchFailed', { reason: 'Opponent disconnected' });
        if (s2) s2.emit('rematchFailed', { reason: 'Opponent disconnected' });
        return;
    }

    const lobbyId = await Redis.generateUniqueLobbyCode();

    const gameState = Shared.createInitialState(rematchCtx.timeControl, rematchCtx.isRanked);
    gameState.playerSockets[0] = p1.socketId;
    gameState.playerSockets[1] = p2.socketId;
    gameState.playerTokens[0] = p1.token;
    gameState.playerTokens[1] = p2.token;
    gameState.playerProfiles[0] = rematchCtx.playerProfiles[swap ? 1 : 0];
    gameState.playerProfiles[1] = rematchCtx.playerProfiles[swap ? 0 : 1];

    await Redis.saveGame(lobbyId, gameState);
    await Redis.addActiveGame(lobbyId);

    const timeoutAt = Date.now() + gameState.timers[0] * 1000;
    await Redis.setTurnTimeout(lobbyId, timeoutAt);

    await linkPlayersToLobbyByToken([p1.token, p2.token], lobbyId);

    s1.join(lobbyId);
    s2.join(lobbyId);

    s1.emit('rematchStarted', {
        lobbyId,
        lobbyCode: lobbyId,
        color: 'white',
        opponent: gameState.playerProfiles[1],
        me: gameState.playerProfiles[0],
        initialTime: gameState.timers[0]
    });
    s2.emit('rematchStarted', {
        lobbyId,
        lobbyCode: lobbyId,
        color: 'black',
        opponent: gameState.playerProfiles[0],
        me: gameState.playerProfiles[1],
        initialTime: gameState.timers[1]
    });

    console.log(`[REMATCH] New game ${lobbyId} from rematch of ${oldLobbyId}`);
}

const PORT = process.env.PORT || 3000;

// Оптимизированный интервал проверки таймеров (не в тестах)
if (process.env.NODE_ENV !== 'test') setInterval(async () => {
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

            const s0 = botManager.isBotSlot(game, 0) ? true : io.sockets.sockets.get(game.playerSockets[0]);
            const s1 = botManager.isBotSlot(game, 1) ? true : io.sockets.sockets.get(game.playerSockets[1]);

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
            const whiteAlive = botManager.isBotSlot(game, 0) || (whiteSock && io.sockets.sockets.has(whiteSock));
            const blackAlive = botManager.isBotSlot(game, 1) || (blackSock && io.sockets.sockets.has(blackSock));

            if (!whiteAlive && !blackAlive) {
                // Оба игрока offline — удаляем игру полностью
                await Redis.deleteGame(lobbyId);
                await Redis.removeActiveGame(lobbyId);
                await Redis.clearDisconnectTimer(lobbyId);
                await Redis.clearTurnTimeout(lobbyId);

                // Очищаем маппинг токенов
                await clearPlayersLobbyLinkByToken(game.playerTokens);

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
        await connectDB();

        await Redis.connect();

        await sessionRedisClient.connect();
        console.log('[STARTUP] Session store (Redis) connected successfully');

        await applyPersistedBotSettings();
        console.log('[STARTUP] Loaded bot settings from MongoDB');

        // Очистка зомби-игр при старте (удаляет только игры с обоими offline игроками)
        await cleanupStaleGames();
        console.log('[STARTUP] Cleaned stale games. Preserving active games with online players.');

        // Запускаем HTTP сервер
        const port = process.env.PORT || 3000;
        const env = process.env.NODE_ENV || 'development';
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
    await Redis.disconnect();
    await sessionRedisClient.quit();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('[SHUTDOWN] Received SIGINT, shutting down gracefully...');
    await Redis.disconnect();
    await sessionRedisClient.quit();
    process.exit(0);
});

// Экспорт для тестов
module.exports = { app, server, io, startServer };

// Запуск (если не тесты)
if (process.env.NODE_ENV !== 'test') {
    startServer();
}
