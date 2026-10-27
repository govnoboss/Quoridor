# Отчёт · Этап 3 — Leaderboard + Profile по макетам

Дата: 2026-10-27. Ветка: `redesign/full`.
ТЗ в паке нет (`tz-03+` отсутствует): этап сделан напрямую по макетам
`design-reference/html/Leaderboard.html` и `design-reference/html/Profile.html`
(инлайн-стили = спецификация). Решения и допущения перечислены в §3.

## 1. Что сделано

### Шаг 1 — Leaderboard (коммит `87f3ad8`)

**`frontend/leaderboard.html`** — переписан целиком по макету:

- `.lbp-page` (bg `--bg`, `--header-h`+32 снизу паддинг 80) → `.lbp-main` 720px;
  headrow: back-круг 44px (`--panel`/`--border-ctl`, radius 50%, inline SVG arrow)
  + h1 «Leaderboard» 28/800; подпись «Top 100 players by rating» 14px `#8b8f98` (ml 60px);
- вкладки Rating / Win rate / **This week** — сегмент 360px (bg `--panel`,
  border `--border`, r10, pad 3, gap 3), активная `--accent`/`--on-accent` 700,
  This week — `is-soon` (opacity .4, cursor not-allowed, `aria-disabled` — данных нет);
- **подиум**: 3 карточки (h 168/196 gold, r12, `--panel`), gold — `--accent-bg` +
  `--accent-border`; медали-кружки 28px: gold `--accent`/`--on-accent`, silver
  `--silver`/`--medal-on-silver`, bronze `--bronze`/`--on-accent`; аватары 48/56
  (инициал или img), имя 16/700, рейтинг 20/800 (gold 24/800 `--accent`), игры 12px;
- **таблица**: `.lbp-table` (bg `--panel`, border `--border`, r12), thead h40
  RANK / PLAYER / RATING / 7 DAYS / WIN RATE / GAMES (11/700/0.08em `#8b8f98`),
  строки h52 (border `--divider`, hover `--row-hover`, курсор → профиль);
  медиа ≤560: скрыты 7 DAYS и GAMES; ≤480: компактный подиум;
- **строка «You»**: `.lbp-you` h56 (bg `--accent-bg-2`, border `--accent-border`,
  r12) — только после успешного `GET /api/leaderboard/me` (401/404 → скрыта);
- JS: вкладки Rating/Win rate, win rate считается на клиенте из `stats.wins/totalGames`
  (тай-брейк — рейтинг); колона 7 DAYS — прочерк «—» (серверных дельт нет);
  словари ru/en локально в странице (`setLanguage` хранит `quoridor-lang`).

**`src/server.js`**:

- `GET /api/leaderboard` — `select('username rating avatarUrl stats.totalGames stats.wins')`
  (для win-rate);
- `GET /api/profiles/:username` — добавлен `rank = 1 + countDocuments
  (isAdmin $ne true, rating $gt user.rating)` (только не-админам, сбой — не критичен);
- `GET /api/leaderboard/me` — +`wins`, `totalGames` из `stats`.

### Шаги 2–4 — Profile (SPA, коммиты `a3738ef`, `70dd329`)

**`frontend/index.html`** (разметка `#profileScreen/ppContent`):

- headrow: `.pp-back` (44px круг, SVG) + h1 `.pp-page-title` 28/800
  (`btn-back-floating` удалён);
- hero-карточка: аватар 88 (`ppAvatar` + hint 📸), `#ppUsername` 28/800,
  страна — чип `#ppCountryChip` (текст «KZ»; img `#ppFlag` удалён,
  `UI.setPlayerFlag` сохранён для игрового экрана), `#ppAdminChip` «Admin»,
  био-блок прежний, `pp-joined` (двоеточие убрано);
- `#ppActions`: для своего профиля — `pp-action-btn` «Edit profile»
  (`UI.startEditBio`) + `···`-меню (`.pp-dots`/`.pp-dots-menu` 200px): My Reports,
  Settings (`showDynamicPanel('panelSettings')`), Change/Set password,
  divider, Delete account, Log out; для чужого — прежние кнопки, но класс
  `pp-logout-btn` заменён на `pp-action-btn` (7 мест в ui.js);
