# AI Method Index

> This is a navigation index, not a complete generated API reference. Function bodies and call sites remain authoritative. Large files change often; use search/IDE symbol lookup before editing.

## Backend: `src/server.js`

### Application / identity / authorization helpers

`startServer`, `getClientIp`, `detectCountry`, `ensureUserCountry`, `generateUniqueUsername`, `resolveUserById`, `isUserBanned`, `requireAdmin`, `isValidToken`, `consumeReauthNonce`.

### Bot configuration / profiles / leaderboard

`botSettingsFromEnv`, `sanitizeBotSettings`, `settingsForBotManager`, `getOrCreateBotSettings`, `applyPersistedBotSettings`, `seedBotAccounts`, `clearLeaderboardCache`, `loadLbCandidates`, `sortLbCandidates`, `lbRankOf`, `lbQualifies`, `applyDisplayNames`, `lbPublicAvatar`, `getPlayerProfile`, `calculateEloChange`, `recalculateBotRatings`.

### Rooms / sockets / game lifecycle

`findSocketByUserId`, `findSocketByToken`, `isPlayerBusy`, `expireStaleRematchRequests`, `getAcceptedFriendIds`, `createNotification`, `generateRoomCode`, `generateUniqueRoomCode`, `linkPlayersToLobbyByToken`, `clearPlayersLobbyLinkByToken`, `checkVictory`, `startBotGame`, `applyBotMove`, `applyGameMove`, `checkRateLimit`, `acquireGameLock`, `handleDisconnectTimeout`, `handleTurnTimeout`, `archiveGame`, `resendGameOverIfFinished`, `finalizeGame`, `startRematchGame`, `cleanupStaleGames`.

### Storage/session helpers

`setCachedSessionVersion`, `clearSessionVersionCache`, `getSessionVersion`, `bumpSessionVersion`.

> The server contains many route-local callbacks and anonymous handlers not listed here. Search route paths and event names in `src/server.js` for those.

## Redis: `src/storage/redis.js`

See the grouped inventory in `docs/AI_DATA.md`. Important categories: lifecycle/mode, game state, locks, token mappings, rooms, queues, disconnect/turn timers, rematch/replay snapshots and bot repeat tracking.

## Bots

- `src/bots/matchmaking.js`: exports `botIdentity`, `styleOf`, `chooseBot` (`diff` is an internal scoring helper inside `chooseBot`, not exported).
- `src/bots/BotManager.js`: module exports the `BotManager` class; `readBool`, `readInt`, `createBotEngine`, `guestBotCandidates` are file-internal helpers (not importable).
- `src/bots/BotPresenceManager.js`: module exports the `BotPresenceManager` class.
- `src/simulation/PopulationManager.js`: `syncRankedBots`, `syncBotPopulation`.

## AI bundle: `src/core/ai-v1-bundle.js`

- `difficultyToMaxDepth(difficulty)` — maps tier labels to search depth.
- `buildAiV1Bundle()` — builds and caches browser engine bundle.

## Canonical rules: `quoridor-engine/rules/`

- `moves.js`: `generateMoves`, `applyInPlace`, `undoInPlace`, `isFinished`.
- `quoridor-rules.js`: browser/CommonJS rules API; includes `isValidPawnMove`, `isValidWallMove`, `isValidMove`, `isGameOver`, `createInitialState` (plus reducer, path and wall validation helpers; inspect exports in `rules/index.js`).
- `paths.js`: path search helpers; inspect module exports directly.

## Production AI v3: `quoridor-engine/engines/v3/index.js`

Module exports: `createEngineV3`, `encodeMove`, `VARIETY_DEFAULT`, `DIFFICULTY_VARIETY`, `ARCHETYPE_DEFAULT`, `ARCHETYPE_NAMES`.

Engine instance methods: `think`, `newGame`, `reset`; `_debug` exposes test-only hooks. Internal search helpers are intentionally not documented as stable API.

## Frontend modules

Frontend is largely global-script based. The following are file-level entry points, not guaranteed exported APIs:

- `frontend/js/net.js` — Socket.IO connection and event bridge.
- `frontend/js/game.js` — board/game controller; locate exact functions by symbol search.
- `frontend/js/ui.js` — UI state, menus, screens and overlays; very large file.
- `frontend/js/replay.js` — `loadGame`, `loadLocalGame`, `buildSnapshots`, `startAnalysis`, `stopAnalysis`, `onEvalMessage`, `goToMove`, `prevMove`, `nextMove`, `goToStart`, `goToEnd`, `togglePlay`, `setSpeed`, `togglePerspective`, `copyLink`, `exportVideo`, `closeExportModal` (among others).
- `frontend/js/board-renderer.js` — board drawing helpers; inspect the full file for local functions.

## How to extend this index

When adding or changing a public/important method, record its file, purpose, arguments, return value, side effects and important callers. Do not add every local helper; prioritize cross-module contracts and lifecycle-critical functions.
