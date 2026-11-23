jest.mock('redis');
jest.mock('../src/storage/db', () => jest.fn().mockResolvedValue());
jest.mock('../src/models/User', () => {
    const docs = new Map();
    const query = value => {
        let result = value;
        return { select() { return this; }, sort() { return this; },
            skip(n) { result = result.slice(n); return this; }, limit(n) { result = result.slice(0, n); return this; }, lean: async () => result,
            then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); } };
    };
    const matches = (doc, filter = {}) => Object.entries(filter).every(([key, value]) => doc[key] === value);
    const Model = jest.fn();
    Model.findById = jest.fn(id => query(docs.get(String(id)) || null));
    Model.findOne = jest.fn(filter => query([...docs.values()].find(u => u.username === filter.username) || null));
    Model.find = jest.fn(filter => query([...docs.values()].filter(u => matches(u, filter))));
    Model.countDocuments = jest.fn(async filter => [...docs.values()].filter(u => matches(u, filter)).length);
    Model.findByIdAndUpdate = jest.fn(async (id, patch) => {
        const doc = docs.get(String(id)); if (!doc) return null;
        Object.assign(doc, patch.$set || (patch.$inc ? {} : patch));
        for (const [key, value] of Object.entries(patch.$inc || {})) doc[key] = (doc[key] || 0) + value;
        return doc;
    });
    Model.seed = data => {
        const doc = { sessionVersion: 0, country: 'KZ', banned: false, stats: {}, ...data };
        doc.save = jest.fn(async () => doc);
        doc.toObject = () => Object.fromEntries(Object.entries(doc).filter(([k]) => !['save', 'toObject', 'passwordHash'].includes(k)));
        docs.set(String(doc._id), doc); return doc;
    };
    Model.clear = () => docs.clear();
    return Model;
});
jest.mock('../src/models/BotSettings', () => {
    let saved;
    class Settings {
        constructor(data) { Object.assign(this, data); }
        async save() { saved = { ...this }; }
        static async findOne() { return saved ? new Settings(saved) : null; }
        static async findOneAndUpdate(_filter, update) { saved = { ...saved, ...update.$set }; return new Settings(saved); }
        static reset() { saved = null; }
    }
    return Settings;
});
jest.mock('../src/models/UserReport', () => {
    const docs = new Map();
    return {
        seed: doc => docs.set(doc._id, { __v: 0, adminNote: '', resolvedAt: null, resolvedBy: null, ...doc }),
        clear: () => docs.clear(),
        findById: jest.fn(async id => docs.has(id) ? { ...docs.get(id) } : null),
        findOneAndUpdate: jest.fn(async (filter, patch) => {
            const current = docs.get(filter._id);
            if (!current || current.status !== filter.status || current.__v !== filter.__v) return null;
            Object.assign(current, patch.$set); current.__v++; return { ...current };
        })
    };
});
jest.mock('../src/models/AdminLog', () => ({ create: jest.fn(async data => data) }));
jest.mock('../src/models/Friendship', () => ({ find: () => ({ select() { return this; }, lean: async () => [] }) }));
jest.mock('../src/models/GameResult', () => ({ find: jest.fn(() => ({ sort() { return this; }, select: async () => [] })) }));

const request = require('supertest');
const { io: connectSocket } = require('socket.io-client');
const bcrypt = require('bcryptjs');
const { setImmediate } = require('node:timers');
const User = require('../src/models/User');
const BotSettings = require('../src/models/BotSettings');
const UserReport = require('../src/models/UserReport');
const AdminLog = require('../src/models/AdminLog');
const BotManager = require('../src/bots/BotManager');
const GameResult = require('../src/models/GameResult');
const { normalizeBotSettings, complaintTransition } = require('../src/admin/policy');

const ids = { admin: '100000000000000000000001', user: '100000000000000000000002',
    bot: '100000000000000000000003', report: '100000000000000000000004' };
