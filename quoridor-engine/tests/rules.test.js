'use strict';
/**
 * Cross-check the canonical rules against the independent reference implementation, and assert the
 * invariants that must hold after every legal move.
 *
 * This is the JS stand-in for "compare two independent implementations". When the Rust port lands it
 * takes over this role: point the same comparisons at the WASM/native build and keep the golden perft
 * numbers from perft.test.js.
 *
 * Performance note: the loops below compare hundreds of thousands of cases, and a single jest
 * `expect()` costs ~0.2 ms. Collecting mismatches into an array and asserting once at the end turns a
 * 3-minute suite into a few seconds.
 */

const Rules = require('../rules');
const RefRules = require('../rules/reference');
const { generateMoves, applyInPlace, isFinished } = require('../rules/moves');
const { makeRng, deriveSeed } = require('../tools/rng');
const { createInitialState } = require('./fixtures');

const norm = (targets) => targets.map(t => `${t.r},${t.c}`).sort().join(' ');
const describeState = (s) => `p0=${s.players[0].pos.r},${s.players[0].pos.c} p1=${s.players[1].pos.r},${s.players[1].pos.c}`;

/** Every wall slot in both orientations, flattened. */
const WALL_SLOTS = [];
for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
        WALL_SLOTS.push([r, c, false]);
        WALL_SLOTS.push([r, c, true]);
    }
}

function jumpDiffs(s) {
    const out = [];
    for (let p = 0; p < 2; p++) {
        const { r, c } = s.players[p].pos;
        const a = norm(Rules.getJumpTargets(s, r, c));
        const b = norm(RefRules.getJumpTargets(s, r, c));
        if (a !== b) out.push(`jump p${p} (${r},${c}): [${a}] vs [${b}]`);
    }
    return out;
}

function pathDiffs(s) {
    const out = [];
    for (let p = 0; p < 2; p++) {
        const a = Rules.hasPathToGoal(s, p);
        const b = RefRules.hasPathToGoal(s, p);
        if (a !== b) out.push(`hasPathToGoal p${p}: ${a} vs ${b}`);
    }
    const a = Rules.isValidWallPlacement(s);
    const b = RefRules.isValidWallPlacement(s);
    if (a !== b) out.push(`isValidWallPlacement: ${a} vs ${b}`);
    if (a !== (Rules.hasPathToGoal(s, 0) && Rules.hasPathToGoal(s, 1))) {
        out.push('isValidWallPlacement disagrees with its own definition');
    }
    return out;
}

function wallSlotDiffs(s) {
    const out = [];
    for (const [r, c, vertical] of WALL_SLOTS) {
        const a = Rules.checkWallPlacement(s, r, c, vertical);
        const b = RefRules.checkWallPlacement(s, r, c, vertical);
        if (a !== b) out.push(`checkWallPlacement ${r},${c},${vertical}: ${a} vs ${b}`);
    }
    return out;
}

describe('canonical rules vs independent reference implementation', () => {
    test('random playouts: jump targets, path existence and every wall slot agree', () => {
        const diffs = [];
        let positions = 0;
        let deepPositions = 0;
        let wallChecks = 0;

        for (let game = 0; game < 120 && diffs.length < 10; game++) {
            const rng = makeRng(deriveSeed(0xC0FFEE, game));
            const s = createInitialState();

            for (let ply = 0; ply < 70; ply++) {
                if (isFinished(Rules, s)) break;

                // 256 slots x 2 BFS is the expensive part: only every 5th ply
                const deep = ply % 5 === 0;
                const where = `game ${game} ply ${ply} [${describeState(s)}]`;
                for (const d of jumpDiffs(s)) diffs.push(`${where} ${d}`);
                for (const d of pathDiffs(s)) diffs.push(`${where} ${d}`);
                if (deep) {
                    for (const d of wallSlotDiffs(s)) diffs.push(`${where} ${d}`);
                    deepPositions++;
                    wallChecks += WALL_SLOTS.length;
                }
                positions++;

                const moves = generateMoves(Rules, s);
                if (moves.length === 0) {
                    diffs.push(`${where} no legal moves`);
                    break;
                }
                applyInPlace(Rules, s, moves[rng.int(moves.length)]);
            }
        }

        expect(diffs).toEqual([]);
        expect(positions).toBeGreaterThan(3000);
        expect(deepPositions).toBeGreaterThan(500);
        expect(wallChecks).toBeGreaterThan(100000);
    });

    test('the two implementations agree on wall validity right after every placement', () => {
        // Targets the exact case the previous bug lived in: a freshly placed wall next to a pawn on
        // the last row, where isWallBetween used to read out of bounds.
        const diffs = [];
        const s = createInitialState();
        let placed = 0;

        for (const [r, c, vertical] of WALL_SLOTS) {
            if (Rules.checkWallPlacement(s, r, c, vertical) !== RefRules.checkWallPlacement(s, r, c, vertical)) {
                diffs.push(`checkWallPlacement ${r},${c},${vertical}`);
            }
            const grid = vertical ? s.vWalls : s.hWalls;
            grid[r][c] = true;
            placed++;
            const canonical = Rules.isValidWallPlacement(s);
            if (canonical !== RefRules.isValidWallPlacement(s)) diffs.push(`isValid after ${r},${c},${vertical}`);
            if (canonical !== (Rules.hasPathToGoal(s, 0) && Rules.hasPathToGoal(s, 1))) {
                diffs.push(`isValid inconsistent with definition at ${r},${c},${vertical}`);
            }
            grid[r][c] = false;
        }

        expect(diffs).toEqual([]);
        expect(placed).toBe(128);
    });
});

