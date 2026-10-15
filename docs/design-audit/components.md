# Quoridor — Переиспользуемые UI-компоненты (аудит для редизайна)

Дата аудита: 2026-10-15. Источник: разметка (`frontend/*.html`) + CSS (`frontend/css/*.css`), без запуска.
Формат: **селектор** — CSS-файл — где встречается — фрагмент DOM.

Легенда CSS-файлов: `S` = `style.css`, `P` = `profile.css`, `A` = `auth.css`, `AP` = `auth-pages.css`, `R` = `replay.css`, `Admin` = инлайн `<style>` в `admin*.html`.

---

## 1. Оболочка (chrome)

### 1.1 Шапка `.main-header` (`#mainHeader`)
- CSS: `S` (строки 34–53). Позиция `fixed`, `z-index: 10010`, высота `var(--header-h)`, `backdrop-filter: blur(12px)`, градиентный фон, нижняя граница `rgba(255,255,255,0.06)`.
- Встречается: `index.html`.
- DOM:
```html
<header id="mainHeader" class="main-header">
  <div class="header-left">
    <span class="header-logo" onclick="UI.backToMenu()">PlayQuor</span>
    <span class="header-version">v1.04</span>
    <select id="headerLang" class="header-lang" onchange="UI.changeLanguage(this.value)">…</select>
  </div>
  <div class="header-right"> … bell, notif, auth/profile, admin-link … </div>
</header>
```
Дочерние компоненты: `.header-logo`, `.header-version` (моно `Courier New`), `.header-lang`, `.header-left/.header-right`.

### 1.2 Кнопки в шапке `.h-btn`
- CSS: `S`. Варианты: `.h-btn-ghost` (Sign In), `.h-btn-primary` (Sign Up), `.h-btn-ghost` (Admin).
- DOM: `<a href="/login" id="headerLoginBtn" class="h-btn h-btn-ghost" data-i18n="header_sign_in">Sign In</a>`.

### 1.3 Профиль в шапке `.header-profile` (`#headerProfile`)
- CSS: `S`. Скрыт по умолчанию (`.hidden`), показывается через JS. DOM:
```html
<div id="headerProfile" class="header-profile hidden" onclick="UI.openMyProfile()">
  <span id="headerUsername">User</span>
  <div class="header-avatar"><img id="headerAvatarImg" …></div>
</div>
```

### 1.4 Колокольчик уведомлений + дропдаун
- CSS: `S`. Селекторы: `.notification-bell`, `.bell-icon` (SVG), `.notif-badge`, `.notif-dropdown`, `.notif-header`, `.notif-mark-read`, `.notif-list`, `.notif-empty`.
- DOM:
```html
<div id="notificationBell" class="notification-bell hidden" onclick="UI.toggleNotifications(event)">…</div>
<div id="notifDropdown" class="notif-dropdown hidden">
  <div class="notif-header">…<button class="notif-mark-read" …></div>
  <div id="notifList" class="notif-list"></div>
  <div id="notifEmpty" class="notif-empty hidden">No notifications</div>
</div>
```

### 1.5 Промо-баннер `.play-banner`
- CSS: `S`. Вариант `.discord-banner`. Элементы: `.play-banner-link`, `.play-banner-icon` (SVG), `.play-banner-text`, `.play-banner-cta`, `.play-banner-close`.
- Встречается: `index.html` (Google Play + Discord).

### 1.6 Соц-бар `.social-bar`
- CSS: `S`. Элементы: `.social-group`, `.social-link` (+ `.social-text`, `.discord-link`, `.google-play-link`), `.social-separator`.
- DOM: ссылки Rules/FAQ/Terms/Privacy, иконки TikTok/YouTube/Discord/Google Play, «Found a bug?».

### 1.7 Статистика внизу `.footer-stats`
- CSS: `S`. `.center-stats`, `.center-stats-item`, `.center-stats-value` (`#statsOnlineCount`, `#statsPlayingCount`), `.center-stats-divider`, `.center-stats-label`.

---

## 2. Кнопки (общие)

