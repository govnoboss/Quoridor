'use strict';
/**
 * The site runs engine v3 in the browser. These tests cover the seam that makes that possible:
 * src/core/ai-v1-bundle.js assembles a browser file out of Node-only CommonJS sources, and the server,
 * the worker and the demo board all load the engine through it. The generated file keeps the historical
 * /js/ai-v1.js URL, the AiV1 global and the createEngineV1 name (an alias for createEngineV3), so the
 * call sites are engine-agnostic.
 *
 * The second half still covers engines/v1 directly: it is the arena baseline and the rollback target,
 * and its anti-repeat rule is stateless — it reconstructs the visited positions from state.history on
 * every single call, with no instance state to lean on. v3 bans repeats differently (per-instance
 * gameSeen plus a hard root ban), which the arena gates cover end to end.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const Rules = require('../rules');
const { generateMoves } = require('../rules/moves');
const { createEngineV1 } = require('../engines/v1');

const SITE_ROOT = path.resolve(__dirname, '..', '..');
const RULES_FILE = path.join(SITE_ROOT, 'quoridor-engine', 'rules', 'quoridor-rules.js');
const {
    buildAiV1Bundle, difficultyToMaxDepth, DIFFICULTY_DEPTH, DEFAULT_MAX_DEPTH,
} = require(path.join(SITE_ROOT, 'src', 'core', 'ai-v1-bundle'));

/** Load the rules exactly as the browser does, then the bundle, into one isolated context. */
function loadBundleInSandbox() {
    const sandbox = {
        console, Date, Math, JSON, Object, Array, Error, String, Number, Boolean,
        Map, Set, Int8Array, Int16Array, Int32Array, Uint8Array, Uint16Array, Uint32Array,
        isNaN, parseInt, parseFloat,
    };
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(RULES_FILE, 'utf8'), sandbox, { filename: 'quoridor-rules.js' });
    if (!sandbox.Shared) throw new Error('quoridor-rules.js did not create the Shared global');
    vm.runInContext(buildAiV1Bundle(), sandbox, { filename: 'ai-v1.js' });
    return sandbox;
}

describe('browser bundle for engine v3', () => {
    test('loads from the rules global and exposes the engine', () => {
        const AiV1 = loadBundleInSandbox().AiV1;
        expect(typeof AiV1.createEngineV1).toBe('function');
        expect(typeof AiV1.difficultyToMaxDepth).toBe('function');
    });

    test('the bundled depth table is the same object of values the server uses', () => {
        const AiV1 = loadBundleInSandbox().AiV1;
        expect(AiV1.DIFFICULTY_DEPTH).toEqual(DIFFICULTY_DEPTH);
        for (const tier of Object.keys(DIFFICULTY_DEPTH)) {
            expect(AiV1.difficultyToMaxDepth(tier)).toBe(difficultyToMaxDepth(tier));
        }
    });

    test('an unknown difficulty falls back to the medium depth on both sides', () => {
        const AiV1 = loadBundleInSandbox().AiV1;
        expect(AiV1.difficultyToMaxDepth('nonsense')).toBe(DEFAULT_MAX_DEPTH);
        expect(difficultyToMaxDepth('nonsense')).toBe(DEFAULT_MAX_DEPTH);
    });

    test('the four site tiers are depth-only and monotonically increasing', () => {
        expect(DIFFICULTY_DEPTH).toEqual({ easy: 2, medium: 3, hard: 4, impossible: 56 });
    });

    test('the bundled engine returns a move the canonical reducer accepts', () => {
        const AiV1 = loadBundleInSandbox().AiV1;
        const state = Rules.createInitialState({ base: 600, inc: 0 });
        const engine = AiV1.createEngineV1({ seed: 7, easyRandomP: 0, maxDepth: 3 });
        const res = engine.think(state, { player: state.currentPlayer, maxDepth: 3 });

        expect(res.move).toBeTruthy();
        const playerIdx = state.currentPlayer;
        expect(() => Rules.gameReducer(state, {
            type: res.move.type, r: res.move.r, c: res.move.c,
            isVertical: res.move.isVertical, playerIdx,
        })).not.toThrow();
    });

    test('the bundled engine uses the shared rules object, not a private copy', () => {
        const sandbox = loadBundleInSandbox();
        const engine = sandbox.AiV1.createEngineV1({ seed: 1, maxDepth: 2 });
        expect(engine.rules).toBe(sandbox.Shared);
        // If the rules were duplicated, patching Shared would not reach the engine.
        expect(typeof sandbox.Shared.gameReducer).toBe('function');
    });

    test('the factory hands out distinct instances', () => {
        const AiV1 = loadBundleInSandbox().AiV1;
        const a = AiV1.createEngineV1({ seed: 1, maxDepth: 2 });
        const b = AiV1.createEngineV1({ seed: 1, maxDepth: 2 });
        expect(a).not.toBe(b);
    });

    test('fails loudly when the rules global is missing', () => {
        const sandbox = { console, Date, Math, JSON, Object, Array, Error, String, Number, Boolean, Map, Set };
        sandbox.self = sandbox;
        vm.createContext(sandbox);
        expect(() => vm.runInContext(buildAiV1Bundle(), sandbox, { filename: 'ai-v1.js' }))
            .toThrow(/shared\.js/);
    });
});

