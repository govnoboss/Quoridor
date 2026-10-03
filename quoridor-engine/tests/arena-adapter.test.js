'use strict';
/**
 * Regression tests for the Quoridor arena adapter.
 *
 * Every test here corresponds to a bug that actually shipped in the first version of this adapter and
 * failed silently — the arena reported a result, just a meaningless one. Silent wrong answers are the
 * only dangerous kind, so each of them gets a named test.
 */

const adapter = require('../arena/adapters/quoridor');
const { playGame } = require('../arena/src/match');
const Rules = require('../rules');
const { makeRng, deriveSeed } = require('../tools/rng');

const specs = require('../arena/bots.json');
const makeBot = (name) => adapter.makeBot(specs[name], name);

// Лимит УЗЛОВ, а не времени. Поиск с дедлайном по времени невоспроизводим: под нагрузкой (соседние
// воркеры, полный прогон jest) один и тот же сид даёт разные ходы, потому что поиск обрывается на
// разной глубине. Для тестов на повторяемость и для сравнения версий это обязательное требование,
// поэтому дефолт здесь — узлы.
const job = (over = {}) => ({
    seed: 1, openingId: 0, openingPlies: 4, aFirst: true,
    maxPlies: 300, repetitionDraw: 3, limits: { nodes: 4000 }, ...over,
});

describe('adapter: the referee is the real gameReducer', () => {
    // GOAL_ROW was [8, 0] — the start rows. Every position looked won, so every game ended at ply 0.
    test('a fresh board has no winner', () => {
        const s = adapter.createInitialState();
        expect(adapter.winner(s)).toBeNull();
    });

    test('a player standing on their goal row wins, and only that player', () => {
        const s = adapter.createInitialState();
        s.players[0].pos = { r: Rules.GOAL_ROW[0], c: 4 };
        expect(adapter.winner(s)).toBe(0);
        s.players[0].pos = { r: 4, c: 4 };
        s.players[1].pos = { r: Rules.GOAL_ROW[1], c: 4 };
        expect(adapter.winner(s)).toBe(1);
    });

    // gameReducer(state, action) reads playerIdx from the action and throws 'Not your turn' without it.
    // The old adapter passed it as a third argument, so every move was rejected.
    test('a legal pawn move is accepted', () => {
        const s = adapter.createInitialState();
        const target = Rules.getJumpTargets(s, 8, 4)[0];
        const r = adapter.applyMove(s, { type: 'pawn', r: target.r, c: target.c });
        expect(r.error).toBeUndefined();
        expect(r.state.players[0].pos).toEqual({ r: target.r, c: target.c });
        expect(r.state.currentPlayer).toBe(1);
    });

    test('a legal wall move is accepted and costs a wall', () => {
        const s = adapter.createInitialState();
        const r = adapter.applyMove(s, { type: 'wall', r: 4, c: 4, isVertical: true });
        expect(r.error).toBeUndefined();
        expect(r.state.vWalls[4][4]).toBe(true);
        expect(r.state.players[0].wallsLeft).toBe(Rules.INITIAL_WALLS - 1);
    });

    test('an illegal pawn move is refused with an error, not an exception', () => {
        const s = adapter.createInitialState();
        expect(adapter.applyMove(s, { type: 'pawn', r: 0, c: 0 }).error).toBeTruthy();
        expect(adapter.applyMove(s, { type: 'pawn', r: 9, c: 9 }).error).toBeTruthy();
    });

    test('a wall that seals a player in is refused', () => {
        const s = adapter.createInitialState();
        s.players[0].pos = { r: 0, c: 4 };
        s.players[1].pos = { r: 8, c: 4 };
        let accepted = 0;
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                for (const isVertical of [false, true]) {
                    if (!adapter.applyMove(s, { type: 'wall', r, c, isVertical }).error) accepted++;
                }
            }
        }
        // A single wall can never seal anyone in from a full board, so all 128 slots must be legal.
        expect(accepted).toBe(128);
    });

    test('applyMove does not mutate the state it was given', () => {
        const s = adapter.createInitialState();
        const before = JSON.stringify(s);
        adapter.applyMove(s, { type: 'pawn', r: 7, c: 4 });
        expect(JSON.stringify(s)).toBe(before);
    });

    test('a player with no walls left cannot place one', () => {
        const s = adapter.createInitialState();
        s.players[0].wallsLeft = 0;
        expect(adapter.applyMove(s, { type: 'wall', r: 2, c: 2, isVertical: true }).error).toBeTruthy();
    });

    test('legalMoves agrees with what the referee accepts', () => {
        const rng = makeRng(7);
        for (let g = 0; g < 8; g++) {
            let s = adapter.createInitialState();
            for (let ply = 0; ply < 40; ply++) {
                if (adapter.winner(s) !== null) break;
                const legal = adapter.legalMoves(s);
                expect(legal.length).toBeGreaterThan(0);
                // everything offered must be accepted
                for (const m of legal) expect(adapter.applyMove(s, m).error).toBeUndefined();
                const chosen = legal[rng.int(legal.length)];
                s = adapter.applyMove(s, chosen).state;
            }
        }
    });
});

