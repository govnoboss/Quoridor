# AI Frontend Reference

Shared notification centre and support conversation clients, polling, draft/error
handling, direct links and email opt-in: `AI_NOTIFICATIONS.md`. The game, public
site-shell and admin-shell use the same centre; standalone pages do not establish
another gameplay socket.

## 1. Main application shell

Game clock/session v2 is documented in `AI_CLOCKS.md`: local bot/local PvP are untimed, private rooms choose untimed or 1/3/5/10 minutes per player, and network recovery replaces the full board/clock snapshot. `game-clock.js` loads before UI/network scripts. New cache versions: UI/Net/Game/AI `1.1.0`, shared rules `1.1.0`, replay `1.4.0`. Room creation is explicit (no code allocation on panel open); duplicate legacy room form IDs were removed.

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

Admin stage 1: all seven admin pages load `/js/admin-api.js?v=1.0.0` before their inline scripts. Non-2xx/network responses reject before success handlers run; failures preserve notes/replies/dialogs, and identical pending mutations are blocked. Bot polling does not fill settings fields; dirty forms and in-flight edits are preserved, with confirmation before an explicit discard/reload. Complaint notes are pre-filled. See `AI_ADMIN.md` for contracts, tests and deployment scope.

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

### 2.1 Bot-mode eval bar and mobile bottom sheets (game.js)

- Desktop (≥769px, bot mode): eval bar renders in `.eval-bar-rail` beside the board; controls live in the sidebar (`#sidebarControls`: Undo / Restart + `#evalCard`). Wall drag templates are hidden (`display:none !important`, `style.css` `@media (min-width: 769px)`).
- Mobile (≤768px, bot mode): the rail is replaced by the horizontal `#evalBarH`; controls live in `#mobileBotBar` (Undo / Restart / Eval / Moves / Menu). The Eval and Moves buttons open bottom sheets:
  - Eval sheet = `#sidebarControls` re-shown as a fixed panel (`#gameScreen.bot-mode.eval-sheet-open`), sitting at `bottom: 82px` — above the button row, so the buttons stay tappable and a second tap on Eval/Moves closes its own sheet.
  - Moves sheet = `#moveHistory` re-shown the same way (`moves-sheet-open`).
  - `#sheetBackdrop` (`.sheet-backdrop`, z-index 650, below the bar at 660 and the sheets at 700) dims the board; tapping it closes both sheets. Escape also closes them (see `game.js` keydown handler).
- `#gameScreen.bot-mode .history-container-wrapper { gap: 0 }` is scoped to ≥769px in `style.css`: the mobile block shows the wall templates in a row with `gap: 60px`, and the bot-mode rule must not override it there (it caused the templates to overlap on mobile).
- Eval state: `Game.evalOn` / `Game.evalDepth` persisted in `localStorage` (`quoridor_eval_on`, `quoridor_eval_depth`); the worker is created only while eval is on.

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

### Replay layout

#### MP4 export v1

`replay-export.js` owns timing/encoding; `replay.js` owns the dialog and drawing adapter. Portrait presets: 720x1280 at 4 Mbps or 1080x1920 at 8 Mbps, both 30 FPS H.264 MP4. Timeline: 1 second intro, 1.2 seconds per move, 2 seconds outro. Integer microsecond timestamps/durations derive from frame index, independently of display refresh rate.

Export probes codec configuration, bounds each encode queue to four frames, yields to UI and closes frames/encoders on all exit paths. Queue/finalization timeout: 30 seconds. One task at a time; Cancel, dialog close and pagehide abort it. Perspective, moves and sound choice are captured at start. Playback/analysis and any old video preview stop during export. Completed MP4 stays in memory until replaced or page exit. No worker, streaming-to-disk or MediaRecorder fallback. Unsupported H.264 produces an explicit error. Existing mp4-muxer is retained pending separate migration; long games can still consume substantial output memory.

The export dialog has an independent, initially enabled `Include game sound in MP4` checkbox. With sound enabled, `replay-export.js` synthesizes soft pawn clicks and wall click/thud effects modeled on `UI.AudioManager`, in small PCM blocks (48 kHz mono), synchronized to the integer video timeline. AudioEncoder encodes AAC-LC at 96 kbps into the same MP4; support is probed before rendering. Unsupported audio displays an actionable error to turn sound off, rather than silently dropping it. With sound disabled no audio encoder or track is created. AAC packet padding can add less than one packet to the container duration. Exported frames contain only the board and wall reserves, without PlayQuor branding, player names, move counters or result captions. The replay page itself retains its player and navigation information. The preview uses `playsinline`; the dialog scrolls within the viewport, respects safe areas and wraps touch buttons on narrow phones.

