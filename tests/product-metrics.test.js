const { buildProductMetrics, bounds } = require('../src/analytics/product-metrics');
const { loadProductMetrics } = require('../src/analytics/product-metrics');
const now = new Date('2026-11-23T08:00:00Z');
const event = (deviceId, name, date, props = {}, extra = {}) => ({ deviceId, name, timestamp: new Date(date + 'T10:00:00+05:00'), props, ...extra });
const first = (actor, date) => ({ _id: 'd:' + actor, first: new Date(date + 'T10:00:00+05:00') });
const report = (events, firstGames, extra = {}) => buildProductMetrics(events, firstGames, { now, days: 14, ...extra });

test('D1/D7 use distinct actors, exact calendar days and separately matured denominators', () => {
    const events = [event('a', 'game-started', '2026-11-10'), event('a', 'game-started', '2026-11-11'),
        event('a', 'game-started', '2026-11-17'), event('a', 'game-started', '2026-11-17'),
        event('b', 'game-started', '2026-11-20'), event('c', 'game-started', '2026-11-22')];
    const r = report(events, [first('a', '2026-11-10'), first('b', '2026-11-20'), first('c', '2026-11-22')]);
    expect(r.current.d1).toEqual({ returned: 1, eligible: 2, percent: 50 });
    expect(r.current.d7).toEqual({ returned: 1, eligible: 1, percent: 100 });
    expect(r.current.cohorts.find(c => c.date === '2026-11-22').d1).toBeNull();
});
test('return within days 1–7 differs from exact D7; visits alone are not a return', () => {
    const r = report([event('a', 'game-started', '2026-11-10'), event('a', 'game-started', '2026-11-12'), event('a', 'session-start', '2026-11-17')], [first('a', '2026-11-10')]);
    expect(r.current.week1.percent).toBe(100); expect(r.current.d7.percent).toBe(0);
});
test('historical first games do not turn existing players into new cohorts', () => {
    const r = report([event('a', 'game-started', '2026-11-21')], [first('a', '2026-09-01')]);
    expect(r.current.newPlayers).toBe(0); expect(r.current.players).toBe(1); expect(r.current.d7.percent).toBeNull();
});
test('day boundaries use UTC+5 and exclude today even when D7 has started', () => {
    const r = report([event('a', 'game-started', '2026-11-16'), { ...event('a', 'game-started', '2026-11-22'), timestamp: new Date('2026-11-22T19:00:00Z') }], [first('a', '2026-11-16')]);
    expect(r.current.d7.eligible).toBe(0);
    expect(bounds(now, 7).start.toISOString()).toBe('2026-11-08T19:00:00.000Z');
});
test('same device before/after sign-in is one actor; exclude admin devices and unknown identities', () => {
    const r = report([event('a', 'session-start', '2026-11-10'), event('a', 'game-started', '2026-11-10', {}, { userId: 'u' }),
        event('test', 'session-start', '2026-11-10'), event('test', 'game-started', '2026-11-11', {}, { userId: 'admin' }),
        event('', 'game-started', '2026-11-10')], [first('a', '2026-11-10'), first('test', '2026-11-11')], { excludedUserIds: ['admin'] });
    expect(r.current.activeIdentities).toBe(1); expect(r.current.newPlayers).toBe(1);
    expect(r.quality.missingIdentityEvents).toBe(1); expect(r.quality.excludedEvents).toBe(2);
});
test('linked game attempts deduplicate starts/finishes; finish supersedes provisional abandonment', () => {
    const props = { gameId: 'g', mode: 'normal', measurementVersion: 2 };
    const r = report([event('a', 'game-started', '2026-11-10', props), event('a', 'game-started', '2026-11-10', props),
        event('a', 'game-abandoned', '2026-11-10', props), event('a', 'game-finished', '2026-11-11', props),
        event('a', 'game-finished', '2026-11-11', props), event('a', 'game-started', '2026-11-12', { ...props, gameId: 'g2' }),
        event('a', 'game-started', '2026-11-12')], [first('a', '2026-11-10')]);
    expect(r.current.games).toMatchObject({ tracked: 2, finished: 1, abandoned: 0, open: 1 });
    expect(r.current.games.completion.percent).toBe(50); expect(r.current.secondGame.percent).toBe(100);
    expect(r.current.modes[0].value).toBe('online'); expect(r.quality.legacyGameEvents).toBe(1);
});
test('game completion is per actor; another player cannot complete this player’s attempt', () => {
    const props = { gameId: 'g', measurementVersion: 2 };
    const r = report([event('a', 'game-started', '2026-11-10', props), event('b', 'game-finished', '2026-11-11', props)], [first('a', '2026-11-10')]);
    expect(r.current.games.finished).toBe(0);
});
test('linked search outcomes and wait percentiles do not count orphan matches', () => {
    const events = [event('a', 'search-started', '2026-11-10', { searchId: 's' }), event('a', 'search-matched', '2026-11-11', { searchId: 's' }), event('a', 'search-matched', '2026-11-11')];
    const r = report(events, []);
    expect(r.current.searches).toMatchObject({ tracked: 1, matched: 1, p50Ms: 86400000 });
    expect(r.quality.orphanSearchOutcomes).toBe(1);
});

test('the loader refuses oversized extraction rather than returning partial retention', async () => {
    const query = { select() { return this; }, sort() { return this; }, limit() { return this; }, maxTimeMS() { return this; }, lean: async () => new Array(200001) };
    const AnalyticsEvent = { distinct: async () => [], find: () => query, aggregate: () => ({ allowDiskUse() { return this; }, option: async () => [] }) };
    const User = { find: () => ({ select: () => ({ lean: async () => [] }) }) };
    await expect(loadProductMetrics({ AnalyticsEvent, User, now, env: {} })).rejects.toMatchObject({ status: 503 });
});

test('legacy first games do not manufacture first-completion or second-game conversion', () => {
    const props = { gameId: 'later', measurementVersion: 2 };
    const r = report([event('a', 'game-started', '2026-11-10'), event('a', 'game-started', '2026-11-12', props), event('a', 'game-finished', '2026-11-12', props)], [first('a', '2026-11-10')]);
    expect(r.current.firstCompletion.percent).toBeNull(); expect(r.current.secondGame.eligible).toBe(0);
});
