# Quoridor — Stack и раздача фронтенда (аудит для редизайна)

Дата аудита: 2026-10-15. Источник: только исходный код репозитория (без запуска приложения).
Прод: https://playquor.org. Репозиторий: github.com/govnoboss/Quoridor.

---

## 1. Общий облик

- **Backend**: Node.js, CommonJS (`"type": "commonjs"`), единственный процесс `src/server.js` (4468 строк).
- **HTTP**: Express `^5.2.1`; **Realtime**: Socket.IO `^4.8.1`.
- **БД**: MongoDB (mongoose `^8`); **сессии/лобби/presence**: Redis (`redis ^5`, `connect-redis ^9`), с in-memory фолбэком.
- **Прочее**: helmet 8, express-rate-limit 8, express-session 1, @sentry/node 10, geoip-lite 2, sharp 0.35 (аватары), multer 2 (upload), resend 6 (email), google-auth-library 11 (Google Sign-In), morgan, dotenv.
- **Frontend**: **чистый vanilla JS, без сборщика и без фреймворка**. Множество глобальных объектов (`UI`, `Net`, `Game`, `AI`, `BoardRenderer`, `EvalShared`, `GameUndo`, …), подключаемых обычными `<script src>` в нужном порядке.
  - Chart.js 4 — из CDN (`cdn.jsdelivr.net`) — используется для графика рейтинга в профиле.
  - Socket.IO client — с собственного сервера (`/socket.io/socket.io.js`).
- **Мобильная обёртка**: Capacitor 8 (`@capacitor/android`) — сборка Android-приложения из того же веб-фронтенда. Присутствует `capacitor.config.json` и скрипт `assets` (`capacitor-assets generate --android`).
- **Монорепо движка**: правила и ИИ вынесены в пакет `quoridor-engine` (нелейерный модуль); в браузер отдаются через серверные роуты (см. §6).

> Примечание: в `frontend/css/style.css` есть «кракозябры» в комментариях (существующее состояние, не относится к теме аудита).

---

## 2. Запуск, скрипты, тесты

`package.json` → `scripts`:

| Скрипт | Команда | Назначение |
|---|---|---|
| `start` | `node src/server.js` | Прод-запуск сервера |
| `dev` | `nodemon src/server.js` | Dev с автоперезагрузкой |
| `test` | `jest --watch` | Тесты в watch-режиме |
| `test:once` | `jest` | Однократный прогон тестов |
| `test:ai` | `node tests/ai-core.test.js` | Отдельный тест ИИ-ядра |
| `load-test` | `node tests/load-test.js` | Нагрузочный тест |
| `lint` | `eslint src/ frontend/js/ scripts/ tests/` | Линт |
| `audit` | `npm audit --audit-level=high` | Аудит зависимостей |
| `coverage` | `jest --coverage` | Покрытие |
| `assets` | `capacitor-assets generate --android` | Генерация ассетов Android |

**Тест-инфраструктура** (`jest.config.js`):
- `testEnvironment: 'node'`, `roots: ['<rootDir>']`, `testMatch: ['**/tests/**/*.test.js']`, `testTimeout: 60000`.
- `transformIgnorePatterns` исключает `quoridor-engine` (перф: perft — миллионы узлов; через babel медленнее ~10×).
- Тестовые зависимости: `jest ^30`, `mongodb-memory-server ^11` (in-memory Mongo), `supertest ^7` (HTTP), `socket.io-client ^4` (WS).

Файлы тестов (`tests/`):
`ai-core.test.js`, `analytics.test.js`, `auth-google.test.js`, `bot-matchmaking.test.js`, `game-logic.test.js`, `game-undo.test.js`, `helpers.js` (хелперы, не тест), `load-test.js` (не `*.test.js`, не в jest), `lobby-access.test.js`, `server-api.test.js`, `server-ws.test.js`, `zobrist.test.js`.

---

## 3. Точки входа HTML (20 файлов, `frontend/`)

### 3.1 SPA (`index.html`, 966 строк)
Единственная точка входа основного приложения. Внутри — **все экраны и модалки** как `<div class="screen">` / модальные оверлеи; переключение через `UI.showScreen(id)` (снимает `.active` со всех `.screen`, добавляет нужному).

