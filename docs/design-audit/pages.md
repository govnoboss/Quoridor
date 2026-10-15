# Quoridor — Страницы и экраны (аудит для редизайна)

Дата аудита: 2026-10-15. Источник: код (`frontend/*.html`, `frontend/js/*.js`, `src/server.js`), без запуска.
Примеры ответов API — **вымышленные** (по схемам моделей), для иллюстрации формы данных.

Общие замечания:
- Аналитика идёт через `window.trackEvent(name, props)` (`analytics.js`), который складывает события в очередь → `POST /api/analytics/events` и, если загружен скрипт umami (`https://analytics.playquor.org/script.js`), дополнительно вызывает `umami.track(...)`. Скрипт umami подключён на `index.html`, `faq.html`, `leaderboard.html`, `login.html`, `register.html`, `rules.html`; `analytics.js` — также на `admin-metrics.html`.
- Ниже для каждой страницы перечислены события, которые на ней реально срабатывают.
- SEO: у большинства статических страниц **некорректные/скопированные** `<title>`/`<meta description>` (см. таблицы). JSON-LD есть только у `index.html`, `rules.html`, `faq.html`.
- `<html lang>`: `index/faq/…` = `en`, но у `login/register/privacy/terms/leaderboard/admin-bots` = `ru` (несогласованно).

---

## 1. SPA — маршрут `/` (`frontend/index.html`, 966 строк)

Точка входа основного приложения. Все «экраны» — `<div class="screen">`, переключаются `UI.showScreen(id)`.

### 1.1 Экран `mainMenu` (главное меню)
- **DOM/компоненты**: промо-баннеры (`.play-banner`: Google Play, Discord), `.menu-layout` → `.board-preview` (демо-доска `#demoBoard`) + `.menu-panel` (кнопки) + `.dynamic-panel` + `.info-panel`; `.footer-stats` (онлайн/в матче); `.social-bar`.
- **Кнопки меню**: «Играть онлайн» (`#playOnlineBtn`), «Играть с другом» (`#playFriendBtn`), «Локальная игра», «Настройки», «Правила» (`/rules`).
- **Динамическая панель** (`#dynamicPanel`, `UI.showDynamicPanel`): подпанели `#panelPlayOnline` (Ranked/Normal), `#panelRoom` (создать/войти по коду), `#panelMode` (PvP / бот easy/medium/hard/impossible), `#panelColorSelect` (белые/чёрные), `#panelHowToPlay`, `#panelSettings`.
- **Инфо-панель** (`#infoPanel`): «Онлайн» (`#onlinePlayersList`), «Лидерборд» (`#leaderboard`, топ-10 через `GET /api/leaderboard?limit=10`).
- **JS**: `UI.showPlayOnlinePanel`, `UI.onPlayFriendClick`, `UI.onPlayLocalClick`, `UI.createPrivateRoom`, `UI.joinPrivateRoom`, `UI.quickMatch`, `UI.onRankedClick`, `UI.selectBotDifficulty`, `UI.showSearch`, `UI.updateOnlineStats`, `UI.renderPresenceLists`.
- **API**: `GET /api/leaderboard?limit=10`; `GET /api/game/active` (на старте — есть ли незавершённая партия); Socket.IO (`onlineStats`).
  ```json
  // GET /api/leaderboard?limit=10
  [{"_id":"6510a1…","username":"alice","rating":1584,"avatarUrl":"https://ui-avatars.com/api/?name=alice&background=333&color=fff","stats":{"totalGames":42}}]
  ```
- **Состояния**: гость (в шапке Sign In/Sign Up, кнопка лидерборда активна); залогинен (аватар/ник в шапке, колокольчик уведомлений); поиск игры (`.search-overlay` + `#cancelSearchBtn` с таймером); пустой лидерборд/онлайн (`.presence-empty`, `.leaderboard-row.loading`).
- **Аналитика**: `session-start`; `play-online-click`, `play-friend-click`, `play-local-click`, `search-started` (`{mode:'ranked'|'normal'}`), `room-created`, `room-joined`, `search-cancelled`.
- **Meta/JSON-LD**: `<title>Quoridor — Play Online Strategy Board Game | Free Multiplayer</title>`; description + 6 OG-тегов; Twitter card; canonical `https://playquor.org`; **JSON-LD `WebApplication`** (+ `Offer` + `Organization`): name «Quoridor», alternateName «Коридор», category Game, inLanguage `[ru,en]`, установка из Google Play.

