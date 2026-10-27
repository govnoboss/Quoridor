# Отчёт · Этап 2 — Редизайн главной страницы (home v2)

Дата: 2026-10-15. Ветка: `redesign/full`.
ТЗ: `tz-02-home.md`. Эталон: `design-reference/html/Main.html` (инлайн-стили = спецификация).

## 1. Что сделано

### Шаг 1 — Разметка (`frontend/index.html`)

- Новый `#mainMenu` «home-layout» := три колонки, gap 48px:
  - **левая 340px**: `.home-tagline` («THINK · BLOCK · WIN»), `.home-title` (h1),
    `.home-lead`, 4 кнопки `.pq-menu-btn` (Play Online с подписью `{n}` в `#menuOnlineSub`,
    Play vs Bot, Play with Friend, Pass & Play), ряд Rules + Settings (44px, radius 10),
    accent-карточка туториала (`.home-new-card` + кнопка Start);
  - **центр 554px**: строка LIVE (`#liveGameText` + кнопка Watch), eval-bar 16×528
    (`.home-eval-fill` 62%, линия по центру), `<canvas id="demoBoard">` 1056×1056
    (retina-удвоение макетных 528, k = width/528);
  - **правая 320px**: карточка Лидерборда (`#leaderboard` — 5 скелетонов `pq-skeleton`,
    `View all` → `/leaderboard`) + строка «You» `#leaderboardYou` (`UI.showMyProfile()`),
    карточка online (`#statsOnlineCount`, `#onlineStatsLabel`, стек `#onlineAvatarStack`),
    карточка Discord (`pq-card--discord` + кнопка Join).
- Шапка прежняя (этап 1), `.footer-stats` и баннеры play/discord удалены.
- Модал-оверлей `#dynamicPanel` (`.pq-overlay`) с окном `.pq-modal` и панелями
  `#panelPlayOnline`, `#panelRoom`, `#panelMode`, `#panelColorSelect`, `#panelHowToPlay`,
  `#panelSettings`, `#searchOverlay` — все прежние `id`, классы и `onclick` сохранены.
- Версии кэша: `style.css?v=1.0.25`, `components.css?v=1.2.0`, `board-renderer.js?v=1.0.6`,
  `ui.js?v=1.0.24`, `game.js?v=1.0.13`.

### Шаг 2 — CSS home v2 (`frontend/css/style.css`)

- Новый блок `/* --- GLOBAL MENU ELEMENTS (home v2) --- */` (~1032…1580): сетка
  `.home-layout`, колонки, типографика (tagline 12/700/0.3em `--text-dim`, h1 34px/1.1/800,
  lead 15px `--text-3`), кнопки-меню (primary 64px `--accent` radius 12, нейтралы 56px
  `--panel`/`--border-ctl`), eval-бар по токенам `--eval-track/--eval-fill/--accent`,
  LIVE-строка (dot `--online-green`, «LIVE» 11/700/0.1em, Watch — outline 44px),
  карточка лидерборда (`.home-lb-card` pad 16, строки 36px, `.home-lb-empty`),
  online-карточка (число 28/800 `--online-green`) со стеком аватаров `.home-av*`,
  discord-карточка, `.home-new-card` accent-заливка + `.home-new-btn` outline 44px.
- Оверлей: `#dynamicPanel` → `position:fixed; inset:0; z-index:10001; background:rgba(0,0,0,.6)`,
  окно 460px/`.dynamic-content` flex+gap 16 (убран `display:block` у `.dynamic-content`),
  закрытие `.pq-modal__close`, поля `.pq-input`/`.pq-select` 44px, спиннер 20px,
  `#searchTimer` без рамок/пульса (font-mono 13px).
- Дочистка старых правил (PS-скриптом, якоря по маркерам комментариев, UTF-8 без BOM):
  вырезаны баннеры Google Play/Discord (2033 симв.), планшетный мобильный блок старой
  главной (3115), nested `.main-title` - правила (742, сохранив `.social-bar` mobile),
  старая info-panel mobile (1639, правила `/* === Game Screen === */` целы),
  tweaks `.main-title`+`#mainMenu{padding-top:50px}` (269), приватные комнаты/поиск/панели
  старые (7071), поздний оверрайд `.dynamic-panel{max-width:400px;padding:30px}` (82).
  Баланс скобок после правок: 479/479.
- Остатки, признанные легитимными (не этапа 2): `max-width:400px` у confirm/disconnect
  модалов; `.separator-line` экрана режимов.
- `#mainMenu` сохранён `padding-top: var(--header-h)` (шапка не скрывается под оверлеем).

### Шаг 3 — `components.css` v1.2.0 (блок 7.2)

- В конец файла дописан блок 7.2 ТЗ: `.pq-overlay`, `.pq-modal` (460px, pad 24, gap 16,
  radius 12) и элементы `__head/__icon/__title/__text/__hint/__actions/__close/__list`,
  поля `.pq-input/.pq-select` (шеврон — inline SVG data-URI, `color-scheme:dark`),
  `.pq-spinner` + `@keyframes pq-spin` + `prefers-reduced-motion`.
