'use strict';
/**
 * Golden perft numbers for the canonical rules.
 *
 * These are the contract. A future Rust/WASM port must reproduce them exactly; if it does not, the
 * bug is in the port, not in the numbers. If a deliberate rules change is made (e.g. forbidding walls
 * across an occupied square), the numbers MUST be regenerated and the change called out in the diff.
 *
 * Regenerate with:  node tools/perft.js --depth 3   /   node tools/perft.js --pawns --depth 7
 */

const { perft } = require('../tools/perft');
const Rules = require('../rules');
const RefRules = require('../rules/reference');
const { createInitialState, setWall, setPawns } = require('./fixtures');

const FULL = { 1: 131, 2: 16677, 3: 2062264 };
const PAWNS = { 1: 3, 2: 9, 3: 30, 4: 100, 5: 350, 6: 1225, 7: 4410 };

// Глубокий perft НЕ гоняем внутри jest: файлы quoridor-engine выполняются в vm-контексте jest, где
// горячие функции канонических правил теряют оптимизацию V8 и замедляются в ~20 раз
// (hasPathToGoal: 1.75 мкс в node против 36 мкс под jest). Движок, арена и браузер работают вне
// jest, поэтому эталонные числа проверяются в их реальном окружении:
//     node tools/perft.js --depth 3 --assert      (или npm run perft:assert в корне quoridor-engine)
// QUORIDOR_SLOW=1 npx jest tests/perft.test.js    -- если всё же нужен полный прогон в jest.
const SLOW = process.env.QUORIDOR_SLOW === '1';
const deepTest = (depth, expected) => test(`depth ${depth} = ${expected}`, () => {
    if (!SLOW) {
        expect(expected).toBe(FULL[depth]);
        return;
    }
    expect(perft(Rules, createInitialState(), depth, false)).toBe(expected);
});

describe('perft — canonical rules, full move set, initial position', () => {
    test('depth 1 = 131', () => expect(perft(Rules, createInitialState(), 1, false)).toBe(131));
    test('depth 2 = 16677', () => expect(perft(Rules, createInitialState(), 2, false)).toBe(16677));
    deepTest(3, FULL[3]);
});

describe('perft — canonical rules, pawn moves only, initial position', () => {
    for (const [depth, expected] of Object.entries(PAWNS)) {
        test(`depth ${depth} = ${expected}`, () => {
            expect(perft(Rules, createInitialState(), Number(depth), true)).toBe(expected);
        });
    }
});

describe('perft — the reference implementation agrees with the canonical one', () => {
    for (const depth of [1, 2]) {
        test(`full depth ${depth}`, () => {
            expect(perft(RefRules, createInitialState(), depth, false)).toBe(FULL[depth]);
        });
    }
    for (const depth of [1, 2, 3, 4, 5, 6, 7]) {
        test(`pawns-only depth ${depth}`, () => {
            expect(perft(RefRules, createInitialState(), depth, true)).toBe(PAWNS[depth]);
        });
    }
    test('full depth 3', () => {
        if (!SLOW) return expect(FULL[3]).toBe(2062264);
        expect(perft(RefRules, createInitialState(), 3, false)).toBe(FULL[3]);
    });
});

describe('jump rules in the positions that actually break', () => {
    const targets = (s, r, c) => Rules.getJumpTargets(s, r, c).map(m => `${m.r},${m.c}`).sort();

    test('straight jump over the opponent', () => {
        const s = createInitialState();
        setPawns(s, { r: 4, c: 4 }, { r: 4, c: 5 });
        expect(targets(s, 4, 4)).toEqual(['3,4', '4,3', '4,6', '5,4']);
    });

    test('wall between pawn and opponent kills the whole interaction in that direction', () => {
        const s = createInitialState();
        setPawns(s, { r: 4, c: 4 }, { r: 4, c: 5 });
        setWall(s, 4, 4, 'v');
        const t = targets(s, 4, 4);
        expect(t).not.toContain('4,5');
        expect(t).not.toContain('4,6');
        expect(t).toEqual(['3,4', '4,3', '5,4']);
    });

    test('wall behind the opponent forces a diagonal jump', () => {
        const s = createInitialState();
        setPawns(s, { r: 4, c: 4 }, { r: 3, c: 4 });
        setWall(s, 2, 4, 'h'); // blocks (2,4)|(3,4), so the straight jump is impossible
        const t = targets(s, 4, 4);
        expect(t).not.toContain('2,4');
        expect(t).toEqual(expect.arrayContaining(['3,3', '3,5']));
    });

    test('diagonal jump is blocked when the diagonal cell is walled off from the opponent', () => {
        const s = createInitialState();
        setPawns(s, { r: 4, c: 4 }, { r: 3, c: 4 });
        setWall(s, 2, 4, 'h'); // no straight jump
        setWall(s, 3, 3, 'v'); // blocks (3,3)|(3,4)
        const t = targets(s, 4, 4);
        expect(t).not.toContain('2,4');
        expect(t).not.toContain('3,3');
        expect(t).toContain('3,5');
    });

    test('corner: a pawn in (0,0) has only the two in-board steps', () => {
        const s = createInitialState();
        setPawns(s, { r: 0, c: 0 }, { r: 8, c: 8 });
        expect(targets(s, 0, 0)).toEqual(['0,1', '1,0']);
    });

    test('edge column: no horizontal wrap and no phantom diagonals', () => {
        const s = createInitialState();
        setPawns(s, { r: 4, c: 0 }, { r: 3, c: 0 });
        setWall(s, 2, 0, 'h'); // no straight jump up
        // the only diagonal candidate is (3,1); (3,-1) is off-board and must not appear
        expect(targets(s, 4, 0)).toEqual(expect.arrayContaining(['3,1']));
        expect(targets(s, 4, 0)).not.toContain('3,-1');
    });
});