### 1.2 Экран `modeScreen` (выбор режима)
- **DOM**: `.mode-buttons` (PvP, бот по сложности), кнопка «Назад».
- **JS**: `Game.startPvP`, `UI.selectBotDifficulty`.
- **Аналитика**: `play-bot-click` (`{difficulty}`) — при выборе сложности.

### 1.3 Экран `profileScreen` (профиль игрока)
- **Маршрут**: `/profiles/:username` (pushState, `UI.showProfilePage`); также открывается из меню/шапки.
- **DOM**: `.profile-page-header` (аватар/ник/флаг/био/дата регистрации), `.pp-stats-overview` (Games, W/L, Winrate, Rating), сворачиваемый `.pp-rating-chart-section` (Chart.js), табы `.pp-tabs` (History/Friends), `.pp-history-table`, блок друзей/запросов, ссылка «My Reports».
- **Render-функции (JS)**: загрузка профиля, график (Chart.js), `renderHistory` (таблица истории), рендер друзей/запросов, редактирование био (`startEditBio/saveBio`), загрузка аватара (`avatarFileInput` → `POST /api/user/upload-avatar`).
- **API**:
  - `GET /api/profiles/:username` → `{..., rating, bio, country, stats, achievements, createdAt, friendshipStatus: 'self'|'friends'|'requested'|'received'|'none'|null}`
  - `GET /api/profiles/:username/games?limit&page` → `{games,total,page,limit}`
  - `GET /api/profiles/:username/rating-history` → `[{date, ratingAfter}]`
  - `GET /api/friends/list` (для своего профиля) → `{friends,incoming,outgoing}`
  - `POST /api/user/upload-avatar`, `PATCH /api/user/profile` (био), `DELETE /api/friends/remove/:userId`, `POST /api/friends/request|accept|decline`
  ```json
  // GET /api/profiles/alice
  {"_id":"6510…","username":"alice","rating":1584,"bio":"","country":"US","stats":{"totalGames":42,"wins":25,"losses":17,"playTimeSeconds":5400},"achievements":[],"createdAt":"2026-01-02T10:00:00.000Z","friendshipStatus":"none"}
  ```
- **Состояния**: загрузка (`.pp-skeleton`); гость (без кнопок действий — `friendshipStatus:null`); залогинен; чужой профиль (Add Friend / Report); свой профиль (Edit Profile, загрузка аватара, био); пустая история; нет ranked-игр (`.pp-chart-empty`); пустые друзья (`#ppFriendsEmpty`).
- **Аналитика**: нет собственных событий (кроме общих).

### 1.4 Экран `roomScreen` (игра с другом)
- Дублирует `#panelRoom` (создание комнаты/вход по коду). Создание — `createRoomBtn`; вход — `#roomCodeInputOld`.
- **API/Socket**: `createRoom`/`joinRoom` (Socket.IO); код комнаты показывается в `#roomCodeValue`.
- **Аналитика**: `room-created`, `room-joined`.

### 1.5 Экран `gameScreen` (игра)
- **DOM**: `.board-group` (шкала оценки `#evalBarRoom`… вертикальная `.eval-bar` и мобильная `.eval-bar-h`, плашки `#topPlayerBar`/`#bottomPlayerBar` с таймерами, ряды стен `#topWallInventory`/`#bottomWallInventory`, доска `#board`), `.sidebar` (история ходов `#moveHistory`/`#historyList`/`.history-controls`, бот-панель `#sidebarControls` с Undo/Restart/Menu + карточкой Evaluation, кнопка сдачи `#surrenderBtn`), мобильный бар `#mobileBotBar`.
- **JS (game.js, 2971 стр.)**: `Game.startPvP/startVsBot/startOnline`, `reset`, `navigateHistory`, `setHistoryView`, `goToMainMenu`, `startNewGame`, обработка Undo (`game-undo.js`), Restart, eval-bar (`game-eval-worker.js`).
- **Состояния**: партия PvP (локально); партия с ботом (Undo/Restart/eval-bar); онлайн-партия (таймеры с сервера, реакции); конец партии (`#resultModal`); дисконнект (`#disconnectModal`); рестарт-подтверждение (`#restartModal`).
- **Аналитика**: `game-started` (`{mode}`, `{mode:'local'}`, `{mode:'bot',difficulty}`), `game-finished` (`{result:'win'|'loss', reason, mode}`), `surrender-click`.
- **API/Socket**: `playerMove`, `surrender`, `leaveGame`, `requestTimerSync`, `sendReaction`, `requestRematch`/`respondRematch`, `rejoinGame` (Socket.IO). Результат → `GET /api/games/:id` при открытии реплея.

