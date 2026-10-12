# quoridor-engine

The Quoridor engine workbench: canonical rules, versioned engines, an arena, perft and weight-tuning
tools. No Mongo, Redis or Socket.IO — here there is nothing but game rules and search. Everything the
website needs lives in `../src`.

```
rules/       the single rules implementation: move generation, walls, goal reachability
engines/     engine versions. v0 — faithful port of the legacy ai-core; everything else is compared only against it
arena/       paired matches, Elo, SPRT, round-robin (worker_threads)
tools/       perft, seedable RNG, micro-benchmark
tests/       parity vs an independent implementation, perft, site parity, arena tests
```

## Rules

`rules/quoridor-rules.js` is UMD — one file for both Node and the browser (it is what
`../src/server.js` serves as `/shared.js`). Any rules change must be accompanied by a perft run: the
numbers in `tools/perft.js` are a contract, not a "for reference" result.

```bash
npm test              # jest: parity, perft to depth 2, engine contract, arena adapter
npm run perft:assert  # full perft in node: reference numbers, non-zero exit code on mismatch
npm run bench         # micro-benchmark of hot rule functions
```

Deep perft (depth 3, ~2M leaves) is deliberately **not** run inside jest: jest executes
`quoridor-engine` in a vm context where V8 does not optimize these loops, and a full walk takes
~3 minutes there instead of ~7 seconds. The engine, arena and browser run outside jest, so the
reference is verified where the code really executes. A deep run inside jest is available via
`QUORIDOR_SLOW=1`.

## Engines

| version | what it is |
|---|---|
| `engines/v0` | Verbatim port of `../src/core/ai-core.js`. Including its known defects: the eval from one bot's point of view and a TT whose key omits the player. Deliberate — otherwise any later SPRT would measure the porting difference, not the search change. |
| `engines/v1` | negamax with score-sign inversion on side change and a player-aware TT key. The historical production engine for the site; still the reference for the arena. |
| `engines/v2` | v1 plus a wider wall-move space. Measurably much worse (Elo −263 vs v1), recorded as a dead-end so nobody re-derives it. |
| `engines/v3` | **Current production engine.** Independent implementation with a compact board, incremental 2×32-bit Zobrist, 2-way bucket TT, negamax + PVS + iterative deepening + aspiration windows + LMR + killers + history, shortest-path wall pruning, exact immediate-win detection, path-race eval and hard-repetition handling. Also the well-known "wall through a pawn" rule is not enforced — a separate conscious decision (see below). |

```js
const { createEngineV0 } = require('./engines/v0');
const Rules = require('./rules');

const engine = createEngineV0({ seed: 1, timeMs: 200, maxDepth: 5 });
const res = engine.think(Rules.createInitialState(), { difficulty: 'hard' });
// res = { move, depth, nodes, timeMs, score, ttStores }
```

Engine state lives on the instance (table, killer moves, node counter, deadline), so two engines in
one process — or in different `worker_threads` — never interfere. The input state is never mutated.
`Math.random()` is not called anywhere: Zobrist tables and random selection in `easy` mode come from
the seed.

`tests/engine-parity.test.js` requires v0 to pick **the same move** as the site engine on 16 fixed
positions at `medium` and `hard`. That is exactly the test that breaks first on any port change.

### Per-bot identity — `engines/personality.js`

A deterministic weight perturbation derived from the bot id, so different bot accounts prefer
different structures (more/less wall-happy, more/less tempo) and open differently game to game.
`personality(botId, spread)` returns `{ weights, archetypes }`; the engine draws one of the three
archetype openings per game with its seeded rng. The site bundles this file for the browser alongside
`engines/v3` (see `src/core/ai-v1-bundle.js`).

## Arena

See `arena/README.md`. In short:

```bash
npm run match -- --a v0-hard --b v0-medium --games 2000 --movetime 100 --sprt 0,5
npm run rr -- --games 200 --movetime 100 --anchor v0-medium
```

## Open items

- The "no wall through a pawn" rule is deliberately not enforced. Changing it will break the perft
  reference numbers.
- v3's anti-repetition and eval are production-tuned for the site's 4 depth tiers; changes must be
  accepted via SPRT on the arena before being promoted.