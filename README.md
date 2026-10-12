# Quoridor — Online Board Game

[![Play](https://img.shields.io/badge/play-playquor.org-2ea44f?style=for-the-badge&logo=googlechrome&logoColor=white)](https://playquor.org)
[![License](https://img.shields.io/badge/license-Proprietary-red?style=for-the-badge)](#license)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?style=for-the-badge&logo=socketdotio)](https://socket.io)
[![MongoDB](https://img.shields.io/badge/MongoDB-8-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com)
[![Redis](https://img.shields.io/badge/Redis-5-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io)

Real-time multiplayer implementation of the classic board game **Quoridor** (Amazon): Web app + Android wrapper (Capacitor). Play at [playquor.org](https://playquor.org).

<p align="center">
  <img src="frontend/og-image.jpg" alt="Quoridor" width="760">
</p>

> **Portfolio project.** The source is public for viewing and evaluation only — copying, reuse or
> deployment is not permitted. See [License](#license).

## Highlights

- **Server-authoritative realtime gameplay** — a single rules engine (`quoridor-engine/rules`) is
  shared between server and browser; clients only suggest moves, the server validates and persists.
- **A real AI engine, not a toy** — versioned engines (`v0`–`v3`) with an arena for matched games,
  Elo, SPRT and round-robin ratings. `v3` runs in production on both server and client, with per-bot
  personality and anti-repetition search. All engine changes are accepted by measurement, not by feel.
- **Full product surface** — accounts, ranked ratings, leaderboard, game history/replays, friends,
  notifications, daily puzzles, product analytics and a complete admin panel.
- **Shippable** — Dockerized (app + Mongo + Redis), Caddy TLS, Android wrapper via Capacitor.

## Features

- Real-time online matchmaking (ranked & casual) and private rooms via Socket.IO
- Server-validated game engine shared between client and server
- Play vs. AI in the browser (Web Worker) **and** bot opponents via server-side matchmaking fallback
- Accounts, profiles, ratings, leaderboard, game history and replays
- Avatar upload (WebP, stored on disk via Docker volume), country flags (CF-Connecting-IP + geoip)
- Rematch with invite/accept protocol, friends, notifications, in-game reactions
- Reports (bug reports + player complaints) and a full admin panel
- Timer game clock with increment, ranked rating changes
- Daily puzzle, product analytics, D1/D3/D7 retention reporting

## Tech Stack

| Layer | Technology |
| --- | --- |
| Backend | Node.js 20, Express 5, Socket.IO 4 |
| Realtime storage | **Redis** (`src/storage/redis.js`, in-process fallback when Redis is down) |
| Persistence | **MongoDB** (Mongoose 8) |
| Sessions | `express-session` + Redis store, secure cookies |
| Uploads | `multer` + `sharp` |
| Email | Resend (password reset) |
| Monitoring | Sentry, Socket.IO Admin UI, morgan |
| Frontend | Vanilla JS SPA (`frontend/`), Canvas board rendering, Chart.js |
| Mobile | Capacitor + Android (`android/`) |
| AI | `quoridor-engine/engines/v3` (shared client/server bot, 4 depth tiers, per-bot personality), Web Worker on the client |
| Engine tooling | `quoridor-engine/` — rules, versioned engines, arena (Elo/SPRT/round-robin), perft, Texel weight tuning |

## Getting Started

### Option A — Docker Compose (recommended)

```bash
cp .env.example .env      # set SESSION_SECRET (openssl rand -hex 32)
docker compose up -d      # app + mongo + redis
# http://localhost:3000
docker compose logs -f
```

### Option B — local Node.js

Prerequisites: **Node.js ≥ 18** (Docker builds use node:20), Redis, MongoDB.

```bash
npm install
cp .env.example .env      # REDIS_URL + MONGO_URI + SESSION_SECRET
npm run dev               # nodemon, auto-restart
```

The app runs on port `3000` (override with `PORT`).

> The server starts even without Redis/Mongo running: the storage layer falls back to an
> in-memory store, which is also how the test suite runs.

## Testing

```bash
npm run test:once         # full suite, single run (CI)
npm test                  # jest --watch
npm run coverage          # jest --coverage
npm run load-test         # manual load simulation (not jest)
```

Suites live in `tests/` (see [docs/TOOLS.md](docs/TOOLS.md)). All suites run without external
services (Redis mock + `mongodb-memory-server`).

## Project Documentation

- [Architecture](docs/ARCHITECTURE.md) — system design, components, data flow
- [Folder Structure](docs/FOLDER_STRUCTURE.md) — full layout of the repo
- [Game Logic](docs/GAME_LOGIC.md) — rules implementation and state shape
- [WebSocket Protocol](docs/WS_PROTOCOL.md) — client/server Socket.IO events
- [API Reference](docs/API_REFERENCE.md) — REST endpoints and environment variables
- [Tools & Config](docs/TOOLS.md) — dev tools, Sentry, Socket.IO Admin UI, Jest, ESLint
- [AI Agents Guide](docs/AGENTS_GUIDE.md) — manual for automated development
- [Deployment](DEPLOY.md) — production setup on a VPS (Docker Compose + Caddy)

## AI Engine & Arena

The AI is a first-class part of this project. Beyond the game site, `quoridor-engine/` is a standalone
workbench — canonical rules, versioned engines (`v0`–`v3`, with `v3` in production), an arena for
matched games with Elo/SPRT/round-robin, perft, seedable self-play and Texel weight tuning. It runs
without Mongo, Redis or Socket.IO.

- [Engine workbench](quoridor-engine/README.md) — rules, engine versions, perft, tools
- [Arena](quoridor-engine/arena/README.md) — match runner, methodology, log format

## License

This is a personal portfolio project. **All rights reserved.** The source is published for viewing
and evaluation only; you may not copy, reuse, modify, redistribute or deploy it without the author's
prior written permission. See [LICENSE](LICENSE).