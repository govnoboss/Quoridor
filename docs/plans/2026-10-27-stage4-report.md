# Отчёт · Этап 4 — Game screen (GamePanel) + Rules + Mobile + Reset по макетам

Дата: 2026-10-27. Ветка: `redesign/full`.
ТЗ в паке нет (`tz-03+` отсутствует): этап сделан напрямую по макетам
`design-reference/html/GamePanel.html`, `Rules.html`, `canvas1-Mobile.html`,
`canvas1-Reset.html` (инлайн-стили = спецификация). Решения и допущения — §3.

## 1. Что сделано

### Шаг 1 — GamePanel (коммит `60ed214`)

**`frontend/css/style.css`** (блоки панели партии):

- **вертикальная шкала оценки**: rail 40 → **32px** (`flex: 0 0 32px`),
  bar width 28 → **32px**, radius 6 → **8px**; midline `#e8a02f` → `var(--accent)`
  (макет рисует `#f0a82a` — совпадает с токеном, §3.2);
- **pawn-dot маркеры** (новое, из макета): статичные span `.eval-dot`
  `.eval-dot-top` (10×10, bg `#0f0f11`, border 2 `#6a6d75`, top 10)
  и `.eval-dot-bottom` (bg `#f3f3f3`, border 2 `#8b8f98`, bottom 10) в `#evalBar`;
- **eval-num**: 11/700 → **13px/800**, отступ от краёв шкалы 8 → **32px**
  (макет: у чисел нет pawn-dot маркеров рядом; `at-bottom`/`at-top` — 32px);
  горизонтальная шкала `.eval-bar-h` (мобильная): midline тоже на `var(--accent)`;
- **сайдбар** party-панели: `#gameScreen.bot-mode .sidebar` 300 → **320px**;
- **история ходов**: `.history-header` и `.history-row` — grid
  **32px 1fr 1fr** с новой колонкой «#»; header: 13px/600 `#8a8d94`,
  pad `0 8px 8px`, border-bottom 1px `#2a2b30`; строки: ui-monospace
  (Consolas) **13px** `#c9cbd0`, pad `6px 8px`; зебра `nth-child(odd)` удалена —
  подсветка текущего хода теперь на всей строке через
  `.history-row:has(.active)` (bg `#2a2b30`, r6); ячейка/ход active:
  bg accent → **transparent + #fff/700**; `.history-num` — 13px `#8a8d94`;
- **кнопки навигации истории**: единый стиль — enabled bg `#2a2b30`, color
  `#ececee`, h44 r8 fs18 border 0; hover `#33343a`; disabled bg `#222327`,
  color `#5d6068`, `not-allowed`, opacity 1 (старое `opacity: .3` убрано).

**`frontend/index.html`**: в `#evalBar` добавлены два span-маркера (`.eval-dot-*`);
в `.history-header` добавлен `<span>#</span>` (без i18n); версии
style `1.0.26`, ui `1.0.26`, game `1.0.14`.

**`frontend/js/ui.js`** (`UI.renderHistory`): добавлен `<span class="history-num">`
с номером хода (`i/2 + 1`) в каждую строку.

**`frontend/js/game.js`** (`Game.renderReplayHistory`): тот же `.history-num`
в replay-рендере (row собирается через innerHTML — колонка добавлена в шаблон).

### Шаг 2 — Rules (коммит `cfd8e29`)

**`frontend/rules.html`** — переписана целиком под макет (новые классы `rulp-*`):

- layout: `<main class="rulp-page">` (flex, gap 56, pad-top 48) →
  TOC-асайд 220px + контент 760px;
- **TOC**: заголовок «ON THIS PAGE» (11/700/0.12em `#8a8d94`, pad `0 12px 8px`);
  ссылки h44 pad `0 12px` r8 14/600 `#9a9ea7`; active — bg `--accent-bg-2`,
  color `--accent` 700; ниже — карточка **«Ready to try it?»** (bg
  `--accent-bg`, border `--accent-border`, r12, pad 16) с текстом
  «Play a bot on Easy and learn by doing.» и кнопкой «Play vs Bot»
  (h44, `--accent`/`--on-accent`, r8);
