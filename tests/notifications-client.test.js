const createCenter = require('../frontend/js/notifications');
const { setImmediate } = require('node:timers');
const tick = () => new Promise(setImmediate);
test('envelope is consumed, unread total is not limited to loaded history, and failed reads stay unread', async () => {
    const fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ notifications: [{ _id: 'a', read: false }], total: 25, unreadTotal: 25, page: 1, limit: 20 }) })
        .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'Try later' }) });
    const center = createCenter({ fetch, document: null });
    await center.refresh(); expect(center.state.items).toHaveLength(1); expect(center.state.unreadTotal).toBe(25);
    await expect(center.markRead('a')).rejects.toThrow('Try later'); expect(center.state.items[0].read).toBe(false);
});
test('a stale response cannot overwrite a new refresh and notification snapshots never clear history', async () => {
    let release;
    const fetch = jest.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
        .mockResolvedValueOnce({ ok: true, json: async () => ({ notifications: [{ _id: 'new' }], unreadTotal: 1, total: 1 }) });
    const center = createCenter({ fetch, document: null });
    const old = center.refresh(); await tick(); await center.refresh();
    release({ ok: true, json: async () => ({ notifications: [{ _id: 'old' }], unreadTotal: 5, total: 5 }) }); await old;
    expect(center.state.items[0]._id).toBe('new');
});
test('failed and duplicate reply clicks preserve draft and reuse the retry key', async () => {
    let reject;
    const calls = [];
    const center = createCenter({ document: null, crypto: { randomUUID: () => 'fixed-key' }, fetch: (url, options) => { calls.push({ url, options }); return new Promise((resolve, no) => { reject = no; }); } });
    const first = center.reply('notification', 'report', 'hello');
    const second = center.reply('notification', 'report', 'hello');
    expect(calls).toHaveLength(1); reject(new Error('Offline'));
    await expect(first).rejects.toThrow('Offline'); await second;
    expect(center.state.drafts.get('notification').text).toBe('hello');
    expect(JSON.parse(calls[0].options.body).clientRequestId).toBe('fixed-key');
});