### 1.6 Экран `settingsScreen` (настройки)
- **DOM**: `.settings-grid` с `#themeSelect` (только «Тёмная»), `#langSelect` (ru/en), `#soundSelect` (on/off), кнопки Save/Back.
- Дублирует `#panelSettings` (инлайн-панель в меню).
- **Состояния**: тема фактически одна (dark); язык/звук сохраняются в localStorage.

### 1.7 Общие модалки SPA
- `#resultModal` (победа/поражение, причина, изменение рейтинга, кнопки New Game/Rematch/Game Analysis/Back to Lobby/Sign Up, Discord CTA).
- `#disconnectModal`, `#confirmModal` (общий `UI.showConfirm`), `#restartModal`, `#notifDropdown`, `#notificationContainer` (тосты), `#loadingScreen`.

---

## 2. Авторизация

### 2.1 `/login` (`login.html`, 255 строк)
- **DOM/JS**: `.auth-form-wrapper` → `.auth-form` с полями username/password (`.password-wrapper` + `.password-toggle`), Google-button (GIS), inline `submitLogin/onGoogleCredential/initGoogleSignIn/liveValidateField`.
- **API**: `GET /api/auth/config` (есть ли `googleClientId`), `POST /api/auth/login`, `POST /api/auth/google`.
  ```json
  // POST /api/auth/login (ok)
  {"message":"Logged in","user":{"username":"alice","id":"6510…"}}
  // 403 banned
  {"error":"Account banned until 2026-11-01T00:00:00.000Z","code":"ACCOUNT_BANNED","reason":"Cheating","expires":"2026-11-01T00:00:00.000Z"}
  ```
- **Состояния**: пустая форма; ошибки полей (`.field-error.visible`, `.input-error`); ошибка/успех (`.auth-error`/`.auth-success`); Google-кнопка присутствует/нет; бан.
- **Аналитика**: `session-start`.
- **Meta**: `<title>Sign In - PlayQuor</title>`; `<meta description>` = **описание лидерборда** (копипаст!); OG нет; JSON-LD нет; `lang=ru`.
- Загрузка: `analytics.js`, umami, GIS.

### 2.2 `/register` (`register.html`, 328 строк)
- Поля username/email/password + Google; `updateSubmitBtn/liveValidateReg/submitRegister`; `POST /api/auth/register`.
  ```json
  // 201
  {"message":"User created","user":{"username":"alice","email":"a@b.com","id":"6510…"}}
  // 400: "Username taken" | "Email already in use" | "Password too short (min 6)"
  ```
- **Состояния**: пусто/ошибки/загрузка; кнопка Submit disabled до валидности.
- **Meta**: `<title>Create account - PlayQuor</title>`; description = **лидерборд** (копипаст); `lang=ru`.
- Аналитика: `session-start`.

### 2.3 `/forgot-password` (`forgot-password.html`, 176 строк)
- `submitForgot` → `POST /api/auth/forgot-password`. Состояния: форма/успех/ошибка.
- **Meta**: `<title>Forgot Password - PlayQuor</title>`; description = **FAQ** (копипаст); `lang=en`.

### 2.4 `/reset-password` (`reset-password.html`, 221 строк)
- `submitReset` (токен из query) → `POST /api/auth/reset-password`. Состояния: валидный/невалидный токен, успех.
- **Meta**: `<title>Reset Password - PlayQuor</title>`; description = **лидерборд** (копипаст); `lang=en`.

---

## 3. Контентные страницы (двуязычные: EN + RU блоки `.lang-block`)

Общий механизм: в разметке два блока `#content-en`/`#content-ru`, переключаются инлайн `setLanguage()` (читает `quoridor-lang`). CSS — `auth-pages.css` (`.content-page`).

### 3.1 `/rules` (`rules.html`, 222 строки)
- **DOM**: `.content-page` (h1 «Quoridor Rules», sections Objective/Board Setup/Moving/Walls/…), `.highlight-box`, `.note`, `.last-updated`, `.cta-section`.
- **JSON-LD**: `HowTo` (+ `HowToStep`).
- **Meta**: `<title>Quoridor Rules - How to Play the Board Game | PlayQuor</title>`; корректный description; 6 OG-тегов; canonical `/rules`.
- Аналитика: `session-start`.
- Полный текст — `text/rules.txt` (EN + RU).

