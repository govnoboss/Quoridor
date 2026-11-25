# Game clocks and session recovery — v2

Implementation: `frontend/js/game-clock.js` (pure CommonJS/UMD clock calculations), `src/core/lobby-lock.js` (serialized transitions), `src/server.js` (game lifecycle), `frontend/js/game.js` / `net.js` (display/recovery), `src/storage/redis.js` (deadlines and owner-aware leases). Canonical board rules remain in `quoridor-engine/rules/`.

## Mode policy

| Mode | Clock |
|---|---|
| Local bot and two players on one device | Disabled; no interval or time-loss condition; timer elements hidden |
| Room by code | Host chooses untimed (UI default), or 60/180/300/600 seconds **per player for the whole game**, increment 0 |
| Friend-list invitation | Untimed |
| Ranked/casual matchmaking, including server bot fallback | Selected queue base/increment; public matchmaking cannot request untimed |
| Rematch | Original normalized control, including untimed |
| Replay/history | Recorded clock snapshots; never inferred from the next move's timestamp |

`createRoom` without a control remains 600+0 for old clients. New UI always sends an explicit choice. The host's settings are immutable after code allocation. `getRoomInfo` supplies the choice before the join confirmation; `joinRoom.expectedTimeControl` detects mismatches. Untimed admission requires that confirmation field; old tabs receive a refresh instruction. Friend-list untimed invitations require `auth.clockVersion:2` on both sockets. Creating a replacement room invalidates that socket's previous pending code. Room admission is serialized and rejects participants already in a game.

## State, units and invariants

- `timeControl = {mode:'timed',base,inc}` uses seconds for compatibility; untimed is `{mode:'untimed',base:null,inc:0}`. Zero is never a sentinel for untimed.
- Persistent `clock = {version:2,enabled,remainingMs,active,startedAt,running,incrementMs}` uses milliseconds and server epoch timestamps. Untimed has `remainingMs:null`; `timers:null` on the compatibility wire.
- `revision` increases after an accepted move and finalization; `startedAt` records game start separately from archive completion date. Compatibility `timers` contains seconds, possibly fractional.
- An action captures server time, checks expiry **before** board mutation (`now >= deadline` loses), settles elapsed milliseconds, validates/applies the reducer and adds one increment only for a legal move. Rejected moves do not gain time/increment. Human and server-bot moves use `applyGameMove`.
- `Clock.snapshot` is read-only after legacy initialization: repeated reads/resumes do not reset the clock. `Clock.stop` freezes the final value. The interval schedules work/displays values; it is never the authority on whether a late action counts.
- `Shared.cloneState` preserves/deep-copies clock/control/lifecycle metadata. New-game clocks start after profile preparation, immediately before persistence.
- Persisted v1 active games migrate from their actual remaining seconds and original anchor, with `clock.legacy:true`. Their missing original base/history is not recoverable; old replay clocks are hidden rather than guessed.

## Network and concurrency

`gameStart`/`rematchStarted` include `clock`, `timeControl`, `revision`, `serverNow`, `initialTime` and `gameMode`. `serverMove` additionally carries the current public board state. `gameResumed` is a full snapshot; participant tokens, socket IDs and private presence metadata are stripped. `timerUpdate` carries a sampled clock and lobby ID; a client only applies it when its revision/turn matches. Otherwise it requests a full snapshot.

`requestTimerSync {lobbyId}` now performs full recovery, emitting `gameResumed` or `gameOver`, then acknowledging `{restored:true}`; unauthorized/missing games acknowledge `{unavailable:true}`. Failures can acknowledge `{error}`. The frontend deduplicates pending recovery, blocks moves until a snapshot arrives, rejects older revisions/samples and always replaces its display anchor. `performance.now()` drives interpolation; half of the previous measured RTT (bounded at one second) is an approximate display correction, never authority for accepting moves.

`withLobbyLock` serializes local callers and uses Redis owner-token leases (30 seconds, renewed every 5 seconds). Nested finalization reuses the held transition. Redis compare-and-delete/renew prevents an expired owner from releasing another owner's lease. The pulse does not overlap itself and waits for the server to listen; state changes in recovery/presence use the same lock. A serialized finished flag prevents concurrent duplicate finalization. Mongo stats/archive writes are not a multi-document transaction; a process failure during those writes still needs operational reconciliation.

## Disconnection, background and restart

Online clocks **continue** while a socket/tab is absent. A disconnect never freezes/refunds thinking time. A single missing participant has a separate server-detected reconnect allowance: 30 seconds for timed games, 120 seconds for untimed rooms. This begins when Socket.IO detects the loss, not necessarily when a phone loses radio connectivity (`pingTimeout` is 60 seconds). Clock expiry takes precedence over a simultaneous presence timeout.

