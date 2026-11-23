# WebSocket Protocol (Socket.IO)

All realtime events between `frontend/js/net.js` (client) and `src/server.js` (server).
Connection root `/` — Socket.IO with `path: '/socket.io'`, served from the same origin.
The server is authoritative: clients only *suggest* moves and the server validates them.

Unless stated otherwise a payload is a JSON object. The server authorizes players by the
Socket.IO connection **plus** a per-connection **player token** (`socket.playerToken`,
set from `req.session.playerToken` or from a fresh token via `assignToken`).

## Client → Server

### Matchmaking

| Event | Payload | Description |
| --- | --- | --- |
| `findGame` | `{ token?, timeControl?: { base, inc }, isRanked? }` | Enqueue for matchmaking. `base` in seconds `[60..1800]`, `inc` `[0..60]`. Ranked requires a logged-in account. Before it, the client must have a token (from `/api/auth/me`). |
| `cancelSearch` | `{ token? }` | Remove from all queues and cancel any scheduled bot fallback. |

### Private rooms

| Event | Payload | Description |
| --- | --- | --- |
| `createRoom` | `{ token?, timeControl?: {mode:'untimed'} \| {mode:'timed',base:60\|180\|300\|600,inc:0} }` | Create a private room. New UI defaults to untimed; omitted control retains legacy 600+0. Returns `roomCreated {roomCode,timeControl}`. |
| `getRoomInfo` | `{roomCode}` + ack | Pre-join confirmation metadata: `{roomCode,timeControl}` or `{error}`. |
| `joinRoom` | `{ roomCode, token?, expectedTimeControl? }` | Join after confirming host settings; code normalized to uppercase. Mismatched settings rejected; untimed rooms require the confirmation field (old tabs must refresh). Admission is serialized. |

### Reconnect / replay

| Event | Payload | Description |
| --- | --- | --- |
| `rejoinGame` | `{ token }` | Server finds the active game by token and emits `gameResumed`. |
| `rejoinLobby` | `{ token, lobbyCode, replay? }` | Load a lobby: active game → `gameResumed`; finished snapshot (5 min TTL) or MongoDB archive → `gameReplayAvailable`; otherwise nothing (normal room join). |

### Gameplay

| Event | Payload |
| --- | --- |
| `playerMove` | `{ lobbyId, move }` where `move` is `{ type: 'pawn', r, c }` or `{ type: 'wall', r, c, isVertical }` (`playerIdx` is added server-side). |
| `surrender` | `{ lobbyId }` |
| `requestTimerSync` | `{ lobbyId }` + acknowledgement callback — full recovery after reconnect/background: emits `gameResumed` or participant-authorized `gameOver`, then ack `{restored:true}`. Missing/non-participant: `{unavailable:true}`; failure: `{error}`. See `AI_CLOCKS.md`. |
| `leaveGame` | `{ lobbyId }` — leave the game: it is finalized with the opponent as winner (reason `Surrender`). |
| `sendReaction` | `{ lobbyId, emoji }` — emoji must be in the server allowlist (25 emoji). |
| `requestRematch` | `{ lobbyId, token? }` |
| `respondRematch` | `{ lobbyId, token?, accept }` |

### Friends

| Event | Payload |
| --- | --- |
| `inviteToGame` | `{ friendId }` — creates a `game_invite` notification (accepted friends only). |
| `acceptGameInvite` | `{ fromId }` — creates a private room with the inviter and starts the game. |

Implicit: `disconnect` removes the player from queues and notifies the opponent. Online turn
clocks continue; separate reconnect allowance is 30 seconds timed / 120 seconds untimed.
Both-absent and restart policies are specified in `AI_CLOCKS.md`.

## Server → Client

### On connect (any socket)
- `assignToken` — `{ token }` sent when the handshake carried no valid player token; the client
  stores it and returns it in the next handshake (`socket.handshake.auth.token`).

