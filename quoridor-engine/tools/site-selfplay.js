'use strict';
/**
 * Site self-play: does exactly what the website's bot wiring does, N times, and reports what came out.
 *
 * WHY THIS EXISTS
 * The arena CLI already runs v1-vs-v1 matches, but it configures the engine from bots.json. This script
 * goes through the site's own path instead — `difficultyToMaxDepth()` from src/core/ai-v1-bundle.js and
 * `easyRandomP: 0` — so a regression in the mapping the players actually get shows up here rather than
 * in a match only the arena can reproduce.
 *
 * IT IS NOT THE ARENA
 * Four deliberate differences, all of them the point:
 *   - no SPRT and no early stopping: exactly `--games` games are played every time, so two runs with
 *     the same seed are comparable;
 *   - a fresh engine per seat per game (two `createEngineV1` calls per game), because the transposition
 *     table key omits the player index, so one shared instance lets a side read the other's scores;
 *   - colours alternate, so a white advantage cannot hide inside the A-vs-B result;
 *   - the referee is the canonical `Rules.gameReducer`, so an illegal engine move is counted rather
 *     than silently skipped.
 *
 * USAGE
 *   node quoridor-engine/tools/site-selfplay.js --games 1000
 *   node quoridor-engine/tools/site-selfplay.js --a easy --b hard --games 200
 *   node quoridor-engine/tools/site-selfplay.js --tiers --games 1000 --threads 4
 */

const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const Rules = require('../rules');
const { generateMoves } = require('../rules/moves');
const { createEngineV1 } = require('../engines/v1');
const { deriveSeed, makeRng } = require('./rng');
const { difficultyToMaxDepth } = require('../../src/core/ai-v1-bundle');

const TIERS = ['easy', 'medium', 'hard', 'impossible'];

/**
 * One engine per seat, built the way the site builds it. Called twice per game on purpose.
 */
function makeSeatEngine(difficulty, seed) {
    return createEngineV1({
        seed,
        // Depth-only tiers. A random move can re-enter a position the engine just banned, which is
        // exactly the loop this whole migration exists to remove.
        easyRandomP: 0,
        maxDepth: difficultyToMaxDepth(difficulty),
    });
}

/** Same fields as the arena adapter's positionKey: pawns, walls in hand, side to move, wall grids. */
function positionKey(s) {
    return JSON.stringify([
        s.players[0].pos, s.players[1].pos,
        s.players[0].wallsLeft, s.players[1].wallsLeft,
        s.currentPlayer, s.hWalls, s.vWalls,
    ]);
}

/**
 * One game. Returns a result row; never throws, because a crash has to be counted, not abort the run.
 *
 * `swapColours` puts bot A on the black side. It matters only when a !== b: without it, "A wins 60%"
 * would be indistinguishable from "white wins 60%".
 */
