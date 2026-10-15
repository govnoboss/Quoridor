# Этап 0 — Фундамент: отчёт о выполнении

Проект: PlayQuor (playquor.org)
Ветка: `redesign/full` (от `bcf3ea5`)
Дата: 2026-10-15
ТЗ: `tz-phase0-foundation.md`

Этап 0 закладывает основу (токены, шрифт, общая шапка, базовые `pq-*`
компоненты, SEO/текст). Сами страницы переделываются на следующих этапах —
визуал страниц должен остаться прежним (нулевая визуальная регрессия).

## Коммиты

| Шаг | Коммит | Сообщение |
|---|---|---|
| 2 | `f2150b9` | phase0: шаг 2 — tokens.css, подключение на всех страницах, замена значений на токены |
| 3 | `10d0a38` | phase0: шаг 3 — шрифт Manrope на публичных страницах, font-family через var(--font-sans) |
| 4 | `ca8a87e` | phase0: шаг 4 — components.css (pq-* базовые компоненты) и подключение |
| 5 | `8be6806` | phase0: шаг 5 — общая шапка (header.css, site-header.js, nav, i18n) |
| 6+7 | `37a2e77` | phase0: шаг 6 — правки текста и SEO; шаг 7 — синхронизация ?v= |

## 1. Разведка (шаг 1) — ответы а–д

- **а)** Своя шапка есть на `login, register, forgot-password, reset-password,
  rules, faq, terms, privacy, leaderboard`:
  `<header class="main-header"><div class="header-left"><a class="header-logo" href="/">PlayQuor</a></div><div class="header-right"><select id="headerLang" class="header-lang" onchange="setLanguage(this.value)">…</select></div></header>`.
  У `report.html` — усечённая шапка `<header id="mainHeader" class="main-header"><a class="header-logo" href="/">PlayQuor</a></header>`.
  У `reports.html` шапки нет. У `replay.html` — своя (не трогали).
- **б)** Цвет текста: `.primary-btn` → `#17120A`, `.h-btn-primary` → `#000`.
  Не `#0B0C0D` ⇒ токен `--text-on-accent: #17120A`.
- **в)** Да: `UI.updateHeaderVisibility()` (`frontend/js/ui.js`) скрывает
  `#mainHeader` на любом экране кроме `mainMenu` (в т.ч. `gameScreen`).
  Дополнительно `showSearch`/`hideSearch` переключают `hidden` вручную.
  Новые `nav`/бургер скрываются тем же механизмом (вся шапка `hidden`).
- **г)** Коллизии имён токенов: `--border` и `--muted` локально объявлены в
  `replay.css` (и в inline `:root` у `reports.html`, `admin*.html`).
  Т.к. `tokens.css` `--muted` не заводит, а `--border` перекрывается локально
  по каскаду — суффиксы `-2` не нужны.
- **д)** Страниц «Strategy Guide» и «Multiplayer Mode» нет ⇒ ссылки удалены (шаг 6.4).

## 2. По шагам

### Шаг 2 — `tokens.css` (`f2150b9`)
- Создан `frontend/css/tokens.css` — единственный источник значений.
- Подключён первым `<link rel="stylesheet">` на 13 страницах (вкл. `replay`,
  без `admin*`).
- Удалены палитровые блоки `:root` из `style.css` и `auth-pages.css`.
- Замены hex → токены: `#F5B13C`×1, `#E9A22C`×4, `#C9821E`×2, `#43D17A`×3.
  Значения внутри `rgba(...)`, градиентов и `box-shadow` не менялись.
- 16 файлов.

### Шаг 3 — шрифт Manrope (`10d0a38`)
- В `<head>` 12 публичных страниц добавлено подключение Google Fonts
  (preconnect + Manrope). В `index.html` уже было.
- `font-family: var(--font-sans)` проставлено в `style.css`, `auth.css`,
  `profile.css`, `auth-pages.css`, `replay.css` (файл не трогали иначе),
  а также в inline `body` у `reports.html`.
- 17 файлов.