### On connect (authenticated sockets)
- `onlineStats` — `{ online, playing, humans, bots, liveGames }` presence snapshot, then a
  global broadcast every 5 s.
- `notifications:list` — up to 20 unread notifications for the logged-in user.
- `friendOnline` / `friendOffline` — `{ _id, username }` when a friend changes status.

### Matchmaking / rooms
- `findGameFailed` — `{ reason }` (`Too many requests…`, `Invalid time limits…`,
  `Ranked play requires login`, `Already in a queue`, `Server error`).
- `roomCreated` — `{ roomCode, timeControl }` (normalized host settings).
- `joinRoomFailed` — `{ reason }` (localized, ru/en). RU examples: `Комната не найдена`
  ("room not found"), `Комната полна` ("room full"), `Вы уже в этой комнате` ("you are already in
  this room"), `Нельзя играть с самим собой` ("you can't play yourself"), ….
- `gameStart` — `{ lobbyId, lobbyCode, color, opponent, me, initialTime? }` (full player
  profiles included). Sent to both players of a match, a private-room game or a friend invite.
- `gameStartFailed` — `{ reason }` (opponent disconnected).

### Gameplay
- `serverMove` — `{ lobbyId, playerIdx, move, nextPlayer, state, clock, timers, revision, serverNow, timeControl }`; `state` is a public snapshot without player tokens/socket IDs. `timers` is nullable seconds compatibility; `clock` is authoritative sampled milliseconds.
- `moveRejected` — `{ reason }` (`Too many moves`, `Invalid request`, `Invalid lobby format`, `Invalid move format`,
  `Room busy`, `Game not found`, `Game already finished`, `Unauthorized`, `Server error`,
  or a `gameReducer` validation message).
- `timerUpdate` — `{lobbyId,clock,timers,revision,serverNow,timeControl,...}`, sampled every second. Apply only at matching board revision/turn; otherwise recover the full game.
- `receiveReaction` — `{ emoji, playerIdx }` broadcast to the lobby.
- `opponentDisconnected` — opponent left; the game is paused (30 s grace).
- `opponentReconnected` — game resumes.
- `gameOver` — `{ winnerIdx, reason, gameResultId, hasBot, ratingChanges? }`; `ratingChanges`
  (`{ playerWhite, playerBlack, newRatingWhite, newRatingBlack }`) only for ranked games.

### Reconnect / replay
- `gameResumed` — `{ lobbyId, lobbyCode, color, myPlayerIndex, state, clock, timers, profiles, revision, serverNow, timeControl, gameMode }`.
- `gameReplayAvailable` — `{ lobbyCode, history, playerProfiles, timers, result }`.
- `gameActiveError` — `{ lobbyCode }` when a rejoin is denied because the game is active.

### Rematch (see also the 30 s window in ARCHITECTURE.md)
- `rematchInvite` — `{ lobbyId, requesterName }` to the invited opponent.
- `rematchStarted` — same shape as `gameStart` (colors swapped), to both players.
- `rematchDeclined` — `{ reason }` (`busy`, `offline`, `declined`) to the requester.
- `rematchFailed` — `{ reason }` to the initiator on errors.
- `rematchExpired` — the 30 s response window elapsed.

### Presence / moderation
- `notification:new` — the notification object itself, not an envelope; client refreshes canonical HTTP history.
- `forceDisconnect` — `{ reason }` (`You have been banned`, `Admin access removed`,
  `Account deleted`, `Logged in from another tab`) — disconnect the socket.
- `error` — generic `{ message }` (e.g. rate-limited `createRoom`).

### Friend invites
- `acceptGameInvite {fromId,notificationId?}` acknowledges `{ok:true}` or `{ok:false,error}`. Saved invites must be current (120 seconds), unaccepted and owned; both players must be free. See `AI_NOTIFICATIONS.md`.
- `inviteFailed` — `{ reason }` (`Friend is offline …`) when a friend game invite cannot be delivered.