- статы: 4 карточки, `pp-stat-card--accent` (RATING `--accent`, sub `#ppRank` —
  «Rank #142» через `pp_rank`), GAMES, WINS/LOSSES (`.pp-wl-sep`, `--online-green` /
  `--danger`), WIN RATE; sub «All time» (`pp_all_time`);
- график `pp-chart-card`: заголовок `#ppChartTitle` + сегмент 30 / 90 / All
  (`pp-chart-range`, `UI.setProfileChartRange`); canvas всегда развёрнут
  (collapsible удалён), пусто — `#ppChartNoData`;
- табы `.pp-tabs-row` (History/Friends, underline «History») + чипы-фильтры
  `.pp-filter-chip` All / Wins / Losses / Ranked (вложенный span;
  `data-i18n` перенесён на span, иначе `setLanguage` затирал его `textContent`);
- история: thead 6 колонок (Date/Opponent/Result/Rating/Moves/replay-кнопка);
  таб Friends и skeleton прежние.

**`frontend/js/ui.js`**:

- `UI._profileGameRowHtml(game, username)` — общий рендер строки (используется и в
  `showProfilePage`, и в `_loadMoreProfileGames`): дата, аватар-инициал + ссылка на
  соперника + тег Unrated, pill `history-result-badge win|loss|draw`, Δрейтинга
  (positive/negative/neutral, «—» для unrated), ходы, replay-кнопка; `tr` несёт
  `data-result`/`data-ranked`, клик → `UI.openReplayModal`;
- фильтры `UI.setHistoryFilter` / `UI._applyHistoryFilter` — клиентские,
  скрытие классом `pp-hidden-row`, active-ключ в `#ppFilters.dataset.active`;
- график: `_loadRatingChart` (загрузка+кэш `_ratingHistoryData`, тайтл, render) →
  `_renderProfileChart` (Chart.js: линия 2.5 `#f0a82a`, fill rgba(240,168,42,.08),
  grid `#1f2125`, подписи Y скрыты, X — даты `#8b8f98`; кастомный плагин
  `ppEndLabels` — первое значение слева, последняя точка r5 + значение справа-снизу;
  destroy перед перерисовкой), `setProfileChartRange('30'|'90'|'all')`,
  тайтлы `pp_chart_last`/`pp_chart_all`; `UI.toggleRatingChart` и
  `#ppRatingChartContainer`/`ppChartGameCount` удалены;
- чип страны/rank/admin: страна — текст чипа, rank через `pp_rank` `{n}`,
  Admin-чип только на своём профиле (по `isOwnProfile`);
- i18n: словари 348=348 (множества и количество ключей совпадают; порядок в en
  отличается исторически — не влияет на lookup): новые `pp_title, pp_admin,
  pp_all_time, pp_rank, pp_chart_last, pp_chart_all, pp_filter_all/wins/losses/ranked,
  pp_unrated, pp_edit_profile, pp_more_actions`; `pp_joined` без двоеточия;
  en `pp_winrate` → «Win rate».

**`frontend/css/profile.css`** — переписан целиком (748 строк) по макету:

- контейнер 720px, скролл страницы (`overflow-y:auto`, pad 32/16/80), gap 16;
- headrow/back 44, hero r14 pad 24, аватар 88, чипы KZ/Admin, `pp-action-btn`
  (44px, `--panel-light`/`--border-strong`), `pp-dots-menu` (200px, `--raised`,
  тень 0 12 32, h44 items, sep 1px, `.danger #f2555a`);
- стат-грид 4 (r12, pad 14 16, label 12/700/0.06em uppercase, value 28/800/1.1),
  accent-вариант; skeleton под новую сетку (4 карты, строка 56px);
- chart-card (pad 16 20 12, title 14/700, сегмент 32px, wrapper 130px);
- tabs-row (h48, underline `inset 0 -2px 0 var(--accent)`), чипы (span pad 6 12,
  r16, active `--border-ctl`/`--text`);
- таблица: карточка r12, thead h36 (11/700/0.08em), строки h56 (border `--divider`,
  hover `--row-hover`), аватар-инициал 28, Unrated-tag, pills (win
  rgba(62,207,142,.1), loss `--danger-bg`), Δрейтинга, `pp-replay-btn` 40px accent;
