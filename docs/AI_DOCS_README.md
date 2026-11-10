# AI Documentation Index

Start with [`AI_CONTEXT.md`](AI_CONTEXT.md). It is intentionally short and tells the agent which reference documents to load for a task.

| Document | Purpose |
|---|---|
| [`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md) | Runtime topology, entrypoints and module responsibilities |
| [`AI_GAME_FLOWS.md`](AI_GAME_FLOWS.md) | Matchmaking, rooms, moves, timers, reconnect, finalization and rematch |
| [`AI_DATA.md`](AI_DATA.md) | MongoDB models, Redis responsibilities, avatar storage and persistence |
| [`AI_ENGINE.md`](AI_ENGINE.md) | Canonical rules, production AI v3 and engine workbench |
| [`AI_FRONTEND.md`](AI_FRONTEND.md) | Main page script order, frontend modules and page inventory |
| [`AI_BOTS.md`](AI_BOTS.md) | Bot population, presence, fallback and matchmaking |
| [`AI_METHOD_INDEX.md`](AI_METHOD_INDEX.md) | Navigation index of important functions and exports |
| [`AI_AUDIT_NOTES.md`](AI_AUDIT_NOTES.md) | Static audit findings, known documentation risks and unverified areas |

Existing detailed references remain available:

- [`API_REFERENCE.md`](API_REFERENCE.md) — HTTP endpoints and environment variables.
- [`WS_PROTOCOL.md`](WS_PROTOCOL.md) — Socket.IO event protocol.
- [`GAME_LOGIC.md`](GAME_LOGIC.md) — rules/state overview.
- [`TOOLS.md`](TOOLS.md) — tests and development tools.

> Historical material (`ARCHITECTURE.md`, `FOLDER_STRUCTURE.md`, plans, reports) was removed from
> the repository. Do not assume it exists; the references above are the current technical truth.

## Maintenance rule

When a code change alters a cross-module contract, endpoint, event, data shape, lifecycle, or architecture, update the corresponding AI reference and this index if needed. Keep historical plans/reports separate from current technical truth.
