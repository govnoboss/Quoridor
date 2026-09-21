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
| `createRoom` | `{ token? }` | Create a private room. Replies with `roomCreated { roomCode }`. |
| `joinRoom` | `{ roomCode, token? }` | Join a room (code normalized to uppercase). When full (2nd player), the game starts. |

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
| `sendReaction` | `{ lobbyId, emoji }` — emoji must be in the server allowlist (25 emoji). |
| `requestRematch` | `{ lobbyId, token? }` |
| `respondRematch` | `{ lobbyId, token?, accept }` |

### Friends

| Event | Payload |
| --- | --- |
| `inviteToGame` | `{ friendId }` — creates a `game_invite` notification (accepted friends only). |
| `acceptGameInvite` | `{ fromId }` — creates a private room with the inviter and starts the game. |

Implicit: `disconnect` — the server removes the player from queues, pauses their game
(turn clocks cleared), notifies the opponent, and clears queues when both are absent.

## Server → Client

### On connect (authenticated sockets)
- `onlineStats` — `{ online, playing, humans, bots, liveGames }` presence snapshot, then a
  global broadcast every 5 s.
- `notifications:list` — up to 20 unread notifications for the logged-in user.
- `friendOnline` / `friendOffline` — `{ _id, username }` when a friend changes status.

### Matchmaking / rooms
- `findGameFailed` — `{ reason }` (`Too many requests…`, `Invalid time limits…`,
  `Ranked play requires login`, `Already in a queue`, `Server error`).
- `roomCreated` — `{ roomCode }`.
- `joinRoomFailed` — `{ reason }` (`Комната не найдена`, `Комната полна`,
  `Вы уже в этой комнате`, `Нельзя играть с самим собой`, …).
- `gameStart` — `{ lobbyId, lobbyCode, color, opponent, me, initialTime? }` (full player
  profiles included). Sent to both players of a match, a private-room game or a friend invite.
- `gameStartFailed` — `{ reason }` (opponent disconnected).

### Gameplay
- `serverMove` — `{ playerIdx, move, nextPlayer, timers }` broadcast to the lobby.
- `moveRejected` — `{ reason }` (`Too many moves`, `Invalid lobby format`, `Invalid move format`,
  `Room busy`, `Game not found`, `Unauthorized`, or a `gameReducer` validation message).
- `timerUpdate` — `{ timers }`, broadcast every second by the server pulse.
- `receiveReaction` — `{ emoji, playerIdx }` broadcast to the lobby.
- `opponentDisconnected` — opponent left; the game is paused (30 s grace).
- `opponentReconnected` — game resumes.
- `gameOver` — `{ winnerIdx, reason, gameResultId, hasBot, ratingChanges? }`; `ratingChanges`
  (`{ playerWhite, playerBlack, newRatingWhite, newRatingBlack }`) only for ranked games.

### Reconnect / replay
- `gameResumed` — `{ lobbyId, lobbyCode, color, myPlayerIndex, state, timers, profiles }`.
- `gameReplayAvailable` — `{ lobbyCode, history, playerProfiles, timers, result }`.
- `gameActiveError` — `{ lobbyCode }` when a rejoin is denied because the game is active.

### Rematch (see also the 30 s window in ARCHITECTURE.md)
- `rematchInvite` — `{ lobbyId, requesterName }` to the invited opponent.
- `rematchStarted` — same shape as `gameStart` (colors swapped), to both players.
- `rematchDeclined` — `{ reason }` (`busy`, `offline`, `declined`) to the requester.
- `rematchFailed` — `{ reason }` to the initiator on errors.
- `rematchExpired` — the 30 s response window elapsed.

### Presence / moderation
- `forceDisconnect` — `{ reason }` (`You have been banned`, `Admin access removed`,
  `Account deleted`, `Logged in from another tab`) — disconnect the socket.
- `error` — generic `{ message }` (e.g. rate-limited `createRoom`).