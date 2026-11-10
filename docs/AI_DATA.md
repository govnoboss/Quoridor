# AI Data and Persistence Reference

## 1. Persistence responsibilities

| Store | Role | Implementation |
|---|---|---|
| MongoDB | Durable application records | Mongoose models in `src/models/`; connection in `src/storage/db.js` |
| Redis | Realtime game coordination, queues, session store integration and short-lived state | `src/storage/redis.js`; session wiring in `src/server.js` |
| In-memory fallback | Local/test fallback when Redis is unavailable, unless disabled by configuration | `src/storage/redis.js` |
| Filesystem | Processed user avatars | `avatars/` or `AVATARS_DIR`; Docker volume `avatars_data` |

Do not assume the in-memory fallback is equivalent to Redis across multiple processes or restarts.

## 2. Mongoose models

Model files found in `src/models/`:

| Model | Purpose inferred from model name and server usage; inspect schema before field changes |
|---|---|
| `User.js` | Accounts, credentials/provider identifiers, roles, rating/profile/statistics |
| `GameResult.js` | Archived completed games and replay/history data |
| `Friendship.js` | Friend relationships/requests |
| `Notification.js` | User notifications, including friend/game invitations |
| `Report.js` | User-submitted support/bug reports and replies |
| `UserReport.js` | Player-to-player complaints and moderation status |
| `BotSettings.js` | Persisted bot configuration |
| `AdminLog.js` | Administrative action audit log |
| `AnalyticsEvent.js` | Product analytics events |

The table is a navigation aid, not a complete schema. Use the relevant model file as the source of truth for field names, defaults, indexes, enums and validation.

## 3. Redis abstraction inventory

`src/storage/redis.js` exports a broad wrapper. Function names found in the source include:

| Group | Methods |
|---|---|
| Lifecycle / mode | `connect`, `disconnect`, `isReady` |
| Game state | `saveGame`, `getGame`, `deleteGame`, `getAllGameIds`, `addActiveGame`, `removeActiveGame`, `getActiveGameIds` |
| Concurrency | `acquireLock`, `releaseLock` |
| Token / lobby mapping | `setTokenMapping`, `getLobbyByToken`, `deleteTokenMapping`, `setTokenUserMapping`, `getUserIdByToken`, `deleteTokenUserMapping`, `setActiveLobbyForUser`, `getActiveLobbyForUser`, `clearActiveLobbyForUser` |
| Rooms / codes | `incrementLobbyCounter`, `getLobbyCounter`, `generateUniqueLobbyCode`, `createRoom`, `getRoom`, `updateRoom`, `deleteRoom` |
| Queues | `addToQueue`, `removeFromQueue`, `popTwoFromQueue`, `removeFromAllQueues` |
| Timers | `setDisconnectTimer`, `clearDisconnectTimer`, `getExpiredDisconnectTimers`, `hasDisconnectTimer`, `setTurnTimeout`, `clearTurnTimeout`, `getExpiredTurnTimeouts` |
| Rematch / replay | `saveRematchContext`, `getRematchContext`, `deleteRematchContext`, `saveFinishedGame`, `getFinishedGame` |
| Bot repeat tracking | `incrementBotRecentMatchCount`, `getBotRecentMatchCount`, `recordBotOpponent`, `getBotOpponents` |
| Constants | `TTL` (cache lifetimes in seconds: `GAME` 2h, `FINISHED_GAME` 5 min, `TOKEN_MAPPING` 2h, `ROOM` 30 min, `REMATCH` 5 min, `USER_ACTIVE_LOBBY` 2h) and `KEYS` (key-name builders, `game:*`, `token:*`, `queue:*`, `room:*`, …) |

> The following exist as internal helpers in the file but are **not** in `module.exports`
> (do not call them via `Redis.<name>`): `getStore`, `isMemoryMode`, `lobbyExists`,
> `randomLobbyCode`, `getAllQueueKeys`.

Inspect method bodies for key names, TTLs, serialization and atomicity before relying on undocumented details.

## 4. Mongo connection

`src/storage/db.js` exports `connectDB()`. It connects to `process.env.MONGO_URI` or `mongodb://127.0.0.1:27017/quoridor`, with 5-second server-selection and connection timeouts. On failure it logs and continues rather than rethrowing from the catch block. Therefore, startup success does not alone prove MongoDB is available.

## 5. Avatar pipeline

The existing architecture/API docs describe `POST /api/user/upload-avatar` as a multipart upload (field `avatar`) with JPEG/PNG/WebP input and a 5 MB limit, processed by `sharp` into a 256×256 WebP file. Verify the middleware and route before changing size/format rules.

**Storage path caveat:** the directory is **hardcoded** to `path.join(__dirname, '..', 'avatars')`
in `src/server.js` (the `AVATARS_DIR` constant); the code never reads `process.env.AVATARS_DIR`,
so that env variable currently has **no effect**. It coincidentally works in Docker because the
Dockerfile places the project root at `/app`, making `<root>/avatars` = `/app/avatars`, which the
Compose volume `avatars_data` mounts. Treat the location as a source-code constant, not as a
configurable setting.

## 6. Environment and secret handling

Use `.env.example` as the variable-name inventory and `docker-compose.yml` for production Compose overrides. Never put actual `.env` values, session secrets, API keys, OAuth secrets, database credentials or keystore passwords into docs or commits.
