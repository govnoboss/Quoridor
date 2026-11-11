# AI Frontend Reference

## 1. Main application shell

`frontend/index.html` is the main game page. It loads styles and browser scripts directly; there is no frontend bundler script in the root `package.json`. Script order is a runtime dependency graph.

Observed main-page script sequence (simplified):

1. Umami analytics (injected by `/js/analytics-boot.js`) and `/js/analytics.js`
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
| `analytics-boot.js` | 2 KB | Unified analytics bootstrap: injects the Umami script tag (with `data-domains`); pages pair it with an explicit `analytics.js` tag |
| `analytics.js` | 5 KB | Client analytics entrypoint: `trackEvent` → Mongo (`POST /api/analytics/events`) + Umami copy (see «External analytics (Umami)» below) |
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

## 6. External analytics (Umami)

**Role split.** Umami (`https://analytics.playquor.org`, self-hosted) covers traffic, sources, countries,
pages and funnels over key events. The internal analytics (`POST /api/analytics/events` → Mongo
`AnalyticsEvent`, dashboard `GET /admin/metrics`) covers product data: retention, users, game results.

### Connection

- Unified bootstrap script per public page (two tags, in `<head>` before the other scripts):
  `<script src="/js/analytics-boot.js?v=1.2.0"></script>` injects the Umami tag
  (`defer`, `data-website-id="4efbc356-ed5e-4f8b-9761-c00a500f67c2"`, `data-domains="playquor.org"`),
  and the explicit `<script src="/js/analytics.js?v=1.2.0"></script>` tag follows.
  (Boot used to load `analytics.js` via `document.write`; removed — Chrome may block such
  inserts on slow connections.)
- `data-domains="playquor.org"` makes Umami ignore localhost, staging and any non-production host.
  The Android app loads `https://playquor.org` (see `capacitor.config.json`), so its traffic passes the filter.
- Pages with Umami + `analytics.js`: `index`, `login`, `register`, `leaderboard`, `rules`, `faq`,
  `terms`, `privacy`, `forgot-password`, `replay` (profile pages are `index.html` served at `/profiles/:username`).
- Admin/service pages (`admin-*`, `maintenance`, `reset-password`, `report`, `reports`) have no Umami.
  `admin-metrics.html` keeps only `analytics.js` (internal), so `admin-metrics-viewed` never reaches Umami.
- Umami events arriving before `script.js` (defer) has loaded are queued in `analytics.js` and flushed
  when `window.umami` appears (poll 250 ms, up to ~15 s, plus one retry on `load`); each event is sent
  to Umami exactly once.

### Privacy

- What never goes to Umami: account `userId`, e-mail, username, `sessionId`. The only identifier is an
  anonymous random `deviceId` from `localStorage` (`quoridor_device_id`, not linked to any account),
  sent via `umami.identify(DEVICE_ID)` (string form) once `window.umami` is ready: script.js records it
  as the session `id` and stitches visits of the same device across months. The object form of `identify`
  only adds session properties and does not stitch visits. Controlled by the constant
  `UMAMI_IDENTIFY_ENABLED` in `frontend/js/analytics.js` (default `true`); set it to `false` to disable.
- `platform: 'android' | 'web'` is merged into every Umami event's props (web detection in `analytics.js`).
- Opt out for your own browser: `localStorage.setItem('umami.disabled', 1)` — skips Umami script injection
  and all `umami.track`/`umami.identify` calls; internal Mongo analytics keeps working.
- `mode` values are normalized in `trackEvent`: `normal` → `online`. Allowed values:
  `bot | local | online | friend | ranked`.

### Events (where they are sent)

Destination legend: **U** = Umami, **M** = Mongo. Allowlist for Umami lives in `UMAMI_EVENTS` in `analytics.js`
(role split: minor clicks stay Mongo-only, not by removing calls). Line numbers are approximate.

