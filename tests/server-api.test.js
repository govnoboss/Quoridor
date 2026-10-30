jest.mock('redis');
jest.mock('../src/storage/db', () => jest.fn().mockResolvedValue());

const bcrypt = require('bcryptjs');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
// sharp С‚СЂРµР±СѓРµС‚ Node >=20.9, Р° Р»РѕРєР°Р»СЊРЅС‹Р№ Node РјРѕР¶РµС‚ Р±С‹С‚СЊ СЃС‚Р°СЂС€Рµ вЂ” РјР°Р»РµРЅСЊРєР°СЏ
// СѓС‚РёР»РёС‚Р° РІС‹С€Рµ Р»РёС€СЊ РЅСѓР¶РЅР° РґР»СЏ С‚РµСЃС‚РѕРІ Р°РІР°С‚Р°СЂРѕРІ; Р±РµР· sharp СЌС‚Рё С‚РµСЃС‚С‹ СЃРєРёРїР°СЋС‚СЃСЏ.
let sharp = null;
try { sharp = require('sharp'); } catch { sharp = null; }

// Mock User model вЂ” factory must be self-contained (no external var references)
jest.mock('../src/models/User', () => {
    const store = new Map();
    let nextId = 1;

    const MockUser = jest.fn().mockImplementation((data) => {
        const user = {
            _id: String(nextId++),
            username: data.username,
            email: data.email || `${data.username}@test.com`,
            passwordHash: data.passwordHash,
            rating: data.rating ?? 1200,
            stats: { totalGames: 0, wins: 0, losses: 0, playTimeSeconds: 0 },
            createdAt: new Date(),
            isBot: Boolean(data.isBot),
            isAdmin: Boolean(data.isAdmin),
            avatarUrl: data.avatarUrl || '',
            status: data.status || '',
            bio: data.bio || '',
            country: data.country || 'XX',
            achievements: [],
            preferences: { boardTheme: 'default', pieceSet: 'default' },
            save: jest.fn().mockResolvedValue(true),
        };
        store.set(user.username, user);
        return user;
    });

    MockUser.findOne = jest.fn((query = {}) => {
        if (query.username) return store.get(query.username) || null;
        if (query.email) {
            for (const user of store.values()) {
                if (user.email === query.email) return user;
            }
            return null;
        }
        return null;
    });
    MockUser.findById = jest.fn((id) => ({
        select(fields) {
            for (const user of store.values()) {
                if (user._id === id) {
                    const result = { ...user };
                    if (fields === '-passwordHash') delete result.passwordHash;
                    return Promise.resolve(result);
                }
            }
            return Promise.resolve(null);
        }
    }));
    MockUser.find = jest.fn((query = {}) => {
        const users = Array.from(store.values());
        let filtered = users;
        if (query && Object.keys(query).length > 0) {
            filtered = users.filter((user) => Object.entries(query).every(([k, v]) => {
                if (k === 'isAdmin' && v?.$ne === true) return user.isAdmin !== true;
                return user[k] === v;
            }));
        }

        const chain = {
            select() { return chain; },
            sort() {
                filtered = [...filtered].sort((a, b) => (b.rating || 0) - (a.rating || 0));
                return chain;
            },
            limit(n) {
                filtered = filtered.slice(0, n);
                return Promise.resolve(filtered);
            },
            exec() {
                return Promise.resolve(filtered.map((u) => u));
            },
            then(resolve, reject) {
                return Promise.resolve(filtered).then(resolve, reject);
            },
        };
        return chain;
    });
    MockUser.findByIdAndUpdate = jest.fn(() => Promise.resolve(null));

    MockUser.__clearStore = () => { store.clear(); nextId = 1; };
    MockUser.__seedUser = (data) => {
        const user = { _id: String(nextId++), ...data, save: jest.fn().mockResolvedValue(true) };
        store.set(user.username, user);
        return user;
    };

    return MockUser;
});