- **контент**: eyebrow «HOW TO PLAY» (12/700/0.2em accent) → h1 «Quoridor
  Rules» 44/1.1/800 → lead 18/1.6 → meta «2 players · 3 min read · Updated
  June 14, 2026» (13px `--text-dim`);
- **секции** (Objective / Board setup / Moving your pawn / Placing walls):
  flex text+figure gap 32, margin-top 56 (первая — 48); h2 28/800; p 17/1.7;
  поток статей идёт по существующему тексту правил (i18n-идентификаторы не
  менялись — RU/EN блоки локальные в странице);
- **иллюстрации** (карточки 300px, bg `--panel`, border `--border`, r12, pad 16):
  - Objective: мини-доска 9×9 (81 клетка 20×20, gap 2, bg `--cell-2`, r3),
    верхний и нижний ряды подсвечены целями через `::after`
    `rgba(240,168,42,.35)`, две пешки 16px (top black `#0f0f11`/`#6a6d75`,
    bottom white `#f3f3f3`/white-border) + подпись «Highlighted rows are the
    goals. Each player aims for the far one.»;
  - Board setup: две строки (пешка 16 + label 44px 13/600 + 2×10 свотчей
    стен 12×5 r2 accent) + подпись;
  - Moving: сетка 3×3 клеток 56px r4: центр — пешка 34px, соседние —
    точки 14px accent, диагонали — «×» (18px `--text-disabled`) + подпись;
  - Placing walls: без иллюстрации (макет обрезан после этого раздела, §3.6);
- **Tip-карточки** (`.rulp-tip`): лампочка-иконка 32px в `--accent-chip`,
  текст 15/1.6 с выделенными `<b>` accent — после Moving и ещё две (стиль по
  аналогии);
- низ: `.rulp-cta` (border-top, «Ready to play?» + кнопка «Play Quoridor
  Online Now» h44 accent) + `.rulp-links` (chip-ссылка на FAQ);
- **механика**: lang-переключение прежнее (`quoridor-lang`), но блоки
  `content-en`/`content-ru` теперь `display: contents` в активном состоянии
  (layout (.rulp-page flex) общий для обоих языков); scroll-spy подсвечивает
  TOC: EN-секции по `id="rulp-*"`, RU-секции по атрибуту `data-rs`
  (id дублировать нельзя); `scroll-behavior: smooth` + `scroll-margin-top: 72px`
  для якорей (§3.7); заголовок tab переключается языком.
- SEO: schema.org HowTo, OG/canonical — без изменений.

**`frontend/css/rules.css`** — новый файл v1.0.0 (вся стилистика `rulp-*`,
адаптив по брейкпоинтам токенов: ≤1025 gap 32; ≤768 колонка, TOC вниз,
h1 34; ≤480 компакт).

### Шаг 3 — canvas1-Mobile (коммит `16afff6`)

**`frontend/js/game.js`** — перекраска игровой доски (canvas) под макет:

- `CONFIG.wallThick` 20 → **15** (толщина стены на доске по макету);
- новый `Game.boardTheme()` — палитра из CSS-токенов
  (`--cell-2`, `--text-faint`, `--pawn-white/black` + борды, `--accent`,
  `--accent-light`), кешируется в `_boardTheme` (getComputedStyle на кадр —
  недопустимо);
- опции BoardRenderer при отрисовке: `cellFill --cell-2` + **cellRadius 9**
  (единая заливка клеток, радиус как в макете Rules-иллюстраций);
  координаты — `--text-faint`, fontFamily из токенов, fontSize `0.22·cellSize`,
  insets L/R 9, T/B 6;
