# AI Game Flows

> Describes the major online-game paths visible in the source and existing protocol documentation. Confirm exact branch conditions in `src/server.js` before modifying them.

## 1. Online matchmaking

1. Frontend obtains/holds the player token (auth/session flow) and connects through `frontend/js/net.js`.
2. Client emits `findGame` with optional token, time control and ranked flag.
3. Server validates rate limits, token, ranked eligibility and time control; queue operations are delegated to `src/storage/redis.js`.
4. When two eligible players are paired, the server creates the lobby/game state and emits `gameStart` to both clients.
5. When bot fallback is enabled, the server may schedule bot substitution after configured wait thresholds. Relevant code: `src/bots/BotManager.js`, `src/bots/matchmaking.js`, bot environment settings.

Related events: `findGame`, `cancelSearch`, `findGameFailed`, `gameStart`.

## 2. Private room

1. Client emits `createRoom`.
2. Server generates a room code and stores room data through Redis abstraction.
3. Client shares code; second client emits `joinRoom` with `roomCode`.
4. Server validates room availability and player identity, joins the room, creates game state and emits `gameStart`.

Related events: `createRoom`, `roomCreated`, `joinRoom`, `joinRoomFailed`, `gameStart`.

## 3. Online move

1. Current player emits `playerMove` with `lobbyId` and a pawn or wall move.
2. Server locates the active game and verifies player/socket/token authorization, turn, rate limit and lobby lock.
3. Server applies the action through the canonical rules reducer (`gameReducer` via the rules module).
4. On success, server updates state/timers and stores the state through Redis abstraction.
5. Server broadcasts `serverMove`; clients update the board.
6. If the game has ended, the server finalizes the game and emits `gameOver`.

The client is not authoritative. Never implement a client-only validation as a substitute for server validation.

## 4. Timers and disconnect

**Current implementation: clock v2.** See `AI_CLOCKS.md` for exact state/wire contracts, untimed local modes, room presets, continuous online clocks, recovery and rollout. The audit below is the historical pre-v2 baseline, not the current behavior.

- Time-control state is held in the game state and managed server-side.
- The server emits `timerUpdate` updates.
- Disconnect handling retains the turn deadline; online clocks continue. Presence recovery is a separate deadline (30 seconds timed / 120 seconds untimed).
- A grace timeout can end the game if the player does not reconnect; inspect `handleDisconnectTimeout` and related Redis timer methods before changing timing behavior.
- Reconnect is token/lobby-based and uses `rejoinGame` or `rejoinLobby`; successful restoration is reported through `gameResumed`.

### Historical pre-v2 timer audit — 2026-11-22

Scope: ranked/casual matchmaking, private rooms and friend invitations, server fallback bots, local PvP, local AI, rematch, live-history review and both replay interfaces. The seven relevant implementation files were compared with production using SHA-256 after CRLF/LF normalization and matched. Findings below describe existing behavior, not implemented fixes.

Current model: server games store remaining seconds in `timers`, the active side in `currentPlayer`, and a wall-clock anchor in `lastMoveTimestamp`; Redis stores turn/disconnect deadlines. The server pulse runs every second. The frontend interpolates from `timerBase` using `performance.now()` and redraws every 250 ms. Local PvP/AI start with 600 seconds and run entirely in the browser. Private/friend rooms use 600+0; matchmaking and server bots use the requested control. Replay clocks are reconstructed rather than authoritative snapshots.

