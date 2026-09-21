jest.mock('redis');
jest.mock('../src/storage/db', () => jest.fn().mockResolvedValue());

const bcrypt = require('bcryptjs');
const request = require('supertest');

// Mock User model
jest.mock('../src/models/User', () => {
    const store = new Map();
    let nextId = 1;

    const MockUser = jest.fn().mockImplementation((data) => {
        const user = {
            _id: String(nextId++),
            username: data.username,
            email: data.email || `${data.username}@test.com`,
            passwordHash: data.passwordHash,
            rating: 1200,
            stats: { totalGames: 0, wins: 0, losses: 0, playTimeSeconds: 0 },
            createdAt: new Date(),
            isBot: false,
            isAdmin: false,
            achievements: [],
            preferences: { boardTheme: 'default', pieceSet: 'default' },
            puzzleStreak: data.puzzleStreak ?? 0,
            lastPuzzleDate: data.lastPuzzleDate || '',
            puzzlesSolved: data.puzzlesSolved ?? 0,
            save: jest.fn().mockResolvedValue(true),
        };
        store.set(user.username, user);
        return user;
    });

    MockUser.findOne = jest.fn((query = {}) => {
        if (query.username) return store.get(query.username) || null;
        return null;
    });
    MockUser.findById = jest.fn((id) => {
        let fields = null;
        const chain = {
            select(f) { fields = f; return chain; },
            then(resolve, _reject) {
                let found = null;
                for (const user of store.values()) {
                    if (user._id === id) { found = user; break; }
                }
                if (!found) return resolve(null);
                if (fields === '-passwordHash') {
                    const copy = { ...found };
                    delete copy.passwordHash;
                    resolve(copy);
                } else {
                    resolve(found);
                }
            }
        };
        return chain;
    });
    MockUser.find = jest.fn(() => Promise.resolve([]));
    MockUser.findByIdAndUpdate = jest.fn(() => Promise.resolve(null));

    MockUser.__clearStore = () => { store.clear(); nextId = 1; };
    MockUser.__seedUser = (data) => {
        const user = { _id: String(nextId++), ...data, save: jest.fn().mockResolvedValue(true) };
        store.set(user.username, user);
        return user;
    };
    MockUser.__getStore = () => store;

    return MockUser;
});

// Mock GameResult with chainable find (puzzle generator uses it)
jest.mock('../src/models/GameResult', () => {
    const games = [];
    const MockGameResult = jest.fn().mockImplementation((data) => {
        return { ...data, save: jest.fn().mockResolvedValue(true) };
    });
    MockGameResult.find = jest.fn((_query = {}) => {
        const chain = {
            select() { return chain; },
            sort() { return chain; },
            limit() { return chain; },
            lean() { return Promise.resolve(games.slice()); },
            then(resolve, _reject) { return Promise.resolve(games.slice()).then(resolve, _reject); }
        };
        return chain;
    });
    MockGameResult.findById = jest.fn().mockResolvedValue(null);
    MockGameResult.__seed = (g) => games.push(g);
    MockGameResult.__reset = () => { games.length = 0; };
    return MockGameResult;
});

// Mock DailyPuzzle with in-memory store
jest.mock('../src/models/DailyPuzzle', () => {
    const store = new Map();
    const MockDailyPuzzle = jest.fn().mockImplementation((data) => ({ ...data }));
    MockDailyPuzzle.findOne = jest.fn(async (query = {}) => store.get(query.date) || null);
    MockDailyPuzzle.create = jest.fn(async (doc) => {
        store.set(doc.date, doc);
        return doc;
    });
    MockDailyPuzzle.findOneAndUpdate = jest.fn(async () => null);
    MockDailyPuzzle.__get = (date) => store.get(date) || null;
    MockDailyPuzzle.__reset = () => store.clear();
    return MockDailyPuzzle;
});

// Mock AnalyticsEvent (only create is used by puzzle solve)
jest.mock('../src/models/AnalyticsEvent', () => {
    const events = [];
    const MockAnalyticsEvent = jest.fn().mockImplementation(() => ({}));
    MockAnalyticsEvent.create = jest.fn(async (doc) => {
        events.push(doc);
        return doc;
    });
    MockAnalyticsEvent.__events = events;
    MockAnalyticsEvent.__reset = () => { events.length = 0; };
    return MockAnalyticsEvent;
});

const { setupTestEnvironment, teardownTestEnvironment, getApp } = require('./helpers');

let app;
let User;
let DailyPuzzle;
let AnalyticsEvent;

beforeAll(async () => {
    jest.setTimeout(30000);
    await setupTestEnvironment();
    app = await getApp();
    User = require('../src/models/User');
    DailyPuzzle = require('../src/models/DailyPuzzle');
    AnalyticsEvent = require('../src/models/AnalyticsEvent');
}, 30000);

beforeEach(() => {
    jest.clearAllMocks();
    User.__clearStore();
    DailyPuzzle.__reset();
    AnalyticsEvent.__reset();
});

afterAll(async () => {
    await teardownTestEnvironment();
});