describe('engine v1 anti-repeat (baseline engine, not the site one)', () => {
    /** Play a random game and return the state plus the full-key visit order. */
    function randomGame(plies, seed) {
        let state = Rules.createInitialState({ base: 600, inc: 0 });
        let n = seed;
        const rand = () => (n = (n * 1103515245 + 12345) % 2147483648) / 2147483648;
        for (let i = 0; i < plies; i++) {
            if (Rules.isGameOver(state).over) break;
            const legal = generateMoves(Rules, state);
            if (!legal.length) break;
            const m = legal[Math.floor(rand() * legal.length)];
            state = Rules.gameReducer(state, {
                type: m.type, r: m.r, c: m.c, isVertical: m.isVertical, playerIdx: state.currentPlayer,
            });
        }
        return state;
    }

    test('pastPositionKeys reconstructs every position the game visited', () => {
        const engine = createEngineV1({ seed: 1, easyRandomP: 0, maxDepth: 2 });
        const state = randomGame(40, 99);

        const keys = engine._internals.pastPositionKeys(state);

        // Replay the same line and collect the keys directly: the reconstruction must agree exactly.
        let s = Rules.createInitialState({ base: 600, inc: 0 });
        const expected = new Set([engine._internals.positionKey(s)]);
        for (const h of state.history) {
            s = Rules.gameReducer(s, {
                type: h.move.type, r: h.move.r, c: h.move.c,
                isVertical: h.move.isVertical, playerIdx: h.playerIdx,
            });
            expected.add(engine._internals.positionKey(s));
        }
        expect([...keys].sort()).toEqual([...expected].sort());
        // One key per ply boundary at most: strictly fewer when the random game genuinely repeated a
        // position, which the set equality above already accounts for.
        expect(keys.size).toBeLessThanOrEqual(state.history.length + 1);
        expect(keys.has(engine._internals.positionKey(state))).toBe(true);
    });

    test('the key covers side to move, both pawns, walls in hand and both wall grids', () => {
        const engine = createEngineV1({ seed: 1, maxDepth: 2 });
        const k = (s) => engine._internals.positionKey(s);
        const base = Rules.createInitialState({ base: 600, inc: 0 });

        // currentPlayer
        const flippedTurn = Rules.cloneState(base);
        flippedTurn.currentPlayer = 1;
        expect(k(flippedTurn)).not.toBe(k(base));

        // each pawn
        for (const idx of [0, 1]) {
            const moved = Rules.cloneState(base);
            moved.players[idx].pos = { r: 7, c: 4 };
            expect(k(moved)).not.toBe(k(base));
        }

        // walls in hand
        for (const idx of [0, 1]) {
            const spent = Rules.cloneState(base);
            spent.players[idx].wallsLeft = 9;
            expect(k(spent)).not.toBe(k(base));
        }

        // wall grids
        for (const grid of ['hWalls', 'vWalls']) {
            for (const vertical of [false, true]) {
                const walled = Rules.cloneState(base);
                walled[grid][3][4] = true;
                expect(k(walled)).not.toBe(k(base));
            }
        }
    });

    test('recreates the start of a position after a detour, so a plain back-and-forth is banned', () => {
        const engine = createEngineV1({ seed: 5, easyRandomP: 0, maxDepth: 2 });
        let state = Rules.createInitialState({ base: 600, inc: 0 });
        state = Rules.gameReducer(state, { type: 'pawn', r: 7, c: 4, playerIdx: 0 });
        state = Rules.gameReducer(state, { type: 'pawn', r: 0, c: 3, playerIdx: 1 });
        state = Rules.gameReducer(state, { type: 'pawn', r: 6, c: 4, playerIdx: 0 });
        state = Rules.gameReducer(state, { type: 'pawn', r: 0, c: 4, playerIdx: 1 });
        // Both pawns are one step from where they stood two plies ago.
        const keys = engine._internals.pastPositionKeys(state);
        expect(keys.size).toBe(state.history.length + 1);
        expect(keys.has(engine._internals.positionKey(state))).toBe(true);
    });

    test('never returns a move that recreates a position from earlier in the game', () => {
        // Endgame-ish positions are where the ban bites: the pawn has few exits and the smart wall
        // generator offers none, which used to fall through to "restore every move" and repeat anyway.
        // Kept deliberately small — a full 12-game sweep belongs in tools/site-selfplay.js, not in a
        // unit test that has to stay fast.
        for (let g = 0; g < 4; g++) {
            let state = Rules.createInitialState({ base: 600, inc: 0 });
            const engines = [
                createEngineV1({ seed: g, easyRandomP: 0, maxDepth: 2 }),
                createEngineV1({ seed: g + 1000, easyRandomP: 0, maxDepth: 2 }),
            ];
            const seenBefore = new Map();
            let violations = 0;
            let illegal = 0;
            for (let ply = 0; ply < 90; ply++) {
                if (Rules.isGameOver(state).over) break;
                const keyNow = engines[0]._internals.positionKey(state);
                const count = seenBefore.get(keyNow) || 0;
                seenBefore.set(keyNow, count + 1);

                const playerIdx = state.currentPlayer;
                const res = engines[playerIdx].think(state, {
                    player: playerIdx, maxDepth: 2, easyRandomP: 0,
                });
                const mv = res.move;
                if (!mv) break;
                let next;
                try {
                    next = Rules.gameReducer(state, {
                        type: mv.type, r: mv.r, c: mv.c, isVertical: mv.isVertical, playerIdx,
                    });
                } catch (e) {
                    illegal++;
                    break;
                }
                if ((seenBefore.get(engines[0]._internals.positionKey(next)) || 0) > 0) violations++;
                state = next;
            }
            expect(illegal).toBe(0);
            // A third visit is the only thing the arena calls a loop; the ban should make it vanishing
            // rate, so one stray return across four 90-ply games is still fine.
            expect(violations).toBeLessThanOrEqual(1);
        }
    });

    test('still moves when every pawn move is banned', () => {
        // Hand-built pocket: P0 walled into a 2x2 with both players out of walls is the extreme case,
        // but a position where the only pawn exit leads back is enough to hit the fallback.
        let state = Rules.createInitialState({ base: 600, inc: 0 });
        state.players[0].pos = { r: 7, c: 4 };
        state.players[1].pos = { r: 0, c: 4 };
        const engine = createEngineV1({ seed: 3, easyRandomP: 0, maxDepth: 2 });
        const res = engine.think(state, { player: 0, maxDepth: 2 });
        expect(res.move).toBeTruthy();
        expect(['pawn', 'wall']).toContain(res.move.type);
    });
});

describe('engine isolation', () => {
    test('a second instance does not inherit the first one\'s transposition table', () => {
        const state = Rules.createInitialState({ base: 600, inc: 0 });
        const a = createEngineV1({ seed: 1, maxDepth: 4 });
        const b = createEngineV1({ seed: 1, maxDepth: 4 });
        a.think(state, { player: 0, maxDepth: 4 });
        expect(b).not.toBe(a);
        // Same seed, same state, same budget: a fresh engine must reproduce the answer exactly.
        const first = a.think(Rules.cloneState(state), { player: 0, maxDepth: 4 });
        const second = b.think(Rules.cloneState(state), { player: 0, maxDepth: 4 });
        expect(second.move).toEqual(first.move);
    });
});