- стены — `wallColor: var(--accent)`, `wallRadius: 6`;
- пешки — `pawnFillColors`/`pawnStrokeColors` из токенов (`--pawn-*-border`),
  `pawnStrokeWidth 6`, `pawnRadius 0.368·cellSize`;
- drag-preview цвета тоже на токены (полупрозрачная пешка, «рука», стена
  под курсором → `--accent-light`); зелёный/красный статусы валидности
  drag оставлены (§3.5).

**`frontend/css/style.css`** (мобильный блок ≤768) — по макету 390pt:

- `.game-layout`: padding `4px` → **`24px 12px 12px`**, gap 10 → **8px**
  (масштаб макета: 1 unit canvas ≈ 0.339 CSS px при доске 366px, §3.3);
- `#game-container`: `calc(100vw - 32px)` → **`calc(100vw - 24px)`**;
- `.player-bar`: 40px → **h48**, bg **`--raised`**, r8, pad `0 10px`, gap 10,
  fs 14; активный — bg `--raised` + inset underline `--accent` 2px
  (в макете активность передаётся инверсией таймера, не плашки — §3.4);
- `.avatar` 32 → **34px, r6** (фон в макете `#2a2b30` — на живой странице
  аватар-картинка пользователя, §3.12);
- `.timer`: mono **16/700**, pad `5px 8px`, r6, bg `--bg-2`; у активного
  игрока — **bg `#f3f3f3`, color `#111`** (инверсия как в макете);
- `.wall-inventory`: bg **`--raised`**, **r6**, pad `4px 8px`, min-height 20;
  `.wall-piece`: 8vw/max-30 → **24×5px**; `.used`: opacity → **bg `#3a2f1a`**
  (тёмно-жёлтый потухший свотч, без прозрачности).

`frontend/index.html`: версии style `1.0.27`, game `1.0.15` (bump также в
`rules.html`, где style.css подключается отдельным тегом).

### Шаг 4 — canvas1-Reset (коммит `db46be3`)

Разметка (`#restartModal` → `.restart-dialog` 460px, `#1c1d20`, r12, pad 24,
gap 16, icon-круг 44 `#2a2b30`/accent-svg, кнопки h44) и стили
(`.restart-*`, включая Confirm-кнопку `#e8a02f`) уже совпадали с макетом
(сделано раньше, коммит `40637d6`) — менять их не потребовалось.
Заменены только i18n-тексты в `frontend/js/ui.js` (оба словаря):

- en `restart_title` «Restart game?» → **«Restart the game?»**;
  `restart_body` → «The board goes back to the starting position and both
  clocks reset. The current game will not be saved.» (точный текст макета);
  `restart_hint` → «Only want to take back a mistake? Use Undo instead.»;
- ru — аналоги: «Начать партию заново?» / «Доска вернётся в начальную позицию,
  часы у обоих игроков обнулятся. Текущая партия не будет сохранена.» /
  «Нужно только отменить ошибочный ход? Используйте Undo.»;
- статичные тексты разметки в `index.html` приведены к тем же строкам ранее,
  словарь теперь совпадает; версия ui `1.0.27`.

## 2. Верификация (браузер, статический стенд)

- Стенд: `python -m http.server 8137 --directory frontend` (порт 8137),
  вкладка браузера 1000×700. На статике API/socket.io недоступны, поэтому
  `Game` не подгружается (`Shared is not defined`) — игровой экран проверялся
  через DOM/ui (`Game`-логика на scratch-canvas, direct-вызовы), §3.1.
