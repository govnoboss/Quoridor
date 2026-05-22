#!/usr/bin/env bash
set -euo pipefail

APP_NAME="quoridor"
REPO_DIR="/opt/quoridor"
COMPOSE_FILE="docker-compose.yml"

cd "$REPO_DIR"

echo ">>> Pulling latest code..."
git pull origin main

echo ">>> Rebuilding and restarting..."
docker compose -f "$COMPOSE_FILE" up -d --build

echo ">>> Cleaning old images..."
docker image prune -f

echo ">>> Done! Check logs: docker compose logs -f"
