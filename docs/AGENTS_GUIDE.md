# AI Agents Guide: Quoridor

Navigation and safe-modification guide for AI agents working on this codebase. Also useful
for humans: it maps goals to files and documents the invariants you must not break.

## Navigation Map

| Goal | Primary files to consult |
| :--- | :--- |
| **Fix game rules / moves** | `src/core/shared.js`, `tests/game-logic.test.js` |
| **Tweak the bot (AI)** | `src/core/ai-core.js` (engine, mirrored to browser), `frontend/js/ai.js` + `frontend/js/ai-worker.js` (browser execution), `src/bots/BotManager.js` (server-side bot play)* |
| **Modify UI / visuals** | `frontend/js/ui.js` (logic/screens), `frontend/js/game.js` + `frontend/js/board-renderer.js` (canvas), `frontend/css/*.css`, `frontend/index.html` |
| **Matchmaking / networking** | `src/server.js` (socket handlers), `frontend/js/net.js` (client), [WS_PROTOCOL.md](WS_PROTOCOL.md) |
| **REST API changes** | `src/server.js` (routes), `frontend/js/net.js` (fetch calls), [API_REFERENCE.md](API_REFERENCE.md) |
| **DB / schema changes** | `src/models/`, `src/storage/`, `scripts/debug_redis_data.js` |
| **Tests** | Add/extend `tests/*.test.js`; suites run with `npx jest --runInBand` |

> \* `BotManager` is enabled by env (`BOTS_ENABLED`, `BOT_RANKED_ENABLED`, …) and pairs
> players with bot opponents when queues are empty. Browser AI (`ai.js`/`ai-worker.js`) is
> for local play only.

## Safe-Practice Rules

### 1. The "Shared Mirror" rule
`src/core/shared.js` (game engine) and `src/core/ai-core.js` run **on both the server and in
the browser** (served as `/shared.js` and `/js/ai-core.js`).
- **DO NOT** use Node-only modules (`fs`, `path`, `process`) or browser-only objects
  (`window`, `document`) in these files.
- **ALWAYS** extend `tests/game-logic.test.js` when you change the engine.

### 2. State immutability
The game engine uses a reducer pattern.
- Work on a cloned state: `Shared.cloneState(state)`.
- `gameReducer` must never throw unhandled exceptions — return validation errors instead
  (the server surfaces them as `moveRejected`).

### 3. Real-time sync
The server is the final validator, clients only suggest moves.
- A new event must be handled on both `src/server.js` and `frontend/js/net.js` (client),
  and documented in [WS_PROTOCOL.md](WS_PROTOCOL.md).
- Rejections use event-specific channels (`findGameFailed`, `joinRoomFailed`,
  `moveRejected`, `rematchFailed`, `inviteFailed`, …), not a generic `error`.

### 4. Storage caveats
- `src/storage/redis.js` falls back to an **in-memory store** when Redis is down — state won't
  survive restarts and won't be shared across processes. Don't rely on this in production.
- Tests run without Redis (mock `__mocks__/redis.js`) and without Mongo
  (`mongodb-memory-server` in `tests/server-api.test.js`). Keep tests dependency-free of
  running services.

### 5. Session & auth
- Auth is `express-session` + Redis store, **not** JWT. `jsonwebtoken` is an unused import —
  do not start using it for auth without a clear plan.
- Session cookie is `Secure` in production: HTTP requests from `http://localhost` won't carry
  it. Smoke-test authenticated flows over HTTPS.
- Settings/appearance strings in `ui.js` are localized (RU/EN); keep translations in sync.

## Common Pitfalls
- **Hardcoding paths**: always relative or via `path` in server code.
- **Breaking the mirror**: adding a Node API call inside `shared.js` breaks the browser copy.
- **Greenfield side-effects in the engine**: keep `shared.js` pure; orchestration belongs in
  `server.js`.
- **Skipping tests**: run `npx jest --runInBand` after any engine/server change.
- **Static file versions**: if you change CSS/JS served to clients, bump the `?v=` version in
  the referencing HTML so users get the update.