jest.mock('../src/models/GameResult', () => {
    let gamesStore = [];

    const MockGameResult = jest.fn().mockImplementation((data) => {
        return { ...data, save: jest.fn().mockResolvedValue(true) };
    });
    MockGameResult.find = jest.fn().mockResolvedValue([]);
    MockGameResult.findById = jest.fn().mockResolvedValue(null);
    // Р›РѕРєР°Р»СЊРЅР°СЏ РёРЅС‚РµСЂРїСЂРµС‚Р°С†РёСЏ Р°РіРіСЂРµРіР°С†РёРё delta7 (tz-03 4.2) РґР»СЏ С‚РµСЃС‚РѕРІ:
    // РїРѕРґРґРµСЂР¶РёРІР°РµС‚ СЂРѕРІРЅРѕ С‚РѕС‚ pipeline, С‡С‚Рѕ РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РІ utils/leaderboard.js
    MockGameResult.aggregate = jest.fn((pipeline) => {
        const match = pipeline.find((stage) => stage.$match) || {};
        const since = match.$match && match.$match.date && match.$match.date.$gte;
        const rows = new Map();
        for (const game of gamesStore) {
            if (match.$match && match.$match.isRanked !== undefined && game.isRanked !== match.$match.isRanked) continue;
            if (since && (!game.date || new Date(game.date) < since)) continue;
            const parts = [
                { id: game.playerWhite && game.playerWhite.id, change: (game.playerWhite && game.playerWhite.ratingChange) || 0 },
                { id: game.playerBlack && game.playerBlack.id, change: (game.playerBlack && game.playerBlack.ratingChange) || 0 }
            ];
            for (const part of parts) {
                if (part.id == null) continue;
                const key = String(part.id);
                rows.set(key, (rows.get(key) || 0) + part.change);
            }
        }
        return Promise.resolve(Array.from(rows.entries()).map(([id, delta]) => ({ _id: id, delta })));
    });
    MockGameResult.__setGames = (games) => { gamesStore = games; };
    MockGameResult.__clearGames = () => { gamesStore = []; };
    return MockGameResult;
});

jest.mock('../src/models/BotSettings', () => {
    let settings = null;

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    class MockBotSettings {
        constructor(data = {}) {
            Object.assign(this, {
                key: 'global',
                enabled: false,
                rankedEnabled: false,
                fallbackMinWaitMs: 15000,
                fallbackMaxWaitMs: 25000,
                maxActiveGames: 15,
                moveMinDelayMs: 800,
                moveMaxDelayMs: 2500,
                maxRecentMatches: 3,
                recentWindowMs: 3600000,
                updatedBy: undefined,
            }, data);
        }

        async save() {
            settings = clone(this);
            return this;
        }

        static async findOne(query = {}) {
            if (query.key !== 'global') return null;
            return settings ? clone(settings) : null;
        }

        static async findOneAndUpdate(query, update = {}, options = {}) {
            if (query.key !== 'global') return null;
            const current = settings ? clone(settings) : {
                key: 'global',
                enabled: false,
                rankedEnabled: false,
                fallbackMinWaitMs: 15000,
                fallbackMaxWaitMs: 25000,
                maxActiveGames: 15,
                moveMinDelayMs: 800,
                moveMaxDelayMs: 2500,
                maxRecentMatches: 3,
                recentWindowMs: 3600000,
            };
            const patch = update.$set || {};
            settings = { ...current, ...clone(patch) };
            if (options.setDefaultsOnInsert && !settings.key) settings.key = 'global';
            return clone(settings);
        }

        static __reset() {
            settings = null;
        }
    }

    return MockBotSettings;
});

const { setupTestEnvironment, teardownTestEnvironment, getApp } = require('./helpers');

let app;
let User;
let BotSettings;
let GameResult;

beforeAll(async () => {
    jest.setTimeout(30000);
    await setupTestEnvironment();
    app = await getApp();
    User = require('../src/models/User');
    BotSettings = require('../src/models/BotSettings');
    GameResult = require('../src/models/GameResult');
}, 30000);

beforeEach(() => {
    jest.clearAllMocks();
    User.__clearStore();
    BotSettings.__reset();
    if (GameResult.__clearGames) GameResult.__clearGames();
    const Leaderboard = require('../src/utils/leaderboard');
    if (Leaderboard.__resetDelta7Cache) Leaderboard.__resetDelta7Cache();
});

afterAll(async () => {
    await teardownTestEnvironment();
});

describe('Health Check', () => {
    it('GET /health returns ok', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
    });
});