| Селектор | CSS | Описание | Пример |
|---|---|---|---|
| `.primary-btn` | `S` | Основная кнопка (акцент) | `<button class="primary-btn">…</button>` |
| `.secondary-btn` | `S` | Вторичная; есть `.disabled` | `<button class="secondary-btn disabled" disabled>Войти</button>` |
| `.h-btn` (`.h-btn-primary/.h-btn-ghost`) | `S` | Кнопки шапки | — |
| `.result-btn` (`.primary`, `.signup-btn`) | `S` | Кнопки в модалке результата | `#newGameBtn`, `#rematchBtn`, `#replayBtn`, `#lobbyBtn` |
| `.bot-action-btn` | `S` | Undo/Restart/Menu в бот-партии | `#undoBtn`, `#restartBtn`, `#menuBtn` |
| `.mb-btn` | `S` | Кнопки мобильного нижнего бара | `#mobileUndoBtn`, `#mobileRestartBtn`, `#mobileEvalBtn`, `#mobileMovesBtn`, `#mobileMenuBtn` |
| `.pp-tab` / `.pp-friend-tab` | `P` | Табы профиля | History/Friends, List/Requests |
| `.close-panel-btn` | `S`/`AP` | Крестик закрытия панели/модалки | `<button class="close-panel-btn">×</button>` |
| `.eval-depth-btn` | `S` | Сегмент глубины анализа (Fast/Normal/Deep) | `role="radio"` |
| `.cta-button` | `AP` | CTA на контент-страницах | `rules/faq` CTA-секции |
| `.back-link` | `AP` | Назад на статике | `<a class="back-link">` |

Кнопки часто содержат SVG иконки: `.btn-icon`, `.btn-chevron`, `.mb-icon`.

---

## 3. Панели, карточки, списки

### 3.1 Динамическая панель `.dynamic-panel` (`#dynamicPanel`)
- CSS: `S`. Состояние `.empty`. Содержит `.dynamic-content` (несколько: `#panelPlayOnline`, `#panelRoom`, `#panelMode`, `#panelColorSelect`, `#panelHowToPlay`, `#panelSettings`), `.search-overlay` (`#searchOverlay`), `.search-spinner`, `<button class="close-panel-btn">`.
- Управление: `UI.showDynamicPanel(id)` / `UI.hideDynamicPanel()`.

### 3.2 Инфо-карточка `.info-card`
- CSS: `S`. Элементы: `.info-card-header`, `.info-icon` (эмодзи 👥/🏆), `h3`, `.info-hint`.
- Списки внутри: `.presence-list` (`#onlinePlayersList`) с `.presence-row`, `.presence-name`, `.presence-queue` (…), `.presence-empty`; и `.leaderboard` (`#leaderboard`) с `.leaderboard-row` (`.loading`).

### 3.3 Комната: код и ссылка
- CSS: `S`. Селекторы: `.code-box` (`#roomCodeValue`), `.link-box`, `.link-label`, `.link-value` (`#roomLinkDisplay`), `.room-section`, `.room-join-group`, `.room-code-input`, `.room-hint`, `.separator-line`.
- Встречается: динамическая панель (`#panelRoom`) и `#roomScreen`.

### 3.4 Панель меню `.menu-panel` / `.menu-layout`
- CSS: `S`. `.menu-title`, `.menu-tagline`, `.menu-buttons`, `.board-preview`, `.demo-board-container`, `.demo-player-bar` (`.top`/`.bottom`), `#demoBoard` (canvas).
- Левая колонка — декоративная доска с демо-партией; правая — кнопки.

### 3.5 Скелетон профиля `.pp-skeleton`
- CSS: `P`. Элементы: `.pp-skeleton-header`, `.pp-skeleton-avatar`, `.pp-skeleton-lines`, `.pp-skeleton-line.w-40/.w-60/.w-20`, `.pp-skeleton-stats`, `.pp-skeleton-card`, `.pp-skeleton-tabs`, `.pp-skeleton-tab`, `.pp-skeleton-table`, `.pp-skeleton-row`.

### 3.6 Панель admin `.panel` / `.stat-card`
- CSS: `Admin`. `.panel`, `.stats-grid`, `.stat-card` (+ `.accent`), `.stat-card .number`, `.stat-card .label`. Повторяется во всех admin-страницах (копипаст инлайн).

---

## 4. Игровой экран

### 4.1 Плашка игрока `.player-bar`
- CSS: `S`. Встречается: `#topPlayerBar`, `#bottomPlayerBar` (в `gameScreen`), и `.demo-player-bar` (в меню).
- DOM:
```html
<div class="player-bar" id="topPlayerBar">
  <div class="avatar-container"><img class="avatar" id="topPlayerAvatar" …></div>
  <div class="player-info">
    <div class="player-name-row">
      <span class="player-name" id="topPlayerName">Оппонент</span>
      <img class="player-country-flag hidden" id="topPlayerFlag" …>
    </div>
  </div>
  <div class="timer" id="topPlayerTimer">10:00</div>
</div>
```
Подкомпоненты: `.avatar-container`/`.avatar`, `.player-info`, `.player-name-row`, `.player-name`, `.player-country-flag`, `.timer`.