- Версия `components.css?v=1.2.0` во всех 13 HTML.

### Шаг 4 — Клиентский JS (`ui.js`, `game.js`, `board-renderer.js`)

- **`board-renderer.js`** переписан параметрически: helper `fillRectRound`
  (roundRect + fallback на fillRect), opts `padding`, `cellVisual`, `cellRadius`,
  `cellFill` (равномерно) / `cellFillEven|Odd` (шахматно, дефолт старой темы
  `#1D1F22`/`#191B1E`), `coordInsetLeft/Top/Right/Bottom`, `coordColor`,
  `wallColor/wallRadius`, `pawnRadius` (дефолт cellSize·0.35, как раньше),
  `pawnStrokeWidth` (дефолт 3). Дефолты = старой теме, поэтому игровой экран и реплей
  (не передающие opts) рисуются без изменений. `transformRow`/`transformWallRow`
  сохранены.
- **`game.js` — DemoBoard**: новый `applyDemoTheme()` — `k = canvas.width / 528`
  (1056 → k=2), `cellSize = 59·k`; тема из CSS-переменных
  `getComputedStyle(document.documentElement)`: `--cell`, `--text-faint`, `--accent`,
  `--pawn-white/black(+border)`, `--font-sans`. Отрисовка §4.1: клетка 56·k c
  radius 4·k, зазор 3·k (9·56+8·3=528·k), координаты font 10·k `--text-faint`
  (сдвиги left 4·k / top 3·k / right 5·k / bottom 3·k), стены thick 5·k / gap 1.5·k /
  radius 2·k / акцент, пешки radius 20·k, stroke 2·k.
- **`game.js`**: в `gameOver` добавлен хук `UI.refreshLeaderboardYou()` (мод ≠ local/bot).
- **`ui.js`**:
  - i18n: поровну en/ru (335=335), новые ключи этапа 2 (en — из макета, ru — по §6);
    `online_label: "online · {n} in game"` — единый ключ;
  - `updateOnlineStats` сохраняет `lastOnlineStats`;
  - `refreshDynamicTexts()` — подстановка `{n}` в `#onlineStatsLabel` и `#menuOnlineSub`;
    вызывается из `setLanguage` **до** обращений к `Game` и обёрнут try/catch
    (TDZ `typeof Game` рвал `setLanguage`, если game.js не загрузился);
  - `renderPresenceLists` → стек аватаров `.home-av home-av--1/2/3` +
    `.home-av--plus` «+N» (N = online − 3), `title` = ник, null-safe;
  - `showDynamicPanel(id, autoCreate)` — фокус-менеджмент (запомнить вызвавший
    элемент, сфокусировать первый); `hideDynamicPanel()` — возврат фокуса;
    `updateHeaderVisibility` упрощён: открытая панель больше **не** скрывает шапку;
  - `showSearch`/`hideSearch` переписаны через `showDynamicPanel('searchOverlay', false)`;
    шапка и кнопки меню не манипулируются;
  - `saveSettingsInline` — null-safe `themeSelectInline` (селект темы вырезан из разметки);
  - `loadLeaderboard` (`/api/leaderboard?limit=5`): строки `.home-lb-row` (медали
    `pq-medal` 1–3, plain 4–5), LIVE-патч `#liveGameText` из топ-2, пусто/ошибка —
    `lb_empty`/`lb_error`;
  - `loadLeaderboardYou` (`/api/leaderboard/me`, кэш 60с): скрыта, если игрок в топе
    (rank ≤числа строк) или не авторизован; рендер «#rank / You / rating»;
  - `refreshLeaderboardYou()` (хуки: `handleAuthSuccess` + `gameOver`), `showMyProfile()`;
  - в `DOMContentLoaded`: закрытие `#dynamicPanel` по Esc и по mousedown на фоне.

### Шаг 5 — Сервер и тесты (`src/server.js`, `tests/server-api.test.js`)

- `GET /api/leaderboard/me`: session-auth (401 неавторизованному), админ →
  404 `{"error":"Not ranked"}`, `rank = 1 + countDocuments(isAdmin $ne true, rating $gt)`,
  ответ `{rank, total, rating, username}`.
- В mock `User.countDocuments` добавлена поддержка `$ne isAdmin` и `$gt/$gte/$lt rating`:
  describe `Leaderboard Me API` — 5 тестов (гость 401; топ → rank 1; равные рейтинги →
  одинаковый ранг; нижний → rank 2; админ → 404), `beforeEach(() => User.__clearStore())`.

## 2. Верификация

- Среда: статический сервер `python -m http.server 8137` + вкладка встроенного браузера
  (скриншоты вкладки недоступны в этой сессии; проверка — вычисляемые стили, DOM и пиксели canvas).
