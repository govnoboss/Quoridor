# Architecture Overview: Quoridor

System design and data flow of the Quoridor online game.

## System Design

Client-server architecture. The browser is a Socket.IO client; the server (`src/server.js`)
is the single source of truth for game state, move validation and matchmaking. All static
content (`frontend/`) is served by Express, so there is no separate web server at runtime.

```mermaid
graph TD
    subgraph Client
        UI[ui.js / game.js / board-renderer.js]
        NET[net.js - Socket.IO client]
        AIW[ai.js + ai-worker.js - local AI]
        SH[shared.js - game engine mirror]
    end
    subgraph Server
        S[server.js - Express + Socket.IO]
        RM[Bots: BotManager + matchmaking + BotPresenceManager + PopulationManager]
        RED[(Redis - game state / queues / sessions)]
        MON[(MongoDB - users / results / reports)]
    end
    UI --> NET
    NET <--> S
    S --> SH
    UI --> SH
    S --> RM
    S <--> RED
    S <--> MON
```

## Components

### 1. Game Rules — `quoridor-engine/rules/`
Pure, framework-agnostic Quoridor logic (movement, jumping, wall placement, victory, timers).
`src/core/shared.js` is a Node alias for it; the server serves it to the browser as `/shared.js`,
mirrored to clients via `index.html`/`replay.html`.

### 2. AI Engine — `quoridor-engine/engines/`
Versioned search engines: `v0` (faithful port of the legacy AI, parity baseline), `v1`
(negamax + player-aware transposition table), `v2` (experimental, measurably worse, kept as a
recorded dead-end), and **`v3` — the current production engine** used by the browser, server-side
bots and the arena (bitboard-flavored board, incremental Zobrist, PVS + iterative deepening,
shortest-path wall pruning, anti-repetition). `engines/personality.js` derives a per-bot
deterministic weight perturbation and opening archetypes so bot accounts play differently.
The browser loads the v3 engine as `/js/ai-v1.js` (historical URL), a bundle generated at startup by
`src/core/ai-v1-bundle.js`; its `require('../../rules')` resolves to the same `Shared` global that
`/shared.js` publishes, so the rules are never duplicated. See
[`quoridor-engine/README.md`](../quoridor-engine/README.md) for the workbench details.

### 3. Backend — `src/server.js` (monolith, ~3700 lines)
- **REST API**: auth, profile, avatars, friends, reports, notifications, admin, leaderboard,
  game history/replay. See [API Reference](API_REFERENCE.md).
- **Real-time**: Socket.IO handlers for matchmaking, rooms, moves, reactions, rematch,
  friend invites. See [WebSocket Protocol](WS_PROTOCOL.md).
- **Auth**: `express-session` + Redis store with secure cookies (`NODE_ENV !== 'test'`).
  User records (bcrypt-hashed passwords) live in MongoDB. Socket connections authenticate
  with a token generated at connect time (`assignToken`), then optional `userId` from the
  HTTP session.
- **Rate limiting**: per-socket/per-route limiters (moves, search, rematch, reports).
- **Security**: helmet, CORS (`ALLOWED_ORIGINS`), sanitization, `requireAdmin` middleware.

### 4. Storage Layer — `src/storage/`
- `redis.js` — wrapper over Redis for game states, finished-game TTL storage, rooms, queues,
  token↔user mapping, disconnect/turn timers, rematch contexts, bot-recent-match counters.
  Falls back to an **in-memory store** when Redis is unreachable (also used by tests).
- `db.js` — Mongo connection (env `MONGO_URI`).

### 5. Data Models — `src/models/`
`User` · `GameResult` (archive/replay) · `Friendship` · `Notification` · `Report` (bug
reports) · `UserReport` (player complaints) · `BotSettings` · `AdminLog`.

### 6. Bots & Simulation — `src/bots/`, `src/simulation/`
- `BotManager.js` — matchmaking fallback: pairs human players with bot opponents when the
  queue is empty, schedules bot moves with one engine v3 instance per game (seeded rng +
  `personality()` for per-bot style).
- `matchmaking.js` — pure helpers that pick the next bot opponent: **avoid-repeat** (recent
  opponents are excluded), **least-recently-seen** (fresher opponents win), **contrast**
  (occasionally force a maximally different tier/style). Deterministic per
  `(candidates, recent, rng)`; unit-tested without services.
- `BotPresenceManager.js` — simulates online presence/activity of bot accounts.
- `simulation/PopulationManager.js` — synchronizes the bot accounts (seeded from
  `defaultBots.js`) into MongoDB at startup and via the admin "seed" endpoint.

### 7. Avatars — upload pipeline
`POST /api/user/upload-avatar` → `multer` (memory, 5 MB, jpeg/png/webp) → `sharp`
(256×256, cover, WebP q80) → `avatars/<userId>.webp`. Files are served from `/avatars`
(`maxAge 365d, immutable`); a missing file 301-redirects to a ui-avatars placeholder.
The directory is backed by the `avatars_data` volume in Docker.

### 8. Frontend — `frontend/`
Vanilla-JS multi-page SPA. The shell is `index.html` loading `ui.js` (all screens),
`net.js` (Socket.IO), `game.js`/`board-renderer.js`, `shared.js`, `ai.js`+`ai-worker.js`
(engine v3), `analytics.js`. Separate standalone pages: auth (login/register/forgot/reset password),
rules/faq/terms/privacy, report, leaderboard, replay, and 6 admin pages + `reports.html`.
Client files are cache-busted with `?v=x.y.z` per-file versions.

### 9. Engine Workbench — `quoridor-engine/`
Rules, versioned engines, the arena (matched pairs, Elo with confidence intervals, SPRT with
early stopping, round-robin with Bradley–Terry ratings, parallel games via `worker_threads`,
per-game JSONL logs) and tuning tools (perft, seedable RNG, micro-benchmark, site self-play,
Texel weight fitting in `tools/texel`). Runs without Mongo/Redis/Socket.IO. See
[`quoridor-engine/README.md`](../quoridor-engine/README.md) and
[`quoridor-engine/arena/README.md`](../quoridor-engine/arena/README.md).

## Data Flow

1. **Matchmaking**: client emits `findGame` → server enqueues token in Redis → on a match,
   both sockets get `gameStart` (fresh lobby) — or a bot is substituted if the queue is empty
   and bot fallback is enabled.
2. **In-game move**: client emits `playerMove` → server validates with `shared.js`
   (`gameReducer`) → server persists to Redis → broadcasts `serverMove` to the lobby →
   schedules the opponent turn timer.
3. **Game over**: `finalizeGame` archives the result to MongoDB (`GameResult`), updates
   ratings/stats, saves a finished-game snapshot for replay (5 min TTL), clears the game from
   Redis and saves the rematch context.
4. **Rematch**: one player emits `requestRematch` → the opponent gets `rematchInvite` →
   `respondRematch { accept: true }` → `startRematchGame` swaps colors and emits
   `rematchStarted` to both. Requests expire after a 30 s window.

## Critical Paths / Conventions

- **Shared rules**: any change to `quoridor-engine/rules/` must stay browser-compatible
  (no Node/browser-only APIs), be covered by `tests/game-logic.test.js`, and re-run the perft
  contract (`npm run perft:assert` in `quoridor-engine`).
- **Concurrency**: move processing is guarded by Redis locks per lobby; turns are enforced
  by Redis turn-timeouts.
- **Deployment**: Docker Compose on a VPS (mongo :7, redis :7, app), Caddy terminates TLS.
  See [DEPLOY.md](../DEPLOY.md).