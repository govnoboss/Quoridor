jest.mock('redis');
jest.mock('../src/storage/db', () => jest.fn().mockResolvedValue());

const bcrypt = require('bcryptjs');
const request = require('supertest');

// Mock User model — factory must be self-contained (no external var references)
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
    const MockGameResult = jest.fn().mockImplementation((data) => {
        return { ...data, save: jest.fn().mockResolvedValue(true) };
    });
    MockGameResult.find = jest.fn().mockResolvedValue([]);
    MockGameResult.findById = jest.fn().mockResolvedValue(null);
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

beforeAll(async () => {
    jest.setTimeout(30000);
    await setupTestEnvironment();
    app = await getApp();
    User = require('../src/models/User');
    BotSettings = require('../src/models/BotSettings');
}, 30000);

beforeEach(() => {
    jest.clearAllMocks();
    User.__clearStore();
    BotSettings.__reset();
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