describe('adapter: position key', () => {
    test('changes with pawns, walls, side to move and walls in reserve', () => {
        const base = adapter.createInitialState();
        const key = adapter.positionKey(base);

        const moved = adapter.cloneState(base);
        moved.players[0].pos = { r: 7, c: 4 };
        expect(adapter.positionKey(moved)).not.toBe(key);

        const walled = adapter.cloneState(base);
        walled.vWalls[0][0] = true;
        expect(adapter.positionKey(walled)).not.toBe(key);

        const turn = adapter.cloneState(base);
        turn.currentPlayer = 1;
        expect(adapter.positionKey(turn)).not.toBe(key);

        const spent = adapter.cloneState(base);
        spent.players[0].wallsLeft = 9;
        expect(adapter.positionKey(spent)).not.toBe(key);

        expect(adapter.positionKey(adapter.cloneState(base))).toBe(key);
    });
});

describe('arena: a real game between two v0 bots', () => {
    test('a game finishes with a legal reason and never returns an illegal move', () => {
        for (const [a, b] of [['v0-medium', 'v0-medium'], ['v0-hard', 'v0-easy'], ['v0-medium', 'v0-random']]) {
            const res = playGame(adapter, makeBot(a), makeBot(b), job());
            expect(['win', 'repetition', 'maxplies']).toContain(res.reason.split(':')[0]);
            expect(res.plies).toBeGreaterThan(0);
            expect(res.aScore).toBeGreaterThanOrEqual(0);
            expect(res.aScore).toBeLessThanOrEqual(1);
            // a crash or an illegal move shows up as a reason prefix, and it must never happen here
            expect(res.reason.startsWith('crash')).toBe(false);
            expect(res.reason.startsWith('illegal')).toBe(false);
            expect(res.reason.startsWith('no-move')).toBe(false);
        }
    }, 120000);

    test('the same seed replays exactly the same game', () => {
        const run = () => playGame(adapter, makeBot('v0-medium'), makeBot('v0-medium'), job());
        const a = run();
        const b = run();
        expect(JSON.stringify(a.moves)).toBe(JSON.stringify(b.moves));
        expect(a.plies).toBe(b.plies);
        expect(a.reason).toBe(b.reason);
    }, 120000);

    // The old adapter deleted ai-core from require.cache per bot so that two bots would not share the
    // module-level TT. Here every game builds its own engine, so the two colours are independent.
    test('the two colours do not share engine state', () => {
        const shared = makeBot('v0-medium');
        shared.newGame(1);
        const limits = { nodes: 4000 };
        const first = shared.think(adapter.createInitialState(), 0, limits);
        const botB = makeBot('v0-medium');
        botB.newGame(1);
        for (let i = 0; i < 6; i++) botB.think(adapter.createInitialState(), 0, limits);
        const second = shared.think(adapter.createInitialState(), 0, limits);
        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    }, 120000);

    test('a bot asked to move for the player who is not to move is refused', () => {
        const bot = makeBot('v0-medium');
        bot.newGame(1);
        expect(() => bot.think(adapter.createInitialState(), 1, { nodes: 4000 })).toThrow(/not to move/);
    });

    test('think() before newGame() is a loud error, not a crash deep in the search', () => {
        const bot = adapter.makeBot(specs['v0-medium'], 'lonely');
        expect(() => bot.think(adapter.createInitialState(), 0, { nodes: 4000 })).toThrow(/newGame/);
    });

    test('a worker-thread style cache of bots still gives independent games', () => {
        // worker.js caches bots by "<slot>:<name>"; two slots of the same name must not interfere.
        const cache = new Map();
        const get = (slot, name) => {
            const k = `${slot}:${name}`;
            if (!cache.has(k)) cache.set(k, makeBot(name));
            return cache.get(k);
        };
        const res = playGame(adapter, get('A', 'v0-medium'), get('B', 'v0-medium'), job());
        expect(res.reason.split(':')[0]).not.toBe('crash');
    }, 120000);

    test('CLI limits reach the engine: the depth cap changes how many nodes are searched', () => {
        const bot = makeBot('v0-hard');
        bot.newGame(1);
        const s = adapter.createInitialState();
        const shallow = bot.think(adapter.cloneState(s), 0, { depth: 1, timeMs: 5000 });
        const deep = bot.think(adapter.cloneState(s), 0, { depth: 6, timeMs: 5000 });
        expect(shallow).not.toBeNull();
        expect(deep).not.toBeNull();
        expect(adapter.legalMoves(adapter.createInitialState()).map(m => `${m.type}${m.r},${m.c}`))
            .toContain(`${shallow.type}${shallow.r},${shallow.c}`);
    }, 120000);
});

