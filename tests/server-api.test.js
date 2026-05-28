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
            passwordHash: data.passwordHash,
            rating: 1200,
            stats: { totalGames: 0, wins: 0, losses: 0, playTimeSeconds: 0 },
            createdAt: new Date(),
            isBot: false,
            isAdmin: false,
            avatarUrl: '',
            status: '',
            bio: '',
            country: 'XX',
            achievements: [],
            preferences: { boardTheme: 'default', pieceSet: 'default' },
            save: jest.fn().mockResolvedValue(true),
        };
        store.set(user.username, user);
        return user;
    });

    MockUser.findOne = jest.fn(({ username } = {}) => store.get(username) || null);
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

const { setupTestEnvironment, teardownTestEnvironment, getApp } = require('./helpers');

let app;
let User;

beforeAll(async () => {
    jest.setTimeout(30000);
    await setupTestEnvironment();
    app = await getApp();
    User = require('../src/models/User');
}, 30000);

beforeEach(() => {
    jest.clearAllMocks();
    User.__clearStore();
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

describe('Auth API', () => {
    const passwordHash = bcrypt.hashSync('testpass123', 10);

    it('POST /api/auth/register - creates user', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ username: 'testplayer', password: 'testpass123' });
        expect(res.status).toBe(201);
        expect(res.body.message).toBe('User created');
    });

    it('POST /api/auth/register - duplicate username', async () => {
        User.__seedUser({ username: 'testplayer', passwordHash });
        const res = await request(app)
            .post('/api/auth/register')
            .send({ username: 'testplayer', password: 'testpass123' });
        expect(res.status).toBe(400);
    });

    it('POST /api/auth/register - missing fields', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ username: 'nopass' });
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
