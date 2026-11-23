const fs = require('node:fs');
const vm = require('node:vm');
const { setImmediate } = require('node:timers');
const { URLSearchParams } = require('node:url');
const { Response } = globalThis;
const makeAPI = require('../frontend/js/admin-api');

function documentFixture() {
    const nodes = new Map();
    const createElement = tag => {
        const result = { tagName: tag.toUpperCase(), value: '', checked: false, disabled: false,
            textContent: '', style: {}, listeners: {}, children: [], attributes: {}, classList: { add() {}, remove() {}, toggle() {} },
            addEventListener(type, fn) { this.listeners[type] = fn; },
            setAttribute(name, value) { this.attributes[name] = value; },
            appendChild(child) { this.children.push(child); return child; } };
        result.replaceChildren = function () { this.children.length = 0; };
        Object.defineProperty(result, 'innerHTML', { get() { return this.html || ''; }, set(value) { this.html = value; this.children.length = 0; } });
        return result;
    };
    const node = id => {
        if (!nodes.has(id)) nodes.set(id, createElement('div'));
        return nodes.get(id);
    };
    return { nodes, getElementById: node, createElement, activeElement: null };
}
const settings = { enabled: true, rankedEnabled: false, fallbackMinWaitMs: 5000, fallbackMaxWaitMs: 10000,
    maxActiveGames: 15, moveMinDelayMs: 800, moveMaxDelayMs: 2500, maxRecentMatches: 3, recentWindowMs: 3600000 };
const flush = () => new Promise(resolve => setImmediate(resolve));
async function page(name, initial, status = 200) {
    const document = documentFixture();
    const nativeFetch = jest.fn(async () => Response.json(initial, { status }));
    const ctx = { document, fetch: nativeFetch, PQSupportClient: require('../frontend/js/support-client'), location: { search: '' }, AdminAPI: makeAPI({ fetch: nativeFetch, document }), console,
        URLSearchParams, setInterval: jest.fn(), confirm: jest.fn(() => true), prompt: jest.fn(), alert: jest.fn() };
    ctx.window = ctx;
    vm.createContext(ctx);
    const html = fs.readFileSync('frontend/' + name + '.html', 'utf8');
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(match[1], ctx);
    await flush();
    return { ctx, document, nativeFetch, element: document.getElementById };
}

