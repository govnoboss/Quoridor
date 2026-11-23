const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const request = require('supertest');
const fs = require('node:fs');
const vm = require('node:vm');
const { createNotificationService } = require('../src/notifications/service');
const { registerNotificationRoutes } = require('../src/notifications/routes');
let mongo, connection, User, Report, Notification, service, app, owner, admin, stranger;
const emits = [];
const sendEmail = jest.fn();
beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 30000 } });
    connection = await mongoose.createConnection(mongo.getUri()).asPromise();
    User = connection.model('User', require('../src/models/User').schema.clone());
    Report = connection.model('Report', require('../src/models/Report').schema.clone());
    Notification = connection.model('Notification', require('../src/models/Notification').schema.clone());
    await Promise.all([User.init(), Report.init(), Notification.init()]);
}, 180000);
afterAll(async () => { if (connection) await connection.close(); if (mongo) await mongo.stop(); });
beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Report.deleteMany({}), Notification.deleteMany({})]);
    [owner, admin, stranger] = await User.create([{ username: 'owner', email: 'owner@example.test' }, { username: 'admin', email: 'admin@example.test', isAdmin: true }, { username: 'stranger', email: 'stranger@example.test' }]);
    emits.length = 0; sendEmail.mockReset(); sendEmail.mockResolvedValue({ id: 'mail' });
    service = createNotificationService({ User, Report, Notification, getSocket: id => ({ emit: (event, value) => emits.push({ id: String(id), event, value }) }), sendEmail });
    app = express(); app.use(express.json());
    app.use((req, res, next) => { req.session = { userId: req.headers['x-user'] }; next(); });
    registerNotificationRoutes({ app, User, Report, Notification, service, reportLimiter: (req, res, next) => next(), requireAdmin: (req, res, next) => String(req.session.userId) === String(admin._id) ? next() : res.sendStatus(403), getClientIp: () => '' });
});
const as = (method, url, user = owner) => request(app)[method](url).set('x-user', String(user._id));
async function ticket() { const res = await as('post', '/api/reports').send({ subject: 'Support test', description: 'A reproducible test problem' }); expect(res.status).toBe(201); return res.body.id; }
test('new ticket alerts admin; replies are idempotent, linked and survive notification failure', async () => {
    const id = await ticket();
    expect(await Notification.countDocuments({ recipient: admin._id, type: 'bug_report_update' })).toBe(1);
    const body = { reply: 'We fixed it', clientRequestId: 'reply-key-123' };
    expect((await as('patch', '/api/admin/reports/' + id, admin).send(body)).status).toBe(200);
    expect((await as('patch', '/api/admin/reports/' + id, admin).send(body)).status).toBe(200);
    expect((await Report.findById(id)).messages.filter(m => m.role === 'admin')).toHaveLength(1);
    expect(await Notification.countDocuments({ recipient: owner._id, type: 'admin_message' })).toBe(1);
    expect(emits.some(e => e.event === 'notification:new' && e.id === String(owner._id))).toBe(true);
    expect(sendEmail).not.toHaveBeenCalled();
});
test('failed delivery is durable and retry does not duplicate notifications', async () => {
    const id = await ticket();
    const create = jest.spyOn(service, 'create').mockRejectedValueOnce(new Error('temporary outage'));
    expect((await as('patch', '/api/admin/reports/' + id, admin).send({ reply: 'Retry me', clientRequestId: 'retry-key' })).status).toBe(200);
    expect((await Report.findById(id)).messages.at(-1).notificationPending).toBe(true);
    create.mockRestore(); await service.drain(); await service.drain();
    expect(await Notification.countDocuments({ recipient: owner._id })).toBe(1);
    expect((await Report.findById(id)).messages.at(-1).notificationPending).toBe(false);
});
test('history has full unread total; read is owned/idempotent and report reads are scoped', async () => {
    const id = await ticket();
    await Notification.insertMany(Array.from({ length: 25 }, (_, i) => ({ recipient: owner._id, type: 'admin_message', title: String(i), data: { reportId: id } })));
    let res = await as('get', '/api/notifications');
    expect(res.body.notifications).toHaveLength(20); expect(res.body.unreadTotal).toBe(25);
    res = await as('get', '/api/notifications?page=2'); expect(res.body.notifications).toHaveLength(5);
    const nid = res.body.notifications[0]._id;
    expect((await as('patch', '/api/notifications/' + nid + '/read', stranger)).status).toBe(404);
    await as('patch', '/api/notifications/' + nid + '/read'); await as('patch', '/api/notifications/' + nid + '/read');
    expect((await User.findById(owner._id)).unreadNotifications).toBe(24);
    expect((await as('post', '/api/reports/' + id + '/read').send()).status).toBe(200);
    expect((await as('get', '/api/notifications')).body.unreadTotal).toBe(0);
    expect((await as('get', '/api/reports/' + id, stranger)).status).toBe(403);
    expect((await request(app).get('/api/notifications')).status).toBe(401);
});
test('bad input is 400; owner may reopen closed report; conversation uses no user IP', async () => {
    const id = await ticket();
    expect((await as('post', '/api/reports/' + id + '/reply').send({ text: [] })).status).toBe(400);
    expect((await as('patch', '/api/notifications/bad/read')).status).toBe(400);
    await as('patch', '/api/admin/reports/' + id, admin).send({ status: 'closed' });
    const res = await as('post', '/api/reports/' + id + '/reply').send({ text: 'Please reopen', clientRequestId: 'reopen' }); expect(res.status).toBe(200);
    expect((await Report.findById(id)).status).toBe('in_progress');
    expect((await as('get', '/api/reports/' + id)).body.ip).toBeUndefined();
});
test('old invitations expire without deletion; email opt-in and failures are respected', async () => {
    const old = await Notification.create({ recipient: owner._id, type: 'game_invite', title: 'Old', createdAt: new Date(Date.now() - 300000) });
    const list = await as('get', '/api/notifications'); expect(list.body.notifications.find(n => n._id === String(old._id)).actionable).toBe(false);
    expect((await as('patch', '/api/notifications/preferences').send({ supportEmail: 'yes' })).status).toBe(400);
    await as('patch', '/api/notifications/preferences').send({ supportEmail: true });
    const id = await ticket(); await as('patch', '/api/admin/reports/' + id, admin).send({ reply: 'Email this', clientRequestId: 'mail-key' });
    sendEmail.mockRejectedValueOnce(new Error('mail outage')); await service.deliverEmails();
    const n = await Notification.findOne({ recipient: owner._id, type: 'admin_message' }); expect(n.email.state).toBe('pending'); expect(n.email.attempts).toBe(1);
    await Notification.updateOne({ _id: n._id }, { $set: { 'email.nextAttemptAt': new Date(0) } });
    await service.deliverEmails(); expect((await Notification.findById(n._id)).email.state).toBe('sent');
});
test('socket invitation rejects expired, foreign and offline attempts with acknowledgement and preserves unread state', async () => {
    let accept;
    const socket = { userId: String(owner._id), playerToken: 'owner-token', on: (event, fn) => { if (event === 'acceptGameInvite') accept = fn; }, emit: jest.fn(), handshake: { auth: { clockVersion: 2 } } };
    const source = fs.readFileSync('src/server.js', 'utf8');
    const start = source.indexOf('    const pendingInviteAccepts =');
    const end = source.indexOf("    socket.on('disconnect'", start);
    vm.runInNewContext(source.slice(start, end), { socket, Notification, notificationService: service, publicNotification: require('../src/notifications/service').publicNotification, Friendship: { findOne: async () => ({}) }, isPlayerBusy: async () => false, findSocketByUserId: () => null, console });
    const old = await Notification.create({ recipient: owner._id, type: 'game_invite', title: 'Old', data: { requesterId: stranger._id }, createdAt: new Date(Date.now() - 300000) });
    const ack = jest.fn(); await accept({ fromId: String(stranger._id), notificationId: String(old._id) }, ack);
    expect(ack).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, error: expect.stringContaining('expired') }));
    const fresh = await Notification.create({ recipient: owner._id, type: 'game_invite', title: 'Fresh', data: { requesterId: stranger._id } });
    await accept({ fromId: String(stranger._id), notificationId: String(fresh._id) }, ack);
    expect(ack).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, error: 'Friend is offline' }));
    expect((await Notification.findById(fresh._id)).read).toBe(false);
    await accept({ fromId: String(admin._id), notificationId: String(fresh._id) }, ack);
    expect(ack).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false }));
});
test('successful invitation starts both players once and then becomes accepted/read', async () => {
    let accept;
    const receiver = { id: 'receiver', userId: String(owner._id), playerToken: 'owner-token', on: (event, fn) => { if (event === 'acceptGameInvite') accept = fn; }, emit: jest.fn(), join: jest.fn(), handshake: { auth: { clockVersion: 2 } } };
    const sender = { id: 'sender', playerToken: 'sender-token', emit: jest.fn(), join: jest.fn(), handshake: { auth: { clockVersion: 2 } } };
    let room;
    const Redis = { createRoom: async (code, value) => { room = value; }, getRoom: async () => room, deleteRoom: async () => { room = null; }, saveGame: jest.fn(), addActiveGame: jest.fn() };
    const source = fs.readFileSync('src/server.js', 'utf8'), start = source.indexOf('    const pendingInviteAccepts ='), end = source.indexOf("    socket.on('disconnect'", start);
    vm.runInNewContext(source.slice(start, end), { socket: receiver, Notification, notificationService: service, publicNotification: require('../src/notifications/service').publicNotification,
        Friendship: { findOne: async () => ({}) }, isPlayerBusy: async () => false, findSocketByUserId: () => sender,
        generateUniqueRoomCode: async () => '12345', Redis, io: { sockets: { sockets: new Map([['receiver', receiver], ['sender', sender]]) } },
        Shared: { createInitialState: () => ({ playerSockets: [], playerTokens: [], playerProfiles: [] }) }, getPlayerProfile: async () => ({}),
        prepareNewGame() {}, scheduleClock: async () => {}, linkPlayersToLobbyByToken: async () => {}, Clock: { payload: () => ({}) }, schedulePresenceBroadcast() {}, console });
    const n = await Notification.create({ recipient: owner._id, type: 'game_invite', title: 'Fresh', data: { requesterId: stranger._id } }), ack = jest.fn();
    const payload = { fromId: String(stranger._id), notificationId: String(n._id) };
    await accept(payload, ack); expect(ack).toHaveBeenLastCalledWith({ ok: true });
    const saved = await Notification.findById(n._id); expect(saved.read).toBe(true); expect(saved.actionStatus).toBe('accepted');
    expect(receiver.emit.mock.calls.some(([name]) => name === 'gameStart')).toBe(true); expect(sender.emit.mock.calls.some(([name]) => name === 'gameStart')).toBe(true);
    await accept(payload, ack); expect(ack).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false })); expect(Redis.saveGame).toHaveBeenCalledTimes(1);
});