### 3.2 `/faq` (`faq.html`, 270 строк)
- **DOM**: `.content-page`, `.faq-item`/`.faq-question`/`.faq-answer`.
- **JSON-LD**: `FAQPage` (+ `Question`, `Answer`).
- **Meta**: `<title>Quoridor FAQ - Answers to Common Questions | PlayQuor</title>`; корректный description; 6 OG; canonical `/faq`.
- Полный текст — `text/faq.txt`.

### 3.3 `/terms` (`terms.html`, 184 строки)
- **DOM**: `.content-page` с EN/RU блоками.
- **Meta**: `<title>Quoridor Rules - How to Play the Board Game | PlayQuor</title>` (**скопирован из rules!**); description = **rules** (копипаст); OG нет; `lang=ru`.
- Полный текст — `text/terms.txt`.

### 3.4 `/privacy` (`privacy.html`, 274 строки)
- **DOM**: `.content-page` EN/RU.
- **Meta**: `<title>Sign In - PlayQuor</title>` (**скопирован из login!**); description = **leaderboard** (копипаст); `lang=ru`.
- Полный текст — `text/privacy.txt`.

---

## 4. `/leaderboard` (`leaderboard.html`, 297 строк)
- **DOM**: собственная разметка/инлайн-скрипт; таблица игроков; `loadLeaderboard`, `pluralGames`, `escapeHtml`, `applyLang`.
- **API**: `GET /api/leaderboard` (limit ≤ 100).
- **Состояния**: загрузка, пустой список, ошибка, разные языки.
- **Meta**: `<title>Leaderboard - PlayQuor</title>`; корректный description; OG нет; `lang=ru`.
- Аналитика: `session-start`.

---

## 5. Отчёты о багах

### 5.1 `/report` (`report.html`, 304 строки)
- Форма баг-репорта: `checkSession` (`GET /api/auth/me`), `collectDeviceInfo`, submit → `POST /api/reports`.
  ```json
  // POST /api/reports body
  {"subject":"Board glitch","description":"…","deviceInfo":{"userAgent":"…","platform":"web","screenSize":"1920x1080","language":"en"}}
  ```
- **Состояния**: гость (возможно предложение войти), форма, успех, ошибки полей.
- **Meta**: `<title>Report a Bug - PlayQuor</title>`; description = **leaderboard** (копипаст); `lang=en`.

### 5.2 `/profile/reports` (`reports.html`, 359 строк)
- Список «моих» отчётов и переписка: `loadReports` → `GET /api/my/reports`; `showDetail` → `GET /api/reports/:id`; `sendReply` → `POST /api/reports/:id/reply`.
  ```json
  // GET /api/my/reports
  [{"_id":"66f0…","subject":"Board glitch","status":"in_progress","createdAt":"2026-10-01T…","messages":[{"role":"user","text":"…","createdAt":"…"},{"role":"admin","text":"Fixed in next build","createdAt":"…"}]}]
  ```
- **Состояния**: список/детали/пусто/ответ отправлен.
- **Meta**: `<title>My Reports - PlayQuor</title>`; description = **leaderboard** (копипаст); `lang=en`.

---

## 6. `/replay/:id` (`replay.html`, 141 строка)
- **DOM**: контейнер плеера; логика в `/js/replay.js` (1019 строк), рендер доски `board-renderer.js`, экспорт видео `mp4-muxer.js`.
- **API**: `GET /api/games/:id` (полный GameResult с `history`).
  ```json
  {"_id":"66f0…","gameType":"blitz","timeControl":{"base":300,"inc":0},"playerWhite":{"id":"…","username":"alice","isGuest":false,"ratingChange":8},"playerBlack":{"id":"…","username":"bob","isGuest":false,"ratingChange":-8},"lobbyId":"AB12C","isRanked":true,"winner":0,"reason":"goal","turns":41,"history":[{"player":0,"type":"move","…":""}],"date":"2026-10-01T…"}
  ```
- **Состояния**: загрузка, ошибка/нет игры, реплей с eval-панелью (worker `replay-eval-worker.js`).
- **Meta**: `<title>Replay - PlayQuor</title>`; description = **leaderboard** (копипаст); `lang=en`.

---

## 7. Админка (все роуты защищены `requireAdmin`; не-админ получает 401/403)

Все admin-страницы: самодостаточные, со своим `<style>` и inline-скриптом; отдельная палитра (см. `tokens.md` §1.5). Нет `<title>`-мета описание (только title).

### 7.1 `/admin` (`admin.html`, 167 строк) — дашборд
- `loadDashboard` → `GET /api/admin/stats`, `GET /api/admin/user-reports`.
  ```json
  // GET /api/admin/stats
  {"totalUsers":1200,"bannedUsers":7,"totalGames":8450,"newUsersToday":13,"totalBots":40,"pendingReports":5,"onlineNow":22,"recentGames":310,"recentRegistrations":[{"username":"eve","createdAt":"…"}],"topReports":[{"username":"troll","avatarUrl":"…","count":4}]}
  ```
