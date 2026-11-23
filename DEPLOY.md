# Deploying Quoridor

## Local run (development and testing)

```bash
# Bring everything up with one command (MongoDB + Redis + app)
docker compose -f docker-compose.dev.yml up -d

# Logs
docker compose -f docker-compose.dev.yml logs -f

# Stop
docker compose -f docker-compose.dev.yml down

# Two-client test:
# Open two browser windows → http://localhost:3000
# Register two users
# Click "Play online" in both windows
```

**Important:** Docker Desktop must be running.

## Dependencies

| Component | Purpose | Free option |
|---|---|---|
| **VPS** | Application server | — |
| **Docker + Docker Compose** | Run the app | Free |
| **MongoDB** | Database (users, games) | MongoDB Atlas M0 |
| **Redis** | Sessions, game state | Upstash Free (30MB) or a Redis Stack container |
| **Caddy** | Reverse proxy + automatic SSL | Free |
| **Domain** | HTTPS for WebSocket | Cloudflare ≈ $9/year |

## Project structure

```
Quoridor/
├── Dockerfile                 # Multi-stage build
├── docker-compose.yml         # Production config
├── deploy.sh                  # Automated deploy
├── .dockerignore              # Docker exclusions
├── .env.example               # Environment variable template
├── frontend/                  # HTML, JS, CSS (static frontend)
├── quoridor-engine/           # AI engine workbench + arena
└── src/                       # Node.js + Socket.IO backend
```

## Environment variables (.env)

Copy `.env.example` to `.env` and fill it in:

```bash
NODE_ENV=production
PORT=3000

# MongoDB: in production the local container is used by default (mongo:7 from docker-compose.yml)
# MONGO_URI is set automatically to mongodb://mongo:27017/quoridor; an external one (Atlas) only when explicitly overridden
MONGO_URI=mongodb://mongo:27017/quoridor

# Redis: in production it is set by docker-compose (redis://redis:6379); for a local run NOT via compose:
REDIS_URL=redis://localhost:6379

# Session secret: openssl rand -hex 32
SESSION_SECRET=your_random_secret_here

# Allowed CORS origins (comma-separated)
ALLOWED_ORIGINS=https://playquor.org
```

## 1. VPS setup (Hetzner CX22 recommended)

```bash
# Update the system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Install Caddy
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

## 2. Running the app

```bash
# Clone the repository
mkdir -p /opt/quoridor
git clone https://github.com/govnoboss/Quoridor.git /opt/quoridor

# Create .env with production values
cd /opt/quoridor
nano .env           # Paste the variables from the section above

# Start
docker compose up -d