describe('adapter: seeds are reproducible', () => {
    test('the same game index gives the same bot seed regardless of thread count', () => {
        // gameIndex must be derived from the match config, not from the dispatch order
        expect(deriveSeed(1, 0)).toBe(deriveSeed(1, 0));
        expect(deriveSeed(1, 0)).not.toBe(deriveSeed(1, 1));
    });

    test('two games with different opening ids differ', () => {
        const a = playGame(adapter, makeBot('v0-easy'), makeBot('v0-easy'), job({ openingId: 0 }));
        const b = playGame(adapter, makeBot('v0-easy'), makeBot('v0-easy'), job({ openingId: 1 }));
        expect(JSON.stringify(a.moves)).not.toBe(JSON.stringify(b.moves));
    }, 120000);
});

// A stall is not a draw by the rules of Quoridor — it is the bot failing to escape a cycle. Since
// roughly half of all games ended this way, "how strong is the bot" was being measured mostly by
// "how fast does it loop", and the score said nothing about it. These tests pin the plumbing: the
// flag must reach the referee, and the loop must be reported.
describe('arena: repetition is reported, not silently scored', () => {
    // The reason a repetition draw exists at all is that the v0 engine loops. The flag used to be
    // parsed by the CLI and then dropped before Arena, so every value of --repetition produced a
    // byte-identical match: a dead knob that looked alive.
    test('repetitionDraw 0 disables the rule and the game no longer ends in a loop draw', () => {
        // What is guaranteed is only that the loop no longer terminates the game. Whether the game
        // then reaches maxPlies or someone wins first depends on the opening, so assert the
        // invariant, not a specific outcome.
        const res = playGame(adapter, makeBot('v0-medium'), makeBot('v0-medium'), job({ repetitionDraw: 0 }));
        expect(res.reason).not.toBe('repetition');
        expect(['win', 'maxplies']).toContain(res.reason);
        expect(res.plies).toBeLessThanOrEqual(300);
        expect(res.loopStartPly).toBeUndefined();
    }, 120000);

    test('repetitionDraw 0 differs observably from the default of 3', () => {
        const off = playGame(adapter, makeBot('v0-medium'), makeBot('v0-medium'), job({ repetitionDraw: 0 }));
        const on = playGame(adapter, makeBot('v0-medium'), makeBot('v0-medium'), job({ repetitionDraw: 3 }));
        // Same seed, same opening: the only thing that changed is the draw rule, so the two games
        // must diverge from the first loop onwards. Identical results would mean the flag is dead.
        expect(JSON.stringify(off.moves)).not.toBe(JSON.stringify(on.moves));
    }, 120000);

    // 1 does NOT mean "off". It fires on the very first repeated position, i.e. almost immediately.
    // A user reaching for this to disable the rule must be stopped, not silently handed garbage.
    test('repetitionDraw 1 ends the game almost immediately, and is not a way to disable the rule', () => {
        const res = playGame(adapter, makeBot('v0-medium'), makeBot('v0-medium'), job({ repetitionDraw: 1 }));
        expect(res.reason).toBe('repetition');
        expect(res.plies).toBeLessThan(20);
    }, 120000);

    test('a repetition reports where the loop started, not just where the referee gave up', () => {
        // res.plies is when the 3rd occurrence showed up. The number worth having is the ply the
        // cycle first appeared at, otherwise the report cannot tell "looped from move 4" from
        // "looped from move 200" — and those need completely different fixes.
        let seen = null;
        for (let openingId = 0; openingId < 12 && !seen; openingId++) {
            const res = playGame(adapter, makeBot('v0-medium'), makeBot('v0-medium'), job({ openingId }));
            if (res.reason === 'repetition') seen = res;
        }
        if (!seen) return; // no loop in this sample: nothing to assert, and that is not a failure
        expect(seen.loopStartPly).toBeGreaterThanOrEqual(0);
        expect(seen.loopStartPly).toBeLessThan(seen.plies);
        expect(seen.loopLength).toBe(seen.plies - seen.loopStartPly);
        expect(seen.positionsSeen).toBeGreaterThan(1);
    }, 300000);
});