function playGame(opts, gameIndex) {
    const { a, b, maxPlies, repetitionDraw, swapColours, openingPlies } = opts;
    const row = { plies: 0, reason: 'win', winner: null, illegal: 0, error: null, ms: 0 };
    const t0 = Date.now();

    let state;
    try {
        state = Rules.createInitialState({ base: 600, inc: 0 });
    } catch (e) {
        row.reason = 'crash:init';
        row.error = String((e && e.message) || e);
        return row;
    }

    const seed = deriveSeed(opts.seed, gameIndex);
    const openingRng = makeRng(deriveSeed(seed, 0x5eed));

    const seen = new Map();
    const moves = [];

    // Seeded random opening. Without it every game is the SAME game: the engines have no randomness at
    // all (easyRandomP is 0), so they are pure functions of the position, and 1000 "games" would just be
    // the initial position solved once. The opening also gives the two colours different material,
    // which is what makes the P0/P1 split meaningful.
    for (let i = 0; i < openingPlies; i++) {
        const over = Rules.isGameOver(state);
        if (over && over.over) { row.reason = 'win'; row.winner = over.winner; break; }
        const legal = generateMoves(Rules, state);
        if (!legal.length) break;
        const m = legal[Math.floor(openingRng.next() * legal.length)];
        try {
            state = Rules.gameReducer(state, {
                type: m.type, r: m.r, c: m.c, isVertical: m.isVertical, playerIdx: state.currentPlayer,
            });
            moves.push(m);
        } catch (e) {
            // The opening generator and the reducer disagree: that is a rules bug, not a bot bug.
            row.reason = 'crash:opening';
            row.error = String((e && e.message) || e);
            break;
        }
    }

    // Seat -> which bot plays it, and with which engine instance. Separate tables, separate seeds.
    const owner = swapColours ? ['b', 'a'] : ['a', 'b'];
    const difficulty = { a, b };
    const engines = [
        makeSeatEngine(difficulty[owner[0]], deriveSeed(seed, 1)),
        makeSeatEngine(difficulty[owner[1]], deriveSeed(seed, 2)),
    ];

    while (moves.length < maxPlies) {
        const over = Rules.isGameOver(state);
        if (over && over.over) {
            row.reason = 'win';
            row.winner = over.winner;
            break;
        }

        if (repetitionDraw > 0) {
            const k = positionKey(state);
            const e = seen.get(k);
            if (e) {
                e.c++;
                if (e.c >= repetitionDraw) {
                    row.reason = 'repetition';
                    row.winner = null;
                    break;
                }
            } else {
                seen.set(k, { c: 1 });
            }
        }

        const p = state.currentPlayer;
        let move;
        try {
            const res = engines[p].think(state, {
                player: p,
                maxDepth: difficultyToMaxDepth(difficulty[owner[p]]),
                easyRandomP: 0,
            });
            move = res && res.move;
        } catch (e) {
            row.reason = 'crash:think';
            row.error = String((e && e.message) || e);
            break;
        }

        if (!move) {
            row.reason = 'crash:no-move';
            break;
        }

        // The canonical reducer is the referee. A move it rejects is a bug, so it is counted and scored
        // as a loss for the side that produced it rather than being skipped.
        try {
            state = Rules.gameReducer(state, {
                type: move.type, r: move.r, c: move.c, isVertical: move.isVertical, playerIdx: p,
            });
            moves.push(move);
        } catch (e) {
            row.illegal++;
            row.reason = 'illegal';
            row.winner = 1 - p;
            row.error = String((e && e.message) || e);
            break;
        }
    }

    if (row.reason === 'win' && moves.length >= maxPlies) row.reason = 'maxPlies';
    row.plies = moves.length;
    row.ms = Date.now() - t0;
    // Translate the seat that won into the bot that won, then drop the seat: everything downstream
    // reasons in terms of A and B.
    if (row.winner === null) row.winnerBot = null;
    else row.winnerBot = owner[row.winner];
    return row;
}

function emptyTally() {
    return {
        games: 0, aWins: 0, bWins: 0, draws: 0,
        whiteWins: 0, blackWins: 0,
        illegal: 0, crashes: 0, ms: 0,
        plies: [], reasons: {}, errors: [],
    };
}

function runChunk(opts) {
    const tally = emptyTally();
    for (let i = opts.from; i < opts.to; i++) {
        // Alternate colours per game index; the chunk boundary is a multiple of 2, so a chunk stays
        // internally balanced even when the total game count is odd.
        const row = playGame({ ...opts, swapColours: i % 2 === 1 }, i);
        tally.games++;
        tally.ms += row.ms;
        tally.plies.push(row.plies);
        tally.reasons[row.reason] = (tally.reasons[row.reason] || 0) + 1;
        if (row.illegal) tally.illegal++;
        if (row.reason.startsWith('crash')) {
            tally.crashes++;
            if (tally.errors.length < 5) tally.errors.push(row.error);
        }
        if (row.winnerBot === 'a') tally.aWins++;
        else if (row.winnerBot === 'b') tally.bWins++;
        else tally.draws++;
        if (row.winner === 0) tally.whiteWins++;
        else if (row.winner === 1) tally.blackWins++;
    }
    return tally;
}

function merge(target, src) {
    target.games += src.games;
    target.aWins += src.aWins;
    target.bWins += src.bWins;
    target.draws += src.draws;
    target.whiteWins += src.whiteWins;
    target.blackWins += src.blackWins;
    target.illegal += src.illegal;
    target.crashes += src.crashes;
    target.ms += src.ms;
    target.plies = target.plies.concat(src.plies);
    for (const [k, v] of Object.entries(src.reasons)) target.reasons[k] = (target.reasons[k] || 0) + v;
    for (const e of src.errors) if (target.errors.length < 5) target.errors.push(e);
    return target;
}

// Node 18.12 has no os.availableParallelism (added in 18.14), hence the fallback.
function defaultThreads() {
    const n = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
    return Math.max(1, Math.min(8, n - 1));
}

function stats(xs) {
    if (!xs.length) return { mean: 0, median: null, min: null, max: null };
    let min = Infinity, max = -Infinity, sum = 0;
    for (const x of xs) { if (x < min) min = x; if (x > max) max = x; sum += x; }
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return {
        mean: sum / xs.length,
        median: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2,
        min, max,
    };
}

