# Quoridor — Online Board Game

Real-time multiplayer implementation of the classic board game **Quoridor** (Amazon): Web app + Android wrapper (Capacitor). Play at [playquor.org](https://playquor.org).

## Features

- Real-time online matchmaking (ranked & casual) and private rooms via Socket.IO
- Server-validated game engine shared between client and server
- Play vs. AI in the browser (Web Worker) **and** bot opponents via server-side matchmaking fallback
- Accounts, profiles, ratings, leaderboard, game history and replays
- Avatar upload (WebP, stored on disk via Docker volume), country flags (CF-Connecting-IP + geoip)
- Rematch with invite/accept protocol, friends, notifications, in-game reactions
- Reports (bug reports + player complaints) and a full admin panel
- Timer game clock with increment, ranked rating changes

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
| AI | `src/core/ai-core.js` (shared client/server minimax), Web Worker on the client |

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