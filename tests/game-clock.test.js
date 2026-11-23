const Clock = require('../frontend/js/game-clock');
const Shared = require('../quoridor-engine/rules');
const make = (tc = { base: 60, inc: 2 }) => Clock.start(Shared.createInitialState(tc), 100000);

describe('clock v2: exact transitions', () => {
    test.each([1, 900, 999, 1000])('charges exactly %i ms', elapsed => {
        const game = make();
        Clock.settle(game, 100000 + elapsed);
        const next = Shared.gameReducer(game, { type: 'pawn', r: 7, c: 4, playerIdx: 0 });
        Clock.moved(next, 0, 100000 + elapsed, elapsed);
        expect(next.clock.remainingMs).toEqual([62000 - elapsed, 60000]);
        expect(next.history[0].clock.remainingMs).toEqual(next.clock.remainingMs);
        expect(next.history[0].elapsedMs).toBe(elapsed);
    });
    test('deadline is exclusive for moves and inclusive for timeout', () => {
        const game = make();
        expect(Clock.expired(game, 159999)).toBe(false);
        expect(Clock.expired(game, 160000)).toBe(true);
        expect(Clock.expired(game, 160001)).toBe(true);
        expect(Clock.remaining(game, 180000)).toEqual([0, 60000]);
    });
    test('repeated clock snapshots never refund or mutate time', () => {
        const game = make();
        expect(Clock.snapshot(game, 120000).remainingMs).toEqual([40000, 60000]);
        expect(Clock.snapshot(game, 125000).remainingMs).toEqual([35000, 60000]);
        expect(game.clock.remainingMs).toEqual([60000, 60000]);
        expect(game.clock.startedAt).toBe(100000);
    });
    test('finished clocks freeze exactly once independent of later reads', () => {
        const game = make();
        Clock.stop(game, 120500); game.finished = true;
        expect(Clock.snapshot(game, 900000).remainingMs).toEqual([39500, 60000]);
        expect(Clock.deadline(game)).toBeNull();
    });
    test('untimed is an explicit mode, never a large fake clock', () => {
        const game = make({ mode: 'untimed' });
        expect(Clock.remaining(game, 1e15)).toBeNull();
        expect(Clock.expired(game, 1e15)).toBe(false);
        Clock.settle(game, 200000);
        const next = Shared.gameReducer(game, { type: 'pawn', r: 7, c: 4, playerIdx: 0 });
        Clock.moved(next, 0, 200000, null);
        expect(next.timers).toBeNull();
        expect(next.history[0].clock.enabled).toBe(false);
        expect(Clock.deadline(next)).toBeNull();
    });
    test.each([60, 180, 300, 600])('room accepts %i seconds for the whole game', base => {
        expect(Clock.control({ base, inc: 0 }, true)).toEqual({ mode: 'timed', base, inc: 0 });
    });
    test.each([{ base: NaN }, { base: Infinity }, { base: 0 }, { base: 60.1 }, { base: 120 }, { base: 60, inc: 1 }])('rejects invalid room settings %j', tc => {
        expect(() => Clock.control(tc, true)).toThrow();
    });
    test('cloning preserves lifecycle, revision, control and clock without aliasing', () => {
        const game = make(); game.finished = true;
        const copy = Shared.cloneState(game);
        expect(copy.finished).toBe(true); expect(copy.timeControl).toEqual(game.timeControl);
        copy.clock.remainingMs[0] = 3;
        expect(game.clock.remainingMs[0]).toBe(60000);
    });
    test('active legacy seconds migrate without a fractional reset', () => {
        const game = Shared.createInitialState(); delete game.timeControl;
        game.timers = [58.25, 60]; game.lastMoveTimestamp = 100000;
        expect(Clock.snapshot(game, 100900).remainingMs).toEqual([57350, 60000]);
        expect(game.clock.legacy).toBe(true);
    });
});