const hash = bcrypt.hashSync('test-pass-123', 4);
let api, Redis, admin, port;
const clients = [];
const originalEnv = { ...process.env };
beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = 'admin-stage1-tests';
    api = require('../src/server'); Redis = require('../src/storage/redis');
    await Redis.connect(); await new Promise(resolve => api.server.listen(0, '127.0.0.1', resolve));
    port = api.server.address().port;
});
beforeEach(async () => {
    jest.clearAllMocks(); User.clear(); BotSettings.reset(); UserReport.clear(); api.clearSessionVersionCache();
    process.env.BOTS_ENABLED = 'true'; process.env.BOT_RANKED_ENABLED = 'false';
    process.env.BOT_FALLBACK_MIN_WAIT_MS = '5000'; process.env.BOT_FALLBACK_MAX_WAIT_MS = '10000';
    User.seed({ _id: ids.admin, username: 'test-admin', isAdmin: true, passwordHash: hash });
    User.seed({ _id: ids.user, username: 'test-user', isAdmin: false, passwordHash: hash });
    User.seed({ _id: ids.bot, username: 'test-bot', isBot: true, passwordHash: hash });
    UserReport.seed({ _id: ids.report, target: ids.user, status: 'new', reason: 'other' });
    admin = request.agent(api.app); await admin.post('/api/auth/login').send({ username: 'test-admin', password: 'test-pass-123' }).expect(200);
});
afterEach(async () => {
    for (const socket of clients.splice(0)) socket.close();
    api.io.sockets.sockets.delete('shadow-test-socket');
    await new Promise(resolve => setImmediate(resolve));
    jest.restoreAllMocks();
});
afterAll(async () => {
    await new Promise(resolve => api.io.close(resolve));
    await Redis.disconnect();
    for (const key of ['BOTS_ENABLED', 'BOT_RANKED_ENABLED', 'BOT_FALLBACK_MIN_WAIT_MS', 'BOT_FALLBACK_MAX_WAIT_MS']) {
        if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
    }
});
async function socketEvent(socket, event) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.off(event, listener); reject(new Error('Missing ' + event)); }, 3000);
        const listener = value => { clearTimeout(timer); resolve(value); };
        socket.once(event, listener);
    });
}