| Priority | Finding | Implementation/effect |
|---|---|---|
| High | Subsecond time disappears on every online move | Both human and bot move paths use `Math.floor(elapsed / 1000)`: a 900 ms move costs zero. `< 0` permits a move at zero remaining; a deterministic 1-second clock accepted a move at 1.5 seconds if the timeout pulse had not finalized it. |
| High | Disconnect pause refunds thinking time and disagrees with synchronization | Disconnect clears only the deadline. Resume pulse resets `lastMoveTimestamp` without subtracting time already spent before disconnect: a player with 100 seconds who spent 20 seconds can resume at 100. `requestTimerSync` still subtracts the entire elapsed interval and can finalize this supposedly paused game. Neither move path consistently prohibits moves while the disconnect grace timer exists. |
| High | Resume does not replace the frontend clock base | `gameResumed` assigns `Game.timers` and calls `startTimer`, which retains an existing `timerBase` if the active side matches. A received value of 58 seconds was overwritten with the old base's 50. Sync acknowledgements include `currentPlayer`/`serverNow`, but the client consumes only `timers`; time-only synchronization cannot repair a stale board/turn. |
| High | Original time control is lost | `createInitialState` stores `timers`/`increment`, not `timeControl`; game creation does not populate it. Archive and rematch read `game.timeControl || {base:600,inc:0}`. A live 120+2 game consequently becomes 600+0 in those paths; non-bot archive gameType can also become `friend`. |
| High | Local late moves and AI results can bypass termination | Local timeout is checked in the rendering tick, not at action admission. Advancing the turn after expiry but before the next tick switches the checked clock. `applyBotMove` lacks a finished-game guard; `AI.endGame` does not invalidate the search token. A late result can mutate a finished board and restart its timer. |
| High | Long-background result recovery expires | Finished snapshots have a 5-minute TTL. `resendGameOverIfFinished` returns before its MongoDB fallback if no snapshot exists; `requestTimerSync` still acknowledges `{finished:true}`, which the frontend does not handle. Thus a return after the snapshot expires need not restore the result. |
| High | Server restart deletes recoverable human games | `cleanupStaleGames` tests presence in the new process's socket map and deletes games whose two humans are absent. It runs before `server.listen`, so clients cannot reconnect in time. This is not reliable restart recovery despite Redis holding the game. |
| Medium | Replay clock reconstruction is inaccurate | Embedded replay/history charges the interval between move i and i+1 to player i; standalone replay uses archive `date` (completion time) as the initial anchor, losing first-move duration. Both omit increments and lack authoritative pause/clock history. A 120+2 example expected [112,115] after 10 s/7 s moves, but embedded replay produced [113,120] and standalone replay [120,113]. |
| Risk | Concurrent lifecycle writers can replace newer state | Move/timeout paths use a lobby lock, but pulse resume and rejoin read/save whole game state without that lock. Async pulse runs can overlap. Lock TTL is 2 seconds with no owner token/renewal; unconditional release can delete a newer lock after expiry. These interleavings need dedicated concurrency tests; production occurrence was not measured. |
| Risk | Server AI blocks global timer processing | `BotManager.makeMove` calls synchronous `engine.think` on the server event loop. Engine v3 has difficulty-based default budgets (150/400/900 ms), but scheduling/search do not adapt to the bot's remaining clock. Load impact needs measurement; move workers and clock-aware budgets are proposed improvements. |

Verification: 12 deterministic reproductions ran against actual functions evaluated in isolated VM contexts with fake clocks/storage/DOM. These confirm the observed faulty behavior; they are not passing correctness regression tests or a physical-phone/background acceptance run. Existing websocket tests check timer presence/positive values but do not establish deadline, increment, pause or background correctness; the production timer pulse is disabled under `NODE_ENV=test`.

Original remediation sequence (superseded by the implementation and revised untimed-mode policy in `AI_CLOCKS.md`):

