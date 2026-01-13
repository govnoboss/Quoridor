# Folder Structure: Quoridor

The project is organized into a modular structure to separate responsibilities and improve maintainability.

## Root Directory
- `/src` - Backend source code (Node.js/Express).
- `/frontend` - Client-side assets (HTML/JS/CSS).
- `/tests` - Automated test suites.
- `/scripts` - Maintenance and utility scripts.
- `/docs` - Detailed technical documentation.

---

## Detailed Breakdown

### `/src` - Backend
- `server.js` - Main entry point, Socket.IO handlers, API routing.
- `/core`
    - `shared.js` - **Critical**: Shared logic used by both server and client. Contains the game engine.
- `/models` - Mongoose schemas (e.g., `User.js`, `GameResult.js`).
- `/storage` - Database and cache initialization (`db.js`, `redis.js`).
- `/services` - Background logic and utility services.

### `/frontend` - Client
- `index.html` - The main game page.
- `/js`
    - `ui.js` - DOM manipulation, event listeners, localization.
    - `game.js` - Client-side game loop, board rendering (Canvas).
    - `net.js` - Socket.IO client communication.
    - `ai.js` - Interface for the local AI bot.
    - `ai-worker.js` - Web Worker running the minimax algorithm for the bot.
- `/css`
    - `style.css` - Main game styles.
    - `auth.css` - Authentication UI styles.

### `/tests`
- `tests.js` - Unit tests for the shared game logic and reducer.

### `/scripts`
- `check_redis.js` - Debugging script for Redis connection.
- `debug_redis_data.js` - Script to inspect active games and queues in Redis.

## Guidelines
- **Logic**: All core game rules must go into `src/core/shared.js`.
- **Statelessness**: Favor pure functions in `shared.js` to allow easy testing and synchronization.
- **Assets**: All new frontend scripts should be placed in `frontend/js/`.