test('saved settings survive GET, repeated polling, and startup application despite conflicting env', async () => {
    const runtime = jest.spyOn(BotManager.prototype, 'setRuntimeConfig');
    const save = await admin.put('/api/admin/bots/settings').send({ enabled: false, fallbackMinWaitMs: 1234, fallbackMaxWaitMs: 4567 }).expect(200);
    expect(save.body.settings.rankedEnabled).toBe(false);
    for (let n = 0; n < 2; n++) {
        const res = await admin.get('/api/admin/bots').expect(200);
        expect(res.body.settings.enabled).toBe(false); expect(res.body.settings.fallbackMinWaitMs).toBe(1234);
    }
    expect(runtime).toHaveBeenCalledTimes(1); // reads do not mutate runtime
    process.env.BOT_FALLBACK_MIN_WAIT_MS = '9999';
    await api.applyPersistedBotSettings();
    expect(runtime.mock.calls.at(-1)[0].enabled).toBe(false);
    expect(runtime.mock.calls.at(-1)[0].fallbackMinWaitMs).toBe(1234);
});
test('GET does not create missing settings or write defaults', async () => {
    await admin.get('/api/admin/bots').expect(200); expect(await BotSettings.findOne()).toBeNull();
});
test('initial environment defaults preserve valid zero values', async () => {
    process.env.BOT_FALLBACK_MIN_WAIT_MS = '0';
    const previous = process.env.BOT_MAX_ACTIVE_GAMES;
    process.env.BOT_MAX_ACTIVE_GAMES = '0';
    try {
        const result = await admin.get('/api/admin/bots').expect(200);
        expect(result.body.settings.fallbackMinWaitMs).toBe(0); expect(result.body.settings.maxActiveGames).toBe(0);
    } finally {
        if (previous === undefined) delete process.env.BOT_MAX_ACTIVE_GAMES; else process.env.BOT_MAX_ACTIVE_GAMES = previous;
    }
});
test('partial setting saves preserve omitted flags and fields; invalid types return 400', async () => {
    await admin.put('/api/admin/bots/settings').send({ enabled: false, maxActiveGames: 0 }).expect(200);
    const next = await admin.put('/api/admin/bots/settings').send({ moveMinDelayMs: 9 }).expect(200);
    expect(next.body.settings.enabled).toBe(false); expect(next.body.settings.maxActiveGames).toBe(0);
    for (const body of [{ enabled: 'false' }, { maxActiveGames: null }, { fallbackMinWaitMs: 1.2 }, { recentWindowMs: 2147483648 }]) {
        await admin.put('/api/admin/bots/settings').send(body).expect(400);
    }
});
test('a failed settings write returns 500 and never applies new runtime config', async () => {
    const runtime = jest.spyOn(BotManager.prototype, 'setRuntimeConfig');
    jest.spyOn(BotSettings, 'findOneAndUpdate').mockRejectedValueOnce(new Error('DB failure'));
    await admin.put('/api/admin/bots/settings').send({ enabled: false }).expect(500);
    expect(runtime).not.toHaveBeenCalled();
});
test('ban revokes primed HTTP sessions, disconnects every matching socket and blocks cookie-free token restore', async () => {
    const victim = request.agent(api.app);
    const login = await victim.post('/api/auth/login').send({ username: 'test-user', password: 'test-pass-123' }).expect(200);
    await victim.get('/api/auth/me').expect(200);
    const token = 'admin-stage1-owned-token';
    const socket = connectSocket('http://127.0.0.1:' + port, { autoConnect: false, reconnection: false,
        transports: ['websocket'], auth: { token }, extraHeaders: { Cookie: login.headers['set-cookie'][0].split(';')[0] } });
    clients.push(socket); const connected = socketEvent(socket, 'connect'); socket.connect(); await connected;
    await Redis.setTokenUserMapping(token, ids.user);
    const shadow = { userId: ids.user, emit: jest.fn(), disconnect: jest.fn() };
    api.io.sockets.sockets.set('shadow-test-socket', shadow);
    const disconnected = socketEvent(socket, 'disconnect');
    const banned = await admin.post('/api/admin/users/' + ids.user + '/ban').send({ reason: 'test', durationDays: 1 }).expect(200);
    expect(banned.body.banExpires).toBeTruthy(); await disconnected;
    expect(shadow.disconnect).toHaveBeenCalledWith(true);
    expect((await victim.get('/api/auth/me')).body.isAuthenticated).toBe(false);
    await victim.get('/api/admin/bots').expect(401);
    const again = connectSocket('http://127.0.0.1:' + port, { autoConnect: false, reconnection: false, transports: ['websocket'], auth: { token } });
    clients.push(again); const denied = socketEvent(again, 'connect_error'); again.connect(); expect((await denied).message).toBe('banned');
});
test('ban validates input and protects own/admin/bot accounts', async () => {
    for (const id of [ids.admin, ids.bot]) await admin.post('/api/admin/users/' + id + '/ban').send({}).expect(400);
    for (const body of [{ durationDays: -1 }, { durationDays: 0.5 }, { durationDays: '1' }, { reason: {} }]) {
        await admin.post('/api/admin/users/' + ids.user + '/ban').send(body).expect(400);
    }
    await admin.post('/api/admin/users/bad-id/ban').send({}).expect(400);
});
test('remembered banned tokens cannot resume a game or apply a move through another socket', async () => {
    const Shared = require('../quoridor-engine/rules');
    const Clock = require('../frontend/js/game-clock');
    const token = 'previously-authenticated-user-token';
    await Redis.setTokenUserMapping(token, ids.user);
    const state = Clock.start(Shared.createInitialState({ mode: 'untimed', base: null, inc: 0 }), Date.now());
    state.playerTokens = [token, 'guest-token']; await Redis.saveGame('BAN01', state);
    const doc = await User.findById(ids.user); doc.banned = true;
    expect(await api.resumeGame({}, 'BAN01', token)).toBe(false);
    expect(await api.applyGameMove({ lobbyId: 'BAN01', token, move: { type: 'pawn', r: 7, c: 4 } })).toBe(false);
    expect((await Redis.getGame('BAN01')).history).toHaveLength(0);
});
test.each([
    ['post', '/api/admin/users/' + ids.user + '/ban', {}],
    ['put', '/api/admin/bots/settings', { enabled: false }],
    ['patch', '/api/admin/user-reports/' + ids.report, { status: 'resolved' }]
])('%s %s requires an administrator', async (method, path, body) => {
    await request(api.app)[method](path).send(body).expect(401);
    const user = request.agent(api.app);
    await user.post('/api/auth/login').send({ username: 'test-user', password: 'test-pass-123' }).expect(200);
    await user[method](path).send(body).expect(403);
});
test('banned admin with an existing session is rejected even without a version change', async () => {
    await admin.get('/api/admin/bots').expect(200); // prime the session-version cache
    const doc = await User.findById(ids.admin); doc.banned = true;
    await admin.get('/api/admin/bots').expect(403);
    api.clearSessionVersionCache();
    await admin.get('/api/admin/bots').expect(401);
});
test('an old ban without a session-version bump invalidates HTTP access after cache refresh', async () => {
    const victim = request.agent(api.app);
    await victim.post('/api/auth/login').send({ username: 'test-user', password: 'test-pass-123' }).expect(200);
    const doc = await User.findById(ids.user); doc.banned = true; api.clearSessionVersionCache();
    await victim.post('/api/reports').send({ subject: 'ignored', description: 'No write should occur' }).expect(401);
});
test('unban does not restore revoked HTTP sessions; expired bans allow a fresh login', async () => {
    const victim = request.agent(api.app);
    await victim.post('/api/auth/login').send({ username: 'test-user', password: 'test-pass-123' }).expect(200);
    await admin.post('/api/admin/users/' + ids.user + '/ban').send({ durationDays: null }).expect(200);
    await admin.post('/api/admin/users/' + ids.user + '/unban').expect(200);
    expect((await victim.get('/api/auth/me')).body.isAuthenticated).toBe(false);
    const doc = await User.findById(ids.user); doc.banned = true; doc.banExpires = new Date(Date.now() - 1000);
    await request(api.app).post('/api/auth/login').send({ username: 'test-user', password: 'test-pass-123' }).expect(200);
    expect(doc.banned).toBe(false);
});
test('complaint in-progress, resolution and reopen have accurate metadata and audit targets', async () => {
    let res = await admin.patch('/api/admin/user-reports/' + ids.report).send({ status: 'in_progress', adminNote: 'investigating' }).expect(200);
    expect(res.body.resolvedAt).toBeNull(); expect(res.body.resolvedBy).toBeNull();
    expect(AdminLog.create.mock.calls.at(-1)[0]).toMatchObject({ action: 'user_report_in_progress', target: ids.user, details: { reportId: ids.report, previousStatus: 'new' } });
    res = await admin.patch('/api/admin/user-reports/' + ids.report).send({ status: 'resolved' }).expect(200);
    expect(res.body.resolvedAt).toBeTruthy(); expect(res.body.resolvedBy).toBe(ids.admin); expect(res.body.adminNote).toBe('investigating');
    const count = AdminLog.create.mock.calls.length, timestamp = res.body.resolvedAt;
    res = await admin.patch('/api/admin/user-reports/' + ids.report).send({ status: 'resolved' }).expect(200);
    expect(res.body.resolvedAt).toBe(timestamp); expect(AdminLog.create).toHaveBeenCalledTimes(count);
    res = await admin.patch('/api/admin/user-reports/' + ids.report).send({ status: 'in_progress' }).expect(200);
    expect(res.body.resolvedAt).toBeNull(); expect(res.body.resolvedBy).toBeNull();
});
test('complaint invalid input, missing record, race and DB errors are not success responses', async () => {
    for (const body of [{ status: 'new' }, { status: 'resolved', adminNote: {} }, { status: 'resolved', adminNote: 'x'.repeat(1001) }, { status: 'resolved', version: '0' }]) {
        await admin.patch('/api/admin/user-reports/' + ids.report).send(body).expect(400);
    }
    await admin.patch('/api/admin/user-reports/' + 'a'.repeat(24)).send({ status: 'resolved' }).expect(404);
    jest.spyOn(UserReport, 'findOneAndUpdate').mockResolvedValueOnce(null);
    await admin.patch('/api/admin/user-reports/' + ids.report).send({ status: 'resolved' }).expect(409);
    jest.spyOn(UserReport, 'findOneAndUpdate').mockRejectedValueOnce(new Error('DB failure'));
    await admin.patch('/api/admin/user-reports/' + ids.report).send({ status: 'resolved' }).expect(500);
    expect(AdminLog.create).not.toHaveBeenCalled();
});
test('an old open-card version cannot overwrite a later resolution, while an identical retry is safe', async () => {
    await admin.patch('/api/admin/user-reports/' + ids.report).send({ status: 'resolved', adminNote: 'decision', version: 0 }).expect(200);
    await admin.patch('/api/admin/user-reports/' + ids.report).send({ status: 'dismissed', adminNote: 'stale decision', version: 0 }).expect(409);
    const retry = await admin.patch('/api/admin/user-reports/' + ids.report).send({ status: 'resolved', adminNote: 'decision', version: 0 }).expect(200);
    expect(retry.body.adminNote).toBe('decision'); expect(AdminLog.create).toHaveBeenCalledTimes(1);
});
test('recalculation returns the actual count; database failure returns 500', async () => {
    const result = await admin.post('/api/admin/bots/recalc').expect(200); expect(result.body.updated).toBe(0);
    GameResult.find.mockImplementationOnce(() => { throw new Error('DB failure'); });
    await admin.post('/api/admin/bots/recalc').expect(500);
});
test('normalization preserves accessor-backed document fields and complaint dismiss action', () => {
    const defaults = { enabled: false, rankedEnabled: false, fallbackMinWaitMs: 0, fallbackMaxWaitMs: 10,
        maxActiveGames: 0, moveMinDelayMs: 0, moveMaxDelayMs: 0, maxRecentMatches: 0, recentWindowMs: 60000 };
    const doc = Object.create(Object.fromEntries(Object.entries(defaults).map(([k, value]) => [k, value])));
    expect(normalizeBotSettings({}, doc)).toMatchObject(defaults);
    expect(complaintTransition({ status: 'new' }, { status: 'dismissed' }, ids.admin).action).toBe('user_report_dismissed');
});
test('legacy in-progress resolution metadata is repaired; editing a closed note keeps its closure date', () => {
    const closed = new Date('2026-01-01T00:00:00Z');
    const old = { status: 'in_progress', adminNote: '', resolvedAt: closed, resolvedBy: ids.admin };
    const repaired = complaintTransition(old, { status: 'in_progress' }, ids.admin);
    expect(repaired.unchanged).toBe(false); expect(repaired.update.resolvedAt).toBeNull();
    const edited = complaintTransition({ ...old, status: 'resolved' }, { status: 'resolved', adminNote: 'new note' }, ids.user);
    expect(edited.update.resolvedAt).toBe(closed); expect(edited.update.resolvedBy).toBe(ids.admin);
    expect(edited.action).toBe('user_report_note_updated');
});
test.each(['user_report_in_progress', 'user_report_note_updated'])('audit model accepts %s', action => {
    const Model = jest.requireActual('../src/models/AdminLog');
    expect(new Model({ admin: ids.admin, target: ids.user, action }).validateSync()).toBeUndefined();
});
test('online account filtering and totals apply before server pagination', async () => {
    (await User.findById(ids.user)).online = true;
    (await User.findById(ids.bot)).online = true;
    for (let index = 0; index < 120; index++) User.seed({ _id: (index + 100).toString(16).padStart(24, '0'), username: 'offline-' + index, online: false });
    const result = await admin.get('/api/admin/users?online=true&limit=1&page=2').expect(200);
    expect(result.body.total).toBe(2); expect(result.body.limit).toBe(1); expect(result.body.users).toHaveLength(1);
    expect(result.body.users[0].online).toBe(true);
});