| Event | Props | Emitted at | U | M |
|---|---|---|---|---|
| `session-start` | — | `analytics.js` (auto on load) | ✓ | ✓ |
| `screen-view` | `screen: menu\|mode\|game\|profile\|color-select\|room` | `ui.js` `UI.showScreen` (dedup consecutive) | ✓ | ✓ |
| `register-click` | — | `login.html` (Register link), `index.html` (result-modal Sign Up) | ✓ | ✓ |
| `register-complete` | — | `register.html` | ✓ | ✓ |
| `login-complete` | — | `login.html`, `register.html` | ✓ | ✓ |
| `play-online-click` | — | `ui.js` `showPlayOnlinePanel` | ✓ | ✓ |
| `play-friend-click` | — | `ui.js` `onPlayFriendClick` | ✓ | ✓ |
| `play-bot-click` | `difficulty` | `game.js` `startVsBot` | ✓ | ✓ |
| `search-started` | `mode: ranked\|online` | `ui.js` `quickMatch` | ✓ | ✓ |
| `search-matched` | `mode`, `wait_ms` | `net.js` `gameStart` (only when a search overlay was open) | ✓ | ✓ |
| `search-timeout` | `mode`, `wait_ms` | `net.js` `findGameFailed` | ✓ | ✓ |
| `search-cancelled` | — | `net.js` `cancelFindGame` | ✓ | ✓ |
| `search-fallback-to-bot` | `difficulty` | `game.js` `startVsBot` (within 5 min after `findGameFailed`) | ✓ | ✓ |
| `room-created` | — | `ui.js` `onRoomCreated` | ✓ | ✓ |
| `room-joined` | — | `ui.js` `joinPrivateRoom` | ✓ | ✓ |
| `room-link-copied` | — | `ui.js` `copyRoomLink` | ✓ | ✓ |
| `room-opened-via-link` | — | `ui.js` `UI.initRouting` (`/lobby/:code` initial load, `?room=` legacy param) | ✓ | ✓ |
| `game-started` | `mode`, `difficulty` (bot) | `game.js` `startOnline` / `startPvP` / `startVsBot` | ✓ | ✓ |
| `game-finished` | `result: win\|loss`, `reason`, `mode` | `game.js` `handleGameOver` | ✓ | ✓ |
| `game-abandoned` | `mode`, `move_number`, `reason: tab-close\|disconnect\|navigate` | `game.js` `trackAbandonment` (`pagehide` — skipped when `persisted` (bfcache), `leaveActiveGame`), `net.js` socket `disconnect` after a 30 s grace period (matches the server `setDisconnectTimer`, canceled by reconnect/`gameResumed`); sent at most once per game, never after `game-finished` | ✓ | ✓ |
| `rematch-click` | — | `net.js` `requestRematch` | ✓ | ✓ |
| `play-local-click` | — | `ui.js` `onPlayLocalClick` | — | ✓ |
| `surrender-click` | — | `ui.js` (surrender button) | — | ✓ |
| `admin-metrics-viewed` | `days` | `admin-metrics.html` | — | ✓ |

### UTM

Umami parses `utm_source`, `utm_medium`, `utm_campaign` from landing URLs automatically. Server redirects
preserve query strings (including `/how-to-play → /rules`). Recommended labeling:

| utm_source | utm_medium | utm_campaign | Example |
|---|---|---|---|
| `telegram` | `post` / `story` | `launch-2026` | `https://playquor.org/?utm_source=telegram&utm_medium=post&utm_campaign=launch-2026` |
| `reddit` | `post` | `r-boardgames` | `https://playquor.org/?utm_source=reddit&utm_medium=post&utm_campaign=r-boardgames` |
| `play-store` | `app-listing` | `android` | `https://playquor.org/?utm_source=play-store&utm_medium=app-listing&utm_campaign=android` |

SPA note: `/lobby/:code` history navigation (`pushState`/`replaceState`) drops the query string — put UTM
links on `https://playquor.org/` (root) or other landing pages, not on `/lobby/…` deep links.

### Recommended Umami funnels (configured in the Umami UI)

1. Acquisition: `visit → play-online-click / play-friend-click / play-bot-click → game-started → game-finished → rematch-click`
   (`play-local-click` and `surrender-click` are Mongo-only — do not use them in Umami funnels)
2. Registration: `register-click → register-complete` (add `login-complete` after)
3. Search quality: `search-started → search-matched` vs `search-started → search-timeout` / `search-fallback-to-bot`
4. Room sharing: `room-created → room-link-copied → room-opened-via-link → game-started`
