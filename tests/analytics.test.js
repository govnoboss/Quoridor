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
    MockUser.find = jest.fn(() => Promise.resolve([]));
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

jest.mock('../src/models/DailyPuzzle', () => {
    const MockDailyPuzzle = jest.fn().mockImplementation((data) => {
        return { ...data, save: jest.fn().mockResolvedValue(true) };
    });
    MockDailyPuzzle.findOne = jest.fn().mockResolvedValue(null);
    MockDailyPuzzle.findOneAndUpdate = jest.fn().mockResolvedValue(null);
    MockDailyPuzzle.create = jest.fn().mockResolvedValue(null);
    return MockDailyPuzzle;
});

// Self-contained in-memory AnalyticsEvent store
jest.mock('../src/models/AnalyticsEvent', () => {
    const store = [];

    const MockAnalyticsEvent = jest.fn().mockImplementation(() => ({}));

    MockAnalyticsEvent.insertMany = jest.fn(async (docs) => {
        store.push(...docs);
        return docs;
    });

    MockAnalyticsEvent.aggregate = jest.fn(async (pipeline) => {
        let rows = store.slice();

        const match = pipeline.find((s) => s.$match);
        if (match && match.$match.timestamp) {
            const gte = match.$match.timestamp.$gte;
            rows = rows.filter((e) => new Date(e.timestamp) >= new Date(gte));
        }

        const group = pipeline.find((s) => s.$group);
        if (!group) return rows;

        const seen = new Map();
        for (const r of rows) {
            let key;
            if (typeof group.$group._id === 'string') {
                key = r[group.$group._id.slice(1)];
            } else if (group.$group._id && group.$group._id.$dateToString) {
                key = new Date(r.timestamp).toISOString().slice(0, 10);
            } else {
                key = 'all';
            }
            if (!seen.has(key)) seen.set(key, { _id: key, count: 0, users: [] });
            const agg = seen.get(key);
            agg.count += 1;
            if (group.$group.users) {
                const target = group.$group.users.$addToSet;
                if (!agg.users.includes(r[target.slice(1)])) agg.users.push(r[target.slice(1)]);
            }
        }

        const out = Array.from(seen.values());
        const sort = pipeline.find((s) => s.$sort);
        if (sort) {
            const [[k, dir]] = Object.entries(sort.$sort);
            out.sort((a, b) => (a[k] < b[k] ? -dir : a[k] > b[k] ? dir : 0));
        }
        return out;
    });

    MockAnalyticsEvent.countDocuments = jest.fn(async (query = {}) => {
        return store.filter((e) => {
            if (query.name && e.name !== query.name) return false;
            if (query.timestamp && new Date(e.timestamp) < new Date(query.timestamp.$gte)) return false;
            return true;
        }).length;
    });

    MockAnalyticsEvent.__events = store;
    MockAnalyticsEvent.__reset = () => { store.length = 0; };

    return MockAnalyticsEvent;
});

const { setupTestEnvironment, teardownTestEnvironment, getApp } = require('./helpers');

let app;
let User;
let AnalyticsEvent;

beforeAll(async () => {
    jest.setTimeout(30000);
    await setupTestEnvironment();
    app = await getApp();
    User = require('../src/models/User');
    AnalyticsEvent = require('../src/models/AnalyticsEvent');
}, 30000);

beforeEach(() => {
    jest.clearAllMocks();
    User.__clearStore();
    AnalyticsEvent.__reset();
});

afterAll(async () => {
    await teardownTestEnvironment();
});

