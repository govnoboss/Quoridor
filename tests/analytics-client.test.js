const vm = require('node:vm');
const fs = require('node:fs');
const { Blob } = require('node:buffer');
function client(pathname = '/') {
    const storage = new Map(); const sent = [];
    const ctx = { console, Date, Math, Blob, setTimeout: jest.fn(), clearTimeout: jest.fn(),
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
        navigator: { sendBeacon: (url, blob) => { sent.push(blob); return true; } },
        document: { addEventListener: jest.fn() },
        window: { location: { pathname }, addEventListener: jest.fn() } };
    vm.runInNewContext(fs.readFileSync('frontend/js/analytics.js', 'utf8'), ctx);
    return { ctx, storage, sent, track: ctx.window.trackEvent, flush: ctx.window.Analytics.flush };
}
async function events(client) { return (await Promise.all(client.sent.map(async blob => JSON.parse(await blob.text())))).flatMap(batch => batch.events); }
test('batch retains device/platform metadata and links only explicit game IDs', async () => {
    const c = client(); c.track('game-started', { mode: 'normal', gameId: 'g' }); c.track('game-finished', { gameId: 'g' }); c.flush();
    const batch = JSON.parse(await c.sent[0].text());
    expect(batch.deviceId).toBeTruthy(); expect(batch.sessionId).toBeTruthy();
    expect(batch.events.find(e => e.name === 'game-started').props).toMatchObject({ mode: 'online', gameId: 'g', measurementVersion: 2 });
    expect(batch.events.find(e => e.name === 'game-finished').props.gameId).toBe('g');
});
test('search IDs link an attempt exactly once; unsolicited matches remain unlinked', async () => {
    const c = client(); c.track('search-started'); c.track('search-matched'); c.track('search-matched'); c.flush();
    const rows = (await events(c)).filter(e => e.name.startsWith('search-'));
    expect(rows[0].props.searchId).toBeTruthy(); expect(rows[1].props.searchId).toBe(rows[0].props.searchId);
    expect(rows[2].props.searchId).toBeUndefined();
});
test('admin pages and explicit test-device opt-out send no events', () => {
    const admin = client('/admin/metrics'); admin.flush(); expect(admin.sent).toHaveLength(0);
    const c = client(); c.flush(); c.sent.length = 0; c.storage.set('analytics.disabled', '1'); c.track('game-started', { gameId: 'g' }); c.flush();
    expect(c.sent).toHaveLength(0);
});
test('more than twenty events are sent in separate batches without losing entries', async () => {
    const c = client(); for (let i = 0; i < 45; i++) c.track('screen-view');
    c.flush(); // One pagehide must drain the entire queue, not just its first batch.
    expect((await events(c)).length).toBe(47); // includes session-start and app-loaded
    expect(c.sent).toHaveLength(3);
});
