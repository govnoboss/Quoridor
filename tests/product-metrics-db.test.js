const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { loadProductMetrics } = require('../src/analytics/product-metrics');
let mongo, connection, AnalyticsEvent, User;
beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 30000 } });
    connection = await mongoose.createConnection(mongo.getUri(), { serverSelectionTimeoutMS: 5000 }).asPromise();
    AnalyticsEvent = connection.model('ReportEvent', new mongoose.Schema({ name: String, deviceId: String, userId: mongoose.Schema.Types.ObjectId, timestamp: Date, props: mongoose.Schema.Types.Mixed, platform: String }));
    User = connection.model('ReportUser', new mongoose.Schema({ isAdmin: Boolean, isBot: Boolean }));
}, 180000); // A cold CI machine may need to download the isolated MongoDB binary.
afterAll(async () => { if (connection) await connection.close(); if (mongo) await mongo.stop(); });
test('real Mongo aggregation preserves old first games, excludes admin guest devices, and respects complete-day bounds', async () => {
    const admin = await User.create({ isAdmin: true });
    const bot = await User.create({ isBot: true });
    const stamp = date => new Date(date + 'T10:00:00+05:00');
    const add = (deviceId, name, day, extra = {}) => ({ deviceId, name, timestamp: stamp(day), props: {}, ...extra });
    await AnalyticsEvent.insertMany([
        add('returner', 'game-started', '2026-09-01'), add('returner', 'game-started', '2026-11-21'),
        add('new', 'game-started', '2026-11-10'), add('new', 'game-started', '2026-11-11'), add('new', 'game-started', '2026-11-17'),
        add('admin-device', 'game-started', '2026-11-10'), add('admin-device', 'session-start', '2026-11-01', { userId: admin._id }),
        add('', 'game-started', '2026-11-10', { userId: bot._id }), add('today', 'game-started', '2026-11-23'),
        add('test', 'game-started', '2026-11-10')
    ]);
    const report = await loadProductMetrics({ AnalyticsEvent, User, days: 14, now: stamp('2026-11-23'), env: { ANALYTICS_EXCLUDED_DEVICE_IDS: 'test' } });
    expect(report.current.newPlayers).toBe(1); expect(report.current.players).toBe(2);
    expect(report.current.d1.percent).toBe(100); expect(report.current.d7.percent).toBe(100);
    expect(report.current.activeIdentities).toBe(2);
    expect(JSON.stringify(report)).not.toContain('admin-device');
});