Sound acceptance on 2026-11-21: real browser downloads at both resolutions contained video (7.8 s) and audio (7.808 s including AAC padding) for a four-move pawn/wall fixture. Sound export cancellation and subsequent silent export passed. Responsive browser viewports 320x568 and 390x844 showed no horizontal overflow and usable settings/buttons/scrolling preview. These are desktop browser viewport checks, not physical iOS/Android device certification. Unit coverage also checks cue silence/onsets, PCM duration, audio cancellation/failure/unsupported-codec cleanup and silent fallback by explicit user choice.

Regression command: `node tests/replay-export.cjs` (timeline and mocked codec lifecycle). Browser acceptance on 2026-11-21 in the desktop in-app browser: downloaded H.264 MP4 at 720x1280 and 1080x1920 using a 16-move demo fixture; both files contain 666 samples, exactly 22.2 seconds at 30 FPS (verified from MP4 sample tables). Cancellation followed by successful retry passed. Both files loaded in the native video preview; 1080p playback was also checked. Long games, Safari and Android WebView remain separate acceptance checks.

`replay.html` mounts the shared `site-shell.js` header into `#siteHeader`, using `header.css` and `components.css` like other standalone pages; do not reintroduce a separate replay header. The fixed header has reserved space above the content. Shared guest navigation includes Sign In/Sign Up in the mobile menu; below 381px the header's Sign Up button moves out of the top row, and menu icons keep their full width. The game-analysis title and profile/home back link sit in the replay sidebar.

Replay uses game-screen tokens and player bars, with one transport control row moved below the board by `replay-layout.js`. Desktop board size follows available viewport width/height (up to 1000px, replacing the old 580px cap); the sidebar scales from 320 to 440px. At 2550x1260 the board is 870px; at 1920x1080 it is 690px. Player text, clocks, history rows and controls are larger; desktop transport buttons and speed/counter share one row. At 960px and below the layout stacks, the board uses available width up to 720px, evaluation becomes horizontal, transport metadata wraps below the buttons, and native details panels start collapsed. The page scrolls on short screens instead of clipping content. Same-origin profile referrers provide a Profile back link; direct visits fall back to Home. `replay.js` retains playback, analysis, flip and export logic and updates the move counter during navigation. Keep IDs stable for these handlers. Analytics is loaded only once on this page.

Layout acceptance (2026-11-22): browser viewports 2550x1260, 1920x1080, 1366x768, 900x1000, 390x844 and 320x568 had no horizontal overflow. Shared mobile menu, guest authentication links, move navigation and board flip were exercised. This is responsive browser validation, not a physical-phone test.

`frontend/css/` contains shared tokens/components/header styles plus page/feature styles such as `style.css`, `auth.css`, `auth-pages.css`, `profile.css`, `replay.css`, and `rules.css`. Inspect the page link tags to determine which styles are actually loaded on a given page.

## 5. Editing guidance

Analytics is loaded on all HTML pages. Early Umami events wait for provider readiness. `session-start` and `app-loaded` count document loads, not cross-page sessions. Registration is recorded server-side and sent separately by the client to Umami. `room-joined` follows gameStart after a join request; failures emit `room-join-failed`. Online game events include lobbyId, and finishes include gameResultId; these remain player observations, not unique match counts. Delivery is best effort; User records remain the authoritative registration count.

- Search for the exact DOM id/class and event listener before changing UI.
- Check whether UI state is shared through globals or module-level variables.
- Check mobile/responsive CSS and the standalone page variants.
- For online game actions, trace the UI action through `net.js` to the server event; never assume local UI validation is authoritative.
- If a script is loaded by multiple pages, consider side effects when changing its initialization.
- Keep asset cache-busting query versions in HTML consistent with deployment expectations.

## 6. External analytics (Umami) and error telemetry (Sentry)

Product reporting v2 is documented in `AI_ANALYTICS.md`. Game lifecycle events now
carry `gameId`/`measurementVersion:2` for new attempts; local restore preserves the
ID without emitting another start. Bot Restart records an abandon signal and a new
start/ID. Online recovery uses the lobby ID without emitting a new start. Search
events use `searchId` for the first outcome of each attempt. Admin pages do not emit
internal events; the metrics page no longer embeds Umami. The `analytics.disabled`
localStorage switch suppresses internal/custom event submission for test devices.

