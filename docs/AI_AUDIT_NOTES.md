# Documentation Audit Notes

> Created from the supplied source archive on 2026-11-10. This is a static review. No production server, live database, Redis instance or browser session was exercised.

## Confirmed navigation facts

- `package.json` points `main` and `start` to `src/server.js`; `npm run dev` also uses `src/server.js`.
- A separate root `server.js` exists and should be treated as legacy/alternate unless an external process invokes it.
- Canonical rules are in `quoridor-engine/rules/`; `src/core/shared.js` is a thin Node re-export.
- Browser AI v3 is assembled by `src/core/ai-v1-bundle.js`; its external URL/global retain historical v1 naming.
- `src/server.js`, `frontend/js/ui.js` and `frontend/js/game.js` are large files and need targeted symbol/call-site inspection.
- Root package scripts include start/dev/test/test:once/test:ai/load-test/lint/audit/coverage/assets.
- Historical material (old architecture maps, `docs/plans/`, `docs/reports/`, design-audit files) has been removed from the repository; the files listed in `docs/AI_DOCS_README.md` are the current technical truth.

## Documentation risks to reconcile

1. The historical `docs/ARCHITECTURE.md` (which claimed a ~3,700-line backend monolith) no longer exists; the current monolith `src/server.js` is ~4,900 lines and `docs/AI_ARCHITECTURE.md` is the current map.
2. Existing architecture text and README may differ in exact infrastructure defaults. For operational changes, trust `docker-compose.yml`, `.env.example`, and actual code over prose.
3. `docs/TOOLS.md` refers to engine commands and scripts; verify the current `quoridor-engine/package.json` before running them.
4. Existing API and WebSocket docs are useful starting points but route/event payload details must be verified against `src/server.js` and `frontend/js/net.js` before contract changes.
5. Root `server.js` is a likely source of confusion for future agents. The AI context explicitly identifies `src/server.js` as the package-script entrypoint.
6. The current archive's documentation is not a guarantee that every listed feature is enabled in production; environment flags and external service availability affect behavior.

## Security / archive hygiene

The inspected extracted snapshot did not contain `.env`, keystore files or `android/local.properties`. Keep these exclusions in place for future exports. Do not commit or distribute:
- `.env` with real secrets;
- OAuth/API keys, database credentials, session secrets or email provider keys;
- Android signing keystores and keystore passwords;
- `android/local.properties` (machine-specific SDK path);
- local logs, dumps or user data.

Keep `.env.example` with placeholder values. Confirm `.gitignore` and `.dockerignore` exclude local secrets and build artifacts.

## Not fully verified in this static pass

- Runtime behavior of every REST endpoint and Socket.IO event.
- Exact payload schemas for every route/event.
- Every Mongoose field/index and every Redis key/TTL.
- Complete method-level documentation for the very large `src/server.js`, `ui.js`, and `game.js`.
- Android build/signing pipeline and Play Store configuration.
- Production Caddy configuration, VPS state and current environment values.
- Whether historical docs and plans (removed from the repository) remain relevant wherever they are still referenced.

## Recommended follow-up audit

1. Extract all route definitions and compare them with `docs/API_REFERENCE.md`.
2. Extract all `socket.on`, `socket.emit`, `io.emit` and client listener names; compare both directions with `docs/WS_PROTOCOL.md`.
3. Generate schema summaries from every `src/models/*.js` file.
4. Trace core online-game functions from client event through server validation to persistence/broadcast.
5. Document high-impact functions in `src/server.js`, `frontend/js/net.js`, `frontend/js/game.js` and `frontend/js/ui.js` with exact signatures and call sites.
6. Run tests and record actual results; do not infer passing status from test file presence.