If both humans disappear, a timed game keeps its clock deadline; an untimed game is retained up to 24 hours before an abandoned draw. Redis game/token/active-user TTLs are 25 hours; connected games renew game/link lifetime once a minute. Restart reconciliation runs after slow startup preparation, preserves game/control/anchor, replaces obsolete sockets and rebuilds clock/presence scheduling. It does not delete recoverable games just because old socket IDs are absent. Server bot turns are rescheduled by recovery/pulse.

Client recovery hooks cover visible `visibilitychange`, `pageshow`, network `online`, Socket.IO reconnection and document `resume`. No background JavaScript execution is required for online correctness. Active lobby ID is retained across page reloads. Finished snapshots are cached for 5 minutes; after expiry, recovery checks the durable archive and authorizes the participant by account ID or a SHA-256 token hash (never a public replay capability). `participantTokenHashes` is excluded from normal model selections/API responses.

Local sessions are untimed and persisted in `quoridor_local_session_v2` after moves/Undo and when hidden. Only an actual page reload (`performance` navigation type `reload`) restores board, side to move, mode and human color. A fresh navigation to the site or a new tab clears the saved session and shows the main menu; the native app always starts at the menu because its WebView can recreate the page without a user reload. The session is also removed when starting online, finishing the local game, or leaving the board for the menu/route change (`leaveActiveGame`). Hidden local AI work is invalidated; visible recovery restarts only the bot's current turn. Search tokens and finished/live guards reject stale results after timeout, exit, Undo, Restart or background. `AI.endGame()` invalidates pending searches. Browser storage may be unavailable/evicted; private browsing/device data removal cannot guarantee local restoration.

Server AI uses `src/bots/think-worker.js`, one lazily created worker per game, preserving per-game personality/engine state without blocking the server event loop. Both artificial delay and search budget adapt to remaining clock time. Finished/cancelled/stale-position results cannot be applied; finalization terminates the worker.

## Archive and replay

New `GameResult` fields: `startedAt`, `finalClock`, private `participantTokenHashes`; `timeControl.mode` distinguishes timed/untimed. Each new history record stores post-move `clock` and `elapsedMs`. Final clocks freeze before archival. Both replay UIs display saved values (including increments); first-position clocks are shown only when a trustworthy v2 initial control exists. Local/untimed/legacy-unknown replay clocks remain hidden. Completion `date` is never treated as game start.

## Validation and rollout

Run `npm run test:once -- --runInBand`. Core cases are in `tests/game-clock.test.js`, `game-clock-client.test.js`, the clock integration group in `server-ws.test.js`, and `bot-clock-worker.test.js`. Existing board/Undo/auth/API/analytics/engine tests also remain required. `tests/setup.js` isolates Sentry process-global instrumentation from Jest test VMs; production Sentry is unchanged.

Browser acceptance uses an isolated local app with test Redis/User stores: room choice/confirmation, five-minute game/reload without refund, untimed local board and a non-initial position surviving reload, mobile layout. Physical Android Chrome/WebView and iPhone Safari lock/unlock, app switching, radio switching and OS process eviction remain a separate manual acceptance gate; desktop responsive checks and synthetic visibility unit tests do not establish physical-device behavior.

Verified locally on 2026-11-22: **18 suites / 320 tests passed** (`artifacts/timer-audit/all-results.json`), including real server-AI workers. The additional recovery/client run passed 47 tests (`final-recovery-results.json`): 120-second untimed reconnect allowance, clock expiry before disconnect forfeiture, both-absent abandonment and immediate persistence after local Restart are covered. New clock/lock/worker modules and new standalone tests pass ESLint; changed runtime files pass syntax checks and `git diff --check`. This is not a claim that the repository-wide legacy lint baseline is clean. Browser verification at 390×844 also restored the bot's first move after reload with hidden clocks; screenshot: `artifacts/timer-audit/local-bot-mobile.jpg`.

Deployed on 2026-11-22; backup/image details are in `DEPLOY.md`. Production acceptance passed 11 real HTTPS/Socket.IO checks (`artifacts/timer-audit/production-smoke.json`): all four room bases, untimed room, move with clock history, reconnect without refund, unauthorized recovery rejection, natural one-minute server timeout, durable archived clocks and finished-result recovery. Public client/rules asset hashes matched the release. Mobile browser acceptance covered the room form, hidden clocks in both local modes and bot position/history restoration after reload. No physical-device lock/sleep/OS-kill acceptance is implied. Deployment preflight also preserved the existing `room-joined` analytics flag after the new settings confirmation.

Deploy frontend/cache versions and backend together, preserving active Redis state/volumes. Verify room defaults, one timed game, reconnection, untimed local modes and archived result recovery after restart. Existing timed clients retain second-based compatibility, but old tabs must refresh before entering untimed rooms. Rollback must drain/finish v2 untimed games before running an older server that assumes array clocks. Do not remove `clock`/`timeControl` fields from saved games as a rollback technique.