describe('regression: isWallBetween must not read past the wall arrays', () => {
    // Before the fix, moving up from row 8 threw TypeError: hWalls has 8 rows, the code read hWalls[8].
    // That killed every BFS and therefore the whole engine.
    test('a pawn on the last row can step up', () => {
        const s = createInitialState();
        expect(() => Rules.getJumpTargets(s, 8, 4)).not.toThrow();
        expect(norm(Rules.getJumpTargets(s, 8, 4))).toBe('7,4 8,3 8,5');
        expect(() => Rules.hasPathToGoal(s, 0)).not.toThrow();
        expect(() => Rules.hasPathToGoal(s, 1)).not.toThrow();
    });

    test('every cell on the border can be expanded without throwing', () => {
        const failures = [];
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const s = createInitialState();
                s.players[0].pos = { r, c };
                s.players[1].pos = { r: (r + 4) % 9, c: (c + 4) % 9 };
                try {
                    Rules.getJumpTargets(s, r, c);
                    Rules.hasPathToGoal(s, 0);
                    Rules.hasPathToGoal(s, 1);
                } catch (e) {
                    failures.push(`${r},${c}: ${e.message}`);
                }
            }
        }
        expect(failures).toEqual([]);
    });

    test('an up-step is blocked by the wall that sits between the two cells', () => {
        const s = createInitialState();
        s.players[0].pos = { r: 4, c: 4 };
        s.players[1].pos = { r: 8, c: 8 };
        expect(Rules.isWallBetween(s, 4, 4, 3, 4)).toBe(false);
        s.hWalls[3][4] = true;
        expect(Rules.isWallBetween(s, 4, 4, 3, 4)).toBe(true);
        s.hWalls[3][4] = false;
        s.hWalls[3][3] = true; // the other wall of the same pair
        expect(Rules.isWallBetween(s, 4, 4, 3, 4)).toBe(true);
    });

    test('an up-step is not blocked by a wall on the pawn\'s own row', () => {
        // The off-by-one that came with the out-of-bounds read: hWalls[fr][fc-1] is a wall to the
        // LEFT of the pawn, which has nothing to do with moving up.
        const s = createInitialState();
        s.players[0].pos = { r: 4, c: 4 };
        s.players[1].pos = { r: 8, c: 8 };
        s.hWalls[4][3] = true;
        expect(Rules.isWallBetween(s, 4, 4, 3, 4)).toBe(false);
    });
});

describe('invariants that must hold after every legal move', () => {
    test('random playouts keep both players able to reach their goal', () => {
        const violations = [];
        let plies = 0;
        let wallsPlayed = 0;

        for (let game = 0; game < 40; game++) {
            const rng = makeRng(deriveSeed(0xBEEF, game));
            const s = createInitialState();
            const expectedWallsLeft = [Rules.INITIAL_WALLS, Rules.INITIAL_WALLS];

            for (let ply = 0; ply < 120; ply++) {
                if (isFinished(Rules, s)) break;

                const mover = s.currentPlayer;
                const moves = generateMoves(Rules, s);
                const m = moves[rng.int(moves.length)];
                const from = { ...s.players[mover].pos };
                applyInPlace(Rules, s, m);
                plies++;
                if (m.type === 'wall') { expectedWallsLeft[mover]--; wallsPlayed++; }

                const where = `game ${game} ply ${ply} ${m.type} ${m.r},${m.c}`;
                if (s.currentPlayer !== 1 - mover) violations.push(`${where}: side to move did not alternate`);
                for (let p = 0; p < 2; p++) {
                    const { r, c } = s.players[p].pos;
                    if (r < 0 || r > 8 || c < 0 || c > 8) violations.push(`${where}: p${p} off board at ${r},${c}`);
                }
                if (s.players[0].pos.r === s.players[1].pos.r && s.players[0].pos.c === s.players[1].pos.c) {
                    violations.push(`${where}: pawns share a square`);
                }
                if (s.players[0].wallsLeft !== expectedWallsLeft[0] || s.players[1].wallsLeft !== expectedWallsLeft[1]) {
                    violations.push(`${where}: wall accounting drifted`);
                }
                if (s.players[0].wallsLeft < 0 || s.players[1].wallsLeft < 0) {
                    violations.push(`${where}: negative walls left`);
                }
                // the core rule: a wall may never seal a player in
                if (!Rules.hasPathToGoal(s, 0)) violations.push(`${where}: p0 sealed off`);
                if (!Rules.hasPathToGoal(s, 1)) violations.push(`${where}: p1 sealed off`);
                if (m.type === 'pawn' && (m.r !== s.players[mover].pos.r || m.c !== s.players[mover].pos.c)) {
                    violations.push(`${where}: pawn ended somewhere else`);
                }
                void from;
            }

            // no crossing walls, checked once per game rather than once per ply
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    if (s.vWalls[r][c] && s.hWalls[r][c]) violations.push(`game ${game}: crossing walls at ${r},${c}`);
                }
            }
        }

        expect(violations.slice(0, 10)).toEqual([]);
        expect(plies).toBeGreaterThan(1000);
        expect(wallsPlayed).toBeGreaterThan(500);
    });

    test('undoInPlace restores the position exactly', () => {
        const s = createInitialState();
        const before = JSON.stringify(s);
        const moves = generateMoves(Rules, s);
        const { undoInPlace } = require('../rules/moves');
        let applied = 0;
        for (const m of moves) {
            const prev = { ...s.players[s.currentPlayer].pos };
            if (!applyInPlace(Rules, s, m)) continue;
            applied++;
            undoInPlace(Rules, s, m, prev);
            if (JSON.stringify(s) !== before) {
                expect({ move: m, state: JSON.parse(JSON.stringify(s)) }).toBe(null);
            }
        }
        expect(applied).toBe(moves.length);
        expect(JSON.stringify(s)).toBe(before);
    });
});
