jest.mock('google-auth-library', () => {
    const nowSec = () => Math.floor(Date.now() / 1000);
    const withPayload = (payload) => ({ getPayload: () => payload });
    const verifyIdToken = jest.fn(async ({ idToken }) => {
        if (idToken === 'valid-token') {
            return withPayload({
                sub: 'google-sub-123',
                email: 'NewUser@Gmail.com',
                email_verified: true,
                name: 'New User',
                picture: 'https://lh3.googleusercontent.com/a/pic',
                iat: nowSec(),
                nonce: 'test-nonce'
            });
        }
        if (typeof idToken === 'string' && idToken.startsWith('reauth:')) {
            return withPayload({
                sub: 'google-sub-123',
                email: 'newuser@gmail.com',
                email_verified: true,
                iat: nowSec(),
                nonce: idToken.slice('reauth:'.length)
            });
        }
        if (idToken === 'stale-token') {
            return withPayload({
                sub: 'google-sub-123',
                email: 'newuser@gmail.com',
                email_verified: true,
                iat: 1000000000,
                nonce: 'stale-nonce'
            });
        }
        if (idToken === 'unverified-token') {
            return withPayload({
                sub: 'google-sub-456',
                email: 'unverified@gmail.com',
                email_verified: false,
                name: 'Unverified'
            });
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
        expect(profile).toEqual(expect.objectContaining({
            googleId: 'google-sub-123',
            email: 'newuser@gmail.com', // lowercased
            emailVerified: true,
            name: 'New User',
            picture: 'https://lh3.googleusercontent.com/a/pic',
            nonce: 'test-nonce'
        }));
        expect(profile.issuedAt).toBeGreaterThan(0);
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

describe('verifyFreshGoogleReauth', () => {
    const OLD = process.env.GOOGLE_CLIENT_ID;
    beforeAll(() => { process.env.GOOGLE_CLIENT_ID = 'test-client-id'; });
    afterAll(() => { process.env.GOOGLE_CLIENT_ID = OLD; });

    it('accepts a fresh token with matching sub and nonce', async () => {
        const { verifyFreshGoogleReauth } = require('../src/auth/google');
        const profile = await verifyFreshGoogleReauth('reauth:abc123', 'google-sub-123', { nonce: 'abc123' });
        expect(profile.googleId).toBe('google-sub-123');
    });

    it('rejects a stale token', async () => {
        const { verifyFreshGoogleReauth } = require('../src/auth/google');
        await expect(verifyFreshGoogleReauth('stale-token', 'google-sub-123', { nonce: 'stale-nonce' }))
            .rejects.toMatchObject({ code: 'REAUTH_STALE' });
    });

    it('rejects a mismatched subject', async () => {
        const { verifyFreshGoogleReauth } = require('../src/auth/google');
        await expect(verifyFreshGoogleReauth('reauth:abc123', 'other-sub', { nonce: 'abc123' }))
            .rejects.toMatchObject({ code: 'REAUTH_MISMATCH' });
    });

    it('rejects a wrong nonce', async () => {
        const { verifyFreshGoogleReauth } = require('../src/auth/google');
        await expect(verifyFreshGoogleReauth('reauth:abc123', 'google-sub-123', { nonce: 'wrong' }))
            .rejects.toMatchObject({ code: 'REAUTH_NONCE' });
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
            sessionVersion: data.sessionVersion || 0,
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
        select(fields) {
            for (const u of store.values()) {
                if (u._id === id) {
                    if (fields === '-passwordHash') { const copy = { ...u }; delete copy.passwordHash; return Promise.resolve(copy); }
                    return Promise.resolve(u);
                }
            }
            return Promise.resolve(null);
        }
    }));
    MockUser.findByIdAndDelete = jest.fn(async (id) => {
        for (const [key, u] of store) {
            if (u._id === id) { store.delete(key); return u; }
        }
        return null;
    });
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
    M.updateMany = jest.fn().mockResolvedValue({});
    return M;
});
jest.mock('../src/models/Friendship', () => {
    const M = jest.fn(() => ({ save: jest.fn().mockResolvedValue(true) }));
    M.deleteMany = jest.fn().mockResolvedValue({});
    M.updateMany = jest.fn().mockResolvedValue({});
    M.find = jest.fn().mockResolvedValue([]);
    return M;
});
jest.mock('../src/models/BotSettings', () => {
    const M = jest.fn();
    M.findOne = jest.fn().mockResolvedValue(null);
    M.findOneAndUpdate = jest.fn().mockResolvedValue(null);
    return M;
});

const request = require('supertest');
const bcrypt = require('bcryptjs');
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
    beforeEach(() => {
        jest.clearAllMocks();
        User.__clearStore();
        require('../src/server').clearSessionVersionCache();
    });
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
        expect(me.body.user.hasPassword).toBe(false);
        expect(me.body.user.passwordHash).toBeUndefined();
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

    it('clears the password when taking over a pre-registered unverified account', async () => {
        User.__seedUser({
            _id: 'u2',
            username: 'victim',
            email: 'newuser@gmail.com',
            emailVerified: false,
            passwordHash: '$2a$10$attackerchosenpasswordhash',
            authProviders: ['password']
        });
        const agent = request.agent(app);
        const res = await agent.post('/api/auth/google').send({ credential: 'valid-token' });
        expect(res.status).toBe(200);
        const linked = await User.findOne({ email: 'newuser@gmail.com' });
        expect(linked.googleId).toBe('google-sub-123');
        expect(linked.passwordHash).toBeUndefined();
        expect(linked.authProviders).not.toContain('password');
        expect(linked.authProviders).toContain('google');
        expect(linked.sessionVersion).toBe(1);
    });

    it('preserves the password of an email-verified account', async () => {
        User.__seedUser({
            _id: 'u3',
            username: 'verified',
            email: 'newuser@gmail.com',
            emailVerified: true,
            passwordHash: '$2a$10$keepthispasswordhash',
            authProviders: ['password']
        });
        const agent = request.agent(app);
        const res = await agent.post('/api/auth/google').send({ credential: 'valid-token' });
        expect(res.status).toBe(200);
        const linked = await User.findOne({ email: 'newuser@gmail.com' });
        expect(linked.googleId).toBe('google-sub-123');
        expect(linked.passwordHash).toBe('$2a$10$keepthispasswordhash');
        expect(linked.authProviders).toEqual(expect.arrayContaining(['password', 'google']));
    });

    it('password login on a Google-only account fails cleanly (400, never 500)', async () => {
        User.__seedUser({ _id: 'u4', username: 'googleonly', email: 'newuser@gmail.com', authProviders: ['google'] });
        const res = await request(app).post('/api/auth/login').send({ username: 'googleonly', password: 'anything' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid credentials');
    });

    it('revokes an existing session when the user session version is bumped', async () => {
        const { clearSessionVersionCache } = require('../src/server');
        User.__seedUser({
            _id: 'u5',
            username: 'svuser',
            email: 'sv@example.com',
            passwordHash: bcrypt.hashSync('correct-password', 10),
            sessionVersion: 0
        });
        const agent = request.agent(app);
        const login = await agent.post('/api/auth/login').send({ username: 'svuser', password: 'correct-password' });
        expect(login.status).toBe(200);

        // Первый запрос с валидной сессией проходит.
        clearSessionVersionCache();
        const before = await agent.get('/api/auth/me');
        expect(before.body.isAuthenticated).toBe(true);

        // Другое устройство/слияние повысило версию — наша сессия должна отвалиться.
        const stored = await User.findOne({ username: 'svuser' });
        stored.sessionVersion = 1;
        clearSessionVersionCache();

        const after = await agent.get('/api/auth/me');
        expect(after.body.isAuthenticated).toBe(false);
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

    it('sets a password for a Google-only account via a fresh Google credential', async () => {
        User.__seedUser({ _id: 'g1', username: 'googset', email: 'newuser@gmail.com', googleId: 'google-sub-123', authProviders: ['google'], sessionVersion: 0 });
        const agent = request.agent(app);
        expect((await agent.post('/api/auth/google').send({ credential: 'valid-token' })).status).toBe(200);

        const challenge = await agent.post('/api/auth/reauth-challenge');
        expect(challenge.status).toBe(200);

        const res = await agent.post('/api/user/password').send({ newPassword: 'brandnewpass1', googleCredential: `reauth:${challenge.body.nonce}` });
        expect(res.status).toBe(200);

        const updated = await User.findOne({ username: 'googset' });
        expect(updated.passwordHash).toBeTruthy();
        expect(updated.authProviders).toContain('password');
        expect(updated.sessionVersion).toBe(1);
    });

    it('rejects setting a password without a valid Google credential', async () => {
        User.__seedUser({ _id: 'g2', username: 'googfail', email: 'newuser@gmail.com', googleId: 'google-sub-123', authProviders: ['google'] });
        const agent = request.agent(app);
        await agent.post('/api/auth/google').send({ credential: 'valid-token' });
        const res = await agent.post('/api/user/password').send({ newPassword: 'brandnewpass1' });
        expect(res.status).toBe(403);
    });

    it('deletes a Google-only account with a fresh Google credential', async () => {
        User.__seedUser({ _id: 'g3', username: 'googdel', email: 'newuser@gmail.com', googleId: 'google-sub-123', authProviders: ['google'] });
        const agent = request.agent(app);
        await agent.post('/api/auth/google').send({ credential: 'valid-token' });
        const challenge = await agent.post('/api/auth/reauth-challenge');
        const res = await agent.delete('/api/user/account').send({ googleCredential: `reauth:${challenge.body.nonce}` });
        expect(res.status).toBe(200);
        expect(await User.findOne({ username: 'googdel' })).toBeNull();
    });

    it('requires the correct password to delete a password account', async () => {
        User.__seedUser({ _id: 'p1', username: 'pwdel', email: 'pwdel@example.com', passwordHash: bcrypt.hashSync('secret123', 10), authProviders: ['password'], sessionVersion: 0 });
        const agent = request.agent(app);
        expect((await agent.post('/api/auth/login').send({ username: 'pwdel', password: 'secret123' })).status).toBe(200);
        const bad = await agent.delete('/api/user/account').send({ password: 'wrong' });
        expect(bad.status).toBe(403);
        expect(await User.findOne({ username: 'pwdel' })).not.toBeNull();
    });
});
