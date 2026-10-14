# Folder Structure: Quoridor

Complete layout of the repository.

```
Quoridor/
├── src/                            # Backend (Node.js + Express + Socket.IO)
│   ├── server.js                   # Entry point (~3700 lines: REST + WebSocket + game orchestration)
│   ├── core/
│   │   ├── shared.js               # Node alias of the canonical rules (mirrors quoridor-engine/rules to the browser as /shared.js)
│   │   ├── ai-v1-bundle.js         # Generates the browser engine bundle from quoridor-engine/engines/v3 (served as /js/ai-v1.js)
│   │   └── ai-core.js              # Legacy v0 AI — parity baseline only, nothing loads it in production
│   ├── storage/
│   │   ├── redis.js                # Redis wrapper + in-memory fallback (games, queues, sessions, rematch)
│   │   └── db.js                   # MongoDB (mongoose) connection
│   ├── models/                     # Mongoose schemas
│   │   ├── User.js  GameResult.js  Friendship.js  Notification.js
│   │   ├── Report.js  UserReport.js  BotSettings.js  AdminLog.js
│   │   ├── AnalyticsEvent.js
│   ├── bots/
│   │   ├── BotManager.js           # Server-side bot play: matchmaking fallback + move scheduling
│   │   ├── matchmaking.js          # Pure bot-opponent selection: avoid-repeat, least-recently-seen, contrast
│   │   ├── BotPresenceManager.js   # Simulated presence/activity of bot accounts
│   │   ├── defaultBots.js          # Seed data for bot accounts
│   │   └── botSeed.js              # Seed helper for account bots (kept for replay)
│   ├── simulation/
│   │   └── PopulationManager.js    # Syncs bot accounts into MongoDB (startup + admin seed)
│   └── utils/
│       ├── logger.js               # Namespaced logger (debug)
│       └── mailer.js               # Resend email for password reset
│
├── quoridor-engine/                # Standalone engine workbench (no Mongo/Redis/Socket.IO)
│   ├── rules/                      # Single canonical implementation of Quoridor rules (see its README)
│   ├── engines/                    # Versioned engines
│   │   ├── v0/                     # Faithful port of legacy ai-core — parity baseline, DO NOT change
│   │   ├── v1/                     # negamax + TT; historical reference for the arena
│   │   ├── v2/                     # Experimental (wide wall-move set) — measurably worse, kept as a dead-end note
│   │   ├── v3/                     # Current production engine used by the site bots and the arena
│   │   └── personality.js          # Per-bot deterministic weight perturbation + opening archetypes
│   ├── arena/                      # Match runner: Elo, SPRT, round-robin (worker_threads) + web UI
│   ├── tools/                      # perft, seedable RNG, micro-bench, site self-play
│   ├── tests/                      # arena / rules / perft / engine-parity suites
│   └── package.json                # npm scripts: test, perft, bench, match, rr
│
├── frontend/                       # Static web app (served by Express)
│   ├── index.html                  # Game shell (matchmaking, room, game, profile SPA)
│   ├── login.html register.html forgot-password.html reset-password.html
│   ├── rules.html faq.html terms.html privacy.html report.html reports.html
│   ├── leaderboard.html replay.html
│   ├── admin.html admin-users.html admin-bots.html admin-reports.html
│   │   admin-user-reports.html admin-logs.html admin-metrics.html
│   ├── js/
│   │   ├── ui.js                   # All app screens + profile page + localization
│   │   ├── net.js                  # Socket.IO client
│   │   ├── game.js board-renderer.js   # Canvas board + game loop
│   │   ├── ai.js ai-worker.js      # Browser AI (Web Worker, engine v3)
│   │   ├── replay.js               # Replay viewer
│   │   └── analytics.js            # Product analytics tracker (deviceId/sessionId, batch queue)
│   ├── css/                        # style.css auth.css auth-pages.css profile.css replay.css
│   ├── img/emoji/                  # Flag SVG assets (~275) rendered by ui.js
│   ├── robots.txt sitemap.xml og-image.jpg
│
├── tests/                          # Jest suites (run without external services)
│   ├── server-ws.test.js           # Socket.IO integration (matchmaking, rooms, rematch…)
│   ├── server-api.test.js          # HTTP API integration (auth, profile, avatars, admin…)
│   ├── lobby-access.test.js        # Room/lobby access rules
│   ├── bot-matchmaking.test.js     # Bot opponent selection (pure helpers in src/bots/matchmaking.js)
│   ├── game-logic.test.js          # Engine + Zobrist rules (shared.js)
│   ├── zobrist.test.js             # Zobrist hashing/chessboard caching
│   ├── ai-core.test.js             # AI engine (jest + standalone node run)
│   ├── analytics.test.js           # /api/analytics/events ingestion + /api/admin/metrics
│   ├── load-test.js                # Manual load simulation (npm run load-test, not jest)
│   └── helpers.js                  # Shared test helpers
│
├── scripts/                        # Ops CLIs (manual, not production entry points)
│   └── retention_report.js         # D1/D3/D7 cohort retention + funnel report
│
├── tools/texel/                    # Texel-style weight tuning for the engine eval
│   ├── extract_features.js         # Game-log → feature extraction
│   ├── fit_weights.py              # Weight fitting
│   ├── parse_logs.py               # Log parsing helpers
│   └── texel_weights.json          # Tuned evaluation weights
│
├── __mocks__/redis.js              # Jest mock of the redis client
├── android/                        # Capacitor Android wrapper (appId com.playquor.app)
│   ├── app/src/main/java/com/playquor/app/MainActivity.java
│   ├── app/src/main/res/…          # Splash/launcher resources
│   └── gradle/ gradlew build.gradle settings.gradle …
│
├── resources/icon.png              # Capacitor icon source
├── docs/                           # Documentation (see README)
├── Dockerfile                      # Multi-stage build (node:20-alpine, non-root, tini)
├── docker-compose.yml              # Production: app + mongo:7 + redis:7, avatars volume
├── docker-compose.dev.yml          # Local dev profile (exposes Mongo/Redis ports)
├── deploy.sh                       # git pull + docker compose up -d --build
├── LICENSE                         # Proprietary (All Rights Reserved) — see ./LICENSE
├── .env.example                    # Environment template
├── jest.config.js eslint.config.js capacitor.config.json
```

## Conventions

- All canonical game rules live in `quoridor-engine/rules/` (single implementation).
  `src/core/shared.js` is a Node alias for them; the browser loads them as `/shared.js`.
- The production AI engine is `quoridor-engine/engines/v3`. `src/core/ai-v1-bundle.js`
  builds the browser bundle from it at startup; the `/js/ai-v1.js` URL is historical.
- New frontend scripts go to `frontend/js/`, styles to `frontend/css/`.
- Static files are cache-busted with `?v=x.y.z`; bump the version on change.
- `node_modules/`, `avatars/`, `.env`, `quoridor-engine/*.jsonl` and arena results are
  gitignored (do not commit them).
- Local IDE config (`/.idea`), root `server.js`/`net.js` and `files/` are stray local
  drafts — never commit them again.
- `src/server.js` is intentionally a monolith for the realtime orchestration; keep
  domain logic pure in `src/core/` and `quoridor-engine/` so it is testable and (for
  the engine) mirrored to the client.
```