- **Компоновка**: `.home-left` 340px, `.home-center` 554px, gap 48px; кнопка primary 64px
  rgb(240,168,42) radius 12 pad 16; eval-бар 16×528, track rgb(43,45,51), fill rgb(236,236,236)
  (327.36px ≈ 62%), линия rgb(240,168,42); live-dot rgb(62,207,142); lb-card flex pad 16,
  5 скелетонов; discord rgb(20,22,42) + «Join»; new-card rgb(23,19,11)/border rgb(58,44,16)
  radius 12 pad 14; Start/Rules/Settings 44px (Start — outline акцент, Rules/Settings —
  нейтралы radius 10, 13px).
- **Тексты (en)**: «Quoridor, online.», «Race to the other side…», 4 заголовка меню
  (Play Online / Play vs Bot / Play with Friend / Pass & Play), подписи («Easy to Impossible»,
  «Send an invite link», «Two players, one device»), карточка «New to Quoridor?
  Learn the rules in a 2-minute walkthrough» / «Start», «Leaderboard / View all»,
  «online · 0 in game»; LIVE-строка из API → «Aoi 1669 vs Crissrose 1620».
- **i18n**: словари en/ru 335=335 ключей; подстановка `{n}` работает
  («Ranked · 0 players online», «online · 0 in game»); смена языка обновляет динамические строки.
- **Модал**: overlay fixed, z 10001, затемнение rgba(0,0,0,.6); при открытии сфокусирован
  `.pq-modal__close`, Esc закрывает и возвращает фокус; mousedown по фону закрывает,
  по содержимому — не закрывает; шапка остаётся видимой; Ranked disabled для гостя
  (tooltip login-required); окно 460px, flex, gap 16.
- **Панель комнаты** (открыта `showDynamicPanel('panelRoom', false)`): title «Play with Friend»,
  input `.pq-input` 44px, Join disabled при пустом коде, код 32px, спиннер 20px.
- **Панель цвета**: title «Choose your color», белая точка rgb(243,243,243), кнопка Back.
- **Пиксельная проверка DemoBoard вручную** (canvas 1056, k=2): центр клетки 1b:1c:20
  (`--cell`), зазор/совместные стены f0:a8:2a (акцент), цифра координаты 6c:6f:76
  (`--text-faint`), белая пешка f3:f3:f3 c обводкой — соответствуют §4.1.
- **Ограничение среды**: статический сервер не отдаёт `socket.io.js`/`shared.js` →
  `game.js` падает при загрузке, демо-цикл доски не стартует; тема и рендер доски
  проверены прямым вызовом `BoardRenderer.*` (см. выше). Это ограничение стенда, не регресс.

## 3. Расхождения и решения (отклонения от ТЗ)

1. **LIVE-строка + Watch реализованы** вопреки §4 («на сайте нет режима просмотра… не делать»):
   по решению пользователя — будущая лайв-игра лучших игроков; пока людей мало —
   пара из топ-2 лидерборда, доска продолжает демо-партию.
2. **`.social-bar` сохранён** как футер mainMenu (оформлен на этапе 1) вопреки §5.2
   («удалить с главной»); удалён только `.footer-stats`.
3. **`online_label`** — один ключ `"online · {n} in game"` вместо пары
   `online_label`/`ingame_label` из §6; подстановка через `refreshDynamicTexts()`.
4. **Карточка туториала**: en по макету — «Learn the rules in a 2-minute walkthrough» / «Start»
   (ru: «Правила за 2 минуты» / «Начать»), а не «2-minute read»/«Read» из таблицы §6
   (приоритет — макет).
5. **Аватар №2 `#34363c`** — literal hex в CSS (в токенах нет переменной; по таблице §5.2).
6. **Legacy-стили** `.time-*`/`#startSearchBtn` и разметка `#modeScreen`/`#roomScreen`
   не тронуты (работают через старые пути, ищутся по `id`; search теперь в `searchOverlay`).
7. **`refreshDynamicTexts` обёрнут try/catch и вызывается до Game в `setLanguage`** из-за
   TDZ `typeof Game`, когда game.js не загрузился (статический стенд; порядок важен).
8. **Версии кэша подняты** по факту правок: style 1.0.25, components 1.2.0,
   board-renderer 1.0.6 (index+replay), ui 1.0.24, game 1.0.13 — `?v=`-bump обязателен,
   т.к. кэш браузера иной раз держит старое даже с новым файлом на сервере.
9. **`npm run lint` / `npm run test:once` не прогнаны** — Node.js отсутствует (отчёт этапа 0);
   контроль — браузер/computed-стили/пиксели. Новые серверные тесты написаны, но не исполнены.
10. **Демо-доска в SPA на статическом стенде не рисует партию** (нет socket.io/shared.js);
    на node-бэкенде поведение прежнее (сценарии + bot-матч), оверлей правок не касался.

## 4. Что осталось

- Прогнать `npm run lint` + `npm run test:once` (нужен Node) — в т.ч. 5 новых тестов лидерборда.
- Полный SPA-прогон на node-бэкенде: DemoBoard.init, LIVE по реальным данным,
  поиск/комната через сокет, строка «You» после партий.
- Этап 3 — Leaderboard/Profile по макетам (`Leaderboard.html`, `Profile.html`).