- **Состояния**: загрузка, пусто, ошибка; карточки `.stat-card`.

### 7.2 `/admin/users` (`admin-users.html`, 445 строк)
- `loadUsers` (поиск, пагинация, фильтры banned/admins/bots) → `GET /api/admin/users`; `openUser` → `GET /api/admin/users/:id`; действия: `banUser` (`POST /api/admin/users/:id/ban`), `unbanUser` (`…/unban`), `resetAvatar` (`DELETE …/avatar`), `toggleRole` (`PATCH …/role`), `setRating` (`POST …/rating`), `deleteUser` (`POST …/delete`).
  ```json
  // GET /api/admin/users?page=1
  {"users":[{"_id":"…","username":"alice","email":"a@b.com","avatarUrl":"…","rating":1584,"isAdmin":false,"isBot":false,"banned":false,"banReason":"","banExpires":null,"createdAt":"…","lastSeen":"…","online":true,"stats":{"totalGames":42,"wins":25,"losses":17}}],"total":1200,"page":1,"limit":20}
  ```
- **Состояния**: таблица/поиск/пагинация, модалка пользователя, модалка бана, ошибки.

### 7.3 `/admin/user-reports` (`admin-user-reports.html`, 236 строк)
- `loadReports` → `GET /api/admin/user-reports`; `setReportStatus` → `PATCH /api/admin/user-reports/:id`; `showDetail`.
  ```json
  // GET /api/admin/user-reports (элемент)
  {"_id":"…","reporter":{"username":"alice"},"target":{"username":"troll"},"reason":"harassment","description":"…","status":"new","adminNote":"","createdAt":"…"}
  ```

### 7.4 `/admin/reports` (`admin-reports.html`, 431 строка)
- `loadReports` → `GET /api/admin/reports`; `updateStatus`/`sendReply` → `PATCH /api/admin/reports/:id` (`{status?, reply?}`); `showDetail`/`renderMessages`.
  ```json
  // GET /api/admin/reports (элемент)
  {"_id":"…","subject":"Board glitch","description":"…","status":"new","userId":{"username":"alice","avatarUrl":"…"},"messages":[],"deviceInfo":{…},"createdAt":"…"}
  ```

### 7.5 `/admin/logs` (`admin-logs.html`, 153 строки)
- `loadLogs` → `GET /api/admin/logs` (пагинация).
  ```json
  // GET /api/admin/logs
  {"logs":[{"_id":"…","admin":{"username":"root"},"action":"user_banned","target":"…","targetUsername":"troll","details":{"reason":"Cheating"},"createdAt":"…"}],"total":134,"page":1,"limit":20}
  ```

### 7.6 `/admin/metrics` (`admin-metrics.html`, 144 строки)
- `loadMetrics` → `GET /api/admin/metrics?days=7`; бары по событиям и по дням.
  ```json
  // GET /api/admin/metrics?days=7
  {"days":7,"totalEvents":5120,"activeUsers":180,"byName":[{"name":"session-start","count":900,"users":150},{"name":"game-started","count":420,"users":90}],"daily":[{"date":"2026-10-09","count":700,"users":120}],"generatedAt":"2026-10-15T…"}
  ```
- Аналитика: `session-start`.

### 7.7 `/admin/bots` (`admin-bots.html`, 405 строк)
- `loadPanel` → `GET /api/admin/bots`; `saveSettings` → `PUT /api/admin/bots/settings`; `seedBots` → `POST /api/admin/bots/seed`; `recalcRatings` → `POST /api/admin/bots/recalc`; `renameBot` → `POST /api/admin/bots/rename`.
- **Состояния**: настройки/рантайм/presence-панели, действия.

---

## 8. Прочие серверные редиректы
- `/how-to-play` → 301 `/rules`; `/play` → 301 `/` (с query).
- `/lobby/:code` → `index.html` (валидный код) или redirect `/`.
- Catch-all (`/{*path}`) → `index.html` (SPA fallback). Значит **любой неизвестный GET-URL отдаёт главный SPA-экран**, а не 404.

---

## 9. Что не собрано по страницам
- Реальные состояния «залогинен / админ / партия» визуально не сняты (нужен запуск и учётные данные) — см. `screens/README.md`.
- Фактические ответы API (значения) не проверялись вживую; примеры синтетические.