/**
 * Render one match and return the problems and the warnings it raised.
 *
 * `expectWinner` is 'a'/'b' for a ladder rung where the deeper bot is supposed to win, null for a
 * mirror where neither side may win more.
 *
 * Ladder rungs are graded, not gated. A 1000-game sample resolves a 50/50 split to about +/-1.6%, so a
 * single rung at p<0.05 fails by chance roughly one time in twenty, and a flat result is a product
 * question rather than a broken engine. What IS a defect is a significant inversion: the deeper tier
 * losing. That fails the run.
 */
function report(label, t, expectWinner) {
    const p = stats(t.plies);
    const decided = t.aWins + t.bWins;
    const colourDecided = t.whiteWins + t.blackWins;
    const colourBias = colourDecided ? (t.whiteWins / colourDecided - 0.5) * 100 : 0;
    // Binomial standard error of a 50/50 split, so the verdict scales with the sample.
    const noise = colourDecided ? Math.sqrt(0.25 / colourDecided) * 100 : 0;
    const aShare = decided ? t.aWins / decided : 0;
    const ladderNoise = decided ? Math.sqrt(0.25 / decided) * 100 : 0;

    console.log('');
    console.log(`  ${label}`);
    console.log(`    games ${t.games}   A ${t.aWins} / B ${t.bWins} / draws ${t.draws}` +
        `   A score ${(aShare * 100).toFixed(1)}%`);
    console.log(`    colour: white ${t.whiteWins} / black ${t.blackWins}` +
        `   bias ${colourBias >= 0 ? '+' : ''}${colourBias.toFixed(1)}% (noise +/-${noise.toFixed(1)}%)`);
    console.log(`    reasons ${JSON.stringify(t.reasons)}`);
    console.log(`    plies mean ${p.mean.toFixed(1)}  median ${p.median}  min ${p.min}  max ${p.max}`);
    console.log(`    illegal ${t.illegal}   crashes ${t.crashes}   ms/game ${(t.ms / Math.max(1, t.games)).toFixed(0)}`);
    for (const e of t.errors) console.log(`      error: ${e}`);

    const problems = [];
    const warnings = [];
    if (t.illegal) problems.push(`${t.illegal} game(s) ended in an illegal move rejected by the canonical reducer`);
    if (t.crashes) problems.push(`${t.crashes} crash(es)`);
    if (t.reasons.repetition) problems.push(`${t.reasons.repetition} repetition draw(s) — the anti-repeat ban did not hold`);
    if (t.reasons['maxPlies']) problems.push(`${t.reasons['maxPlies']} game(s) hit the ply cap`);
    if (p.mean < 55 || p.mean > 95) problems.push(`mean ${p.mean.toFixed(1)} plies is outside the healthy 60-90 band`);
    if (colourDecided && Math.abs(colourBias) > Math.max(6, 3 * noise)) {
        problems.push(`colour bias ${colourBias.toFixed(1)}% is too large to be chance`);
    }

    if (expectWinner && decided) {
        const deeper = expectWinner === 'b' ? 'B' : 'A';
        const deeperMargin = (expectWinner === 'b' ? 1 - aShare : aShare) * 100 - 50;
        const twoSigma = 2 * ladderNoise;
        if (deeperMargin < -twoSigma) {
            problems.push(`ladder inversion: ${deeper} is the deeper tier but lost by ${Math.abs(deeperMargin).toFixed(1)}% (> 2 sigma = ${twoSigma.toFixed(1)}%)`);
        } else if (deeperMargin < 0) {
            warnings.push(`ladder rung is inverted but within noise: ${deeper} -${Math.abs(deeperMargin).toFixed(1)}%, 2 sigma = ${twoSigma.toFixed(1)}%`);
        } else if (deeperMargin < twoSigma) {
            warnings.push(`${deeper} is only ${deeperMargin.toFixed(1)}% ahead, under 2 sigma = ${twoSigma.toFixed(1)}%: this depth pair is not separated at ${t.games} games`);
        }
    }
    return { problems, warnings };
}

function runMatch(opts) {
    const { a, b, games, threads, expectWinner } = opts;
    const jobs = [];
    const perWorker = Math.ceil(games / threads);
    let next = 0;
    for (let w = 0; w < threads && next < games; w++) {
        const to = Math.min(games, next + perWorker);
        jobs.push({ ...opts, from: next, to });
        next = to;
    }

    return new Promise((resolve, reject) => {
        const tally = emptyTally();
        let done = 0;
        let settled = false;

        const fail = (err) => { if (!settled) { settled = true; reject(err); } };
        const finish = () => { if (!settled && done === jobs.length) { settled = true; resolve(tally); } };

        for (const job of jobs) {
            const worker = new Worker(__filename, { workerData: job });
            worker.on('message', (partial) => { merge(tally, partial); done++; finish(); });
            worker.on('error', fail);
            worker.on('exit', (code) => { if (code !== 0) fail(new Error(`worker exited with code ${code}`)); });
        }
        if (!jobs.length) resolve(tally);
    }).then((tally) => ({
        tally,
        expectWinner,
        label: `${a}(d${difficultyToMaxDepth(a)}) vs ${b}(d${difficultyToMaxDepth(b)})`,
    }));
}