Экраны (`id`), в порядке в DOM:
- `mainMenu` — главное меню (баннеры, демо-доска, кнопки, динамическая панель, инфо-панель онлайн/лидерборд, соц-бар).
- `modeScreen` — выбор режима (PvP / бот по сложности).
- `profileScreen` — профиль игрока (шапка, статистика, график рейтинга, табы History/Friends, запросы в друзья).
- `roomScreen` — «игра с другом» (создание/вход по коду). Дублирует функционал динамической панели.
- `gameScreen` — игровой экран (доска, шкала оценки, плашки игроков, стены, сайдбар истории, управление бот-партией, мобильный бар).
- `settingsScreen` — настройки (тема/язык/звук).

Модалки/оверлеи: `resultModal`, `disconnectModal`, `confirmModal`, `restartModal`, `notifDropdown`, `dynamicPanel`, `searchOverlay`, `emojiPicker`, `#notificationContainer` (тосты), `#loadingScreen`.

### 3.2 Отдельные статические страницы (с собственными inline-скриптами)

| Файл | Строк | Назначение | Глобальные инлайн-скрипты |
|---|---|---|---|
| `login.html` | 255 | Вход (пароль + Google) | `getLang/setLanguage/applyLang/togglePassword/…/submitLogin/onGoogleCredential/initGoogleSignIn` |
| `register.html` | 328 | Регистрация (+ Google) | аналогично + `updateSubmitBtn/liveValidateReg` |
| `forgot-password.html` | 176 | Запрос сброса пароля | `submitForgot` |
| `reset-password.html` | 221 | Сброс пароля | `submitReset` |
| `rules.html` | 222 | Правила (EN+RU блоки, JSON-LD HowTo) | `getLang/setLanguage` |
| `faq.html` | 270 | FAQ (EN+RU, JSON-LD FAQPage) | `getLang/setLanguage` |
| `terms.html` | 184 | Terms (EN+RU `.lang-block`) | `getLang/setLanguage` |
| `privacy.html` | 274 | Privacy (EN+RU `.lang-block`) | `getLang/setLanguage` |
| `leaderboard.html` | 297 | Таблица рейтинга | `loadLeaderboard/pluralGames/escapeHtml/…` |
| `report.html` | 304 | Форма «report a bug» | `collectDeviceInfo/checkSession/…` |
| `reports.html` | 359 | «Мои отчёты» | `loadReports/showList/showDetail/sendReply` |
| `replay.html` | 141 | Плеер реплея | (логика в `/js/replay.js`) |
| `admin.html` | 167 | Дашборд администратора | `loadDashboard` |
| `admin-users.html` | 445 | Управление пользователями | `loadUsers/renderUsers/banUser/toggleRole/setRating/deleteUser/…` |
| `admin-user-reports.html` | 236 | Жалобы на пользователей | `loadReports/render/showDetail/setReportStatus` |
| `admin-reports.html` | 431 | Жалобы/баг-репорты | `loadReports/render/updateStatus/showDetail/renderMessages/sendReply` |
| `admin-logs.html` | 153 | Логи действий админов | `loadLogs/renderLogs` |
| `admin-metrics.html` | 144 | Метрики/аналитика | `loadMetrics/renderByName/renderDaily` |
| `admin-bots.html` | 405 | Настройки ботов | `loadPanel/saveSettings/seedBots/recalcRatings/renameBot/…` |

> Все admin-страницы содержат **инлайн-скрипты** (без внешних JS-файлов) и обращаются к `/api/admin/*`.

---

## 4. Маршрутизация

### 4.1 Серверные маршруты, отдающие HTML
- Статика: `app.use(express.static(frontend))` — все файлы из `frontend/` доступны напрямую.
- Явные роуты (`res.sendFile`): `/login`, `/register`, `/forgot-password`, `/reset-password`, `/terms`, `/privacy`, `/report`, `/profile/reports`, `/rules`, `/faq`, `/replay/:id`, `/leaderboard`, `/admin`, `/admin/users`, `/admin/user-reports`, `/admin/reports`, `/admin/logs`, `/admin/metrics`, `/admin/bots`.
  - Роуты `/admin/*` защищены `requireAdmin` (401/403 для не-админов).
- SPA-роуты (отдают `index.html`): `/profiles/:username`, `/lobby/:lobbyCode` (с валидацией формата lobby-кода, иначе redirect на `/`), а также catch-all `app.get('/{*path}')` → `index.html` (Express 5 wildcard).
- Редиректы: `/how-to-play` → 301 `/rules`; `/play` → 301 `/` (с сохранением query).