### 4.2 Шкала оценки — вертикальная `.eval-bar` и горизонтальная `.eval-bar-h`
- CSS: `S`. V: `.eval-bar-rail` (`#evalBarRail`) → `.eval-bar` (`#evalBar`, `role="img"`) → `.eval-fill` (`#evalFill`), `.eval-mid`, `.eval-num` (`#evalNum`).
- H (мобильная): `.eval-bar-h` (`#evalBarH`) → `.eval-h-fill` (`#evalHFill`), `.eval-h-mid`, `.eval-h-num` (`#evalHNum`).
- Только в партии против бота.

### 4.3 Карточка Evaluation `.eval-card`
- CSS: `S`. Элементы: `.eval-card-head`, `.eval-card-title`, `.eval-switch` (`role="switch"`, `#evalSwitch`) → `.eval-switch-track` → `.eval-switch-knob`; `.eval-depth` (`role="radiogroup"`) с `.eval-depth-btn[data-depth=4/6/8]`; `.eval-label` (`#evalLabel`).
- Это компонент-**переключатель (switch)** + сегмент-контрол.

### 4.4 Ряд стен `.wall-inventory`
- CSS: `S`. Контейнеры: `#topWallInventory` (стены соперника), `#bottomWallInventoryWrap` → `#bottomWallInventory` (мои, интерактивные). Шаблоны `.wall-template.v` (`#wallTemplateV`) и `.wall-template.h` (`#wallTemplateH`).
- Элементы стен рендерятся JS-ом (ряды вертикальных/горизонтальных стен).

### 4.5 Доска
- CSS: `S`. `.board-group` (`#boardGroup`) → `.board-area` → `#game-container` → `<canvas id="board" width="1080" height="1080">`.
- Рендер — `board-renderer.js` (canvas 2D), не DOM.

### 4.6 Сайдбар: история ходов и управление
- CSS: `S`. `.sidebar`, `.sidebar-content`, `.history-container-wrapper`, `#moveHistory`, `.history-header` (White/Black), `.history-list` (`#historyList`), `.history-controls` (`#histFirst/#histPrev/#histNext/#histLast`).
- Панель бот-действий: `.sidebar-controls` (`#sidebarControls`), `.bot-action-row` (`#botActionRow`), `.hotkey-chip` (клавиша `Z`).
- Кнопка сдачи: `.menu-actions` → `#surrenderBtn` (`.secondary-btn`).

### 4.7 Мобильный нижний бар `.mobile-bot-bar`
- CSS: `S`. `#mobileBotBar` с `.mb-btn` (`#mobileUndoBtn`, `#mobileRestartBtn`, `#mobileEvalBtn`, `#mobileMovesBtn`, `#mobileMenuBtn`), `.mb-icon`, `#mobileEvalLabel`.

### 4.8 Реакции (эмодзи)
- CSS: `S`. `.wall-inventory-wrap` содержит `.emoji-trigger` (`#emojiTrigger`, эмодзи 🙂) и `.emoji-picker` (`#emojiPicker`, скрыт).

---

## 5. Профиль

- CSS: `P` (`profile.css`, 760 строк). Контейнер `.profile-page-container`, `.btn-back-floating`.
- Шапка профиля: `.profile-page-header`, `.pp-avatar-section` (`#ppAvatarSection`, кнопка загрузки), `.pp-avatar` (`#ppAvatar`), `.pp-avatar-edit-hint` (📸), `.pp-info-section`, `.pp-username-row`, `#ppUsername`, `.player-country-flag` (`#ppFlag`), `.pp-bio-wrap`, `.pp-bio` (`#ppBio`), `.pp-bio-edit-btn` (✏️), `.pp-bio-edit-form`, `.pp-bio-edit-actions`, `.pp-bio-save-btn/.pp-bio-cancel-btn`, `.pp-joined`, `.pp-actions` (`#ppActions`, кнопки инжектятся JS).
- Статистика: `.pp-stats-overview`, `.pp-stat-card` (`.rating`), `.label`, `.value` (`#ppTotalGames/#ppWins/#ppWinrate/#ppRating`).
- График: `.pp-rating-chart-section`, `.pp-chart-toggle`, `.pp-chart-arrow`, `.pp-chart-container`, `.pp-chart-wrapper`, `#ppRatingChart` (canvas, Chart.js), `.pp-chart-empty`.
- Табы: `.pp-tabs`, `.pp-tab` (`.active`); контент `.pp-tab-content` (`#ppTabHistory`, `#ppTabFriends`).
- История: `.pp-history-scroll-area`, `.pp-history-table` (thead-колонки Date/Opponent/Result/Rating/Moves), `#ppHistoryBody`. Классы ячеек: `.rating-change` (+ `.positive/.negative`).
- Друзья: `.pp-friends-tabs`, `.pp-friend-tab`, `.pp-friend-tab-content`, `#ppFriendsList`, `.pp-friend-*` (аватары), `#ppIncomingRequests`, `#ppOutgoingRequests`, `.pp-add-friend-section`, `.pp-add-friend-row`, `#ppAddFriendInput`, `.pp-error-msg`, `.pp-empty-state`.
- Есть `.pp-reports-link`.