- **GamePanel** (постановка `bot-mode` + `eval-on`, история 18 ходов,
  eval White 59% `+1.4` подстановкой): rail/bar **32px r8**; pawn-dot top
  10×10 `rgb(15,15,17)`/border `rgb(106,109,117)`, top 10px; midline
  `rgb(240,168,42)` (= token accent, = макет `#f0a82a`); eval-num 13px/800,
  bottom 32px; sidebar 320px; header row `1e2c7` → grid 32px+#, fs/mono
  13px, `#8a8d94`, pad `0 8px 8px`; строка mono 13 c9cbd0, pad `6 8`;
  активная строка bg `rgb(42,43,48)` r6 (зебра ушла); кнопки nav:
  disabled bg `rgb(34,35,39)` color `rgb(93,96,104)`
  cursor not-allowed opacity 1 (проверено на клоне кнопки); enabled
  `#2a2b30`/`#ececee`;
- **проверка disabled-стиля через клон**: на «застоявшейся» кнопке
  `getComputedStyle` показывал enabled-цвета при `disabled=true` — причина:
  вкладка в скрытом Review pane, `CSSTransition` замирает на
  `currentTime: 0` (transition background-color/color не движется).
  Свежесозданный клон кнопки и повторный `disabled` дают корректный
  disabled-стиль ⇒ CSS корректен; застрявшие CSSTransition — артефакт
  окружения, не баг стилей.
- **Rules** (lang en по умолчанию): activeLang `content-en`; toc-title
  11/700 ls 2.4; toc-link active — bg `rgb(31,24,10)` color `rgb(240,168,42)`
  (`--accent-bg-2`/`--accent`); try-card r12 bg accent-bg; try-btn h44
  accent/on-accent r8; eyebrow 12/700 ls 2.4 accent; h1 44/800; h2 28/800;
  lead 18/1.6; meta 13; figure 300px bg `--panel` border `rgb(31,33,37)` r12
  pad 16; mini-grid 81 клетка 20px, grid-cols 20px×9, cell bg `rgb(34,35,39)`,
  цели `::after rgba(240,168,42,.35)` на 1-м и 75-м спане, середина
  `none`; пешки 16px (black `rgb(15,15,17)`/`rgb(106,109,117)`; white
  `rgb(243,243,243)`); setup-стены 12×5 r2 accent; moves-grid 56px (3×3),
  dot 14 accent, no 18px `rgb(93,96,104)`, пешка 34 white/border white;
  tip border `rgb(58,44,16)`; cta-btn 44 r8 accent/on-accent pad 28;
  header/footer смонтировались через site-shell; одна 404-ошибка — analytics
  standalone (не влияет); scroll-spy на верху страницы = «Objective»;
  переключение RU (тест в evaluate) возвращает заголовок «Правила игры
  Коридор» без дубликатов id;
- **Mobile (canvas1-Mobile)**: вьюпорт окна стенда 1000px — правила ≤768
  не активны; проверка по CSS-документу: 14 правил селекторов
  `player-bar|wall-piece|wall-inventory|.timer|#game-container|game-layout`
  внутри `@media (max-width: 768px)` найдены, значения соответствуют §1
  (текстовая приёмка); визуально мобильный экран не проверялся (§3.9);
  BoardRenderer принял все новые опции (direct-вызов на scratch-canvas
  300×300 отрисовал без ошибок: cellFill/cellRadius/coords/wallThick
  15/wallRadius/новые pawn-опции);
- **boardTheme()**: токены читаются (cell-2 `#222327`, text-faint,
  pawn-white/black + борды, accent, accent-light) — проверено в консоли
  через DOM-обёртку (на статике `Game` не определён, поэтому косвенно).

## 3. Расхождения и решения

1. **Статический стенд без API** — `Game` не подгружается
   (`Shared is not defined`); игровая логика отрисовки проверялась
   direct-вызовами BoardRenderer на scratch-canvas и существованием
   опций в коде; живой прогон перенесён на node-бэкенд.
2. **`#e8a02f` vs `--accent #f0a82a`** — макет в eval-mid/стенах/переключателях
   иногда рисует `#e8a02f`, а токен акцента `#f0a82a` (решено ещё ранее):
   для системных акцентов используется токен; у Confirm/Restart-кнопок и
   node-цвета, где макет однозначно рисует `#e8a02f`, оставлен `#e8a02f`
   (диалог restart совпал без изменений).