function parseArgs(argv) {
    const out = {
        games: 100, threads: defaultThreads(), a: 'medium', b: null,
        seed: 20240101, maxPlies: 300, repetitionDraw: 3, openingPlies: 6, tiers: false, help: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const val = () => argv[++i];
        if (arg === '--games') out.games = parseInt(val(), 10);
        else if (arg === '--threads') out.threads = Math.max(1, parseInt(val(), 10));
        else if (arg === '--a') out.a = val();
        else if (arg === '--b') out.b = val();
        else if (arg === '--seed') out.seed = parseInt(val(), 10);
        else if (arg === '--max-ply') out.maxPlies = parseInt(val(), 10);
        else if (arg === '--opening') out.openingPlies = parseInt(val(), 10);
        else if (arg === '--repetition-draw') out.repetitionDraw = parseInt(val(), 10);
        else if (arg === '--tiers') out.tiers = true;
        else if (arg === '--help' || arg === '-h') out.help = true;
        else throw new Error(`unknown argument ${arg}`);
    }
    if (!out.b) out.b = out.a; // default: mirror match
    for (const d of [out.a, out.b]) {
        if (!TIERS.includes(d)) throw new Error(`unknown difficulty "${d}" (expected ${TIERS.join('/')})`);
    }
    if (!(out.games > 0)) throw new Error('--games must be > 0');
    return out;
}

const USAGE = `
site-selfplay — plays the site's own bot wiring against itself.

  --a <tier>              white seat difficulty (default medium)
  --b <tier>              black seat difficulty (default: same as --a)
  --games <n>             exactly n games, no early stopping (default 100)
  --threads <n>           worker threads (default ${defaultThreads()})
  --seed <n>              base seed; same seed + same games = same results (default 20240101)
  --max-ply <n>           ply cap per game (default 300)
  --opening <n>           seeded random plies played before the engines take over (default 6)
  --repetition-draw <n>   draw after n repeats of a full position; 0 disables (default 3)
  --tiers                 standard matrix: mirror at each tier, then the ladder
`;

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) { console.log(USAGE); return; }

    const base = {
        seed: opts.seed, threads: opts.threads, maxPlies: opts.maxPlies, repetitionDraw: opts.repetitionDraw,
        openingPlies: opts.openingPlies,
    };

    console.log(`site self-play  seed=${opts.seed}  threads=${opts.threads}  repetitionDraw=${opts.repetitionDraw}`);
    console.log(`depths: ${TIERS.map((t) => `${t}=${difficultyToMaxDepth(t)}`).join('  ')}`);

    const runs = [];
    if (opts.tiers) {
        // Mirror at every tier: identical depth both sides, so P0/P1 must be a coin flip. This is where
        // a colour bias, or a tier that plays badly against itself, shows up.
        for (const tier of TIERS) {
            runs.push({ ...base, a: tier, b: tier, games: opts.games, expectWinner: null });
        }
        // The ladder: each tier must beat the one below it. A depth that does not is a mislabelled bot.
        const ladderGames = Math.max(20, Math.round(opts.games / 4));
        for (let i = 0; i + 1 < TIERS.length; i++) {
            runs.push({
                ...base, a: TIERS[i], b: TIERS[i + 1], games: ladderGames, expectWinner: 'b',
            });
        }
    } else {
        runs.push({ ...base, a: opts.a, b: opts.b, games: opts.games, expectWinner: null });
    }

    const problems = [];
    const warnings = [];
    for (const run of runs) {
        const started = Date.now();
        const { tally, label, expectWinner } = await runMatch(run);
        const verdict = report(label, tally, expectWinner);
        for (const p of verdict.problems) problems.push(`${label}: ${p}`);
        for (const w of verdict.warnings) warnings.push(`${label}: ${w}`);
        console.log(`    (${((Date.now() - started) / 1000).toFixed(1)}s wall)`);
    }

    if (warnings.length) {
        console.log('');
        console.log('WARNINGS (not failures):');
        for (const w of warnings) console.log('  - ' + w);
    }
    console.log('');
    if (problems.length) {
        console.log('FAILED:');
        for (const p of problems) console.log('  - ' + p);
        process.exitCode = 1;
    } else {
        console.log('OK: no illegal moves, no crashes, no repetition draws.');
    }
}

if (!isMainThread) {
    parentPort.postMessage(runChunk(workerData));
} else {
    main().catch((err) => {
        console.error((err && err.stack) || err);
        process.exitCode = 1;
    });
}
