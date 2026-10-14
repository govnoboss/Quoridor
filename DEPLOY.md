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

```bash
cd /opt/quoridor
./deploy.sh
```

The script runs `git pull`, rebuilds the container and restarts it.

## 5. Scheduled tasks (cron)

it can be pre-created ahead of time and the retention report captured:

```bash
sudo crontab -e -u root

# Every Monday at 00:30 (UTC) — D1/D3/D7 cohort report
30 0 * * 1 cd /opt/quoridor && docker compose exec -T app node scripts/retention_report.js >> /var/log/quoridor-retention.log 2>&1
```

Verify the command works inside the container (check the service name in `docker compose ps`):

```bash
docker compose exec app node scripts/retention_report.js
```

## 6. Monitoring

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
