# API Reference

REST endpoints of the Quoridor server (`src/server.js`), plus the authoritative environment
variable list. All routes are JSON unless noted. Auth is cookie-based (`express-session` +
Redis store); protected routes return `401` when there is no session.

## Static / Pages

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/` | SPA shell (`frontend/index.html`) |
| GET | `/health` | liveness probe |
| GET | `/shared.js` | mirrored game engine (`src/core/shared.js`) |
| GET | `/js/ai-v1.js` | production engine (v3) for the browser, generated from `quoridor-engine/engines/v3` + `personality.js` by `src/core/ai-v1-bundle.js` (historical URL) |
| GET | `/js/ai-core.js` | legacy v0 AI engine, kept for reference only — nothing loads it |
| GET | `/js/mp4-muxer.js` | `node_modules/mp4-muxer` served for replay video export |
| GET | `/login` `/register` `/forgot-password` `/reset-password` | auth pages (`/login`, `/register` are `noindex,follow`) |
| GET | `/rules` `/how-to-play` (301 → `/rules`) `/faq` | info pages |
| GET | `/terms` `/privacy` `/report` `/profile/reports` | user pages |
| GET | `/leaderboard` `/replay/:id` | content pages |
| GET | `/profiles/:username` | SPA with server-injected meta: `<title>`/description/OG/canonical built from the user (`unknown user → 404 page`); indexed |
| GET | `/lobby/:lobbyCode` | SPA with `noindex, nofollow` + invite OG snippet (messenger previews); invalid code → redirect `/` |
| GET | `/sitemap.xml` | generated dynamically: static pages with `lastmod` (file mtime) + top-50 non-bot/non-admin profiles; 1h in-memory cache |
| GET | `/play` | legacy alias, 301 → `/` (preserves the rest of the URL) |
| GET | `/profile`, `/profile/:legacyUser` | legacy redirect, 301 → `/profiles/<username>` |
| GET | `/{*path}` | unknown GET route → `frontend/404.html` with HTTP 404 (`/api/*` unknown → JSON 404). No SPA soft-404 fallback |
| GET | `/avatars/*` | avatar files (`avatars/<userId>.webp`, immutable); missing file → 301 to placeholder |
| GET | `/admin` `/admin/users` `/admin/user-reports` `/admin/reports` `/admin/logs` `/admin/bots` `/admin/metrics` | admin pages (`requireAdmin`) |

## Auth

| Method | Path | Body / Notes |
| --- | --- | --- |
| POST | `/api/auth/register` | `{ username, name?, password }` → creates user, starts session |
| POST | `/api/auth/login` | `{ username, password }` → session + `playerToken` |
| GET | `/api/auth/config` | `{ googleClientId }` for Google Identity Services (null when unconfigured) |
| POST | `/api/auth/google` | `{ credential }` (Google ID token) → session; merges into an existing account with the same email; creates a Google-only account otherwise (no `passwordHash`) |
| POST | `/api/auth/reauth-challenge` | issues a one-time reauth `nonce` in the session (used by Google-account users to set a password) |
| POST | `/api/auth/logout` | destroys session |
| GET | `/api/auth/me` | current user or `null` (also issues a fresh `playerToken`) |
| POST | `/api/auth/forgot-password` | `{ email }` — rate-limited, sends reset email via Resend |
| POST | `/api/auth/reset-password` | `{ token, newPassword }` |

## User / Profile

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/game/active` | active lobby for the current session |
| GET | `/api/user/profile` | own profile (stats, bio, status, friends count…) |
| PATCH | `/api/user/profile` | `{ name?, bio?, status?, avatarUrl? }` — profile/bio/status/avatar URL |
| POST | `/api/user/update-status` | `{ status }` |
| POST | `/api/user/update-avatar` | `{ avatarUrl }` — sets allowed image URL as avatar |
| POST | `/api/user/upload-avatar` | `multipart/form-data`, field `avatar` (JPEG/PNG/WebP, ≤ 5 MB) → resized to 256×256 WebP at `avatars/<userId>.webp` |
| POST | `/api/user/password` | `{ currentPassword, newPassword }` (`googleCredential` instead of `currentPassword` for Google accounts; bumps `sessionVersion`, keeps current session) |
| GET | `/api/user/history` | paginated own game history |
| DELETE | `/api/user/account` | delete own account and data |

## Profiles / Leaderboard (public)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/profiles/:username` | public profile |
| GET | `/api/profiles/:username/games` | recent games of a user |
| GET | `/api/profiles/:username/rating-history` | rating points over time (chart) |
| GET | `/api/leaderboard` | ranked players (`stats.totalGames` included) |
| GET | `/api/leaderboard/me` | leaderboard context for the current session user (rank around own position) |
| GET | `/api/games/:id` | one archived game (result + history for replay) |

## Friends

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/friends/request` | send friend request |
| POST | `/api/friends/accept` | accept request |
| POST | `/api/friends/decline` | decline/remove request |
| DELETE | `/api/friends/remove/:userId` | unfriend |
| GET | `/api/friends/list` | friends with online status |

## Notifications

| Method | Path |
| --- | --- |
| GET | `/api/notifications` |
| PATCH | `/api/notifications/:id/read` |
| PATCH | `/api/notifications/read-all` |
| DELETE | `/api/notifications/:id` |

## Reports

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/reports` | bug report (rate-limited) |
| GET | `/api/reports/:id` | report + replies (author or admin) |
| POST | `/api/reports/:id/reply` | reply to a report |
| GET | `/api/my/reports` | own reports |
| POST | `/api/user-reports` | complain about a player (rate-limited) |

## Analytics

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/analytics/events` | batch events `{ events: [...] }` (≤ 20), rate-limited (60/min). Accepted names come from the server whitelist `session-start`, `screen-view`, `register-click`, `register-complete`, `login-complete`, `play-online-click`, `play-friend-click`, `play-local-click`, `play-bot-click`, `search-started`, `search-matched`, `search-timeout`, `search-cancelled`, `search-fallback-to-bot`, `room-created`, `room-joined`, `room-link-copied`, `room-opened-via-link`, `game-started`, `game-finished`, `game-abandoned`, `rematch-click`, `net-latency`, `surrender-click`, `admin-metrics-viewed`); unknown names are dropped, oversized `props` are cleared. `userId` is taken from the session automatically. See `docs/AI_FRONTEND.md` §6 for which events also go to Umami |
| GET | `/api/admin/metrics` | `?days=1..30` (default 7, `requireAdmin`): aggregates events by name, per day (`$dateToString`), active users, totals |

Dashboard: `GET /admin/metrics` (admin page). CLI: `node scripts/retention_report.js` (D1/D3/D7 cohorts + funnel).

## Admin (`requireAdmin`)

### Bots
- `GET /admin/bots` (page) · `GET /api/admin/bots`
- `PUT /api/admin/bots/settings` · `POST /api/admin/bots/seed` · `POST /api/admin/bots/rename` · `POST /api/admin/bots/recalc`

### Reports
- `GET /api/admin/reports` · `PATCH /api/admin/reports/:id`
- `GET /api/admin/user-reports` · `PATCH /api/admin/user-reports/:id`

### Users
- `GET /api/admin/users` · `GET /api/admin/users/:id`
- `POST /api/admin/users/:id/ban` · `POST /api/admin/users/:id/unban`
- `POST /api/admin/users/:id/rating` · `POST /api/admin/users/:id/delete`
- `DELETE /api/admin/users/:id/avatar` · `PATCH /api/admin/users/:id/role`

### Meta
- `GET /api/admin/stats` · `GET /api/admin/logs` · `GET /api/admin/metrics`

## Environment Variables

Defaults are resolved from code (`src/`), then docker-compose may override them.

| Variable | Default (code) | Compose (prod) | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | `production` | enables secure cookies, Sentry, per-second timers, morgan off in `test` |
| `PORT` | `3000` | `3000` | HTTP port |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/quoridor` | `mongodb://mongo:27017/quoridor` | Mongo connection |
| `REDIS_URL` | `redis://localhost:6379` | `redis://redis:6379` | Redis connection |
| `SESSION_SECRET` | — | — | **required**; `openssl rand -hex 32` |
| `ALLOWED_ORIGINS` | — | `https://playquor.org` | CORS origins, comma-separated |
| `SENTRY_DSN` | — | — | Sentry error tracking (disabled without it) |
| `GOOGLE_CLIENT_ID` | — | — | Google Identity Services client ID (web); feeds `GET /api/auth/config`, `POST /api/auth/google` and password-setting reauth for Google accounts |
| `SOCKET_ADMIN_USERNAME` / `SOCKET_ADMIN_PASSWORD` | — | (not passed by compose) | enables Socket.IO Admin UI |
| `BOTS_ENABLED` | `false` | `false` | enables server-side bot matchmaking fallback |
| `BOT_RANKED_ENABLED` | `false` | `false` | bots allowed in ranked queues |
| `BOT_FALLBACK_MIN_WAIT_MS` | `15000` | `5000` | queue wait before a bot is substituted |
| `BOT_FALLBACK_MAX_WAIT_MS` | `25000` | `10000` | max wait before bot substitution |
| `BOT_MAX_ACTIVE_GAMES` | `15` | `15` | per-bot parallel games |
| `BOT_MOVE_MIN_DELAY_MS` | `800` | `800` | bot move delay range |
| `BOT_MOVE_MAX_DELAY_MS` | `2500` | `2500` | — |
| `BOT_MAX_RECENT_MATCHES` | `3` | `3` | per-bot cap on recent games vs one human |
| `BOT_RECENT_WINDOW_MS` | `3600000` | `3600000` | recent-match window |
| `BOT_ACCOUNT_PASSWORD` | — | (optional) | password for seeded bot accounts |
| `RESEND_API_KEY` | — | — | Resend key for password-reset mail |
| `EMAIL_FROM` | `onboarding@resend.dev` | — | sender address |
| `SITE_URL` | — | `https://playquor.org` | canonical site URL (used in emails) |
| `AVATARS_DIR` | *(ignored)* | *(ignored)* | **No effect in code** — the avatar directory is hardcoded in `src/server.js` to `<repo>/avatars`; Docker maps the `avatars_data` volume to `/app/avatars`, which coincides with it |
| `REDIS_DISABLE_MEMORY_FALLBACK` | — | — | if set, fails instead of falling back to in-memory store |

See [.env.example](../.env.example) for the full template.