**Role split.** Umami (`https://analytics.playquor.org`, self-hosted) covers traffic, sources, countries,
pages and funnels over key events. The internal analytics (`POST /api/analytics/events` → Mongo
`AnalyticsEvent`, dashboard `GET /admin/metrics`) covers product data: retention, users, game results.
Sentry (`@sentry/node` on the backend, `@sentry/browser` on the frontend) covers crashes and errors.

### Connection

- Unified bootstrap script per public page (two tags, in `<head>` before the other scripts):
  `<script src="/js/analytics-boot.js?v=1.2.0"></script>` and the explicit
  `<script src="/js/analytics.js?v=1.2.0"></script>` tag follows.
  (Boot used to load `analytics.js` via `document.write`; removed — Chrome may block such
  inserts on slow connections.)
- `analytics-boot.js` injects, in order: `/js/telemetry-config.js` (`async=false`; server route in
  `src/server.js` returning `window.__TELEMETRY = { sentryDsn }`, `Cache-Control: no-store`, so the
  DSN never lands in the public repo), the Sentry CDN bundle (`browser.sentry-cdn.com/10.78.0`,
  `init` on `onload`, release `web@<version>`, sampleRate 1.0, tracesSampleRate 0.2), and the Umami
  tag (`defer`, `data-website-id="4efbc356-ed5e-4f8b-9761-c00a500f67c2"`,
  `data-domains="playquor.org"`, `data-performance="true"` → web vitals TTFB/FCP/LCP/CLS/INP
  are sent to Umami automatically).
- Opt-out switches (independent): `localStorage.setItem('sentry.disabled', 1)` and
  `localStorage.setItem('umami.disabled', 1)`.
- `data-domains="playquor.org"` makes Umami ignore localhost, staging and any non-production host.
  The Android app loads `https://playquor.org` (see `capacitor.config.json`), so its traffic passes the filter.
- Backend Sentry: `Sentry.init` runs **before** `require('express')` in `src/server.js` (in v10 the
  auto-instrumentation hooks at require time; otherwise the log shows
  `[Sentry] express is not instrumented`). Socket.IO is not instrumented (no such export in v10).
  Frontend DSN: `SENTRY_FRONTEND_DSN` if set, otherwise falls back to the backend `SENTRY_DSN`
  (both frontend and backend events land in one Sentry project).
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
| `net-latency` | `p50_ms`, `p95_ms`, `samples: 20` | `net.js` `recordLatency` — RTT measured on the `requestTimerSync` ack (in-game only), flushed every 20 samples | ✓ | ✓ |
| `play-local-click` | — | `ui.js` `onPlayLocalClick` | — | ✓ |
| `surrender-click` | — | `ui.js` (surrender button) | — | ✓ |
| `admin-metrics-viewed` | `days` | `admin-metrics.html` | — | ✓ |

### UTM

Umami parses `utm_source`, `utm_medium`, `utm_campaign` from landing URLs automatically. Server redirects
preserve query strings (including `/how-to-play → /rules`). Full labeling guide (rules, channel → value
table, example links, verification steps): **`docs/UTM_GUIDE.md`**. Quick rules: lowercase-hyphen values,
labels on the root `https://playquor.org/` only, three params, never label internal links.

SPA note: `/lobby/:code` history navigation (`pushState`/`replaceState`) drops the query string — put UTM
links on `https://playquor.org/` (root) or other landing pages, not on `/lobby/…` deep links.

### Recommended Umami funnels (configured in the Umami UI)

1. Acquisition: `visit → play-online-click / play-friend-click / play-bot-click → game-started → game-finished → rematch-click`
   (`play-local-click` and `surrender-click` are Mongo-only — do not use them in Umami funnels)
2. Registration: `register-click → register-complete` (add `login-complete` after)
3. Search quality: `search-started → search-matched` vs `search-started → search-timeout` / `search-fallback-to-bot`
4. Room sharing: `room-created → room-link-copied → room-opened-via-link → game-started`

Production integration: preserve analytics-boot.js, the Umami event allowlist, device identification and mode normalization. If Umami is ready, flush custom events immediately before authentication redirects; the former 250 ms delay could lose registration events. Remaining early events use the existing readiness polling.

### Shared administration workspace (deployed 2026-11-22)

The seven administration pages use `css/tokens.css`, `css/admin.css?v=1.0.0` and deferred `js/admin-shell.js?v=1.0.0`. Body `data-admin-page` selects the active navigation item; `main#adminMain` is the content/focus target. The shell owns the responsive sidebar, labeled table scroll regions and nested-dialog focus management. Individual pages keep API/data behavior through `admin-api.js`. Details, responsive behavior and validation/deployment status are in `AI_ADMIN.md`, Administration UI revision.
