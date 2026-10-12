# Developer Tools & Configuration

Tools installed to simplify development.

---

## 1. nodemon — server auto-restart

Automatically restarts the server when files change.

```bash
npm run dev
```

Configuration: `package.json` → `dev` script.

---

## 2. morgan — HTTP logging

Logs every HTTP request to the console:

```
POST /api/auth/login 200 45ms
GET /api/leaderboard 304 2ms
```

Wired in `src/server.js` as `app.use(morgan('dev'))` (skipped when `NODE_ENV === 'test'`).

---

## 3. debug — namespaced logging

Replacement for `console.log` with namespaces. Lets you filter logs.

### Namespaces

| Namespace | Purpose |
|-----------|---------|
| `quoridor:server` | Startup, configuration |
| `quoridor:redis` | Redis connections |
| `quoridor:game` | Game logic |
| `quoridor:ai` | AI engine |
| `quoridor:db` | MongoDB queries |
| `quoridor:auth` | Authentication |
| `quoridor:matchmaking` | Game search, queues |
| `quoridor:error` | Errors |

### Usage in code:

```js
const log = require('./utils/logger');
log.server('Server started on port %d', port);
log.game('Game %s: player %s moved', lobbyId, username);
```

### Enabling:

```bash
# All project logs
DEBUG=quoridor:* npm run dev

# Only server + Redis
DEBUG=quoridor:server,quoridor:redis npm run dev

# Only game + AI
DEBUG=quoridor:game,quoridor:ai npm start

# Everything, including socket.io and express logs
DEBUG=quoridor:*,socket.io:*,express:* npm run dev
```

File: `src/utils/logger.js`.

---

## 4. Sentry — error tracking

Catches unhandled exceptions, unhandled rejections, and production errors.

### Setup:

1. Register at https://sentry.io
2. Create a Node.js project
3. Copy the DSN
4. Add to `.env`:
```env
SENTRY_DSN=https://xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx@xxxxx.ingest.de.sentry.io/xxxxxx
```

Sentry is inactive without a DSN (checked via `enabled: !!process.env.SENTRY_DSN`).

Wired in `src/server.js`:
- `Sentry.init()` at startup
- `Sentry.Handlers.requestHandler()` as middleware
- `Sentry.Handlers.errorHandler()` after all routes

Trace level: 50% in production, 0% in development.

---

## 5. Socket.IO Admin UI — websocket dashboard

Visual interface for monitoring Socket.IO: active connections, rooms, events.

### Setup:

In `.env`:
```env
SOCKET_ADMIN_USERNAME=admin
SOCKET_ADMIN_PASSWORD=your_secure_password
```

The Admin UI is not activated without these variables.

### Usage:

1. Start the server
2. Open https://admin.socket.io
3. Enter the server URL: `http://localhost:3000`
4. Enter the login/password from `.env`

Wired in `src/server.js` after `io` is created.

---

## 6. Jest — test runner

```bash
# Watch mode (for development)
npm test

# Single run (for CI)
npm run test:once

# With coverage report
npm run coverage
```

### Configuration: `jest.config.js`

```js
module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.js'],
    verbose: true,
    testTimeout: 60000,
};
```

### Test suites (all run without external services):

- `tests/server-ws.test.js` — Socket.IO integration (matchmaking, rooms, moves, rematches)
- `tests/server-api.test.js` — HTTP API integration (auth, profile, avatars, admin; Mongo via `mongodb-memory-server`)
- `tests/lobby-access.test.js` — lobby/room access rules
- `tests/bot-matchmaking.test.js` — bot opponent selection (`src/bots/matchmaking.js`)
- `tests/game-logic.test.js` — game logic (`shared.js`)
- `tests/zobrist.test.js` — Zobrist hashing
- `tests/ai-core.test.js` — legacy AI engine (jest, plus `npm run test:ai` for a standalone run)
- `tests/analytics.test.js` — `/api/analytics/events` ingestion + `/api/admin/metrics`
- `tests/puzzle.test.js` — `/api/puzzles/today` + `/api/puzzles/solve` + streaks
- `quoridor-engine/tests/site-v1.test.js` — browser bundle of the production engine and anti-repetition
- `tests/load-test.js` — load testing (`npm run load-test`, not jest)

Redis is mocked via `__mocks__/redis.js`.

---

## 7. quoridor-engine workbench

The engine package (`quoridor-engine/`) has its own scripts. Run them from `quoridor-engine/`:

```bash
npm test              # jest: rules, perft (depth 2), engine parity, arena adapter
npm run perft:assert  # full perft in node: reference numbers, non-zero exit on mismatch
npm run bench         # micro-benchmark of hot rule functions
npm run probe         # quick arena match (40 games)
npm run match         # SPRT match v0-hard vs v0-medium (2000 games)
npm run rr            # round-robin tournament (200 games per pair)
npm run arena:selftest# arena self-check on a toy game
```

Docs: `quoridor-engine/README.md` (rules/engines/arena summary) and
`quoridor-engine/arena/README.md` (match runner, methodology, log format).

### Site self-play — `quoridor-engine/tools/site-selfplay.js`

Plays the site's bots against each other exactly the way production runs them: depth from
`difficultyToMaxDepth()` (`src/core/ai-v1-bundle.js`), randomness off. Unlike the arena, there
is no SPRT or early stopping; the engine is re-created for every seat in every game, colors
alternate.

```bash
# mirror of one tier: 1000 games, no early stopping
node quoridor-engine/tools/site-selfplay.js --games 1000

# a specific tier pair
node quoridor-engine/tools/site-selfplay.js --a easy --b hard --games 200

# full measurement: mirror of every tier + ladder of neighboring tiers
node quoridor-engine/tools/site-selfplay.js --tiers --games 1000 --threads 8
```

The report includes P0/P1 win share, color bias, number of repeats, illegal moves, crashes and the
game-length distribution. It exits with code 1 on an illegal move, engine crash, position repeat,
or an average length outside 60–90 plies. The tier ladder is checked against 2 sigmas: a significant
inversion (a deeper tier losing) is a failure; indistinguishable tiers are a warning.

### Texel tuning — `tools/texel/`

Game-log → feature extraction (`extract_features.js`), weight fitting (`fit_weights.py`),
log parsing (`parse_logs.py`); tuned engine weights live in `texel_weights.json`.

---

## 8. ESLint — code linting

```bash
npm run lint
```

### Configuration: `eslint.config.js`

Rules:
- `no-unused-vars`: warn (except `_`-prefixed arguments)
- `no-undef`: error
- `no-console`: off (allowed)

Supports both Node.js (`src/`) and browser (`frontend/js/`) environments.

---

## Quick start

```bash
# Install
npm install

# Run with auto-restart
npm run dev

# Logs for game + AI only
DEBUG=quoridor:game,quoridor:ai npm run dev

# All logs
DEBUG=quoridor:*,socket.io:* npm run dev

# Tests
npm test

# Lint
npm run lint
```