### 4.2 Клиентская маршрутизация SPA
- Основная навигация — переключение экранов без смены URL (`UI.showScreen`).
- Пуш состояния (history API) только для: `/profiles/:username` (`UI.showProfilePage`), `/lobby/:code` (комнаты и вход в онлайн) и replay-параметра. Есть `initRouting` / обработчик `popstate`.
- Переходы между SPA-экранами и отдельными страницами — обычные `window.location.href` (напр. `/rules`, `/login`, `/replay/:id`).

### 4.3 Что «страница», а что «состояние»
- **Отдельные HTML-страницы**: все из §3.2.
- **Состояния одной SPA-страницы** (`index.html`): меню, выбор режима, комната, профиль, игровой экран, настройки + все модалки.

---

## 5. Кэш-бастинг `?v=` — есть, но **версии рассинхронизированы**

Механизм: ручной номер версии в query (`?v=x.y.z`) на `<link>`/`<script>`; сервер отдаёт файлы с обычным `express.static` (без content-hash/immutable, кроме `/avatars`).

Фактические версии по страницам:

| Ресурс | index.html | Прочие страницы | Комментарий |
|---|---|---|---|
| `css/style.css` | `1.0.22` | `1.0.17` | **рассинхрон** |
| `css/auth.css` | `1.0.5` | `1.0.4` (login/register/forgot/reset/leaderboard) | **рассинхрон** |
| `css/profile.css` | `1.0.6` | `1.0.4` (leaderboard) | **рассинхрон** |
| `css/auth-pages.css` | — | `1.0.5` | |
| `css/replay.css` | — | `1.0.6` (replay) | |
| `js/analytics.js` | `1.1.0` | `1.1.0` | синхронно |
| `js/ui.js` | `1.0.22` | — | |
| `js/net.js` | `1.0.8` | — | |
| `shared.js` | `1.0.4` | `1.0.4` (replay) | |
| `js/eval-shared.js` | `1.0.0` | — | |
| `js/game-undo.js` | `1.0.0` | — | |
| `js/ai.js` | `1.0.9` | — | воркер грузится как `ai-worker.js?v=1.2.2` |
| `js/ai-v1.js` | `1.3.2` | — | серверный bundle (см. §6) |
| `js/board-renderer.js` | `1.0.5` | `1.0.5` (replay) | |
| `js/game.js` | `1.0.12` | — | |
| `js/mp4-muxer.js` | — | `1.0.4` (replay) | |
| `js/replay.js` | — | `1.0.5` (replay) | |

Вывод для редизайна: механизм ручной и легко расходится между SPA и статическими страницами. Стоит унифицировать (например, единый build-hash или динамическая подстановка версии).

---

## 6. Специальные серверные роуты статики

| URL | Источник | Примечание |
|---|---|---|
| `/shared.js` | `quoridor-engine/rules/...` (`RULES_FILE`) | канонические правила для браузера и Node |
| `/js/ai-v1.js` | генерируется на сервере (`buildAiV1Bundle()`, `src/core/ai-v1-bundle.js`) | bundle движка v3; URL исторический; `Cache-Control: public, max-age=3600` |
| `/js/ai-core.js` | `src/core/ai-core.js` | старый роут (backup) |
| `/js/mp4-muxer.js` | `node_modules/mp4-muxer/build/mp4-muxer.js` | для экспорта реплея в видео |
| `/avatars/*` | `AVATARS_DIR` | `max-age=365d, immutable`, есть фолбэк-заглушка |
| `/socket.io/socket.io.js` | Socket.IO | клиент |

Внешние CDN: `cdn.jsdelivr.net` (chart.js), `analytics.playquor.org` (umami), `accounts.google.com`/`gsi.gstatic.com` (Google Tap), `fonts.googleapis.com`/`fonts.gstatic.com` (Manrope). Всё это разрешено в CSP (`helmet`).

---

## 7. i18n