describe('Active Lobby API', () => {
    it('GET /api/game/active returns false when no active game', async () => {
        const res = await request(app).get('/api/game/active');
        expect(res.status).toBe(200);
        expect(res.body.hasActiveGame).toBe(false);
    });

    it('GET /api/game/active responds with expected schema', async () => {
        const res = await request(app).get('/api/game/active');
        expect(res.status).toBe(200);
        expect(typeof res.body.hasActiveGame).toBe('boolean');
    });
});

describe('Auth API', () => {
    const passwordHash = bcrypt.hashSync('testpass123', 10);

    it('POST /api/auth/register - creates user', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ username: 'testplayer', email: 'test@example.com', password: 'testpass123' });
        expect(res.status).toBe(201);
        expect(res.body.message).toBe('User created');
    });

    it('POST /api/auth/register - duplicate username', async () => {
        User.__seedUser({ username: 'testplayer', email: 'test@example.com', passwordHash });
        const res = await request(app)
            .post('/api/auth/register')
            .send({ username: 'testplayer', email: 'other@example.com', password: 'testpass123' });
        expect(res.status).toBe(400);
    });

    it('POST /api/auth/register - duplicate email', async () => {
        User.__seedUser({ username: 'player1', email: 'test@example.com', passwordHash });
        const res = await request(app)
            .post('/api/auth/register')
            .send({ username: 'player2', email: 'test@example.com', password: 'testpass123' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Email already in use');
    });

    it('POST /api/auth/register - missing fields', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ username: 'nopass' });
        expect(res.status).toBe(400);
    });

    it('POST /api/auth/register - invalid email', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ username: 'testplayer', email: 'notanemail', password: 'testpass123' });
        expect(res.status).toBe(400);
    });

    it('POST /api/auth/login - success', async () => {
        User.__seedUser({ username: 'testplayer', passwordHash });
        const res = await request(app)
            .post('/api/auth/login')
            .send({ username: 'testplayer', password: 'testpass123' });
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Logged in');
    });

    it('POST /api/auth/login - wrong password', async () => {
        User.__seedUser({ username: 'testplayer', passwordHash });
        const res = await request(app)
            .post('/api/auth/login')
            .send({ username: 'testplayer', password: 'wrongpass' });
        expect(res.status).toBe(400);
    });

    it('POST /api/auth/login - nonexistent user', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ username: 'nobody', password: 'pass123' });
        expect(res.status).toBe(400);
    });

    it('GET /api/auth/me - authenticated', async () => {
        User.__seedUser({ username: 'testplayer', passwordHash, _id: 'user1' });
        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ username: 'testplayer', password: 'testpass123' });
        const res = await agent.get('/api/auth/me');
        expect(res.status).toBe(200);
        expect(res.body.isAuthenticated).toBe(true);
        expect(res.body.user.username).toBe('testplayer');
        expect(res.body.user.passwordHash).toBeUndefined();
    });

    it('GET /api/auth/me - unauthenticated', async () => {
        const res = await request(app).get('/api/auth/me');
        expect(res.status).toBe(200);
        expect(res.body.isAuthenticated).toBe(false);
    });
});

