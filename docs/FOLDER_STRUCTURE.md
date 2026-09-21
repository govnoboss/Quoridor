# Folder Structure: Quoridor

Complete layout of the repository.

```
Quoridor/
├── src/                        # Backend (Node.js + Express + Socket.IO)
│   ├── server.js               # Entry point (~3900 lines: REST + WebSocket + game orchestration)
│   ├── core/
│   │   ├── shared.js           # Game engine (pure logic, mirrored to browser as /shared.js)
│   │   └── ai-core.js          # Minimax AI (shared client/server, served as /js/ai-core.js)
│   ├── storage/
│   │   ├── redis.js            # Redis wrapper + in-memory fallback (games, queues, sessions, rematch)
│   │   └── db.js               # MongoDB (mongoose) connection
│   ├── models/                 # Mongoose schemas
│   │   ├── User.js  GameResult.js  Friendship.js  Notification.js
│   │   ├── Report.js  UserReport.js  BotSettings.js  AdminLog.js
│   ├── bots/
│   │   ├── BotManager.js       # Matchmaking fallback vs bots + move scheduling
│   │   ├── BotPresenceManager.js  # Simulated presence/activity of bot accounts
│   │   ├── defaultBots.js      # Seed data for bot accounts
│   │   └── botSeed.js          # Seed helper for scripts/seed_bots.js
│   ├── simulation/
│   │   └── PopulationManager.js  # Syncs bot accounts into MongoDB (startup + admin seed)
│   └── utils/
│       ├── logger.js           # Namespaced logger (debug)
│       └── mailer.js           # Resend email for password reset
│
├── frontend/                   # Static web app (served by Express)
│   ├── index.html              # Game shell (matchmaking, room, game, profile SPA)
│   ├── login.html register.html forgot-password.html reset-password.html
│   ├── rules.html faq.html terms.html privacy.html report.html reports.html
│   ├── leaderboard.html replay.html
│   ├── admin.html admin-users.html admin-bots.html admin-reports.html
│   │   admin-user-reports.html admin-logs.html
│   ├── js/
│   │   ├── ui.js               # All app screens + profile page + localization
│   │   ├── net.js              # Socket.IO client
│   │   ├── game.js board-renderer.js   # Canvas board + game loop
│   │   ├── ai.js ai-worker.js  # Browser AI (Web Worker)
│   │   ├── replay.js           # Replay viewer
│   │   └── analytics.js        # Umami tracking helper
│   ├── css/                    # style.css auth.css auth-pages.css profile.css replay.css
│   ├── img/emoji/              # Flag SVG assets (~275) rendered by ui.js
│   ├── robots.txt sitemap.xml og-image.jpg
│
├── tests/                      # Jest suites (run without external services)
│   ├── server-ws.test.js       # Socket.IO integration (matchmaking, rooms, rematch…)
│   ├── server-api.test.js      # HTTP API integration (auth, profile, avatars, admin…)
│   ├── lobby-access.test.js    # Room/lobby access rules
│   ├── game-logic.test.js      # Engine + Zobrist rules (shared.js)
│   ├── zobrist.test.js         # Zobrist hashing/chessboard caching
│   ├── ai-core.test.js         # AI engine (jest + standalone node run)
│   ├── load-test.js            # Manual load simulation (npm run load-test, not jest)
│   └── helpers.js              # Shared test helpers
│
├── scripts/                    # Ops CLIs (manual, not production entry points)
│   ├── seed_bots.js            # npm run seed:bots — upsert ACCOUNT_BOTS via botSeed
│   ├── cleanup_bots.js         # Delete all isBot users (server re-seeds on next boot)
│   ├── check_redis.js          # Redis connectivity probe
│   └── debug_redis_data.js     # Dump active games/queues content
│
├── __mocks__/redis.js          # Jest mock of the redis client
├── android/                    # Capacitor Android wrapper (appId com.playquor.app)
│   ├── app/src/main/java/com/playquor/app/MainActivity.java
│   ├── app/src/main/res/…      # Splash/launcher resources
│   └── gradle/ gradlew build.gradle settings.gradle …
│
├── docs/                       # Documentation (see README)
├── Dockerfile                  # Multi-stage build (node:20-alpine, non-root, tini)
├── docker-compose.yml          # Production: app + mongo:7 + redis:7, avatars volume
├── docker-compose.dev.yml      # Local dev profile (exposes Mongo/Redis ports)
├── deploy.sh                   # git pull + docker compose up -d --build
├── .env.example                # Environment template
├── jest.config.js eslint.config.js capacitor.config.json
```

## Conventions

- All core game rules live in `src/core/shared.js` (pure functions).
- New frontend scripts go to `frontend/js/`, styles to `frontend/css/`.
- Static files are cache-busted with `?v=x.y.z`; bump the version on change.
- `node_modules/` and Android build outputs are gitignored (do not commit them).
- `src/server.js` is intentionally a monolith for the realtime orchestration; keep
  domain logic pure in `src/core/` so it is testable and mirrored to the client.