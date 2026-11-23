const makeDashboard = require('../frontend/js/admin-product-metrics');
const { buildProductMetrics } = require('../src/analytics/product-metrics');
function setup(fetch) {
    function element(tag) {
        const el = { tagName: tag, children: [], value: '', appendChild(child) { this.children.push(child); return child; } };
        Object.defineProperty(el, 'textContent', { get() { return this.value + this.children.map(c => c.textContent).join(' '); }, set(value) { this.value = String(value); this.children = []; } });
        return el;
    }
    const target = element('div');
    const document = { createElement: element, getElementById: () => target };
    return { target, dashboard: makeDashboard({ document, fetch }) };
}
const empty = () => buildProductMetrics([], [], { days: 7, now: new Date('2026-11-23T08:00:00Z') });
test('empty and immature cohorts display unavailable/maturity states rather than zero retention', () => {
    const { target, dashboard } = setup(); dashboard.render(empty());
    expect(target.textContent).toContain('Not available');
    expect(target.textContent).toContain('Not mature');
    expect(target.textContent).toContain('Asia/Yekaterinburg');
});
test('failed refresh clears old numbers; late responses cannot overwrite newer reports', async () => {
    let release;
    const fetch = jest.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
        .mockResolvedValueOnce({ ok: false, status: 503 });
    const { target, dashboard } = setup(fetch);
    const pending = dashboard.load(28); await dashboard.load(7);
    expect(target.textContent).toContain('503');
    release({ ok: true, json: async () => empty() }); await pending;
    expect(target.textContent).toContain('503');
});
test('dynamic values use text nodes, not HTML interpolation', () => {
    const { target, dashboard } = setup(); const report = empty();
    report.quality['<img src=x onerror=alert(1)>'] = 1; dashboard.render(report);
    expect(target.textContent).toContain('<img src=x onerror=alert(1)>');
    const tags = el => [el.tagName, ...el.children.flatMap(tags)];
    expect(tags(target)).not.toContain('img');
});
