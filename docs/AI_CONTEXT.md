# AI_CONTEXT.md — PlayQuor

> **Purpose:** compact entry point for coding agents. Read this file first, then load only the referenced documents relevant to the task.
> **Repository snapshot:** supplied archive, inspected 2026-11-10. This is a static source audit; runtime behavior and production configuration were not independently exercised.

## 1. Project identity

PlayQuor is a browser-based online Quoridor game with an Android wrapper. The repository contains a Node.js backend, vanilla-JavaScript frontend, a shared Quoridor rules implementation, a versioned AI engine/workbench, account and social features, bots, analytics, and an admin interface.

Production URL referenced by the repository: `https://playquor.org`.

## 2. Stack

| Area | Technology | Source of truth |
|---|---|---|
| Runtime | Node.js, CommonJS | `package.json` (`type: commonjs`) |
| HTTP | Express 5 | `src/server.js` |
| Realtime | Socket.IO 4 | `src/server.js`, `frontend/js/net.js` |
| Durable data | MongoDB + Mongoose | `src/storage/db.js`, `src/models/` |
| Realtime/session state | Redis; in-memory fallback exists | `src/storage/redis.js` |
| Frontend | Vanilla JS, HTML, CSS | `frontend/` |
| Rules | Shared UMD/CommonJS rules package | `quoridor-engine/rules/` |
| AI | Versioned engines; v3 is production engine | `quoridor-engine/engines/` |
| Mobile | Capacitor Android | `android/`, `capacitor.config.json` |
| Deployment | Docker Compose; Caddy documented as reverse proxy | `Dockerfile`, `docker-compose.yml`, `DEPLOY.md` |

## 3. Entrypoints and canonical implementations

- **Production Node entrypoint:** `src/server.js` (`npm start` and `npm run dev`).
- **Root `server.js`:** legacy/alternate implementation; do not assume it is used by the package scripts. Compare before changing it.
- **Canonical game rules:** `quoridor-engine/rules/`. `src/core/shared.js` is a Node re-export; the browser receives the canonical rules through `/shared.js`.
- **Production AI:** `quoridor-engine/engines/v3/`. `src/core/ai-v1-bundle.js` builds a browser bundle at runtime and exposes the historical `AiV1` global and `/js/ai-v1.js` URL. Do not edit a generated bundle by hand.
- **Frontend main page scripts:** see `frontend/index.html`; script load order matters. In particular, `/shared.js` is loaded before the AI bundle.
- **Server orchestration:** `src/server.js` contains HTTP routes, Socket.IO handlers, game orchestration, timers, and finalization. It is a large monolith; search by route/event/function name before editing.

## 4. System invariants

1. The server is authoritative for online game state and validates submitted moves.
2. Browser and server must use the same canonical rules implementation; avoid creating a second rules implementation.
3. Rules changes must preserve browser compatibility (no Node-only APIs in the shared rules module).
4. Online game state, queues, locks, token mappings, timers, and rematch contexts are managed through `src/storage/redis.js`; understand its fallback semantics before changing storage behavior.
5. MongoDB models live in `src/models/`; do not invent schema fields without checking the model and all read/write sites.
6. AI v3 is used by production paths; v0/v1/v2 are versioned historical/experimental engines. Confirm actual call sites before changing engine selection.
7. `src/server.js` is the package-script entrypoint; root `server.js` is not the configured `main` or `start` target.
8. Never copy secrets from `.env`, keystores, local machine config, or deployment credentials into documentation.

## 5. Task-to-document routing

| Task | Read first |
|---|---|
| General orientation / architecture | `docs/AI_ARCHITECTURE.md` |
| Online game, matchmaking, reconnect, rematch | `docs/AI_GAME_FLOWS.md`, `docs/WS_PROTOCOL.md`, relevant sections in `src/server.js` and `src/storage/redis.js` |
| Rules, moves, wall placement, win conditions | `docs/GAME_LOGIC.md`, `quoridor-engine/rules/` |
| AI strength, engine search, bot personality | `docs/AI_ENGINE.md`, `quoridor-engine/README.md`, `quoridor-engine/engines/v3/` |
| REST endpoint changes | `docs/API_REFERENCE.md`, route implementation in `src/server.js` |
| Frontend screens / board / replay | `docs/AI_FRONTEND.md`, relevant HTML and `frontend/js/` modules |
| Database / sessions / Redis | `docs/AI_DATA.md`, `src/models/`, `src/storage/` |
| Bot accounts / bot matchmaking | `docs/AI_BOTS.md`, `src/bots/`, `src/simulation/` |
| Deployment / environment | `DEPLOY.md`, `.env.example`, Docker files |
| UTM links / marketing traffic | `docs/UTM_GUIDE.md`, `docs/AI_FRONTEND.md` §6 |
| SEO / sitemap / robots / 404 | `docs/SEO.md` (состояние), `docs/SEO_NEXT_STEPS.md` (очередь работ + ручные шаги), route implementations in `src/server.js` (SEO section near `/profiles`) |
| Tests / lint / tooling | `docs/TOOLS.md`, `package.json`, `jest.config.js` |

## 6. Development workflow for agents

1. Read this file and the task-relevant reference docs.
2. Inspect the exact implementation and its callers before editing; documentation is a map, not a substitute for source verification.
3. Identify affected client, server, rules, persistence, and test surfaces.
4. Prefer the smallest change consistent with current architecture. Avoid broad refactors unless requested.
5. Add or update tests for behavior changes.
6. Run the narrowest relevant test first, then broader checks where practical (`npm run test:once`, `npm run lint`; engine tests from `quoridor-engine/`).
7. Update the relevant documentation when contracts, events, methods, data shape, or behavior change.
8. Report files changed, checks run, failures, and any unverified assumptions.

## 7. Documentation reliability

- Source code wins when it conflicts with docs. Verify the source and then correct the docs.
- A documented endpoint/event does not prove that its runtime integration is currently healthy.
- Do not assume optional services are available just because they appear in Compose or `.env.example`.
- Avoid loading every document for every task. This file is deliberately an index, not a full specification.

## 8. Compact repository map

- `src/server.js` — HTTP + Socket.IO application and orchestration.
- `src/auth/` — external authentication integration.
- `src/core/` — shared-rule alias, legacy AI core, runtime browser AI bundler.
- `src/storage/` — Redis abstraction and Mongo connection.
- `src/models/` — Mongoose models.
- `src/bots/` — server bot manager, presence, matchmaking selection, bot seed data.
- `src/simulation/` — bot population synchronization.
- `src/utils/` — logger and mailer.
- `frontend/` — multi-page web client and static assets.
- `quoridor-engine/rules/` — canonical rules.
- `quoridor-engine/engines/` — AI versions and personality logic.
- `quoridor-engine/arena/` — tournament/match evaluation workbench.
- `quoridor-engine/tools/` — engine testing and benchmarking tools.
- `tests/` — application/integration/unit tests.
- `android/` — Capacitor Android project.
