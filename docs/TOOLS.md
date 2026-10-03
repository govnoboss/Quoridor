# Developer Tools & Configuration

Список инструментов, установленных для упрощения разработки.

---

## 1. nodemon — авторестарт сервера

Автоматически перезапускает сервер при изменении файлов.

```bash
npm run dev
```

Конфигурация: `package.json` — скрипт `dev`.

---

## 2. morgan — HTTP логи

Логирует каждый HTTP-запрос в консоль:
```
POST /api/auth/login 200 45ms
GET /api/leaderboard 304 2ms
```

Подключён в `src/server.js` как `app.use(morgan('dev'))` (кроме режима `NODE_ENV === 'test'`).

---

## 3. debug — структурированное логирование

Замена `console.log` с namespace-ами. Позволяет фильтровать логи.

### Namespace:

| Namespace | Назначение |
|-----------|-----------|
| `quoridor:server` | Запуск, конфигурация |
| `quoridor:redis` | Redis подключения |
| `quoridor:game` | Игровая логика |
| `quoridor:ai` | AI движок |
| `quoridor:db` | MongoDB запросы |
| `quoridor:auth` | Аутентификация |
| `quoridor:matchmaking` | Поиск игры, очереди |
| `quoridor:error` | Ошибки |

### Использование в коде:

```js
const log = require('./utils/logger');
log.server('Server started on port %d', port);
log.game('Game %s: player %s moved', lobbyId, username);
```

### Включение:

```bash
# Все логи проекта
DEBUG=quoridor:* npm run dev

# Только сервер + Redis
DEBUG=quoridor:server,quoridor:redis npm run dev

# Только игра + AI
DEBUG=quoridor:game,quoridor:ai npm start

# Всё, включая логи socket.io и express
DEBUG=quoridor:*,socket.io:*,express:* npm run dev
```

Файл: `src/utils/logger.js`

---

## 4. Sentry — отслеживание ошибок

Ловит необработанные исключения, unhandled rejections, ошибки в production.

### Настройка:

1. Зарегистрироваться на https://sentry.io
2. Создать проект Node.js
3. Скопировать DSN
4. Добавить в `.env`:
```env
SENTRY_DSN=https://xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx@xxxxx.ingest.de.sentry.io/xxxxxx
```

Без DSN Sentry не активен (проверка `enabled: !!process.env.SENTRY_DSN`).

Подключён в `src/server.js`:
- `Sentry.init()` в начале
- `Sentry.Handlers.requestHandler()` как middleware
- `Sentry.Handlers.errorHandler()` после всех маршрутов

Уровень трассировки: 50% в production, 0% в development.

---

## 5. Socket.IO Admin UI — дашборд вебсокетов

Визуальный интерфейс для мониторинга Socket.IO: активные подключения, комнаты, события.

### Настройка:

В `.env`:
```env
SOCKET_ADMIN_USERNAME=admin
SOCKET_ADMIN_PASSWORD=your_secure_password
```

Без этих переменных Admin UI не активируется.

### Использование:

1. Запустить сервер
2. Открыть https://admin.socket.io
3. Ввести URL сервера: `http://localhost:3000`
4. Ввести логин/пароль из `.env`

Подключён в `src/server.js` после создания `io`.

---

## 6. Jest — тест-раннер

Замена ручным тестовым скриптам.

```bash
# Запустить тесты в watch режиме (для разработки)
npm test

# Однократный прогон (для CI)
npm run test:once

# С coverage отчётом
npm run coverage
```

### Конфигурация: `jest.config.js`

```js
module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.js'],
    verbose: true,
    testTimeout: 60000,
};
```

## 8. Self-play ботов сайта — `quoridor-engine/tools/site-selfplay.js`

Играет ботов сайта друг против друга ровно тем способом, которым их запускает прод: глубина берётся из
`difficultyToMaxDepth()` (`src/core/ai-v1-bundle.js`), случайность отключена. Отличие от арены — нет
SPRT и ранней остановки, движок создаётся заново на каждое кресло в каждой партии, цвета чередуются.

```bash
# зеркало одного уровня: 1000 партий, без ранней остановки
node quoridor-engine/tools/site-selfplay.js --games 1000

# конкретная пара уровней
node quoridor-engine/tools/site-selfplay.js --a easy --b hard --games 200

# полный замер: зеркало на каждом уровне + лестница соседних
node quoridor-engine/tools/site-selfplay.js --tiers --games 1000 --threads 8
```

Отчёт содержит долю побед P0/P1, смещение цвета, число повторов, нелегальных ходов, падений и
распределение длин партий. Падает (exit code 1) при нелегальном ходе, падении движка, повторе позиции
или средней длине вне 60-90 полуходов. Лестница уровней проверяется через 2 сигмы: значимая инверсия
(глубокий уровень проигрывает) — падение, неразличимые уровни — предупреждение.

### Тестовые файлы (все запускаются без внешних сервисов):

- `tests/server-ws.test.js` — Socket.IO интеграция (матчмейкинг, комнаты, ходы, реванши)
- `tests/server-api.test.js` — HTTP API интеграция (auth, профиль, аватары, админ; Mongo через `mongodb-memory-server`)
- `tests/lobby-access.test.js` — права доступа к лобби/комнатам
- `tests/game-logic.test.js` — игровая логика `shared.js`
- `tests/zobrist.test.js` — Zobrist hashing
- `tests/ai-core.test.js` — AI движок v0 (jest, а также `npm run test:ai` для одиночного прогона)
- `quoridor-engine/tests/site-v1.test.js` — бандл движка v1 для браузера и антиповтор
- `tests/load-test.js` — нагрузочное тестирование (`npm run load-test`, не jest)

Redis в тестах мокается через `__mocks__/redis.js`.

---

## 7. ESLint — проверка кода

```bash
npm run lint
```

### Конфигурация: `eslint.config.js`

Правила:
- `no-unused-vars`: warn (кроме аргументов с `_`)
- `no-undef`: error
- `no-console`: off (разрешён)

Поддерживает как Node.js (`src/`), так и browser (`frontend/js/`) окружения.

---

## Быстрый старт разработки

```bash
# Установка
npm install

# Запуск с авторестартом
npm run dev

# Логи только игры и AI
DEBUG=quoridor:game,quoridor:ai npm run dev

# Логи всего и вся
DEBUG=quoridor:*,socket.io:* npm run dev

# Тесты
npm test

# Проверка кода
npm run lint
```