describe('Admin Bots API', () => {
    const adminHash = bcrypt.hashSync('adminpass123', 10);
    const userHash = bcrypt.hashSync('userpass123', 10);

    it('GET /api/admin/bots requires auth', async () => {
        const res = await request(app).get('/api/admin/bots');
        expect(res.status).toBe(401);
    });

    it('GET /api/admin/bots rejects non-admin user', async () => {
        User.__seedUser({ _id: 'u1', username: 'plainuser', passwordHash: userHash, isAdmin: false });
        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ username: 'plainuser', password: 'userpass123' });
        const res = await agent.get('/api/admin/bots');
        expect(res.status).toBe(403);
    });

    it('GET /api/admin/bots returns settings/runtime/bots for admin', async () => {
        User.__seedUser({ _id: 'a1', username: 'boss', passwordHash: adminHash, isAdmin: true });
        User.__seedUser({ _id: 'b1', username: 'BotAlpha', passwordHash: adminHash, isBot: true, rating: 1300, country: 'XX', avatarUrl: '' });
        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ username: 'boss', password: 'adminpass123' });

        const res = await agent.get('/api/admin/bots');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('settings');
        expect(res.body).toHaveProperty('runtime');
        expect(Array.isArray(res.body.bots)).toBe(true);
        expect(res.body.bots.some(b => b.username === 'BotAlpha')).toBe(true);
    });

    it('PUT /api/admin/bots/settings persists normalized settings', async () => {
        User.__seedUser({ _id: 'a2', username: 'admin2', passwordHash: adminHash, isAdmin: true });
        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ username: 'admin2', password: 'adminpass123' });

        const res = await agent.put('/api/admin/bots/settings').send({
            enabled: true,
            rankedEnabled: true,
            fallbackMinWaitMs: 50,
            fallbackMaxWaitMs: 40,
            moveMinDelayMs: 100,
            moveMaxDelayMs: 90,
            maxActiveGames: -1,
            maxRecentMatches: -2,
            recentWindowMs: 500,
        });

        expect(res.status).toBe(200);
        expect(res.body.settings.enabled).toBe(true);
        expect(res.body.settings.rankedEnabled).toBe(true);
        expect(res.body.settings.fallbackMaxWaitMs).toBe(50);
        expect(res.body.settings.moveMaxDelayMs).toBe(100);
        expect(res.body.settings.maxActiveGames).toBe(0);
        expect(res.body.settings.maxRecentMatches).toBe(0);
        expect(res.body.settings.recentWindowMs).toBe(60000);
        expect(res.body.settings.updatedBy).toBe('a2');
    });

    it('POST /api/admin/bots/seed creates or updates bot accounts', async () => {
        User.__seedUser({ _id: 'a3', username: 'admin3', passwordHash: adminHash, isAdmin: true });
        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ username: 'admin3', password: 'adminpass123' });

        const res = await agent.post('/api/admin/bots/seed').send({ password: 'botpass123' });
        expect(res.status).toBe(200);
        expect(res.body.created + res.body.updated).toBeGreaterThan(0);
        expect(Array.isArray(res.body.bots)).toBe(true);
        expect(res.body.bots.length).toBeGreaterThan(0);
    });
});

(sharp ? describe : describe.skip)('Avatar Upload API', () => {
    const passHash = bcrypt.hashSync('avatarpass123', 10);
    const AVATARS_DIR = path.join(__dirname, '..', 'avatars');

    async function pngBuffer(size = 64) {
        return sharp({ create: { width: size, height: size, channels: 3, background: { r: 30, g: 90, b: 200 } } })
            .png()
            .toBuffer();
    }

    it('POST /api/user/upload-avatar requires auth', async () => {
        const res = await request(app)
            .post('/api/user/upload-avatar')
            .attach('avatar', await pngBuffer(), { filename: 'a.png', contentType: 'image/png' });
        expect(res.status).toBe(401);
    });

    it('rejects non-image upload', async () => {
        User.__seedUser({ _id: 'av1', username: 'avtest', passwordHash: passHash });
        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ username: 'avtest', password: 'avatarpass123' });

        const res = await agent
            .post('/api/user/upload-avatar')
            .attach('avatar', Buffer.from('just some text, not an image'), { filename: 'evil.png', contentType: 'image/png' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid or corrupt image file');
    });

    it('rejects unsupported file type', async () => {
        User.__seedUser({ _id: 'av2', username: 'avgif', passwordHash: passHash });
        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ username: 'avgif', password: 'avatarpass123' });

        const res = await agent
            .post('/api/user/upload-avatar')
            .attach('avatar', Buffer.from('GIF89a...'), { filename: 'a.gif', contentType: 'image/gif' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Unsupported file type. Use JPEG, PNG or WebP.');
    });

    it('rejects oversized file', async () => {
        User.__seedUser({ _id: 'av3', username: 'avbig', passwordHash: passHash });
        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ username: 'avbig', password: 'avatarpass123' });

        const big = Buffer.alloc(6 * 1024 * 1024);
        const res = await agent
            .post('/api/user/upload-avatar')
            .attach('avatar', big, { filename: 'big.png', contentType: 'image/png' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/too large/i);
    });

    it('uploads valid PNG, saves webp and serves it statically', async () => {
        User.__seedUser({ _id: 'av4', username: 'avok', passwordHash: passHash });
        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ username: 'avok', password: 'avatarpass123' });

        const file = path.join(AVATARS_DIR, 'av4.webp');
        try { fs.unlinkSync(file); } catch { /* ignore */ }

        const res = await agent
            .post('/api/user/upload-avatar')
            .attach('avatar', await pngBuffer(), { filename: 'a.png', contentType: 'image/png' });
        expect(res.status).toBe(200);
        expect(res.body.avatarUrl).toMatch(/^\/avatars\/av4\.webp\?v=\d+$/);
        expect(fs.existsSync(file)).toBe(true);

        const staticRes = await request(app).get(res.body.avatarUrl.split('?')[0]);
        expect(staticRes.status).toBe(200);
        expect(staticRes.type).toBe('image/webp');

        try { fs.unlinkSync(file); } catch { /* ignore */ }
    });
});