- `pp-load-more-btn` h48 border `--accent-border` accent;
- сохранены/перетокенизированы skeleton, friends (`pp-friend-*`, dropown, request-кнопки),
  bio-редактор, `pp-empty-state`, `pp-error-msg`, `opponent-link`;
- удалены `btn-back-floating`, `pp-logout-btn`, старые tabs/history/chart-collapsible
  стили; media ≤768 (статы 2×2, hero в колонку, pp-actions static) и ≤480
  (компактные статы/чипы, скрыты col-moves/col-date) — по правилам токенов
  (768/480), а не по предварительной заметке 560 (см. §3.9).

- версии кэша: `profile.css?v=1.0.8`, `ui.js?v=1.0.25`.

### Шаг 5 — Тесты (коммит `e898e4c`)

- `tests/server-api.test.js`: новый describe `Profile rank API` — 4 кейса:
  rank по рейтингу (3-й из трёх), равные рейтинги → одинаковый rank, админ
  пропускается в подсчёте, проекция не отдаёт `passwordHash/email/isAdmin`;
- mock `User`: `findOne` теперь thenable с `.select('-a -b')` (проекция как в Mongoose),
  `__seedUser`/конструктор добавляют `toObject()` shim (роут `/api/profiles` его
  зовёт).

## 2. Верификация (браузер, статический стенд)

- Стенд: `python -m http.server 8137 --directory frontend` + вкладки браузера.
  API на стенде нет (404/HTML) — «живые» данные подставлялись напрямую в DOM/переменные.
- **Leaderboard**: main 720px, h1 28/800, back 44 круг rgb(19,20,23); tabs 360px
  bg rgb(19,20,23) pad 3 gap 3, активная rgb(240,168,42)/rgb(26,18,4)/700, This week
  opacity .4 cursor not-allowed; error-стейт (HTML вместо JSON) → «Failed to load»;
  подстановка 5 игроков: подиум gold rgb(23,19,11)/border rgb(58,44,16) h196,
  медаль №1 rgb(240,168,42); строка You h56 bg rgb(31,24,10) border rgb(58,44,16)
 .cells `#42 / You · mnikita / 1063 / — / 34% / 73`; сортировка Win rate даёт
  подиум Epsilon(90%)/Beta(70%)/Gamma(50%); ru-табы «Рейтинг/Процент побед/За неделю».
- **Profile**: headrow 44/28-800; hero r14 pad 24 gap 20, аватар 88, чип KZ
  (12/700, rgb(28,30,34), r6, pad 3 8); статы r12 pad 14 16, label 12 uppercase
  ls 0.72px, value 28/800 lh 30.8, accent-карта rgb(23,19,11)/rgb(58,44,16);
  chart-card r12 pad 16 20 12, title 14/700, сегмент bg rgb(28,29,32) pad/gap 3,
  активная 32px rgb(240,168,42)/rgb(26,18,4)/700 r6; tabs h48 underline
  inset rgb(240,168,42), idle rgb(154,158,167)/600; чипы btnH 44, active span
  r16 pad 6 12;
  история: строка h56, дата rgb(185,188,196), thead h36 11px ls 0.88px uppercase,
  pill LOST 11/800 ls 0.44px rgb(242,85,90)/rgb(42,18,20) r4 pad 3 7,
  Unrated rgb(139,143,152)/border rgb(42,44,50), Δ −15 rgb(242,85,90)/700,
  аватар 28 rgb(42,43,48), replay 40×40 accent + SVG; Load more h48 border
  rgb(58,44,16) accent 700 r10; фильтры скрывают строки (фильтр Win → видна
  только победная строка, сброс → все);
- **график**: рендер Chart.js ok (canvas 646×130 при вьюпорте 720),
  тайтлы «Rating, last 30 games» / «Rating, all games», config: borderColor
  #f0a82a, width 2.5, fill rgba(240,168,42,0.08), grid #1f2125, Y-ticks скрыты,
  X-ticks #8b8f98, plugin ppEndLabels; скриншот подтверждает подписи 1117/1063
  и точку на конце (после скрытия Y-меток перекрытия больше нет — конфиг
  перепроверен: `y.ticks.display=false`);
