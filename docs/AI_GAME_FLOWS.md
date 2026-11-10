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

- Time-control state is held in the game state and managed server-side.
- The server emits `timerUpdate` updates.
- Disconnect handling pauses/clears relevant turn timing and informs the opponent.
- A grace timeout can end the game if the player does not reconnect; inspect `handleDisconnectTimeout` and related Redis timer methods before changing timing behavior.
- Reconnect is token/lobby-based and uses `rejoinGame` or `rejoinLobby`; successful restoration is reported through `gameResumed`.

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
