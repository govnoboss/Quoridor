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
| GET | `/js/ai-core.js` | mirrored AI engine (`src/core/ai-core.js`) |
| GET | `/login` `/register` `/forgot-password` `/reset-password` | auth pages |
| GET | `/rules` `/how-to-play` (301 → `/rules`) `/faq` | info pages |
| GET | `/terms` `/privacy` `/report` `/profile/reports` | user pages |
| GET | `/leaderboard` `/replay/:id` `/lobby/:lobbyCode` `/profiles/:username` | content pages |
| GET | `/avatars/*` | avatar files (`avatars/<userId>.webp`, immutable); missing file → 301 to placeholder |
| GET | `/admin` `/admin/users` `/admin/user-reports` `/admin/reports` `/admin/logs` `/admin/bots` | admin pages (`requireAdmin`) |

## Auth

| Method | Path | Body / Notes |
| --- | --- | --- |
| POST | `/api/auth/register` | `{ username, name?, password }` → creates user, starts session |
| POST | `/api/auth/login` | `{ username, password }` → session + `playerToken` |
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
| GET | `/api/user/history` | paginated own game history |
| DELETE | `/api/user/account` | delete own account and data |

## Profiles / Leaderboard (public)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/profiles/:username` | public profile |
| GET | `/api/profiles/:username/games` | recent games of a user |
| GET | `/api/profiles/:username/rating-history` | rating points over time (chart) |
| GET | `/api/leaderboard` | ranked players (`stats.totalGames` included) |
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
- `GET /api/admin/stats` · `GET /api/admin/logs`

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
| `AVATARS_DIR` | `<repo>/avatars` | `/app/avatars` (volume) | avatar storage directory |
| `REDIS_DISABLE_MEMORY_FALLBACK` | — | — | if set, fails instead of falling back to in-memory store |

See [.env.example](../.env.example) for the full template.