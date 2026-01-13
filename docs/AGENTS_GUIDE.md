# AI Agents Guide: Quoridor

This document is specifically for AI agents working on this project. It provides context on where to find information and how to safely modify the codebase.

## Navigation Map for Agents

| Goal | Primary Files to Consult |
| :--- | :--- |
| **Fixing game rules / moves** | `src/core/shared.js`, `tests/tests.js` |
| **Tweaking the Bot (AI)** | `frontend/js/ai-worker.js` (logic), `frontend/js/ai.js` (interface) |
| **Modifying UI / Visuals** | `frontend/js/ui.js` (logic), `frontend/js/game.js` (canvas), `frontend/css/style.css` |
| **Changing Matchmaking / Networking** | `src/server.js` (Socket.IO events), `frontend/js/net.js` (client events) |
| **Database / DB Schema changes** | `src/models/`, `src/storage/` |

## Modifying the Code (Safe Practices)

### 1. The "Shared Mirror" Rule
`src/core/shared.js` is included in both the server and the frontend. 
- **DO NOT** use Node.js-specific modules (like `fs`, `path`) or browser-specific objects (like `window`, `document`) inside this file.
- **ALWAYS** update `tests/tests.js` if you change any game logic in `shared.js`.

### 2. State Immutability
The game uses a reducer pattern. 
- When implementing new actions, ensure you work with a cloned state.
- Use `Shared.cloneState(state)` to create a deep copy before making changes.

### 3. Real-time Synchronization
The server acts as the final validator.
- If you add a new event, ensure it is handled in both `src/server.js` and `frontend/js/net.js`.
- Errors on the server should be sent back to the client via `socket.emit('error', ...)` or a specific rejection event.

### 4. Bot Performance
The bot logic (`ai-worker.js`) runs in a separate thread.
- If you increase the minimax depth, monitor performance to avoid blocking the user's browser, though the worker helps prevent this.

## Common Pitfalls to Avoid
- **Hardcoding Paths**: Always use relative paths or the `path` module on the server.
- **Breaking Reducer**: The `gameReducer` must never throw unhandled exceptions; wrap validation in `try-catch` where necessary and provide helpful error messages.
- **Ignoring Tests**: Running `npm test` is non-negotiable after any engine change.