---

## 6. Модалки и оверлеи

| Компонент | CSS | Селекторы |
|---|---|---|
| Модалка результата | `S` | `.modal-overlay` (`#resultModal`) → `.modal-content`; `#resultStatus`, `.result-divider`, `.result-reason`, `.rating-changes` (`#resultRatingChanges`), `.result-actions`, `.result-secondary-row`, `.result-signup` (`.signup-btn`, `.signup-subtitle`), `.result-discord-cta` |
| Оверлей дисконнекта | `S` | `.disconnect-overlay` (`#disconnectModal`) → `.disconnect-content`, `.disconnect-title`, `.disconnect-msg` |
| Модалка подтверждения | `S` | `.confirm-overlay` (`#confirmModal`) → `.confirm-box`, `.confirm-title` (`#confirmTitle`), `.confirm-msg` (`#confirmMessage`), `.confirm-actions` (`#confirmYes/#confirmNo`) |
| Модалка рестарта | `S` | `.restart-overlay` (`#restartModal`) → `.restart-dialog`, `.restart-head`, `.restart-icon`, `.restart-body`, `.restart-hint`, `.restart-actions`, `.restart-cancel` (`#restartCancel`), `.restart-confirm` (`#restartConfirm`) |
| Лоадер | `S` | `#loadingScreen`, `.loading-content`, `.spinner`, `.loading-text`, `#loadingError` |

Инициализация: `UI.showConfirm(...)`.

---

## 7. Обратная связь (feedback)

- **Тосты**: `#notificationContainer` (`.notification-container`), функция `UI.showToast(msg, type)`.
- **Инлайн-ошибки форм**: `.field-error` / `.input-error` (+ `.visible`) в `A`/`AP`; `.pp-error-msg`.
- **Бейджи/чипы**: `.notif-badge`, `.hotkey-chip`, `.presence-queue`, `.pp-friend-tab` (со счётчиками `#ppFriendCount/#ppRequestCount`).
- **Состояния загрузки**: `.leaderboard-row.loading`, `.pp-skeleton`, `.spinner`, `.search-spinner`.

---

## 8. Контент-страницы (rules/faq/terms/privacy)

- CSS: `AP`. Обёртка `.content-page` (+ `h1/h2/h3`, `p`, `ul`, `li strong`), `.last-updated`, `.highlight-box`, `.note`.
- Двуязычные блоки: `.lang-block` / `.lang-block.active`.
- FAQ: `.faq-item` (`.faq-question` / `.faq-answer`).
- CTA: `.cta-section`, `.cta-button`, `.internal-links`, `.back-link`.
- Оболочка статики: `.auth-page-body`, `.auth-page-container`, `.main-header`, `.header-logo`.

---

## 9. Формы авторизации

- CSS: `A` + `AP`. Обёртка `.auth-form-wrapper`, `.auth-form`, `.auth-title`, `.auth-footer`.
- Поля: `.field-group` → `.field-label`, `input`, `.field-error`; пароль — `.password-wrapper` → `.password-toggle`; чекбокс — `.checkbox-row`; кнопка `.btn-primary` (`.full-width`).
- Ссылки: `.auth-link` (+ `.small`, `.action-link`), `.auth-footer-links`.
- Сообщения: `.auth-error`/`.auth-success` (`.visible`).
- Google-вход: слот для кнопки GIS (`initGoogleSignIn`, `theme: 'outline'`).

---

## 10. Игровые/админ таблицы

- Профиль: `.pp-history-table` (таблица) — единственная «таблица» в основном приложении.
- Leaderboard (отдельная страница `leaderboard.html`): собственные инлайн-стили/классы (`escapeHtml`, `pluralGames`).
- Admin: инлайн `<style>`, компонент `.panel` + `<table>` внутри; компоненты повторяются в 7 admin-файлах без общих стилей.

---

## 11. Замечания для редизайна

- **Нет единой библиотеки компонентов**: кнопки/карточки продублированы, admin-страницы полностью самодостаточны (свой `:root` и `<style>`), replay — своя палитра.
- Много компонентов рендерится **строками шаблонов в JS** (`ui.js`), а не в HTML: `renderPresenceLists`, `renderHistory`, `renderNotifications`, `renderNotificationItem`, лидерборд, карточки друзей/запросов. При редизайне это точки правки в JS.
- Иконки — инлайновые SVG/эмодзи (см. `stack.md` §8); нет централизованного набора.
