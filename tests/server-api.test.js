jest.mock('redis');
jest.mock('../src/storage/db', () => jest.fn().mockResolvedValue());

const bcrypt = require('bcryptjs');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Mock User model — factory must be self-contained (no external var references)
jest.mock('../src/models/User', () => {
    const store = new Map();
    let nextId = 1;

    // Adds a toObject() shim so document-style routes (e.g. /api/profiles) can
    // serialize a mock user the same way Mongoose does.
    const withToObject = (user) => {
        user.toObject = function () {
            const { save, toObject: _ignored, ...rest } = user;
            return rest;
        };
        return user;
    };

    const MockUser = jest.fn().mockImplementation((data) => {
        const user = withToObject({
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
        });
        store.set(user.username, user);
        return user;
    });

    MockUser.findOne = jest.fn((query = {}) => {
        // Порядок: username → email. Возвращает thenable:
        // `await` даёт сырой документ (со всеми полями), `.select()` —
        // проекцию как в Mongoose (поля с '-' удаляются).
        let picked = null;
        if (query.username) picked = store.get(query.username) || null;
        else if (query.email) {
            for (const user of store.values()) {
                if (user.email === query.email) { picked = user; break; }
            }
        } else {
            return null;
        }
        return {
            select(fields) {
                if (!picked) return Promise.resolve(null);
                const clone = { ...picked };
                if (typeof fields === 'string') {
                    fields.split(/\s+/).filter(Boolean).forEach((f) => {
                        if (f.startsWith('-')) delete clone[f.slice(1)];
                    });
                }
                clone.toObject = function () {
                    const { save, toObject: _ignored, ...rest } = clone;
                    return rest;
                };
                return Promise.resolve(clone);
            },
            then(resolve, reject) {
                return Promise.resolve(picked).then(resolve, reject);
            },
        };
    });
    MockUser.findById = jest.fn((id) => ({
        select(fields) {
            for (const user of store.values()) {
                if (user._id === id) {
                    const result = { ...user };
                    if (fields === '-passwordHash') delete result.passwordHash;
                    // own toObject из замыкания на store-документ приложил бы
                    // passwordHash обратно (шаг /api/auth/me) — навешиваем на клон.
                    result.toObject = function () {
                        const { save, toObject: _ignored, ...rest } = result;
                        return rest;
                    };
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
    MockUser.countDocuments = jest.fn((query = {}) => {
        const users = Array.from(store.values());
        return Promise.resolve(users.filter((user) => {
            if (query && Object.keys(query).length > 0) {
                return Object.entries(query).every(([k, v]) => {
                    if (k === 'isAdmin' && v?.$ne === true) return user.isAdmin !== true;
                    if (k === 'rating' && v && typeof v === 'object' && !Array.isArray(v)) {
                        if ('$gt' in v && !((user.rating || 0) > v.$gt)) return false;
                        if ('$gte' in v && !((user.rating || 0) >= v.$gte)) return false;
                        if ('$lt' in v && !((user.rating || 0) < v.$lt)) return false;
                        return true;
                    }
                    return user[k] === v;
                });
            }
            return true;
        }).length);
    });

    MockUser.__clearStore = () => { store.clear(); nextId = 1; };
    MockUser.__seedUser = (data) => {
        const user = withToObject({ _id: String(nextId++), ...data, save: jest.fn().mockResolvedValue(true) });
        store.set(user.username, user);
        return user;
    };

    return MockUser;
});

jest.mock('../src/models/GameResult', () => {
    const gameStore = [];

    const MockGameResult = jest.fn().mockImplementation((data) => {
        return { ...data, save: jest.fn().mockResolvedValue(true) };
    });
    MockGameResult.find = jest.fn().mockResolvedValue([]);
    MockGameResult.findById = jest.fn().mockResolvedValue(null);

    // Путь вида 'players.ratingChange' / '$players.ratingChange'.
    function getPath(obj, path, stripDollar = false) {
        let p = String(path);
        if (stripDollar && p.startsWith('$')) p = p.slice(1);
        return p.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
    }

    // Достаточный интерпретатор конвейера computeDelta7 (этап 3 §4.2):
    // [$match корня, $group {_id:null, $push...}, $project $concatArrays,
    //  $unwind, $match вложенного пути с $ne, $group {_id:путь, $sum}].
    MockGameResult.aggregate = jest.fn(async (pipeline) => {
        let docs = gameStore.slice();
        let rows = null; // null → корневые документы; после $group — свёрнутые строки
        for (const stage of pipeline) {
            const [op, spec] = Object.entries(stage)[0];
            if (op === '$match') {
                const filter = (row) => Object.entries(spec).every(([field, cond]) => {
                    const value = getPath(row, field);
                    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
                        if ('$gte' in cond && !(new Date(value) >= new Date(cond.$gte))) return false;
                        if ('$ne' in cond && !(value !== cond.$ne)) return false;
                        return true;
                    }
                    return value === cond;
                });
                if (rows === null) docs = docs.filter(filter);
                else rows = rows.filter(filter);
            } else if (op === '$group' && spec._id === null) {
                const g = { _id: null };
                Object.entries(spec).forEach(([outKey, s]) => {
                    if (outKey === '_id') return;
                    if (s.$push !== undefined) g[outKey] = docs.map((d) => getPath(d, s.$push, true));
                });
                rows = [g];
            } else if (op === '$project') {
                const cs = spec.players && spec.players.$concatArrays;
                if (cs) rows[0].players = cs.flatMap((ref) => getPath(rows[0], ref, true) || []);
            } else if (op === '$unwind') {
                const path = String(spec).replace(/^\$/, '');
                rows = rows[0][path].map((entry) => ({ [path]: entry }));
            } else if (op === '$group') {
                const groups = new Map();
                for (const row of rows) {
                    const gk = getPath(row, spec._id, true);
                    const key = String(gk);
                    if (!groups.has(key)) groups.set(key, { _id: gk, delta: 0 });
                    Object.entries(spec).forEach(([outKey, s]) => {
                        if (outKey === '_id') return;
                        if (s.$sum !== undefined) groups.get(key)[outKey] += getPath(row, s.$sum, true) || 0;
                    });
                }
                rows = Array.from(groups.values());
            }
        }
        return rows === null ? [] : rows;
    });

    // Хелперы тестов: seed / clear для delta7-сценариев.
    MockGameResult.__seedGames = (arr) => { gameStore.push(...arr); };
    MockGameResult.__clearGames = () => { gameStore.length = 0; };
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

describe('Leaderboard Me API', () => {
    const hash = bcrypt.hashSync('testpass123', 10);

    beforeEach(() => {
        User.__clearStore();
    });

    async function loginAgent(username) {
        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ username, password: 'testpass123' });
        return agent;
    }

    it('guest gets 401', async () => {
        const res = await request(app).get('/api/leaderboard/me');
        expect(res.status).toBe(401);
    });

    it('top player gets rank 1', async () => {
        User.__seedUser({ username: 'topuser', passwordHash: hash, rating: 1500 });
        const agent = await loginAgent('topuser');
        const res = await agent.get('/api/leaderboard/me');
        expect(res.status).toBe(200);
        expect(res.body.rank).toBe(1);
        expect(res.body.rating).toBe(1500);
        expect(res.body.username).toBe('topuser');
    });

    it('equal rating shares the same rank', async () => {
        User.__seedUser({ username: 'tiedone', passwordHash: hash, rating: 1600 });
        User.__seedUser({ username: 'tiedtwo', passwordHash: hash, rating: 1600 });
        const agentA = await loginAgent('tiedone');
        const agentB = await loginAgent('tiedtwo');
        const [resA, resB] = await Promise.all([
            agentA.get('/api/leaderboard/me'),
            agentB.get('/api/leaderboard/me'),
        ]);
        expect(resA.status).toBe(200);
        expect(resB.status).toBe(200);
        expect(resA.body.rank).toBe(1);
        expect(resB.body.rank).toBe(1);
    });

    it('player with lower rating is ranked behind better players', async () => {
        User.__seedUser({ username: 'betterone', passwordHash: hash, rating: 1700 });
        User.__seedUser({ username: 'lowerrate', passwordHash: hash, rating: 1300 });
        const agent = await loginAgent('lowerrate');
        const res = await agent.get('/api/leaderboard/me');
        expect(res.status).toBe(200);
        expect(res.body.rank).toBe(2);
    });

    it('admin is not ranked (404)', async () => {
        User.__seedUser({ username: 'bossuser', passwordHash: hash, rating: 2000, isAdmin: true });
        const agent = await loginAgent('bossuser');
        const res = await agent.get('/api/leaderboard/me');
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('Not ranked');
    });
});

// ==== Leaderboard API (ТЗ этапа 3 §4.5) ====
describe('Leaderboard API', () => {
    const hash = bcrypt.hashSync('testpass123', 10);
    let clearLeaderboardCache;

    beforeAll(() => {
        ({ clearLeaderboardCache } = require('../src/server'));
    });

    beforeEach(() => {
        // delta7 кэшируется между запросами (§4.2) — в тестах сбрасываем.
        clearLeaderboardCache();
        User.__clearStore();
    });

    afterAll(() => {
        const GameResult = require('../src/models/GameResult');
        GameResult.__clearGames();
    });

    it('sort=rating возвращает rank 1…N по убыванию рейтинга и stats.wins', async () => {
        User.__seedUser({ username: 'alpha', passwordHash: hash, rating: 1500, stats: { totalGames: 50, wins: 30, losses: 20 } });
        User.__seedUser({ username: 'beta', passwordHash: hash, rating: 1700, stats: { totalGames: 80, wins: 60, losses: 20 } });
        User.__seedUser({ username: 'gamma', passwordHash: hash, rating: 1300, stats: { totalGames: 10, wins: 3, losses: 7 } });

        const res = await request(app).get('/api/leaderboard');
        expect(res.status).toBe(200);
        expect(res.body.map((p) => p.username)).toEqual(['beta', 'alpha', 'gamma']);
        res.body.forEach((p, i) => expect(p.rank).toBe(i + 1));
        expect(res.body.find((p) => p.username === 'alpha').stats).toEqual(
            expect.objectContaining({ totalGames: 50, wins: 30, losses: 20 }),
        );
    });

    it('sort=winrate исключает игроков с менее чем 10 партиями', async () => {
        User.__seedUser({ username: 'veteran', passwordHash: hash, rating: 1400, stats: { totalGames: 20, wins: 18, losses: 2 } });
        User.__seedUser({ username: 'rookie', passwordHash: hash, rating: 1900, stats: { totalGames: 9, wins: 2, losses: 7 } });
        User.__seedUser({ username: 'perfect', passwordHash: hash, rating: 1000, stats: { totalGames: 10, wins: 10, losses: 0 } });

        const res = await request(app).get('/api/leaderboard?sort=winrate');
        expect(res.status).toBe(200);
        const names = res.body.map((p) => p.username);
        expect(names).not.toContain('rookie'); // 9 партий < порога
        expect(names).toEqual(['perfect', 'veteran']); // 100% > 90%
    });

    it('sort=week возвращает только игроков с ранговыми партиями за 7 дней, delta7 = сумме ratingChange', async () => {
        const GameResult = require('../src/models/GameResult');
        const u1 = User.__seedUser({ username: 'riser', passwordHash: hash, rating: 1300 });
        const u2 = User.__seedUser({ username: 'faller', passwordHash: hash, rating: 1200 });
        User.__seedUser({ username: 'idle', passwordHash: hash, rating: 1400 });

        const now = Date.now();
        GameResult.__seedGames([
            { gameType: 'blitz', playerWhite: { id: u1._id, isGuest: false, ratingChange: 12 }, playerBlack: { id: u2._id, isGuest: false, ratingChange: -12 }, isRanked: true, winner: 0, date: new Date(now - 2 * 24 * 60 * 60 * 1000) },
            { gameType: 'blitz', playerWhite: { id: u2._id, isGuest: false, ratingChange: 4 }, playerBlack: { id: u1._id, isGuest: false, ratingChange: -4 }, isRanked: true, winner: 0, date: new Date(now - 24 * 60 * 60 * 1000) },
            // не ранговая и старая — не учитываются
            { gameType: 'friend', playerWhite: { id: u1._id, isGuest: false, ratingChange: 50 }, playerBlack: { id: u2._id, isGuest: false, ratingChange: -50 }, isRanked: false, winner: 0, date: new Date(now - 8 * 24 * 60 * 60 * 1000) },
        ]);

        const res = await request(app).get('/api/leaderboard?sort=week');
        expect(res.status).toBe(200);
        const byName = Object.fromEntries(res.body.map((p) => [p.username, p]));
        expect(byName.riser.delta7).toBe(12 - 4);   // только ранговые за окно
        expect(byName.faller.delta7).toBe(-12 + 4);
        expect(byName.idle).toBeUndefined();          // партий за 7 дней нет
        expect(res.body[0].username).toBe('riser');   // delta7 = 8 > -8
    });

    it('sort=week при нулевом и отрицательном delta7: порядок по значению', async () => {
        const GameResult = require('../src/models/GameResult');
        const a = User.__seedUser({ username: 'plus', passwordHash: hash, rating: 1000 });
        const b = User.__seedUser({ username: 'minus', passwordHash: hash, rating: 1000 });
        User.__seedUser({ username: 'zero', passwordHash: hash, rating: 1000 });
        const now = Date.now();

        GameResult.__seedGames([
            { gameType: 'rapid', playerWhite: { id: a._id, isGuest: false, ratingChange: 7 }, playerBlack: { id: b._id, isGuest: false, ratingChange: -7 }, isRanked: true, winner: 0, date: new Date(now - 3 * 24 * 60 * 60 * 1000) },
        ]);

        const res = await request(app).get('/api/leaderboard?sort=week');
        const names = res.body.map((p) => p.username);
        expect(names[0]).toBe('plus');      // delta7 = 7
        expect(names).toContain('minus');   // delta7 = -7 (включён, ненулевой)
        expect(names).not.toContain('zero'); // delta7 = null (нет партий за окно)
    });

    it('email никогда не появляется в ответе при username-подобном-email', async () => {
        User.__seedUser({ username: 'mnikita868@gmail.com', passwordHash: hash, rating: 1250, stats: { totalGames: 12, wins: 5, losses: 7 } });
        User.__seedUser({ username: 'cleanuser', passwordHash: hash, rating: 1300 });

        const res = await request(app).get('/api/leaderboard');
        expect(res.status).toBe(200);
        const withEmail = res.body.find((p) => p.username === 'mnikita868@gmail.com');
        expect(withEmail).toBeDefined();
        // displayName: часть до '@' (≤12 симв.), без домена и '@' вообще
        expect(withEmail.displayName).toBe('mnikita868');
        res.body.forEach((p) => {
            expect(String(p.displayName)).not.toMatch(/@/);
        });
        // Единственное поле, где email допустим как username, — ссылочное username;
        // в JSON в целом адрес доменной части не должен просачиваться в другие поля.
        res.body.forEach((p) => {
            const json = JSON.stringify(p);
            const clean = { ...p };
            delete clean.username;
            expect(JSON.stringify(clean)).not.toContain('@gmail.com');
        });
    });

    it('limit=500 обрезается до 100', async () => {
        for (let i = 0; i < 3; i++) {
            User.__seedUser({ username: `p${i}`, passwordHash: hash, rating: 1200 + i });
        }
        const res = await request(app).get('/api/leaderboard?limit=500');
        expect(res.status).toBe(200);
        expect(res.body.length).toBe(3); // в базе всего 3 игрока, лимит не больше 100
        // Проверка потолка: 150 сеяных игроков → вернётся ровно 100.
    });

    it('limit: при переполнении отдаётся максимум 100', async () => {
        for (let i = 0; i < 150; i++) {
            User.__seedUser({ username: `many${i}`, passwordHash: hash, rating: 800 + i });
        }
        const res = await request(app).get('/api/leaderboard?limit=500');
        expect(res.status).toBe(200);
        expect(res.body.length).toBe(100);
        expect(res.body[0].rank).toBe(1);
        expect(res.body[99].rank).toBe(100);
    });
});

describe('Profile rank API', () => {
    const hash = bcrypt.hashSync('testpass123', 10);

    beforeEach(() => {
        User.__clearStore();
    });

    it('GET /api/profiles/:username returns rank for non-admin player', async () => {
        User.__seedUser({ username: 'topA', passwordHash: hash, rating: 1800 });
        User.__seedUser({ username: 'topB', passwordHash: hash, rating: 1600 });
        User.__seedUser({ username: 'viewme', passwordHash: hash, rating: 1400 });
        const res = await request(app).get('/api/profiles/viewme');
        expect(res.status).toBe(200);
        expect(res.body.rank).toBe(3);
    });

    it('equal ratings share the same profile rank', async () => {
        User.__seedUser({ username: 'halfA', passwordHash: hash, rating: 1200 });
        User.__seedUser({ username: 'halfB', passwordHash: hash, rating: 1200 });
        const res = await request(app).get('/api/profiles/halfB');
        expect(res.status).toBe(200);
        expect(res.body.rank).toBe(1);
    });

    it('admin accounts are skipped in ranking', async () => {
        User.__seedUser({ username: 'chief', passwordHash: hash, rating: 2500, isAdmin: true });
        User.__seedUser({ username: 'solo', passwordHash: hash, rating: 1000 });
        const res = await request(app).get('/api/profiles/solo');
        expect(res.status).toBe(200);
        expect(res.body.rank).toBe(1);
    });

    it('profile response contains no admin-only fields', async () => {
        User.__seedUser({ username: 'plain', passwordHash: hash, rating: 1100 });
        const res = await request(app).get('/api/profiles/plain');
        expect(res.status).toBe(200);
        expect(res.body.passwordHash).toBeUndefined();
        expect(res.body.email).toBeUndefined();
        expect(res.body.isAdmin).toBeUndefined();
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

describe('Avatar Upload API', () => {
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
