# Отчёт · Этап 1 — Новая тема и оболочка сайта

Дата: 2026-10-15. Ветка: `redesign/full`. Коммиты: `e60a54b` (шаг 1), `b3eec47` (шаг 2), `881abde` (шаг 3).
ТЗ: `tz-01-retheme-shell.md`. Эталон: `design-reference/html/*.html` (инлайн-стили = спецификация).

## 1. Что сделано

### Шаг 1 — Токены v2.0.0 (`e60a54b`)

- `frontend/css/tokens.css` полностью переписан по п. 1 ТЗ: палитра из макетов
  (`--bg #0a0b0d`, `--surface/--panel/--row #131417`, `--panel-light #1c1e22`, `--raised #1c1d20`,
  `--btn-neutral #2a2b30`, `--cell #1b1c20`/`--cell-2 #222327`, линии `--border #1f2125` /
  `--border-ctl #23252a` / `--border-header #1d1f23` / `--border-strong #2a2c32` / `--border-btn #3a3c42` /
  `--divider #191b1f`, тексты `#ececee`…`#5d6068`, акцент `#f0a82a` + производные заливки,
  статусы `#3ecf8e`/`#f2555a`, доска/eval-бар, `--header-h: 56px`, `--page-pad-x: 64px`, шрифты Manrope,
  радиусы 2–22px, z-индексы прежних значений).
- Комментарий-спецификация брейкпоинтов (mobile ≤768 / small ≤480 / wide ≥1025) добавлен в конец файла.
- По таблице ТЗ в `style.css` заменена акцентная палитра:
  `#E9A22C → var(--accent)`, `#F5B13C → var(--accent-light)`, `#C9821E → var(--accent-dark)`,
  `rgba(233, 162, 44, x) → rgba(240, 168, 42, x)` (9 вхождений: box-shadows, градиенты кнопок-стен,
  text-shadows, radial-gradient главной). `auth.css`, `auth-pages.css`, `profile.css` — жёстких цветов
  старой палитры не найдено (проверено grep), там уже токены.
- Версия `?v` во всех 13 HTML: `tokens.css?v=2.0.0`.

### Шаг 2 — Компоненты (`b3eec47`)

- `frontend/css/components.css` переписан по п. 2 ТЗ (v1.0.0 → фактическая спецификация из макетов):
  `.pq-btn` (--primary/--neutral/--outline/--solid/--game/--icon/--block/--sm/--lg/--r10/--more/--danger),
  `.pq-menu-btn` (+`--primary`, иконка 36×36, шеврон), `.pq-card` (+accent/discord), `.pq-seg`,
  `.pq-tabs/.pq-tab`, `.pq-chip` (кнопка 44px + пилюля), `.pq-tag` (lost/won/outline), `.pq-role` (+admin),
  `.pq-avatar` 28/32/48/56/88 + `--me`, `.pq-medal` 1/2/3, `.pq-switch`, `.pq-menu` (+item/danger/sep),
  `.pq-table` (head/row), `.pq-skeleton` (shimmer, respects prefers-reduced-motion).
- Версия: `components.css?v=1.1.0` во всех 13 HTML.

### Шаг 3 — Шапка и подвал (`881abde`)

- `frontend/css/header.css` переписан по п. 3.1–3.5 ТЗ (v2.0.0):
  `.main-header` fixed, h 56px, паддинг 0 64px, gap 40px, фон `--bg`, бордер `--border-header`;
  логотип 18px/800/0.24em `--accent` + версия 11px `--text-muted`;
  нав flex, gap 28px, ссылки 14/600 `--text-3`, актив `#fff` + `inset 0 -2px 0 var(--accent)`;
  селект языка — нативный `<select>`, оформленный как кнопка макета (44px, рамка `--border-ctl`,
  шеврон через inline SVG data-URI, option в тёмной теме);
  `#notificationBell` 44×44 без рамки, SVG-колокольчик из макета (изменён path);
  `#notifBadge` — производный элемент (в макете нет);
  `.notif-dropdown` — стиле `.pq-menu` (flat `--raised`, рамка, тень 0 12px 32px, без blur);
  `.header-profile` — пилюля 44px radius 22, фон `--panel`, рамка `--border-ctl`,
  аватар 32px слева, `is-active` — рамка акцентная;
  мобильная версия ≤768: паддинг 16px, версия скрыта, нав в `#headerNavMobile`,
  `.site-footer`/`.social-bar` — auto-высота/pad 16px.