# Check
docker compose logs -f
```

## 3. Caddy setup (SSL)

Create `/etc/caddy/Caddyfile`:

```
playquor.org {
    reverse_proxy localhost:3000
}
```

```bash
caddy fmt --overwrite /etc/caddy/Caddyfile
systemctl restart caddy
```

## 4. Updating (deploying a new version)

Production SSH target: `root@62.238.36.105` (port 22), project directory `/opt/quoridor`.
On the maintainer's Windows machine the existing identity is `C:\Users\User\.ssh\id_ed25519.txt`.
Example: `ssh -i "C:\Users\User\.ssh\id_ed25519.txt" root@62.238.36.105`.
Never commit the private key or `.env` contents.

```bash
cd /opt/quoridor
./deploy.sh
```

Normal delivery order: commit and test locally, push `main` to GitHub, then run
`./deploy.sh` on the server. The script uses `git pull --ff-only origin main`,
rebuilds and restarts the containers. Use Bash (`./deploy.sh` or `bash deploy.sh`);
the script uses Bash's `pipefail` and is not a portable `sh` script.

Keep the server checkout on `main` with no local source edits. Pull rejects
divergent history instead of silently merging it. Keep `.env`, database data,
avatars and backups outside Git. Do not automatically reapply the reconciliation
stash over the published source. Details: `docs/SERVER_SYNC_REPORT.md`.

### Admin UI redesign — deployed 2026-11-22

Selected 16-file release: seven admin HTML pages, shared `admin.css?v=1.0.0` and `admin-shell.js?v=1.0.0`, server online-user filtering, two admin regression suites and documentation. Server-side comparison preserved existing production changes; unrelated local changes were excluded. Rebuilt/recreated only `app`; MongoDB/Redis services and volumes remained running. No database migration.

Private backup: `/opt/quoridor-admin-ui-backup-20261122T184320Z`, including project, actual production MongoDB archive, Redis snapshot and configuration hash. Previous image: `quoridor-app:pre-admin-ui-20261122T184320Z`; deployed image: `sha256:ff22f1f9c8a57bceb40bfd930b40be17e741b470196503643c62b7e618da90e7`. Source permissions and JS syntax were checked before switching. Revert the application only while preserving current database/Redis state; retain clock-v2 compatibility.

Post-deploy verification passed: public health, 9 exact asset hashes, 17 denied anonymous admin requests and guest game move/completion. The deployed image passed 2 suites/37 tests with mocked stores, networking disabled and a read-only filesystem in an isolated derived image. Saved bot settings including `updatedAt` were unchanged; restart count 0. A transient startup response cleared after initialization. Production authenticated UI and physical-phone acceptance remain manual; pre-deploy responsive UI checks used local sample data. Details and report paths: `docs/AI_ADMIN.md`. Final documentation was synchronized to the host without another restart.

### Admin stage 1 — deployed 2026-11-22

Selected release: `src/server.js`, new `src/admin/policy.js`, `src/models/AdminLog.js`, all seven admin HTML pages, new `/js/admin-api.js?v=1.0.0`, two regression test files and related documentation. Existing production changes were preserved by server-side comparison. Rebuilt/recreated only `app`, retaining MongoDB/Redis services and volumes.

Private backup directory: `/opt/quoridor-admin-stage1-backup-20261122T175756Z` (0700). It contains the project archive, actual external production MongoDB archive, Redis snapshot and a safe configuration hash snapshot. Previous image: `quoridor-app:pre-admin-stage1-20261122T175756Z`; deployed image: `sha256:882b393a2861f14bf6e6ced733f03c869f1bc5bb7bea387eedc51d9e70e3f4e3`. Preserve database/Redis state when reverting the app; this release requires no destructive migration. Source files were set to 0644 and the new source directory to 0755 before the image checks.

Verification: pre-release full suite 20/355 passed; post-release server verification 2 suites/35 tests passed in an isolated derived image with separate test tooling, no network and mocked persistence. Public HTTPS checks passed: health, 8 exact admin asset hashes, 17 anonymous authorization checks (14 GET + 3 mutation attempts denied with 401), and an untimed guest move/completion smoke test. Saved production bot settings plus `updatedAt` were identical before/after startup. Restart count 0; no matching admin/auth/rating error markers observed. Reports and scope limitations are in `docs/AI_ADMIN.md`; no privileged production admin UI mutation was used for verification. Documentation records were updated on the host after verification without another application restart.

### Clock v2 rollout — deployed 2026-11-22

Deployed the selected clock/server/client/rules/test/documentation files to production and rebuilt/recreated only `app`; MongoDB/Redis containers and volumes were preserved. Existing production changes were compared on the server before replacement. Backup directory: `/opt/quoridor-clock-v2-backup-20261122T075105Z` (mode 0700), with project archive, Redis snapshot and MongoDB archives. `production-mongo.archive.gz` backs up the actual application URI (external MongoDB), rather than just the local Mongo container. Previous image: `quoridor-app:pre-clock-v2-20261122T075105Z`; deployed image: `sha256:6ff41d04516f10dcb8bb9fac4762892903fa877881542cf20562523260495aec`.

The first image check caught unreadable new files before the running container was replaced. Release files were set to 0644, the image rebuilt and syntax checks rerun as the image's normal user before switching. Keep production secrets/backups private; the readable-file rule applies only to the explicit source/documentation release manifest. Preserved `room-joined` analytics when confirming new room conditions.

Post-deploy verification: `/health` OK; 11 real public HTTPS/Socket.IO checks passed, including 1/3/5/10-minute controls, untimed room, legal move/history, socket replacement without clock refund, outsider rejection, natural one-minute timeout from the production pulse, archived clocks and finished-game recovery. Public JS/shared-rule hashes match the release manifest. Browser at 390×844: five-minute room form, local two-player/bot clocks hidden, bot move survives reload. Container restart count 0; no matching clock/move/archive error markers in the observed logs. Results: `artifacts/timer-audit/production-smoke.json`, screenshot: `artifacts/timer-audit/production-room-mobile.jpg`. Physical-phone OS sleep/process eviction is still unverified.

See `docs/AI_CLOCKS.md` for changed mode/Socket.IO/schema contracts and the remaining physical-phone acceptance checklist. Deploy frontend versions, shared rules, new `frontend/js/game-clock.js`, `src/core/lobby-lock.js`, `src/bots/think-worker.js`, server/Redis/model changes together. Preserve MongoDB/Redis volumes and back up active state/image before restart. Restart reconciliation now retains active games and reconstructs deadlines after startup preparation. Old timed tabs retain second-based wire compatibility; untimed rooms/invitations require refreshed clients. An older server cannot safely consume v2 untimed `timers:null` games: drain them before rollback rather than deleting their saved state.

Local test setup note: the supplied package lock currently fails `npm ci` (missing transitive entries); this change does not rewrite the dependency lock. For verification a temporary official Node runtime and `npm install --no-save --package-lock=false --ignore-scripts` were used. Production deployment should keep its established dependency workflow until the lock/runtime compatibility is repaired separately. `.tmp-export` and `artifacts` are excluded from Docker build context.

### MP4 export v1 deployment — 2026-11-21

Caption removal follow-up: `replay.js?v=1.3.1` removes the remaining PlayQuor caption from exported video. Backup: `/opt/quoridor-pre-no-branding-20261121.tar.gz`; previous image: `quoridor-app:pre-no-branding-20261121`. Deploy only replay JS/HTML and documentation, then rebuild/recreate `app`.

Follow-up sound/mobile release: `replay-export.js?v=1.1.0`, `replay.js?v=1.3.0`, `replay.css?v=2.2.0`. Adds optional AAC game effects, removes video name/move/result captions and improves touch dialog/inline preview. Targeted app rebuild; backup `/opt/quoridor-pre-mp4-sound-20261121.tar.gz`, previous image `quoridor-app:pre-mp4-sound-20261121`. Video/audio lifecycle regression suite passed on the server; browser acceptance is recorded in `docs/AI_FRONTEND.md`.

The tested replay exporter was uploaded as a targeted release (replay HTML/JS, new `replay-export.js`, regression test and frontend documentation), preserving existing production changes. Rebuilt/recreated only `app`; MongoDB/Redis volumes were retained. Backup: `/opt/quoridor-pre-mp4-v1-20261121.tar.gz`; previous image: `quoridor-app:pre-mp4-v1-20261121`. Codec lifecycle tests passed on the server. Public HTTP returned 200 after startup; wait for bot initialization to complete before treating a transient startup 502 as a deployment failure. Browser export acceptance details are in `docs/AI_FRONTEND.md`.

### Replay layout/header update — 2026-11-22

Replay now uses the shared `site-shell.js` header and responsive larger board/sidebar. Release assets: `replay.css?v=2.3.0`, `replay-layout.js?v=1.1.0`, `site-shell.js?v=1.1.2`, `header.css?v=1.1.1`. Shared header changes keep the menu icon readable and expose guest auth links in the mobile menu. Responsive acceptance and board dimensions are in `docs/AI_FRONTEND.md`. Targeted app rebuild; backup `/opt/quoridor-pre-replay-layout-20261122.tar.gz`, previous image `quoridor-app:pre-replay-layout-20261122`.

## 5. Scheduled tasks (cron)

it can be pre-created ahead of time and the retention report captured:

```bash
sudo crontab -e -u root

