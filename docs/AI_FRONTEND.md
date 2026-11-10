# AI Frontend Reference

## 1. Main application shell

`frontend/index.html` is the main game page. It loads styles and browser scripts directly; there is no frontend bundler script in the root `package.json`. Script order is a runtime dependency graph.

Observed main-page script sequence (simplified):

1. analytics provider script and `/js/analytics.js`
2. Socket.IO client library
3. Chart.js CDN
4. `/js/ui.js`
5. `/js/net.js`
6. `/shared.js` (canonical rules global)
7. `/js/eval-shared.js`
8. `/js/game-undo.js`
9. `/js/ai.js`
10. `/js/ai-v1.js` (generated engine v3 bundle)
11. `/js/board-renderer.js`
12. `/js/game.js`

Check `frontend/index.html` for exact version strings and order before editing. `/shared.js` must precede `/js/ai-v1.js`.

## 2. JavaScript modules

| File | Approx. size (measured 2026-11-10) | Role |
|---|---:|---|
| `ui.js` | 3,506 lines | Main UI controller; screens, menus, overlays and broad application UI |
| `game.js` | 2,729 lines | Game state/UI interaction and board/game flow |
| `net.js` | 374 lines | Socket.IO client bridge |
| `board-renderer.js` | 142 lines | Board rendering helpers |
| `ai.js` | 8 KB | Client-side AI orchestration |
| `ai-worker.js` | 4 KB | AI worker |
| `eval-shared.js` | 8 KB | Shared game evaluation helpers |
| `game-eval-worker.js` | 4 KB | Game evaluation worker |
| `game-undo.js` | see file | Undo functionality |
| `replay.js` | 960 lines | Replay loading, rendering, navigation, analysis, video export |
| `replay-eval-worker.js` | 8 KB | Replay evaluation worker |
| `analytics.js` | 4 KB | Client analytics |
| `site-shell.js` | 12 KB | Shared shell behavior on standalone pages |

Line counts/sizes are snapshot-specific and should not be treated as stable API.

## 3. HTML page inventory

Main page: `index.html`.

Other pages in `frontend/` include:

- Authentication: `login.html`, `register.html`, `forgot-password.html`, `reset-password.html`.
- Help/legal: `rules.html`, `faq.html`, `terms.html`, `privacy.html`.
- Player-facing: `leaderboard.html`, `replay.html`, `report.html`, `reports.html` (own reports list, served at `/profile/reports`), `admin-user-reports.html` (moderation UI; check access policy).
- Administration: `admin.html`, `admin-users.html`, `admin-reports.html`, `admin-logs.html`, `admin-metrics.html`, `admin-bots.html`.
- Operational/error: `maintenance.html`.

Routes and access control are implemented in `src/server.js`; do not infer authorization from the existence of an HTML file.

## 4. CSS organization

`frontend/css/` contains shared tokens/components/header styles plus page/feature styles such as `style.css`, `auth.css`, `auth-pages.css`, `profile.css`, `replay.css`, and `rules.css`. Inspect the page link tags to determine which styles are actually loaded on a given page.

## 5. Editing guidance

- Search for the exact DOM id/class and event listener before changing UI.
- Check whether UI state is shared through globals or module-level variables.
- Check mobile/responsive CSS and the standalone page variants.
- For online game actions, trace the UI action through `net.js` to the server event; never assume local UI validation is authoritative.
- If a script is loaded by multiple pages, consider side effects when changing its initialization.
- Keep asset cache-busting query versions in HTML consistent with deployment expectations.
