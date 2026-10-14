jest.mock('google-auth-library', () => {
    const verifyIdToken = jest.fn(async ({ idToken }) => {
        if (idToken === 'valid-token') {
            return { getPayload: () => ({
                sub: 'google-sub-123',
                email: 'NewUser@Gmail.com',
                email_verified: true,
                name: 'New User',
                picture: 'https://lh3.googleusercontent.com/a/pic'
            })};
        }
        if (idToken === 'unverified-token') {
            return { getPayload: () => ({
                sub: 'google-sub-456',
                email: 'unverified@gmail.com',
                email_verified: false,
                name: 'Unverified'
            })};
        }
        throw new Error('Invalid token signature');
    });
    return { OAuth2Client: jest.fn(() => ({ verifyIdToken })) };
});

describe('verifyGoogleIdToken', () => {
    const OLD = process.env.GOOGLE_CLIENT_ID;
    beforeAll(() => { process.env.GOOGLE_CLIENT_ID = 'test-client-id'; });
    afterAll(() => { process.env.GOOGLE_CLIENT_ID = OLD; });

    it('returns a normalized profile for a valid token', async () => {
        const { verifyGoogleIdToken } = require('../src/auth/google');
        const profile = await verifyGoogleIdToken('valid-token');
        expect(profile).toEqual({
            googleId: 'google-sub-123',
            email: 'newuser@gmail.com', // lowercased
            emailVerified: true,
            name: 'New User',
            picture: 'https://lh3.googleusercontent.com/a/pic'
        });
    });

    it('rejects an unverified email', async () => {
        const { verifyGoogleIdToken } = require('../src/auth/google');
        await expect(verifyGoogleIdToken('unverified-token')).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
    });

    it('rejects a bad token', async () => {
        const { verifyGoogleIdToken } = require('../src/auth/google');
        await expect(verifyGoogleIdToken('garbage')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    });

    it('throws when GOOGLE_CLIENT_ID is missing', async () => {
        const saved = process.env.GOOGLE_CLIENT_ID;
        delete process.env.GOOGLE_CLIENT_ID;
        const { verifyGoogleIdToken } = require('../src/auth/google');
        await expect(verifyGoogleIdToken('valid-token')).rejects.toThrow(/GOOGLE_CLIENT_ID/);
        process.env.GOOGLE_CLIENT_ID = saved;
    });
});

// --- app-level tests (need the shared harness) ---
jest.mock('redis');
jest.mock('../src/storage/db', () => jest.fn().mockResolvedValue());

jest.mock('../src/models/User', () => {
    const store = new Map();
    let nextId = 1;
    const MockUser = jest.fn().mockImplementation((data) => {
        const user = {
            _id: String(nextId++),
            username: data.username,
            email: data.email || `${data.username}@test.com`,
            passwordHash: data.passwordHash,
            googleId: data.googleId,
            authProviders: data.authProviders || ['password'],
            emailVerified: Boolean(data.emailVerified),
            avatarUrl: data.avatarUrl || '',
            country: data.country || 'XX',
            banned: false,
            save: jest.fn().mockResolvedValue(true)
        };
        store.set(user.username, user);
        return user;
    });
    MockUser.findOne = jest.fn((query = {}) => {
        if (query.username) return store.get(query.username) || null;
        for (const u of store.values()) {
            if (query.email && u.email === query.email) return u;
            if (query.googleId && u.googleId === query.googleId) return u;
        }
        return null;
    });
    MockUser.findById = jest.fn((id) => ({
        select() {
            for (const u of store.values()) if (u._id === id) return Promise.resolve({ ...u });
            return Promise.resolve(null);
        }
    }));
    MockUser.__clearStore = () => { store.clear(); nextId = 1; };
    MockUser.__seedUser = (data) => {
        const user = { _id: String(nextId++), ...data, save: jest.fn().mockResolvedValue(true) };
        store.set(user.username, user);
        return user;
    };
    return MockUser;
});
jest.mock('../src/models/GameResult', () => {
    const M = jest.fn(() => ({ save: jest.fn().mockResolvedValue(true) }));
    M.find = jest.fn().mockResolvedValue([]);
    M.findById = jest.fn().mockResolvedValue(null);
    return M;
});
jest.mock('../src/models/BotSettings', () => {
    const M = jest.fn();
    M.findOne = jest.fn().mockResolvedValue(null);
    M.findOneAndUpdate = jest.fn().mockResolvedValue(null);
    return M;
});

const request = require('supertest');
const { setupTestEnvironment, teardownTestEnvironment, getApp } = require('./helpers');

describe('POST /api/auth/google', () => {
    let app, User;
    beforeAll(async () => {
        jest.setTimeout(30000);
        await setupTestEnvironment();
        process.env.GOOGLE_CLIENT_ID = 'test-client-id';
        app = await getApp();
        User = require('../src/models/User');
    }, 30000);
    beforeEach(() => { jest.clearAllMocks(); User.__clearStore(); });
    afterAll(async () => { await teardownTestEnvironment(); });

    it('GET /api/auth/config returns the public client id and creates a session on valid token', async () => {
        const cfg = await request(app).get('/api/auth/config');
        expect(cfg.status).toBe(200);
        expect(cfg.body.googleClientId).toBe('test-client-id');

        const agent = request.agent(app);
        const res = await agent.post('/api/auth/google').send({ credential: 'valid-token' });
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Logged in');
        expect(res.body.user.username).toBe('newuser');

        const me = await agent.get('/api/auth/me');
        expect(me.body.isAuthenticated).toBe(true);
        expect(me.body.user.googleId).toBe('google-sub-123');
    });

    it('links an existing password account by email', async () => {
        User.__seedUser({ _id: 'u1', username: 'existing', email: 'newuser@gmail.com' });
        const agent = request.agent(app);
        const res = await agent.post('/api/auth/google').send({ credential: 'valid-token' });
        expect(res.status).toBe(200);
        const linked = await User.findOne({ email: 'newuser@gmail.com' });
        expect(linked.googleId).toBe('google-sub-123');
        expect(linked.authProviders).toContain('google');
    });

    it('rejects an unverified Google email with 400', async () => {
        const res = await request(app).post('/api/auth/google').send({ credential: 'unverified-token' });
        expect(res.status).toBe(400);
    });

    it('rejects a bad credential with 401', async () => {
        const res = await request(app).post('/api/auth/google').send({ credential: 'garbage' });
        expect(res.status).toBe(401);
    });

    it('rejects a missing credential with 401', async () => {
        const res = await request(app).post('/api/auth/google').send({});
        expect(res.status).toBe(401);
    });
});
