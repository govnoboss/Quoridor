# AI Engine Reference

## 1. Package layout

`quoridor-engine/` is a standalone engine workbench. Its rules/engines/arena/tools are separable from the web application and are intended to run without MongoDB, Redis or Socket.IO.

| Path | Role |
|---|---|
| `rules/` | Canonical Quoridor rules and move/path helpers |
| `engines/v0/` | Legacy parity/baseline engine |
| `engines/v1/` | Earlier search engine implementation |
| `engines/v2/` | Experimental version retained for comparison |
| `engines/v3/` | Current production engine used by site/bots/arena according to repository docs and bundle source |
| `engines/personality.js` | Per-bot deterministic personality/opening preferences |
| `arena/` | Match runner, worker execution, Elo/rating and tournament configs |
| `tools/` | RNG, perft, benchmark and site self-play utilities |

## 2. Production integration

- Server-side bundler/adapter: `src/core/ai-v1-bundle.js`.
- Source engine: `quoridor-engine/engines/v3/index.js`.
- Shared rules dependency: `quoridor-engine/rules/`.
- Embedded RNG: `quoridor-engine/tools/rng.js`.
- Personality source: `quoridor-engine/engines/personality.js`.
- Browser endpoint: `/js/ai-v1.js`; browser global: `AiV1`.
- Historical compatibility naming: `createEngineV1` maps to `createEngineV3`.

The bundle is generated in memory and cached. Do not hand-edit a generated response. After editing source files, restart the server; also bump relevant frontend asset version query parameters if browser caching requires it.

## 3. Difficulty mapping

Current values defined in `src/core/ai-v1-bundle.js`:

| Label | Max depth |
|---|---:|
| `easy` | 4 |
| `medium` | 6 |
| `hard` | 8 |
| `impossible` | 56 |
| Unknown | 3 (default) |

These are depth caps, not guaranteed completed depths. Engine search may stop early due to its time budget/termination conditions. Check the engine and worker caller before changing difficulty behavior.

## 4. v3 public API (source-exported)

`createEngineV3(options)` returns an engine object with:

- `name`, `version`
- `think(state, options)` — selects a move and returns an object containing encoded move, completed depth, node count, elapsed milliseconds and score (see implementation for exact options and move encoding).
- `newGame(seed)` — resets per-game engine state/seed.
- `reset()` — currently a no-op compatibility method.
- `rules` — reference to the canonical rules object.
- `_debug` — internal testing/debug hooks; do not treat as stable product API.

Module exports: `createEngineV3`, `encodeMove`, `VARIETY_DEFAULT`, `DIFFICULTY_VARIETY`, `ARCHETYPE_DEFAULT`, `ARCHETYPE_NAMES`.

Search implementation details (hashing, move generation, path analysis, transposition table, negamax/PVS/iterative deepening, repetition handling) are internal. Inspect `quoridor-engine/engines/v3/index.js` directly for changes to search correctness or performance.

## 5. Rules package public surface

`quoridor-engine/rules/quoridor-rules.js` exposes browser-compatible functions including:

- `isValidPawnMove(move)`
- `isValidWallMove(move)`
- `isValidMove(move)`
- `isGameOver(state)`
- `createInitialState(timeControl, isRanked)`

Other rule operations are defined across `rules/index.js`, `moves.js`, `paths.js` and `quoridor-rules.js`. Read the actual exports before using names in new code.

## 6. Testing / measurement

Useful test and tool locations:

- `quoridor-engine/tests/rules.test.js`
- `quoridor-engine/tests/perft.test.js`
- `quoridor-engine/tests/engine-parity.test.js`
- `quoridor-engine/tests/site-v1.test.js`
- `quoridor-engine/tests/arena-adapter.test.js`
- `quoridor-engine/tests/selftest-v3.js`
- `quoridor-engine/tools/perft.js`
- `quoridor-engine/tools/bench.js`
- `quoridor-engine/tools/site-selfplay.js`
- `quoridor-engine/arena/README.md`

Run commands from `quoridor-engine/` and confirm available scripts in its own `package.json`; do not assume root package scripts expose every engine command.