describe('Analytics Ingest API', () => {
    it('POST /api/analytics/events with valid batch -> 204 and stores docs', async () => {
        const res = await request(app)
            .post('/api/analytics/events')
            .send([
                { name: 'game-started', props: { mode: 'ranked' }, ts: new Date().toISOString() },
                { name: 'puzzle-viewed', props: {}, ts: new Date().toISOString() }
            ]);
        expect(res.status).toBe(204);
        expect(AnalyticsEvent.insertMany).toHaveBeenCalledTimes(1);
        const docs = AnalyticsEvent.insertMany.mock.calls[0][0];
        expect(docs).toHaveLength(2);
        expect(docs.every((d) => d.userId === null)).toBe(true);
        expect(docs[0].platform).toBe('web');
    });

    it('drops unknown event names and keeps events with oversized props (props cleared)', async () => {
        const bigProps = { payload: 'x'.repeat(5000) };
        const res = await request(app)
            .post('/api/analytics/events')
            .send([
                { name: 'totally-unknown-event', props: {} },
                { name: 'game-started', props: bigProps },
                { name: 'game-finished', props: { result: 'win' } }
            ]);
        expect(res.status).toBe(204);
        const docs = AnalyticsEvent.insertMany.mock.calls[0][0];
        expect(docs).toHaveLength(2);
        expect(docs[0].name).toBe('game-started');
        expect(docs[0].props).toEqual({});
        expect(docs[1].name).toBe('game-finished');
        expect(docs[1].props).toEqual({ result: 'win' });
    });

    it('caps batch at 20 events', async () => {
        const batch = [];
        for (let i = 0; i < 25; i++) {
            batch.push({ name: 'session-start', props: {}, ts: new Date().toISOString() });
        }
        const res = await request(app).post('/api/analytics/events').send(batch);
        expect(res.status).toBe(204);
        expect(AnalyticsEvent.insertMany.mock.calls[0][0]).toHaveLength(20);
    });

    it('rejects empty body', async () => {
        const res = await request(app).post('/api/analytics/events').send({});
        expect(res.status).toBe(400);
    });

    it('attaches userId for authenticated users', async () => {
        User.__seedUser({ username: 'player1', passwordHash: bcrypt.hashSync('testpass123', 10), _id: 'user1' });
        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ username: 'player1', password: 'testpass123' });

        const res = await agent.post('/api/analytics/events').send([
            { name: 'login-complete', props: {}, ts: new Date().toISOString() }
        ]);
        expect(res.status).toBe(204);
        const docs = AnalyticsEvent.insertMany.mock.calls[0][0];
        expect(docs[0].userId).toBe('user1');
    });

    it('accepts object body with events key', async () => {
        const res = await request(app)
            .post('/api/analytics/events')
            .send({ events: [{ name: 'room-created', props: {}, ts: new Date().toISOString() }] });
        expect(res.status).toBe(204);
        expect(AnalyticsEvent.insertMany.mock.calls[0][0]).toHaveLength(1);
    });
});

describe('Admin Metrics API', () => {
    it('GET /api/admin/metrics requires auth -> 401', async () => {
        const res = await request(app).get('/api/admin/metrics');
        expect(res.status).toBe(401);
    });

    it('GET /api/admin/metrics forbids non-admins -> 403', async () => {
        User.__seedUser({ username: 'regular', passwordHash: bcrypt.hashSync('testpass123', 10), _id: 'user1' });
        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ username: 'regular', password: 'testpass123' });
        const res = await agent.get('/api/admin/metrics');
        expect(res.status).toBe(403);
    });

    it('GET /api/admin/metrics aggregates for admin', async () => {
        User.__seedUser({ username: 'admin1', passwordHash: bcrypt.hashSync('testpass123', 10), _id: 'admin1', isAdmin: true });
        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ username: 'admin1', password: 'testpass123' });

        for (let i = 0; i < 3; i++) {
            AnalyticsEvent.__events.push({
                name: 'game-started',
                userId: 'user1',
                timestamp: new Date()
            });
        }
        AnalyticsEvent.__events.push({
            name: 'puzzle-solved',
            userId: 'user1',
            timestamp: new Date()
        });

        const res = await agent.get('/api/admin/metrics?days=7');
        expect(res.status).toBe(200);
        expect(res.body.totalEvents).toBe(4);
        expect(res.body.puzzleSolved).toBe(1);

        const gameStarted = res.body.byName.find((e) => e.name === 'game-started');
        expect(gameStarted.count).toBe(3);
        expect(gameStarted.users).toBe(1);

        expect(res.body.daily).toHaveLength(1);
        expect(res.body.daily[0].count).toBe(4);
    });
});