describe('Daily Puzzle API', () => {
    it('GET /api/puzzles/today auto-generates the fallback puzzle without games', async () => {
        const res = await request(app).get('/api/puzzles/today');
        expect(res.status).toBe(200);
        expect(res.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(res.body.winner).toBe(0);
        expect(res.body.solutionLength).toBe(1);
        expect(res.body.moves.length).toBe(14); // FALLBACK_HISTORY
        expect(DailyPuzzle.create).toHaveBeenCalledTimes(1);
        // guest: no streak info
        expect(res.body.streak).toBe(0);
        expect(res.body.solvedToday).toBe(false);
    });

    it('GET /api/puzzles/today returns persisted puzzle and user state when logged in', async () => {
        User.__seedUser({ username: 'player1', _id: 'user1', passwordHash: bcrypt.hashSync('testpass123', 10), puzzleStreak: 3, lastPuzzleDate: '2000-01-01', puzzlesSolved: 5 });
        const first = await request(app).get('/api/puzzles/today');
        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ username: 'player1', password: 'testpass123' });

        const res = await agent.get('/api/puzzles/today');
        expect(res.status).toBe(200);
        expect(res.body.date).toBe(first.body.date);
        expect(res.body.streak).toBe(3);
        expect(res.body.puzzlesSolved).toBe(5);
        expect(res.body.solvedToday).toBe(false);
        // No second creation
        expect(DailyPuzzle.create).toHaveBeenCalledTimes(1);
    });

    it('POST /api/puzzles/solve rejects missing/invalid move', async () => {
        await request(app).get('/api/puzzles/today');
        const res = await request(app).post('/api/puzzles/solve').send({});
        expect(res.status).toBe(400);
    });

    it('POST /api/puzzles/solve rejects illegal move', async () => {
        await request(app).get('/api/puzzles/today');
        const res = await request(app)
            .post('/api/puzzles/solve')
            .send({ move: { type: 'pawn', r: 4, c: 4 } });
        expect(res.status).toBe(200);
        expect(res.body.solved).toBe(false);
        expect(res.body.message).toBe('Invalid pawn move');
    });

    it('POST /api/puzzles/solve rejects legal but non-winning move', async () => {
        await request(app).get('/api/puzzles/today');
        const res = await request(app)
            .post('/api/puzzles/solve')
            .send({ move: { type: 'pawn', r: 1, c: 3 } });
        expect(res.status).toBe(200);
        expect(res.body.solved).toBe(false);
        expect(res.body.message).toBe('Wrong move');
    });

    it('POST /api/puzzles/solve accepts winning move for guests (no streak)', async () => {
        await request(app).get('/api/puzzles/today');
        const res = await request(app)
            .post('/api/puzzles/solve')
            .send({ move: { type: 'pawn', r: 0, c: 4 } });
        expect(res.status).toBe(200);
        expect(res.body.solved).toBe(true);
        expect(res.body.alreadySolved).toBe(false);
        expect(res.body.streak).toBe(null);

        const event = AnalyticsEvent.__events.find((e) => e.name === 'puzzle-solved');
        expect(event).toBeTruthy();
        expect(event.userId).toBe(null);
    });

    it('POST /api/puzzles/solve updates streak once per day for logged users', async () => {
        await request(app).get('/api/puzzles/today');

        User.__seedUser({ username: 'solver', _id: 'user1', passwordHash: bcrypt.hashSync('testpass123', 10) });
        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ username: 'solver', password: 'testpass123' });

        const first = await agent.post('/api/puzzles/solve').send({ move: { type: 'pawn', r: 0, c: 4 } });
        expect(first.status).toBe(200);
        expect(first.body.solved).toBe(true);
        expect(first.body.streak).toBe(1);
        expect(first.body.puzzlesSolved).toBe(1);

        const second = await agent.post('/api/puzzles/solve').send({ move: { type: 'pawn', r: 0, c: 4 } });
        expect(second.body.solved).toBe(true);
        expect(second.body.alreadySolved).toBe(true);
        expect(second.body.streak).toBe(1);
        expect(second.body.puzzlesSolved).toBe(1);

        const storeUser = Array.from(User.__getStore().values())[0];
        expect(storeUser.puzzleStreak).toBe(1);
        expect(storeUser.puzzlesSolved).toBe(1);

        const events = AnalyticsEvent.__events.filter((e) => e.name === 'puzzle-solved');
        expect(events).toHaveLength(2);
        expect(events[0].userId).toBe('user1');
    });

    it('POST /api/puzzles/solve continues streak on consecutive days', async () => {
        const { yesterdayDateKey } = require('../src/puzzles/puzzleGenerator');
        await request(app).get('/api/puzzles/today');

        User.__seedUser({
            username: 'streaker',
            _id: 'user2',
            passwordHash: bcrypt.hashSync('testpass123', 10),
            puzzleStreak: 4,
            lastPuzzleDate: yesterdayDateKey(),
            puzzlesSolved: 9
        });
        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ username: 'streaker', password: 'testpass123' });

        const res = await agent.post('/api/puzzles/solve').send({ move: { type: 'pawn', r: 0, c: 4 } });
        expect(res.body.solved).toBe(true);
        expect(res.body.streak).toBe(5);
        expect(res.body.puzzlesSolved).toBe(10);
    });
});