# Every Monday at 00:30 (UTC) — v2 D1/D7 and days 1–7 return report (full UTC+05 days)
30 0 * * 1 cd /opt/quoridor && docker compose exec -T app node scripts/retention_report.js >> /var/log/quoridor-retention.log 2>&1
```

Verify the command works inside the container (check the service name in `docker compose ps`):

```bash
docker compose exec app node scripts/retention_report.js
```

## 6. Monitoring

### Notifications/support release — deployed 2026-11-23

Released 48 explicit files after source hash drift checks. Runtime image inherits
the previous production dependencies; no npm install/upgrade. New image:
`sha256:157a35c4e664898fa7d120170d11c0f6f5084e71bcbd04d23c6776292c31dfad`.
App started `2026-11-23T09:06:08.850610631Z`; MongoDB/Redis containers and volumes
were retained. Private backup `/opt/quoridor-notifications-backup-20261123T090535Z`
contains project, actual application MongoDB archive, Redis snapshot and old image.
Previous tag: `quoridor-app:pre-notifications-20261123T090535Z`.

Contracts and verification: `docs/AI_NOTIFICATIONS.md`. Sparse dedupe/email/pending
indexes are additive. Existing messages are not replayed; users are not opted into
email automatically. No new environment secret or dependency required. Refresh
pages for new request IDs and the shared centre. API and client scripts ship together.

Before a planned rollback, inspect/drain or preserve pending report/email jobs.
Re-tag the previous image as `quoridor-app:latest`, then run
`docker compose up -d --no-deps --no-build app`. Reconcile host source files from
the private source backup/release manifest. Keep current database/Redis data;
restoring backups is disaster recovery, not normal rollback. Prior clock-v2
compatibility constraints still apply. Post-verification docs are synced to the
host without another application restart.

```bash
docker compose logs -f          # Application logs
docker compose logs -f --tail 50
docker stats                    # CPU/RAM usage
```

## Notes

- Port 3000 does not need to be opened in the firewall — Caddy proxies 443 → 3000
- Firewall: open only 22 (SSH), 80 (HTTP→HTTPS), 443 (HTTPS)
- The frontend is served statically through Express (the `frontend/` folder)
- Avatars are stored in the `avatars_data` volume → `/app/avatars` (survives container rebuilds)
- Bot opponents run **on the server** (`src/bots/` + `src/simulation/`): matchmaking fallback, move
  scheduling through engine v3 (`quoridor-engine/engines/v3`), presence simulation. Enabled via
  `BOTS_ENABLED`/`BOT_RANKED_ENABLED` (off by default)
- Socket.IO handles thousands of concurrent connections on 1 vCPU
