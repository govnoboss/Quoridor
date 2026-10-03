#!/usr/bin/env node
'use strict';
/**
 * perft — count legal move sequences to a fixed depth.
 *
 * This is the ground truth for the rules. Any change to quoridor-rules.js (or to a future Rust port)
 * must reproduce the numbers below exactly. A mismatch almost always means a bug in jump generation
 * or in wall validation.
 *
 * Usage:
 *   node tools/perft.js                      full move set, depth 1..3
 *   node tools/perft.js --depth 4            full move set, depth 1..4 (slow: ~1e8 leaves)
 *   node tools/perft.js --pawns --depth 8    pawn moves only, cheap, exercises jump rules deeply
 *   node tools/perft.js --rules ./rules/reference.js   perft the reference implementation instead
 *   node tools/perft.js --divide             per node at the deepest level
 *   node tools/perft.js --assert             verify against the golden numbers, exit 1 on mismatch
 *
 * Why depth 3 for the full move set: branching is ~130 on an empty board (4 pawn moves + 128 wall
 * slots), so depth 4 is ~1.4e8 leaves and each leaf costs several BFS. Depth 1-3 (~1.5e6) already
 * covers every wall interaction type; the deep jump logic is covered by --pawns.
 *
 * Why --assert lives here and not only in tests/perft.test.js: jest executes quoridor-engine inside a
 * vm context where V8 does not optimize these hot loops, making depth 3 roughly 20x slower than in
 * plain node. The engine, the arena and the browser all run outside jest, so the golden numbers are
 * checked in the environment that actually ships.
 */

const path = require('path');
const Rules = require('../rules');
const RefRules = require('../rules/reference');
const { generateMoves, applyInPlace, undoInPlace, isFinished } = require('../rules/moves');

// Эталон. Меняется только вместе с сознательным изменением правил — и тогда коммит обязан это
// упоминать в описании, иначе значение бесполезно.
const GOLDEN_FULL = { 1: 131, 2: 16677, 3: 2062264 };
const GOLDEN_PAWNS = { 1: 3, 2: 9, 3: 30, 4: 100, 5: 350, 6: 1225, 7: 4410 };

function perft(rules, state, depth, pawnsOnly) {
    if (isFinished(rules, state)) return 0;
    if (depth === 0) return 1;

    const moves = generateMoves(rules, state, { pawnsOnly });
    if (depth === 1) return moves.length;

    let nodes = 0;
    for (const m of moves) {
        const prevPos = { ...state.players[state.currentPlayer].pos };
        if (!applyInPlace(rules, state, m)) continue;
        nodes += perft(rules, state, depth - 1, pawnsOnly);
        undoInPlace(rules, state, m, prevPos);
    }
    return nodes;
}

/** Per-node breakdown: how many child nodes each first move leads to. Catches asymmetric rules. */
function divide(rules, state, depth, pawnsOnly) {
    const moves = generateMoves(rules, state, { pawnsOnly });
    const out = [];
    for (const m of moves) {
        const prevPos = { ...state.players[state.currentPlayer].pos };
        if (!applyInPlace(rules, state, m)) continue;
        const n = depth === 1 ? 1 : perft(rules, state, depth - 1, pawnsOnly);
        undoInPlace(rules, state, m, prevPos);
        out.push({ move: m, nodes: n });
    }
    return out;
}

function parseArgs(argv) {
    const a = { depth: 3, rules: null, pawns: false, divide: false, quiet: false, assert: false };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--depth') a.depth = parseInt(argv[++i], 10);
        else if (argv[i] === '--rules') a.rules = path.resolve(argv[++i]);
        else if (argv[i] === '--pawns') a.pawns = true;
        else if (argv[i] === '--divide') a.divide = true;
        else if (argv[i] === '--quiet') a.quiet = true;
        else if (argv[i] === '--assert') a.assert = true;
    }
    return a;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const rules = args.rules ? require(args.rules) : Rules;
    const label = args.rules ? path.basename(args.rules) : 'quoridor-rules';
    const mode = args.pawns ? 'pawns-only' : 'full';
    const golden = args.pawns ? GOLDEN_PAWNS : GOLDEN_FULL;
    const failures = [];

    const state = rules.createInitialState();
    if (!args.quiet) console.log(`perft [${label}] mode=${mode} from the initial position`);

    for (let d = 1; d <= args.depth; d++) {
        const t0 = Date.now();
        const n = perft(rules, state, d, args.pawns);
        const ms = Date.now() - t0;
        const nps = ms > 0 ? Math.round(n / (ms / 1000)) : n;
        const expect = args.assert ? golden[d] : undefined;
        const ok = expect === undefined || expect === n;
        console.log(`  depth ${d}: ${n}  (${ms} ms${ms > 0 ? `, ${nps.toLocaleString('en-US')} nps` : ''})${expect === undefined ? '' : ok ? '  ok' : `  MISMATCH, expected ${expect}`}`);
        if (!ok) failures.push(`${label} ${mode} depth ${d}: got ${n}, expected ${expect}`);
    }

    if (args.divide) {
        const d = args.depth;
        console.log(`\ndivide [${label}] depth ${d}:`);
        for (const { move, nodes } of divide(rules, state, d, args.pawns)) {
            const s = move.type === 'pawn' ? `pawn ${move.r},${move.c}` : `wall ${move.r},${move.c} ${move.isVertical ? 'V' : 'H'}`;
            console.log(`  ${s.padEnd(16)} ${nodes}`);
        }
    }

    if (args.assert) {
        if (failures.length) {
            console.error(`\nperft FAILED:\n  ${failures.join('\n  ')}`);
            process.exit(1);
        }
        console.log('\nperft matches the golden numbers.');
    }
}

if (require.main === module) main();

module.exports = { perft, divide, GOLDEN_FULL, GOLDEN_PAWNS };
