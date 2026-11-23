const makeClient = require('../frontend/js/support-client');
const { setImmediate } = require('node:timers');
const id = '123456789012345678901234', other = '223456789012345678901234';
function setup() {
    const nodes = new Map();
    const node = tag => ({ tagName: tag, value: '', style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, children: [], appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; } });
    const document = { hidden: false, createElement: node, getElementById: key => { if (!nodes.has(key)) nodes.set(key, node('div')); return nodes.get(key); } };
    const fetch = jest.fn(async url => ({ ok: true, json: async () => url.endsWith('/read') ? { success: true } : { subject: 'Test', status: 'closed', messages: [{ role: 'admin', text: 'Reply' }] } }));
    const client = makeClient({ document, fetch, crypto: { randomUUID: () => 'request-key' } }, {});
    return { client, fetch, document, el: document.getElementById };
}
test('background replies preserve typed draft and closed ticket still offers a reply', async () => {
    const p = setup(); await p.client.open(id); p.el('replyInput').value = 'Draft';
    await p.client.open(id, true);
    expect(p.el('replyInput').value).toBe('Draft'); expect(p.el('replySection').style.display).toBe('block');
    expect(p.fetch.mock.calls.some(([url]) => url === '/api/reports/' + id + '/read')).toBe(true);
});
test('duplicate sends blocked, network failure preserves text and retry key', async () => {
    const p = setup(); await p.client.open(id); p.el('replyInput').value = 'Hello';
    let reject;
    p.fetch.mockImplementationOnce(() => new Promise((resolve, no) => { reject = no; }));
    const first = p.client.send(); await p.client.send(); expect(p.client.pending.size).toBe(1);
    reject(new Error('Offline')); await first; expect(p.el('replyInput').value).toBe('Hello'); expect(p.el('replyStatus').textContent).toBe('Offline');
    p.fetch.mockImplementationOnce(async () => { throw new Error('Still offline'); }); await p.client.send();
    const requests = p.fetch.mock.calls.filter(([, options]) => options?.body && JSON.parse(options.body).text);
    expect(requests).toHaveLength(2); expect(JSON.parse(requests[0][1].body).clientRequestId).toBe(JSON.parse(requests[1][1].body).clientRequestId);
});
test('late conversation response cannot replace a newer ticket and changing tickets restores drafts', async () => {
    const p = setup(); await p.client.open(id); p.el('replyInput').value = 'First draft';
    let resolve;
    p.fetch.mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
    const pending = p.client.open(id, true); await new Promise(setImmediate); await p.client.open(other);
    resolve({ ok: true, json: async () => ({ subject: 'Stale', status: 'new', messages: [] }) }); await pending;
    expect(p.el('detailSubject').textContent).toBe('Test');
    await p.client.open(id); expect(p.el('replyInput').value).toBe('First draft');
});
test('failed load of a new report disables sending instead of sending from stale conversation', async () => {
    const p = setup(); await p.client.open(id);
    p.fetch.mockRejectedValueOnce(new Error('Offline')); await p.client.open(other);
    p.el('replyInput').value = 'Do not send against stale content';
    const count = p.fetch.mock.calls.length; await p.client.send();
    expect(p.fetch.mock.calls).toHaveLength(count); expect(p.el('sendReplyBtn').disabled).toBe(true);
});