describe('Leaderboard API (tz-03)', () => {
    function seedPlayers() {
        const pw = bcrypt.hashSync('pass123', 5);
        // id СѓРїСЂР°РІР»СЏРµРј: РЅСѓР¶РµРЅ РїСЂРµРґСЃРєР°Р·СѓРµРјС‹Р№ РїРѕСЂСЏРґРѕРє Рё РїРѕР»Рµ _id РґР»СЏ displayName-РєРѕР»Р»РёР·РёР№
        User.__seedUser({ _id: 'u001', username: 'frag_lord', passwordHash: pw, rating: 1669, stats: { totalGames: 170, wins: 158, losses: 12, playTimeSeconds: 0 } });
        User.__seedUser({ _id: 'u002', username: 'rookie', passwordHash: pw, rating: 1200, stats: { totalGames: 3, wins: 1, losses: 2, playTimeSeconds: 0 } });
        User.__seedUser({ _id: 'u003', username: 'grinder', passwordHash: pw, rating: 1300, stats: { totalGames: 25, wins: 15, losses: 10, playTimeSeconds: 0 } });
        User.__seedUser({ _id: 'u004', username: 'admin_guy', passwordHash: pw, isAdmin: true, rating: 3000, stats: { totalGames: 50, wins: 50, losses: 0, playTimeSeconds: 0 } });
        User.__seedUser({ _id: 'u005', username: 'emailplayer', passwordHash: pw, rating: 1400, stats: { totalGames: 12, wins: 7, losses: 5, playTimeSeconds: 0 }, email: 'secret.address@hostmail.com' });
    }

    function agentFor(username) {
        const agent = request.agent(app);
        return agent.post('/api/auth/login').send({ username, password: 'pass123' }).then(() => agent);
    }

    const now = Date.now();
    const d = (daysAgo) => new Date(now - daysAgo * 24 * 3600 * 1000);

    it('sort=rating (default) returns rank 1..N, stats.wins/losses, and excludes admins', async () => {
        seedPlayers();
        const res = await request(app).get('/api/leaderboard');
        expect(res.status).toBe(200);
        expect(res.body.map((p) => p.username)).toEqual(['frag_lord', 'emailplayer', 'grinder', 'rookie']);
        expect(res.body[0].rank).toBe(1);
        expect(res.body[3].rank).toBe(4);
        expect(res.body.find((p) => p.username === 'frag_lord').stats).toEqual({ totalGames: 170, wins: 158, losses: 12 });
    });

    it('email never appears in any field; displayName derived for @-usernames', async () => {
        User.__seedUser({ _id: 'mail01', username: 'mnikita868@gmail.com', email: 'secret.address@hostmail.com', rating: 1500, stats: { totalGames: 30, wins: 20, losses: 10, playTimeSeconds: 0 } });
        User.__seedUser({ _id: 'mail02', username: 'mnikita868@gmail.com2', email: 'secret.address@hostmail.com', rating: 1501, stats: { totalGames: 30, wins: 20, losses: 10, playTimeSeconds: 0 } });
        const res = await request(app).get('/api/leaderboard');
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).not.toContain('secret.address@hostmail.com');
        const rows = res.body.filter((p) => p.username.startsWith('mnikita868'));
        // коллизия производных имён: обе записи получают '…' + последние 2 символа id
        expect(rows.every((p) => /^mnikita868…[a-z0-9]{2}$/.test(p.displayName))).toBe(true);
        expect(new Set(rows.map((p) => p.displayName)).size).toBe(2);
    });

    it('sort=winrate excludes players with fewer than 10 games', async () => {
        seedPlayers();
        const res = await request(app).get('/api/leaderboard?sort=winrate');
        expect(res.status).toBe(200);
        const usernames = res.body.map((p) => p.username);
        expect(usernames).not.toContain('rookie');
        // РїСЂРёРѕСЂРёС‚РµС‚: winrate РїРѕ СѓР±С‹РІР°РЅРёСЋ, РїСЂРё СЂР°РІРµРЅСЃС‚РІРµ wins, Р·Р°С‚РµРј СЂРµР№С‚РёРЅРі
        expect(usernames).toEqual(['frag_lord', 'grinder', 'emailplayer']);
    });

    it('sort=week: only players with ranked games in last 7 days, delta7 = sum of ratingChange', async () => {
        seedPlayers();
        GameResult.__setGames([
            { isRanked: true, date: d(1), playerWhite: { id: 'u003', ratingChange: 12 }, playerBlack: { id: 'u002', ratingChange: -12 } },
            { isRanked: true, date: d(3), playerWhite: { id: 'u003', ratingChange: 10 }, playerBlack: { id: null, ratingChange: 0 } },
            { isRanked: false, date: d(1), playerWhite: { id: 'u003', ratingChange: 999 }, playerBlack: { id: 'u002', ratingChange: -999 } },
            { isRanked: true, date: d(20), playerWhite: { id: 'u001', ratingChange: 500 }, playerBlack: { id: 'u002', ratingChange: -500 } }
        ]);
        const res = await request(app).get('/api/leaderboard?sort=week');
        expect(res.status).toBe(200);
        const grinder = res.body.find((p) => p.username === 'grinder');
        expect(grinder.delta7).toBe(22);
        expect(grinder.rank).toBe(1);
        const rookie = res.body.find((p) => p.username === 'rookie');
        expect(rookie.delta7).toBe(-12);
        // frag_lord: СЂР°РЅРіРѕРІС‹Рµ РїР°СЂС‚РёРё С‚РѕР»СЊРєРѕ 20 РґРЅРµР№ РЅР°Р·Р°Рґ -> delta7 null, РЅРµ РІ РІС‹Р±РѕСЂРєРµ
        expect(res.body.find((p) => p.username === 'frag_lord')).toBeUndefined();
    });

    it('limit is capped at 100', async () => {
        for (let i = 0; i < 150; i++) {
            User.__seedUser({ _id: 'bulk' + String(i).padStart(3, '0'), username: 'bulk' + i, rating: 2000 - i, stats: { totalGames: 10, wins: 5, losses: 5, playTimeSeconds: 0 } });
        }
        const res = await request(app).get('/api/leaderboard?limit=500');
        expect(res.status).toBe(200);
        expect(res.body.length).toBe(100);
        expect(res.body[0].rank).toBe(1);
        expect(res.body[99].rank).toBe(100);
    });

    it('GET /api/leaderboard/me requires auth', async () => {
        const res = await request(app).get('/api/leaderboard/me');
        expect(res.status).toBe(401);
    });

    it('GET /api/leaderboard/me returns rank by rating, stats and delta7', async () => {
        seedPlayers();
        GameResult.__setGames([
            { isRanked: true, date: d(2), playerWhite: { id: 'u003', ratingChange: -8 }, playerBlack: { id: 'u005', ratingChange: 8 } }
        ]);
        const agent = await agentFor('grinder');
        const res = await agent.get('/api/leaderboard/me');
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(4);
        expect(res.body.username).toBe('grinder');
        expect(res.body.rank).toBe(3);
        expect(res.body.rating).toBe(1300);
        expect(res.body.stats.totalGames).toBe(25);
        expect(res.body.delta7).toBe(-8);
    });

    it('GET /api/leaderboard/me?sort=winrate: rank null below 10 games threshold', async () => {
        seedPlayers();
        const agent = await agentFor('rookie');
        const res = await agent.get('/api/leaderboard/me?sort=winrate');
        expect(res.status).toBe(200);
        expect(res.body.rank).toBeNull();
        expect(res.body.total).toBe(4);
    });

    it('GET /api/leaderboard/me?sort=week: rank null without ranked games within 7 days', async () => {
        seedPlayers();
        GameResult.__setGames([
            { isRanked: true, date: d(20), playerWhite: { id: 'u001', ratingChange: 500 }, playerBlack: { id: 'u002', ratingChange: -500 } }
        ]);
        const agent = await agentFor('frag_lord');
        const res = await agent.get('/api/leaderboard/me?sort=week');
        expect(res.status).toBe(200);
        expect(res.body.rank).toBeNull();
        expect(res.body.delta7).toBeNull();
    });
});