1. Specify lifecycle policy: online/ranked clocks should normally continue through disconnection; a reconnect allowance is separate from chess-clock time. If friendly games pause, settle elapsed time once and store an explicit paused status with a limited allowance. Decide whether local games pause while hidden; pausing both local clocks and AI is the recommended default.
2. Introduce one clock calculation module using millisecond precision, explicit lifecycle status and one captured timestamp per transition. Check expiry before accepting a move (`remaining <= 0`); apply the increment once after a legal move. Route human/server-bot actions through the same transition. Preserve original time control explicitly.
3. Serialize move/disconnect/resume/timeout/finalization through one lock or atomic versioned transition; use owner-aware locks if Redis locks remain. Redis deadline records must agree with authoritative game state. Preserve games across server restart and rebuild deadline scheduling rather than deleting them because old socket IDs are absent.
4. Replace separate resume/time-only recovery with a versioned full snapshot carrying board/turn/clock/status/result and a server timestamp. Ignore older snapshots. Anchor display interpolation to `performance.now()` after accounting for network delay; block action admission until recovery completes. Resolve completed games through participant-authorized durable archive lookup after the short Redis snapshot expires.
5. Handle `visibilitychange`/`pageshow`/network reconnect with a unified recovery operation. Persist local state and clock policy on move and hidden; do not depend on page-exit callbacks. Background rendering may stop; correctness must not depend on timers running in the background. Cancel/ignore stale AI searches on timeout, pause, restart and resume.
6. Store authoritative post-move clock snapshots, move elapsed time and lifecycle events for future archives. Historical games without those fields should not claim exact reconstructed clocks. Add deadline/boundary/increment/reconnect/concurrency tests and real Android/iOS lock/unlock, app-switch, network-switch and process-reload acceptance before deployment. Optimize timer sweeps and move server AI off the event loop after correctness is covered.

### Single-session enforcement and session version

- When a socket connects, if the same `userId` is already connected through another socket, the old
  socket receives `forceDisconnect { reason: 'Logged in from another tab' }` and is kicked
  (see the connection handler in `src/server.js`).
- Socket auth middleware checks the session `sv` against `User.sessionVersion`; a mismatch (password
  reset/change, account merge) destroys the session and rejects the socket with `unauthorized`.

## 5. Finalization and replay

The server's finalization path is centered on `finalizeGame` and related helpers such as `archiveGame`, `resendGameOverIfFinished`, and `calculateEloChange` (names verified in `src/server.js`). The codebase documents the following responsibilities:

- archive completed result/history in MongoDB (`GameResult` model);
- update ranked rating/statistics where applicable;
- preserve a short-lived finished-game snapshot for replay/rejoin;
- remove active realtime state and save rematch context;
- notify clients with `gameOver`.

Replay UI is implemented in `frontend/js/replay.js`; archive lookup endpoint is `GET /api/games/:id`, with page route `/replay/:id`.

## 6. Rematch

1. Player emits `requestRematch`.
2. Opponent receives `rematchInvite`.
3. Opponent emits `respondRematch` with `accept`.
4. On acceptance, server creates a new game and emits `rematchStarted`; colors are **always** swapped (`startRematchGame` hardcodes `swap = true` in `src/server.js`).
5. The invite has an expiry window (documented as 30 seconds). Confirm exact timer implementation before changing it.

## 7. Friends and invites

- Friend requests and relationships use REST endpoints and Mongo models.
- A friend game invite is initiated through `inviteToGame`; server creates a `game_invite` notification.
- `acceptGameInvite` creates a private room/game flow with the inviter.
- Online/offline friend presence is communicated through Socket.IO events.

## 8. Where to inspect

| Behavior | Primary implementation |
|---|---|
| Matchmaking, room lifecycle, move processing | `src/server.js` |
| Redis queues, rooms, locks, timers, mappings | `src/storage/redis.js` |
| Bot fallback and scheduled bot moves | `src/bots/BotManager.js` |
| Bot candidate selection | `src/bots/matchmaking.js` |
| Bot account population | `src/simulation/PopulationManager.js` |
| Client socket event bridge | `frontend/js/net.js` |
| Board/game UI | `frontend/js/game.js`, `frontend/js/ui.js`, `frontend/js/board-renderer.js` |
| Rules/reducer | `quoridor-engine/rules/` |
| Replay | `frontend/js/replay.js`, `src/models/GameResult.js` |