### Шаг 4 — `components.css` (`ca8a87e`)
- Создан `frontend/css/components.css` с базовыми `pq-*` компонентами:
  `pq-btn`, `pq-card`, `pq-input`, `pq-chip`, `pq-badge`, `pq-overlay`,
  `pq-modal`, `pq-skeleton`.
- Подключён после `tokens.css` на 12 страницах (без `admin` и `replay`).
- 13 файлов.

### Шаг 5 — общая шапка (`8be6806`)
- Создан `frontend/css/header.css`: перенесены правила `.main-header`,
  `.header-*`, `.h-btn*`, `.header-profile`, `.header-avatar`, `.notification-*`,
  `.notif-*` из `style.css`; `z-index: 10010` → `var(--z-header)`;
  добавлен новый блок `.header-nav` / `.header-nav-link` / `.header-menu-btn` /
  `.header-nav-mobile` с медиа-запросами 768/769px.
- Удалены дубли из `auth-pages.css`.
- `header.css?v=1.0.0` подключён на 12 страницах (без `replay`, см. отклонения).
- SPA (`index.html`): переписан `<header id="mainHeader">` — добавлен `nav`
  (Play/Leaderboard/Rules/FAQ), `select#headerLang` перенесён в `header-right`,
  добавлен бургер `#headerMenuBtn` и мобильный `#headerNavMobile`.
- `ui.js`: ключи `nav_play/nav_leaderboard/nav_rules/nav_faq` в `translations.ru`
  и `translations.en` (306 → 310); `aria-current="page"` у «Play» в
  `UI.showScreen(id)` для `mainMenu/modeScreen/roomScreen/gameScreen`;
  `UI.initHeaderNav()` — обработчик бургера.
- Создан `frontend/js/site-header.js` для статических страниц: рисует шапку,
  язык (`localStorage['quoridor-lang']`, вызов `window.setLanguage`), активный
  пункт по `location.pathname`, авторизацию через `GET /api/auth/me`
  (`{ isAuthenticated, user: { username, avatarUrl } }`), мобильное меню.
- 11 статических страниц: старая шапка заменена на
  `<div id="siteHeader"></div>` + `<noscript>` + скрипт; удалена верхняя ссылка
  «← Back to Home» (и её обработчик в inline-скриптах).
- 17 файлов.

### Шаги 6+7 — текст/SEO и `?v=` (`37a2e77`)

**SEO (6.1):**
- `<title>` в формате `<Название> | PlayQuor` и добавлены `description` для
  `login, register, forgot-password, reset-password, terms, privacy, report,
  reports, replay`; `leaderboard` — новый title, description сохранён.
  `index`, `rules`, `faq` — не менялись.
- `<html lang="en">` на всех публичных страницах.
- `robots noindex,follow`: `forgot-password, reset-password, report, reports, replay`.
- `canonical` на: `login, register, terms, privacy, leaderboard`.

**Правила множественного числа (6.2):** исправлена `pluralGames` в
`leaderboard.html` — для `en` `n === 1 ? 'game' : 'games'`.

**Тексты `rules.html` (6.3):** EN «Board Setup» и RU «Подготовка к игре»
сведены в один абзац; в RU «Конец игры» добавлено предложение про последний ряд;
JSON-LD `HowTo` (шаг «Setup the Board») приведён в соответствие.

**Ссылки (6.4):** удалены `/strategy` и `/multiplayer` из EN и RU блоков
`.internal-links` (страниц нет). Ссылка на FAQ оставлена.

**Версии `?v=` (7):** см. таблицу ниже.

## 3. Таблица версий `?v=`

| Файл | Было (макс.) | Стало | Страницы |
|---|---|---|---|
| `style.css` | 1.0.22 | **1.0.23** | все 13 |
| `auth.css` | 1.0.5 | **1.0.6** | index + статические auth |
| `profile.css` | 1.0.6 | **1.0.7** | index, leaderboard |
| `auth-pages.css` | 1.0.5 | **1.0.6** | статические страницы |
| `replay.css` | 1.0.6 | **1.0.7** | replay (см. отклонения) |
| `ui.js` | 1.0.22 | **1.0.23** | index (см. отклонения) |
| `tokens.css` / `components.css` / `header.css` | — | **1.0.0** | по списку шага 2 |
| `site-header.js` | — | **1.0.0** | 11 статических страниц |