3. **Масштаб мобильных paddings**: макет 390pt ↔ реальные мобильные экраны;
   фиксированное соотношение не заявлено в макете как зависимое от ширины,
   поэтому paddings/типоразмеры фиксированы (24/12/8, доска `100vw - 24px`,
   таймер 16px) без clamp/флюидов — как в макете были жёсткие px.
4. **Схема «активный игрок» мобильная**: в макете активный игрок — только
   инверсия таймера (bg `#f3f3f3`); в живой игре плашка имеет
   `.active-turn` — добавлен inset underline-accent 2px (не конфликтует с
   макетом: у макета нет понятия «плашка неактивна/активна», только таймер);
   фон плашки одинаков для обоих (`--raised`).
5. **Аватар-картинки**: макет показывает «B»-инициал в 34px квадрате
   `#2a2b30`; на живой странице в плашке рисуется аватар пользователя
   (при его отсутствии можно упасть на инициал — прежняя логика не трогалась).
6. **Drag-hint зелёный/красный**: полупрозрачные статусы
   `rgba(67,209,122,.45)` / `rgba(248,113,113,.5)` и hover-wall статусы не
   из макета (статусы валидности в макете не заданы), сохранены как есть.
7. **Rules mock обрезан** после раздела «Placing walls»: «Jumping over
   pawns», «Winning the game», финальный Summary-блок и FAQ-ссылка
   отсутствуют в макете; блоки стилизованы консистентно (h2/p/ul/tip-card)
   и тексты взяты из текущего содержимого правил.
8. **scroll-behavior/scroll-margin** добавлены не из макета, а для
   удобства TOC: smooth-scroll + отступ 72px от clamp-заголовка.
9. **MOBILE приёмка**: вьюпорт окна 1000×700 — правила ≤768 не активны,
   приёмка была textual (соответствие CSS-правил §1) + проверка опций
   BoardRenderer; реальный рендер на 390px не снимался.
10. **«#» колонка**: добавляется и в header (статичная разметка), и в
    рендеры (ui.js и game.js replay: нумерация пар ходов); replay-шаблон
    (innerHTML) отредактирован так же.
11. **eval-mid `--accent`**: макет рисует `#f0a82a`, что совпадает со
    значением токена `--accent`; вертикальная и мобильная горизонтальная
    midline переведены на токен (вместо жёсткого `#e8a02f`).
12. **Restart dialog тексты**: body/hint в макете короткие; в index.html
    уже стояли статичные строки нового текста, а i18n-словарь отличался —
    словарь приведён к тексту разметки/макета (EN) и аналогам (RU).
13. **Геометрия стен не пересматривалась**: размещение стен на доске
    (`fullLen - gap*2` hurdle-структура) оставлено как было — перерисована
    только толщина (15) и радиус (6) по макету; поперечная длина/слоты
    соответствуют текущей сеточной модели.
14. **Активная строка истории через `:has()`**: подсветка строки целиком
    требует `:has()` (поддержка — все современные браузеры и Chromium
    встроенного браузера); в старых браузерах подсветка сведётся к ячейке
    (как раньше) — деградация приемлемая.

## 4. Что осталось

- Прогнать `npm run lint` + `npm run test:once` (нет Node.js — не менялось
  с этапа 0; теперь ещё 4 теста Profile rank API из этапа 3).
- Живой прогон с node-бэкендом: партии против бота (eval-режим, шкала 32px,
  pawn-dot-маркеры, история с «#»), Rules в продакшен-хедере,
  длинная история/replay, мобильный вьюпорт 390px (DevTools).
- Этап 5 (не заявлен в паке): при появлении новых макетов — real-time
  недели/лотерея/последние макеты, какие появятся.
