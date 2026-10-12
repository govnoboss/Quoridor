# Arena

Engine comparison: paired games (same opening, colors swapped), Elo with confidence intervals, SPRT
with early stopping, round-robin with Bradley–Terry ratings, parallel games via `worker_threads`, and
a JSONL log per game.

The arena knows nothing about Quoridor. All interaction with the game goes through an adapter
(`src/match.js` only calls these eight functions):

```
createInitialState()            cloneState(s)              currentPlayer(s)
winner(s) -> 0|1|null           positionKey(s) -> string   legalMoves(s) -> move[]
applyMove(s, m) -> {state}|{error}
makeBot(spec, name) -> { newGame(seed), think(state, playerIdx, limits) -> move }
```

Adapters: `adapters/quoridor.js` (live) and `adapters/toy.js` (Nim, the arena's own self-check).

## Running

```bash
# SPRT match: accept a new version only if it beats v0 by at least 5 Elo
node src/cli.js match --adapter ./adapters/quoridor.js --bots ./bots.json \
     --a v0-hard --b v0-medium --games 2000 --movetime 100 --sprt 0,5 --out results/hard-vs-medium.jsonl

# all vs all + ratings (anchor: v0-medium = 0)
node src/cli.js roundrobin --adapter ./adapters/quoridor.js --bots ./bots.json \
     --games 200 --movetime 100 --anchor v0-medium

# arena self-check on a toy game
node src/cli.js match --adapter ./adapters/toy.js --bots ./bots.toy.json \
     --a smart --b random --games 200 --threads 2 --sprt 0,20 --out results/selftest.jsonl
```

Flags: `--threads N` (default cores−1), `--seed`, `--movetime ms | --depth N | --nodes N`,
`--opening-plies N` (default 4 random plies), `--max-plies 300`, `--repetition N`, `--no-moves`,
`--out file.jsonl`.

`--repetition N` — how many occurrences of one position count as a loop. **`N=0` disables the rule**
(the game runs to `--max-plies`): this is the mode that distinguishes "the bot is stuck in a cycle"
from "the bot just deliberates for a long time". `N=1` is **not** the way to disable it — it is the
opposite: a trigger on the very first repetition, the game ends almost immediately, and garbage goes
into the result.

## Loops: not a draw, a bug

A repetition draw is not a Quoridor rule but an alien Draw the arbiter introduced so a match can
end. For `v0-hard` against `v0-medium` it was roughly half of all games, and against itself — 48.5%;
for `v1-hard` against itself — 0%. It is a sign that the engine cannot escape a cycle, so the loop
share is measured and shown separately from the score:

```
loops: 23/40 (57.5%)  loop starts at ply ~30  median loop 8 plies   <-- HIGH: score is dominated by stalls
```

`loop starts at ply ~30` — the ply at which the **current** cycle started, i.e. the last previous
occurrence of the position. Not the ply at which the arbiter gave up. The distinction is essential:
"stuck from move 4" and "reached move 200 and got stuck" are fixed in completely different ways.
While the loop share is above ~20%, any SPRT mostly measures stall speed rather than strength, and
tuning weights on such a score optimizes the bug.

Game length is shown next to it, because the score does not reflect it:

```
plies: mean 72.0  median 72  min 25  max 107
```

A growing mean at an unchanged score is a sure sign the engine has become slower; a falling one means
it wins faster, sometimes by stalling the opponent.

A related caveat about weak loop protection: the engine reads `history[].prevPos`, but the reducer
(`rules/quoridor-rules.js`) only stores `move` in the history, so `prevPos` is **never** there and the
fallback kicks in — a penalty for returning to the *destination* cell of the previous move, not the
*source*. This is a defect of the server-side `ai-core.js` (the same fallback is there), so it is
expressed the same way on the site. For version comparison it is a constant; for gameplay it must be
fixed in `gameReducer`.

From the `quoridor-engine` root, the same commands are available as `npm run match`, `npm run rr`,
`npm run arena:selftest`.

## What was already done (and why)

The first version of the arena did not exist — there was a set of stubs marked `ADAPT`. Three things
in it were not merely unfinished but silently produced wrong numbers:

1. **`GOAL_ROW = [8, 0]`** — those are the start rows, not the goal rows. Every position looked
   finished, and every game ended on ply zero. The goal row now comes from the rules (`Rules.GOAL_ROW`).
2. **`gameReducer(clone, move, s.currentPlayer)`** — but `gameReducer(state, action)` reads the player
   from the `action` itself and throws `Not your turn` if it is missing. The third argument was ignored,
   so **every** move was rejected. Now `playerIdx` is passed inside the action.
3. **A shared TT between bots** — the old adapter copied the `ai-core` module via `delete require.cache`
   so each bot had its own table. That is a global side effect and breaks as soon as there is more than
   one adapter in the process. Now a new engine instance is created per game.

All of this is covered by tests in `../tests/arena-adapter.test.js` — not because it "would be nice",
but because all three bugs produced a result rather than an error.

The remaining items of the original `TODO` list were closed as follows:

| item | where |
|---|---|
| `think(state, idx, difficulty, opts)` with limits and seed | `engines/v0` (the engine has its own interface `think(state, limits)`; limits are mandatory) |
| remove global state (`tt`, `killers`, `deadline`, nodes) | `engines/v0` — state on the instance, `reset()` and `newGame(seed)` |
| TT perspective | **deliberately not fixed** — that is the next engine version, see `engines/v0/index.js` |
| node limit | `limits.nodes`, checked next to the deadline |
| versions in `bots.json` | `bots.json`, weights via `spec.weights` |
| perft + check against an independent implementation | `../tools/perft.js`, `../rules/reference.js`, tests |

## v1 difficulty tiers

Four play tiers that differ **only in search depth**:

| bot | `maxDepth` | measured Elo relative to itself |
|---|---|---|
| `v1-easy` | 2 | −28 |
| `v1-medium` | 3 | −5 |
| `v1-hard` | 4 | −4 |
| `v1-expert` | 5 | +37 |

The order is monotonic, no inversions (round-robin, 200 games per pair, 10000 nodes). The gap between
neighboring tiers is small: `v1-medium` vs `v1-easy` — 25.1 Elo [3.5, 46.8] over 1000 games, LOS
98.9%. A player may not feel the difference between tiers 1 and 2.

**Why `difficulty: "hard"` for all four.** The `difficulty` label in the engine controls only two
things: the default depth (`DEPTH_BY_DIFFICULTY`) and random moves. A random move triggers only when
`difficulty === "easy"` and is taken BEFORE the recent-cell ban, i.e. it brings loops back. So tiers
are set with the `"hard"` label (the only one that disables random moves) plus an explicit `maxDepth`.
There are no random moves at any tier, no loops: 0/1000.

Depth above 5 is not used deliberately: depth 9 vs depth 5 gave Elo −76.5 [−143.0, −15.1], LOS 0.8%
at 100000 nodes. Deepening hurts here, so no "expert" beyond `v1-expert` exists.

## Methodology rules

- `--games` must be even: games 2k and 2k+1 start from the same position, colors swapped.
- Both bots get the **same limit** (time or nodes). For time-based matches, do not load the machine.
- A change is accepted only via SPRT. Elo error ≈ ±680/√N (95%).
- Keep anchors in the pool: old versions plus `v0-random`.
- **A repetition draw is a bug, not a result.** Because of weak anti-loop heuristics v0 often falls
  into a repetition: in `v0-hard` vs `v0-medium` about 40–58% of games end in a repetition. For
  version comparison this is noise; when analyzing, look at `reason` and the `loops:` line in the
  report, not just the score. A miniature Quoridor draw is impossible — a game ends when someone
  reaches the opponent's row.
- The game seed is derived from the match parameters (`seed` + game index within the pair), not from
  pool order: otherwise the same match with `--threads 2` and `--threads 4` would give different
  results.

## Log format (one line = one game)

`{a, b, gameId, openingId, aFirst, aScore, plies, openingLen, reason, timeMs:[a,b], moves:[...]}`

`reason`: `win | repetition | maxplies | illegal:.. | crash:.. | no-move`.
An illegal move or a crash is a loss for the player who moved; the reason goes into the log in full.

For `reason: repetition` the following are added:
- `loopStartPly` — the ply at which the **current** cycle started, i.e. the last previous occurrence
  of the position. That is precisely the loop start;
- `loopLength` — `plies - loopStartPly`, the current cycle length in plies;
- `positionsSeen` — how many distinct positions occurred in the game;
- `loopFirstSeenPly` — when the position occurred **first** in the game. Usually less than
  `loopStartPly`, and the difference shows how many times the position was already on the board before
  the current entry.

Caution: `loopStartPly` used to be computed from the FIRST occurrence of the position, not the last
repetition, and the metric lied by about a factor of two (showing 16 when the true cycle length was
8). The meaning of the fields is unchanged, but they now answer their own question.

WARNING: `--out` opens the file in **append** mode (`runner.js`), so re-running appends to the end
instead of overwriting. For a clean measurement, use a new file name.
