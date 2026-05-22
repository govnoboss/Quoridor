# Деплой Quoridor

## Локальный запуск (для разработки и теста)

```bash
# Поднять всё одной командой (MongoDB + Redis + приложение)
docker compose -f docker-compose.dev.yml up -d

# Логи
docker compose -f docker-compose.dev.yml logs -f

# Остановить
docker compose -f docker-compose.dev.yml down

# Тест с двух клиентов:
# Откройте два окна браузера → http://localhost:3000
# Зарегистрируйте двух пользователей
# Нажмите "Играть онлайн" в обоих окнах
```

**Важно:** Docker Desktop должен быть запущен.

## Зависимости

| Компонент | Назначение | Бесплатный вариант |
|---|---|---|
| **VPS** | Сервер приложения | — |
| **Docker + Docker Compose** | Запуск приложения | Бесплатно |
| **MongoDB** | База данных (пользователи, игры) | MongoDB Atlas M0 |
| **Redis** | Сессии, состояние игр | Upstash Free (30MB) или Redis Stack container |
| **Caddy** | Reverse proxy + автоматический SSL | Бесплатно |
| **Домен** | HTTPS для WebSocket | Cloudflare ≈ $9/год |

## Структура проекта

```
Quoridor/
├── Dockerfile                 # Multi-stage сборка
├── docker-compose.yml         # Продакшен конфиг
├── deploy.sh                  # Автоматический деплой
├── .dockerignore              # Исключения для Docker
├── .env.example               # Шаблон переменных окружения
├── frontend/                  # HTML, JS, CSS (статический фронтенд)
└── src/                       # Node.js + Socket.IO бэкенд
```

## Переменные окружения (.env)

Скопируйте `.env.example` в `.env` и заполните:

```bash
NODE_ENV=production
PORT=3000

# MongoDB: https://cloud.mongodb.com → Create cluster M0 → получить URI
MONGO_URI=mongodb+srv://user:password@cluster0.xxxxx.mongodb.net/quoridor?retryWrites=true&w=majority

# Redis: Upstash (https://upstash.com) → Create Redis DB → получить URL
REDIS_URL=redis://default:password@xxxxx.upstash.io:6379

# Session secret: openssl rand -hex 32
SESSION_SECRET=your_random_secret_here

# Разрешённые origin для CORS (через запятую)
ALLOWED_ORIGINS=https://quoridor.yourdomain.com
```

## 1. Настройка VPS (рекомендуется Hetzner CX22)

```bash
# Обновить систему
apt update && apt upgrade -y

# Установить Docker
curl -fsSL https://get.docker.com | sh

# Установить Caddy
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

## 2. Запуск приложения

```bash
# Клонировать репозиторий
mkdir -p /opt/quoridor
git clone https://github.com/govnoboss/Quoridor.git /opt/quoridor

# Создать .env с продакшен-значениями
cd /opt/quoridor
nano .env           # Вставить переменные из раздела выше

# Запустить
docker compose up -d

# Проверить
docker compose logs -f
```

## 3. Настройка Caddy (SSL)

Создайте `/etc/caddy/Caddyfile`:

```
quoridor.yourdomain.com {
    reverse_proxy localhost:3000
}
```

```bash
caddy fmt --overwrite /etc/caddy/Caddyfile
systemctl restart caddy
```

## 4. Обновление (деплой новой версии)

```bash
cd /opt/quoridor
./deploy.sh
```

Скрипт делает `git pull`, пересобирает контейнер и перезапускает.

## 5. Мониторинг

```bash
docker compose logs -f          # Логи приложения
docker compose logs -f --tail 50
docker stats                    # Загрузка CPU/RAM
```

## Примечания

- Порт 3000 не нужно открывать в фаерволле — Caddy проксирует с 443 → 3000
- Фаерволл: открыть только 22 (SSH), 80 (HTTP→HTTPS), 443 (HTTPS)
- Фронтенд раздаётся статически через Express (папка `frontend/`)
- Socket.IO хендлит до тысячи одновременных подключений на 1 vCPU
- AI боты считаются на клиенте — сервер не нагружают
