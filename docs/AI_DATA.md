# AI Data and Persistence Reference

## 1. Persistence responsibilities

Clock v2 schema/lifetime/recovery contracts are in `AI_CLOCKS.md`. Game state now includes millisecond `clock`, original `timeControl`, `revision` and `startedAt`. `GameResult` adds `timeControl.mode`, `startedAt`, `finalClock` and private `participantTokenHashes` (excluded from normal selections). History records include post-move `clock` and `elapsedMs`; never reconstruct exact historical clocks from adjacent timestamps.

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

Admin stage 1 (`AI_ADMIN.md`): banning atomically increments `User.sessionVersion` with the ban. Saved `BotSettings` takes precedence over initial environment defaults. Complaint updates use/increment Mongoose `__v` for optimistic concurrency, clear completion fields on reopen and preserve them on note-only edits. `AdminLog.action` adds `user_report_in_progress` and `user_report_note_updated`; new complaint logs target the reported User and put the complaint ID in `details.reportId`. Historical misclassified logs are retained; legacy complaint metadata is repaired on a subsequent save, without a bulk migration.

## 3. Redis abstraction inventory

Notification/support update: User.notificationPreferences.supportEmail defaults
false. Report messages add opaque id/notificationPending. Notification adds sparse
unique dedupeKey, expiresAt/actionStatus and email retry state. Additive indexes,
no bulk historical notification replay. Details and single-process worker limits:
`AI_NOTIFICATIONS.md`.

Product analytics v2 uses the existing AnalyticsEvent fields and opaque linkage IDs
in `props`, plus an additive `{name:1,timestamp:1}` index. Full-day cohort definitions,
identity/exclusion limitations, read limits and rollout are in `AI_ANALYTICS.md`.

`src/storage/redis.js` exports a broad wrapper. Function names found in the source include:

| Group | Methods |
|---|---|
| Lifecycle / mode | `connect`, `disconnect`, `isReady` |
| Game state | `saveGame`, `getGame`, `deleteGame`, `getAllGameIds`, `addActiveGame`, `removeActiveGame`, `getActiveGameIds` |
| Concurrency | `acquireLock` returns an owner token or false; `releaseLock(lobbyId,token)` compare-deletes; `renewLock(lobbyId,token,ttlMs)` compare-renews. Lifecycle callers use `src/core/lobby-lock.js`. |
| Token / lobby mapping | `setTokenMapping`, `getLobbyByToken`, `deleteTokenMapping`, `setTokenUserMapping`, `getUserIdByToken`, `deleteTokenUserMapping`, `setActiveLobbyForUser`, `getActiveLobbyForUser`, `clearActiveLobbyForUser` |
| Rooms / codes | `incrementLobbyCounter`, `getLobbyCounter`, `generateUniqueLobbyCode`, `createRoom`, `getRoom`, `updateRoom`, `deleteRoom` |
| Queues | `addToQueue`, `removeFromQueue`, `popTwoFromQueue`, `removeFromAllQueues` |
| Timers | `setDisconnectTimer`, `clearDisconnectTimer`, `getExpiredDisconnectTimers`, `hasDisconnectTimer`, `setTurnTimeout`, `clearTurnTimeout`, `getExpiredTurnTimeouts` |
| Rematch / replay | `saveRematchContext`, `getRematchContext`, `deleteRematchContext`, `saveFinishedGame`, `getFinishedGame` |
| Bot repeat tracking | `incrementBotRecentMatchCount`, `getBotRecentMatchCount`, `recordBotOpponent`, `getBotOpponents` |
| Constants | `TTL` (cache lifetimes in seconds: `GAME`/`TOKEN_MAPPING`/`USER_ACTIVE_LOBBY` 25h, `FINISHED_GAME` 5 min, `ROOM` 30 min, `REMATCH` 5 min) and `KEYS` (key-name builders, `game:*`, `token:*`, `queue:*`, `room:*`, …). Connected game/link lifetime is renewed once per minute; untimed both-absent games retain up to 24h. |

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