## 4. Таблица `pluralGames` (шаг 6.2)

| n | en | ru |
|---|---|---|
| 0 | games | матчей |
| 1 | game | матч |
| 2 | games | матча |
| 5 | games | матчей |
| 11 | games | матчей |
| 21 | games | матч |

Логика: `lang === 'en' ? (n === 1 ? 'game' : 'games') : <русское правило>`.

## 5. Проверки

- `node --check frontend/js/ui.js` — OK.
- `node --check frontend/js/site-header.js` — OK.
- Палитровый `:root` остался только в `tokens.css` и `replay.css`
  (плюс inline в `reports.html`/`admin*`, не в области этапа).
- `#E9A22C` в `style.css` остался только внутри 3 градиентов (допустимо).
- `#F2F2F2` / `#A0A0A0` / `#0B0C0D` — только в `tokens.css`.
- `html lang="en"` на всех публичных страницах.
- **`npm run lint` и `npm run test:once` НЕ запускались** — см. ниже.

## 6. Найденное, но НЕ исправленное / отклонения

### Блокеры окружения
- **`node_modules` повреждён**: папка
  `node_modules/mongodb-memory-server-core/node_modules` заблокирована
  (пустой, неразрешимый владелец SID), удалить не удаётся даже с правами
  администратора; `npm install` падает `EPERM`/`lstat`. Поэтому `lint`/`test`
  и визуальный прогон не выполнялись. Нужен перезапуск ОС или `chkdsk C: /f`.

### Найденные проблемы (не исправлялись)
- `login.html`: id элементов ошибок `usernameError`/`passwordError` не
  совпадают с ожидаемыми в коде `loginUsernameError`/`loginPasswordError`.
- Auth-поток: OAuth-клиент без `playquor.org` в Authorized JavaScript origins
  (400); вход недоступен для Google-only аккаунтов; пароль стирается в
  `src/server.js:401-406` — планом не предусмотрено.

### Отклонения от ТЗ (rule 0.6)
1. **`site-header.js` подключён без `defer`** (обычный скрипт сразу после
   `#siteHeader`). С `defer` он выполняется после inline-скриптов страниц,
   которые на загрузке читают `#headerLang` → падение. Разметка страниц по ТЗ
   не менялась.
2. **`header.css` не подключён на `replay.html`** (ТЗ 5.2.1 упоминает «все
   страницы шага 2»), т.к. ТЗ 5.3 явно исключает replay (своя шапка) и там нет
   `components.css`. `tokens.css` на replay подключён.
3. **`.main-header a.header-logo`** — задан только `text-decoration: none`,
   без `color: inherit`, чтобы логотип остался оранжевым (нулевая регрессия).
4. **`reports.html`** не имеет класса `auth-page-body`; фиксированной шапке
   добавлен `padding-top: var(--header-h)` в inline-стиль, верхняя ссылка
   «← Home» удалена.
5. **`leaderboard.html`** — нижняя кнопка `lb-back-btn` («←», ведёт на `/`)
   оставлена (не текстовый Back-to-Home).
6. **Дополнительно** подняты версии `ui.js` → 1.0.23 и `replay.css` → 1.0.7
   (файлы изменены, но в списке ТЗ 7 отсутствуют) для корректного кэш-бастинга.
7. **Шаги 6 и 7 в одном коммите** `37a2e77`: правки переплетены в одних и тех же
   файлах, разделить без интерактивного `git add -p` нельзя.

## 7. Что дальше

- Починить `node_modules`, прогнать `npm run lint` и `npm run test:once`.
- Визуальная приёмка на 1440×900 и 390×844 (EN/RU) по чек-листу §10 ТЗ.
- Снять скриншоты до/после для `index` и одной статической страницы.
- Принять решение по пуше ветки `redesign/full`.