- **Движок**: словари `translations.ru` / `translations.en` внутри `frontend/js/ui.js` (`translations:` начинается на строке 9; `ru` — стр. 10, `en` — стр. 319, конец словаря — ~стр. 629).
- **Размер**: **306 ключей в каждом языке**, наборы ключей совпадают 1:1 (нет ключей только в одном языке).
- **Формат ключей**: `snake_case` (`menu_rules`, `btn_save`, `pp_th_opponent`, …).
- **Применение**: `translate(key)` → `this.translations[this.currentLang][key] || key` (при отсутствии ключа возвращается **сам ключ**). Разметка помечается `data-i18n="key"`; `setLanguage(lang)` обходит `[data-i18n]` (для `INPUT` пишет в `placeholder`, иначе в `innerHTML`), ставит `documentElement.lang`, синхронизирует `#headerLang`, вызывает `Game.refreshBotControls()`.
- **Хранение**: `localStorage['quoridor-lang']`; **дефолт — `'en'`** (`localStorage.getItem('quoridor-lang') || 'en'`).
- **Учёт языка в HTML**: 170 использований `data-i18n`. Найдены **отсутствующие ключи**: `pp_rating` (в `index.html`, значение подставляется JS-ом), `privacy_page_title`, `tos_page_title`, `btn_back_to_home` (в `privacy.html`/`terms.html` — обслуживаются собственным inline-скриптом).
- **Статические страницы** (login/register/forgot/reset/rules/faq/terms/privacy/leaderboard/report/reports) имеют **собственный** inline `getLang()`/`setLanguage()` и двуязычные блоки `.lang-block` (`content-en` / `content-ru`): переключается видимость блока, язык читается из того же `localStorage['quoridor-lang']`. То есть i18n реализован **дважды и по-разному** (SPA — через словарь+`data-i18n`; статика — через параллельные языковые блоки в разметке).

Языки: **en** и **ru**.

---

## 8. Иконки

- Иконочного шрифта/sprite нет. Всё — **инлайновые SVG** прямо в разметке (кнопки меню, соц-сети, шапка, игровые кнопки, eval-переключатель).
- Часть иконок — **эмодзи** (`👥` Онлайн, `🏆` Лидерборд, `🙂` реакции, `📸` загрузка аватара, `✏️` редактирование био).
- Аватары — внешний сервис `https://ui-avatars.com/api/?name=...` (фолбэк) или загруженные пользователем из `/avatars/`.

---

## 9. Шрифты

- `index.html` подключает **Manrope** (Google Fonts, `wght@400;500;600;700;800`, `display=swap`).
- `style.css:205` — `body { font-family: 'Manrope', Inter, Arial, sans-serif; }` (Inter в списке, но не подключается).
- Статические страницы Manrope **не подключают** → на них фактически `Arial, sans-serif` (или `replay.css:13` body).
- Моноширинный: `'Courier New'` (бейдж версии `header-version`, игровые поля).
- Итог: единого типографического подключения нет; SPA на Manrope, статика — на Arial.

---

## 10. Пакетирование и деплой

- **Dockerfile** (multi-stage): `node:20-alpine` build → prod-образ, `tini` как init, `USER node`, `AVATARS_DIR=/app/avatars`, `CMD node src/server.js`, порт 3000.
- **docker-compose.dev.yml**: сервисы `mongodb` (mongo:7), `redis` (redis:7-alpine), `app` (сборка из Dockerfile, порт 3000, env-дефолты, healthcheck-зависимости). Секреты по умолчанию dev (`SESSION_SECRET=dev_secret_12345`).
- **docker-compose.yml**: прод-вариант.
- **deploy.sh**: скрипт деплоя (в репозитории).
- Переменные окружения (`.env.example`): `MONGO_URI`, `REDIS_URL`, `SESSION_SECRET`, `PORT`, `NODE_ENV`, `ALLOWED_ORIGINS`, `SENTRY_DSN`, `SOCKET_ADMIN_*`, блок `BOTS_*`, `RESEND_API_KEY`/`EMAIL_FROM`/`SITE_URL`, `GOOGLE_CLIENT_ID`, `AVATARS_DIR`.

---

## 11. Что НЕ удалось собрать (по этому документу)

- **Реальные значения CSS (computed styles) и скриншоты** — снятие требует запущенного приложения; по решению заказчика работаем «только код, без запуска». См. `tokens.md` §6 и `screens/README.md`.
- **Фактический HTTP-ответ сервера** (заголовки, коды, время) — не запускали сервер.
- **Прод-версии файлов** (`?v=` на https://playquor.org) могут отличаться от кода в рабочей копии.