- **меню ··· и Edit profile** (DOM-копия классов): btn 44×44 rgb(28,30,34), menu
  200px rgb(28,29,32) r10 pad 6 тень, items h44 fs14, danger rgb(242,85,90),
  sep 1px, pp-action-btn h44 pad 0 18 r8 fs14 — всё = макету;
- **i18n**: ru «Профиль», чипы «Все/Победы/Поражения/Рейтинговые», «Нет рейтинговых
  партий», «Игры» — переключение туда-обратно ок; синтаксис ui.js косвенно подтверждён
  загрузкой и исполнением файла (нет ошибок парсинга в консоли);
- **узкий экран 768/480**: правила присутствуют в CSS-документе (список селекторов
  в §1), пиксельная проверка не проводилась (окно стенда ≥768).

## 3. Расхождения и решения

1. **Нет серверных «7 DAYS»-дельт** — колонка «7 DAYS» задаётся прочерком «—»
   и вкладка «This week» disabled (нет 7-дневного рейтинга/статистики).
2. **Win rate считается на клиенте** (`wins/totalGames`, тай-брейк по рейтингу) —
   серверных агрегатов нет; ранги при сортировке по win rate пересчитываются
   по позиции (4+n), а «You» остаётся с реальным rank.
3. **Меню ··· шире макета**: 6 пунктов (My Reports, Settings, Change/Set password,
   Delete account, Log out) вместо трёх из макета — сохранены существующие
   функции профиля; «Log out» вынесен из отдельной кнопки.
4. **`setPlayerFlag` не удалён** — используется игровым экраном
   (`topPlayerFlag/bottomPlayerFlag`); в профиле img заменён на текстовый чип.
5. **Admin-чип виден только на своём профиле** (в публичном ответе нет `isAdmin`,
   и раскрывать состояние админа публично не хотелось).
6. **X-подписи дат на графике сохранены** (в макете осей-подписей нет вовсе) —
   без них диапазон «All» нечитаем; Y-метки убраны как в макете.
7. **`chartLast`-заголовок** берётся из i18n (`pp_chart_last`/`pp_chart_all`), en —
   точные тексты макета, ru — дословный перевод.
8. **Фильтры истории — клиентские** (All/Wins/Losses/Ranked) поверх обычной
   пагинации; `draw` не входит в потери (pill серый с рамкой).
9. **Брейкпоинты 768/480 вместо 560/480**: предварительный план упоминал 560,
   но правила токенов запрещают вводить новые брейкпоинты кроме 768/480/1025.
   Leaderboard (статическая страница, шаг 1) оставлен на 560/480 — она вне
   SPA и коммит уже был.
10. **Фикс по ходу приёмки**: `data-i18n` на кнопке-чипе затирал вложенный span
    при смене языка (`textContent`) — перенос `data-i18n` на span; фон активного
    чипа заменён с `--btn-neutral` на `--border-ctl` (=точное значение макета
    #23252a). После этих правок DOM-проверка чипов проходила (span pad 6 12 r16),
    повторный замер фона не делался — правило одно, значение взято из токена.
11. **Тесты написаны, не исполнены** — Node.js отсутствует (зафиксировано в отчёте
    этапа 0); `npm run lint`/`npm run test:once` не прогонялись.
12. **Text-мини-различия**: «My Reports» ссылкой п.10 заменён на пункт меню —
    блок разметки из index.html удалён, i18n-ключ `pp_my_reports` остался в словарях.

## 4. Что осталось

- Прогнать `npm run lint` + `npm run test:once` (нужен Node) — в т.ч. 4 новых
  теста `Profile rank API` (mock User обновлён).
- Живой прогон на node-бэкенде: leaderboard с реальным топ-100 и строкой «You»,
  profile (rank/чипы/админ-кнопки/···-меню/Load more) на реальном наборе партий,
  график по `/api/profiles/:username/rating-history` на всех диапазонах.
- Этап 4 — игровой экран (GamePanel) и Rules по макетам; мобильная главная
  (`canvas1-Mobile.html`); вынос «Reset» (`canvas1-Reset.html`).