- `frontend/js/site-header.js` удалён. Взамен `frontend/js/site-shell.js` (v1.0.0):
  монтирует шапку (3 пункта нав по макету: Play / Leaderboard / Rules, FAQ убран) и подвал
  (`Rules, FAQ, Terms, Privacy | соц-иконки TikTok/YouTube/Discord/GooglePlay | Found a bug?`)
  на 11 статических страницах: login, register, forgot-password, reset-password, rules, faq, terms,
  privacy, leaderboard, report, reports. i18n: собственный компактный dict (en/ru), синхронизирован
  с `quoridor-lang`; auth через `GET /api/auth/me` (профиль-пилюля → `/profiles/<name>`) или
  guest-кнопки `pq-btn--neutral/--primary`; `aria-current` только на /leaderboard и /rules.
- Подключение на всех статических страницах переключено на `site-shell.js?v=1.0.0`; перед `</body>`
  добавлен `<div id="siteFooter"></div>`.
- SPA (`index.html`): нав 3 пункта (FAQ убран), колокольчик — SVG из макета + `aria-label="Notifications"`,
  guest-кнопки на `pq-btn--neutral/--primary` (старые `.h-btn` удалены), `#headerAdminLink` —
  `pq-btn--neutral`, перенесён в header-right (после селекта языка);
  в `#headerProfile` порядок: аватар слева, `#headerUsername` справа (по макету профиля).
- `frontend/js/ui.js`: `showScreen` — пункт Play считается активным на
  mainMenu/modeScreen/roomScreen (gameScreen убран, по решению ТЗ — доска не главная).
- `.social-bar` (SPA-футер на mainMenu) переоформлен в style.css как футер макета:
  h 56px, absolute bottom, паддинг 0 64px, justify-content: space-between, бордер сверху
  `--border-header`, цвет `--text-muted`, 13px; правая группа («Found a bug?») — `--accent` 600;
  `.social-separator` скрыт; мобильный вариант (auto-высота, social first) — из header.css media.
- Версии: `header.css?v=1.1.0` (13 файлов), `style.css?v=1.0.24` (18 файлов).

## 2. Верификация

- Статический сервер `python -m http.server 8137` + встроенный браузер.
- Computed-стили SPA шапки (index.html): высота 56px, паддинг 64px, gap 40px, логотип
  18px/800/4.32px/rgb(240,168,42), nav gap 28px, селект 44px c рамкой rgb(35,37,42) — совпадает с макетом.
- Подвал (leaderboard.html): h 56px, gap 24px, паддинг 64px, бордер rgb(29,31,35), цвет rgb(125,129,138),
  ссылки Rules/FAQ/Terms/Privacy + «Found a bug?» rgb(240,168,42) — совпадает.
- Login/rules: `#siteFooter` есть, запись в слот работает (исправлен баг см. п. 3.3).

## 3. Расхождения и решения (отклонения от ТЗ)

1. **rgba замены в градиентах/тенях** — ТЗ требовало только токены; «rgba(233,162,44,x)» заменены
   на «rgba(240,168,42,x)» (новый акцент) — это осознанное решение для консистентной палитры.
2. **`.play-banner` остался relative** — ТЗ не требовало переносить его в fixed; оставлен на месте.
3. **Баг-фикс site-shell**: скрипт подключён до `#siteFooter` в HTML; исправлено — инициализация
   отложена до `DOMContentLoaded`.
4. **`.header-profile.is-active`** в SPA-шапке не ставится (только на статических /profiles/*).
5. **Не запускались `npm run lint` и `npm run test:once`** — Node.js отсутствует на машине,
   `node_modules` повреждён (см. отчёт этапа 0). Контроль качества — вручную через браузер и
   `git diff`. Тесты не покрыты.
6. **Профиль-пилюля в шапке статических страниц** — как в макете (аватар слева, ник справа);
   в SPA-шапке приведено к тому же порядку. Отклонений от макета Profile по аватару нет.

## 4. Что осталось

- Прогнать `npm run lint` + `npm run test:once` (нужен Node).
- Прогнать визуальную проверку на десктопном скриншоте 1440×900 — сверка с `png/Main.png`
  (скриншоты браузера недоступны в этой сессии — вкладка не видима на десктопе;
  вычислительная проверка computed-стилей проведена вручную, см. п. 2).