test.each([401, 403, 409, 500])('HTTP %i is rejected with the server message, never returned as success', async status => {
    const api = makeAPI({ fetch: async () => Response.json({ error: 'Operation rejected' }, { status }) });
    await expect(api.fetch('/api/admin/users/id/ban', { method: 'POST' })).rejects.toMatchObject({ status, message: 'Operation rejected' });
});
test('network and proxy HTML failures produce actionable errors', async () => {
    await expect(makeAPI({ fetch: async () => { throw new TypeError('socket lost'); } }).fetch('/api/admin/users')).rejects.toThrow('Network error');
    await expect(makeAPI({ fetch: async () => new Response('<html>bad gateway</html>', { status: 502 }) }).fetch('/api/admin/users')).rejects.toThrow('HTTP 502');
});
test('duplicate mutations are blocked and the initiating button is restored on failure', async () => {
    const button = { tagName: 'BUTTON', disabled: false }; let release;
    const fetch = jest.fn(() => new Promise(resolve => { release = resolve; }));
    const api = makeAPI({ fetch, document: { activeElement: button } });
    const pending = api.fetch('/api/admin/bots/recalc', { method: 'POST' });
    expect(button.disabled).toBe(true);
    await expect(api.fetch('/api/admin/bots/recalc', { method: 'POST' })).rejects.toThrow('already in progress');
    expect(fetch).toHaveBeenCalledTimes(1);
    release(Response.json({ error: 'DB unavailable' }, { status: 500 }));
    await expect(pending).rejects.toThrow('DB unavailable'); expect(button.disabled).toBe(false);
});
test('bot polling preserves edited settings and does not clear the dirty message', async () => {
    const p = await page('admin-bots', { settings, bots: [], runtime: {}, presence: {} });
    const input = p.element('fallbackMinWaitMs'); input.value = '1234'; input.listeners.input();
    const message = p.element('settingsStatus').textContent;
    await p.ctx.setInterval.mock.calls[0][0]();
    expect(input.value).toBe('1234'); expect(p.element('settingsStatus').textContent).toBe(message);
    p.ctx.confirm.mockReturnValue(false); p.element('reloadBtn').listeners.click(); await flush();
    expect(input.value).toBe('1234'); expect(p.ctx.confirm).toHaveBeenCalled();
});
test('failed bot save keeps edited values and displays the server error', async () => {
    const p = await page('admin-bots', { settings, bots: [], runtime: {}, presence: {} });
    const input = p.element('fallbackMinWaitMs'); input.value = '1234'; input.listeners.input();
    p.nativeFetch.mockResolvedValueOnce(Response.json({ error: 'Database unavailable' }, { status: 500 }));
    p.element('saveSettingsBtn').listeners.click(); await flush();
    expect(input.value).toBe('1234'); expect(p.element('settingsStatus').textContent).toBe('Database unavailable');
});
test('polling recovers an initial load failure before enabling settings editing/saving', async () => {
    const p = await page('admin-bots', { error: 'Temporarily unavailable' }, 503);
    expect(p.element('fallbackMinWaitMs').disabled).toBe(true);
    await expect(p.ctx.saveSettings()).rejects.toThrow('Load settings');
    p.nativeFetch.mockResolvedValueOnce(Response.json({ settings, bots: [], runtime: {}, presence: {} }));
    await p.ctx.setInterval.mock.calls[0][0]();
    expect(p.element('fallbackMinWaitMs').value).toBe(5000);
    expect(p.element('fallbackMinWaitMs').disabled).toBe(false);
    expect(p.element('saveSettingsBtn').disabled).toBe(false);
    expect(p.element('settingsStatus').textContent).toBe('Updated');
});
test('a save response cannot overwrite edits made while the request was pending', async () => {
    const p = await page('admin-bots', { settings, bots: [], runtime: {}, presence: {} }); let release;
    p.nativeFetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = p.ctx.saveSettings();
    p.element('fallbackMinWaitMs').value = '9876'; p.element('fallbackMinWaitMs').listeners.input();
    release(Response.json({ settings, runtime: {} })); await pending;
    expect(p.element('fallbackMinWaitMs').value).toBe('9876');
    expect(p.element('settingsStatus').textContent).toContain('still unsaved');
});
test('failed user operations do not refresh the card or list as if successful', async () => {
    const p = await page('admin-users', { users: [], total: 0 });
    p.ctx.currentUser = { _id: 'test-id', username: 'user' }; p.ctx.openUser = jest.fn(); p.ctx.loadUsers = jest.fn();
    p.element('newRatingInput').value = '1500';
    p.nativeFetch.mockImplementation(async () => Response.json({ error: 'Session expired' }, { status: 401 }));
    for (const action of ['unbanUser', 'resetAvatar', 'setRating']) { p.ctx[action](); await flush(); }
    expect(p.ctx.openUser).not.toHaveBeenCalled(); expect(p.ctx.loadUsers).not.toHaveBeenCalled();
    expect(p.ctx.alert.mock.calls.map(call => call[0])).toEqual(['Session expired', 'Session expired', 'Session expired']);
});
test('failed complaint update preserves the dialog and note', async () => {
    const p = await page('admin-user-reports', []);
    p.ctx.reports = [{ _id: 'test-id', __v: 4 }];
    p.ctx._currentReportId = 'test-id'; p.element('adminNoteInput').value = 'Keep this note';
    p.ctx.closeDetail = jest.fn(); p.ctx.loadReports = jest.fn();
    p.nativeFetch.mockResolvedValueOnce(Response.json({ error: 'Report changed. Reload it.' }, { status: 409 }));
    p.ctx.setReportStatus('resolved'); await flush();
    expect(p.ctx.closeDetail).not.toHaveBeenCalled(); expect(p.ctx.loadReports).not.toHaveBeenCalled();
    expect(p.element('adminNoteInput').value).toBe('Keep this note');
    expect(p.ctx.alert).toHaveBeenCalledWith('Report changed. Reload it.');
    expect(JSON.parse(p.nativeFetch.mock.calls.at(-1)[1].body).version).toBe(4);
});
test('failed support reply retains the text and never displays Sent', async () => {
    const p = await page('admin-reports', []);
    p.nativeFetch.mockResolvedValueOnce(Response.json({ subject: 'Test', status: 'new', messages: [] })).mockResolvedValueOnce(Response.json({ success: true }));
    await p.ctx.showDetail('123456789012345678901234');
    p.element('replyInput').value = 'My answer';
    p.nativeFetch.mockResolvedValueOnce(Response.json({ error: 'Forbidden' }, { status: 403 }));
    await p.ctx.sendReply();
    expect(p.element('replyInput').value).toBe('My answer'); expect(p.element('replyStatus').style.display).toBe('inline');
    expect(p.element('replyStatus').textContent).toBe('Forbidden');
});
test('bot names are rendered as text and rename works with apostrophes; filtering retains all source rows', async () => {
    const bots = [{ id: 'bot-a', username: "O'Brien <b>", rating: 0, country: 'GB', seedId: 'qbot-1', stats: {} },
        { id: 'bot-b', username: 'Other bot', rating: 1300, seedId: 'sbot-2', stats: {} }];
    const p = await page('admin-bots', { settings, bots, runtime: {}, presence: {} });
    const first = p.element('botsTableBody').children[0];
    const name = first.children[0].children[0].children[0];
    expect(name.textContent).toBe("O'Brien <b>"); expect(name.innerHTML).toBe('');
    expect(first.children[1].textContent).toBe('0');
    await first.children[0].children[0].children[1].listeners.click();
    expect(p.ctx.prompt).toHaveBeenCalledWith('New username for bot:', "O'Brien <b>");
    p.element('botSearchInput').value = 'sbot-'; p.ctx.renderBots(bots);
    expect(p.element('botsTableBody').children).toHaveLength(1); expect(p.element('botCount').textContent).toBe('1 of 2 bots');
    p.element('botSearchInput').value = ''; p.ctx.renderBots(bots);
    expect(p.element('botsTableBody').children).toHaveLength(2);
});
