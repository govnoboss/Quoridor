/* PlayQuor site shell: shared dictionary, language, page scale (--sp). v1.0.0
   Этап 1 (оболочка) + ТЗ tz-03 (разделы 3, 5, 2.6).
   Статические страницы подключают этот файл и используют PQSite:
     - PQSite.getLang() / setLanguage(lang)
     - PQSite.t(key, lang?)        — словарь
     - PQSite.formatGames(n, lang) — «N games / N игр»
     - PQSite.applyScale()         — масштаб контента zoom: var(--sp)
   Страница может зарегистрировать PQSite.onLanguageChange = fn(lang, dict).
*/
(function () {
    'use strict';

    var DICT = {
        en: {
            lb_page_title: 'Leaderboard',
            lb_sub_rating: 'Top 100 players by rating',
            lb_sub_winrate: 'Players with at least 10 games',
            lb_sub_week: 'Biggest rating gains in the last 7 days',
            lb_tab_rating: 'Rating',
            lb_tab_winrate: 'Win rate',
            lb_tab_week: 'This week',
            lb_col_rank: 'RANK',
            lb_col_player: 'PLAYER',
            lb_col_rating: 'RATING',
            lb_col_week: '7 DAYS',
            lb_col_winrate: 'WIN RATE',
            lb_col_games: 'GAMES',
            lb_retry: 'Retry',
            lb_soon: 'Coming soon',
            lb_loading: 'Loading…',
            header_play: 'Play',
            header_leaderboard: 'Leaderboard',
            header_rules: 'Rules',
            header_sign_in: 'Sign In',
            header_sign_up: 'Sign Up',
            header_admin: 'Admin',
            notifications_title: 'Notifications',
            notifications_mark_read: 'Mark all read',
            notifications_empty: 'No notifications'
        },
        ru: {
            lb_page_title: 'Рейтинг',
            lb_sub_rating: 'Топ-100 игроков по рейтингу',
            lb_sub_winrate: 'Игроки не менее чем с 10 партиями',
            lb_sub_week: 'Больший прирост рейтинга за 7 дней',
            lb_tab_rating: 'Рейтинг',
            lb_tab_winrate: 'Победы',
            lb_tab_week: 'За неделю',
            lb_col_rank: 'МЕСТО',
            lb_col_player: 'ИГРОК',
            lb_col_rating: 'РЕЙТИНГ',
            lb_col_week: '7 ДНЕЙ',
            lb_col_winrate: 'ПОБЕД',
            lb_col_games: 'ИГР',
            lb_retry: 'Повторить',
            lb_soon: 'Скоро',
            lb_loading: 'Загрузка…',
            header_play: 'Играть',
            header_leaderboard: 'Рейтинг',
            header_rules: 'Правила',
            header_sign_in: 'Войти',
            header_sign_up: 'Регистрация',
            header_admin: 'Админка',
            notifications_title: 'Уведомления',
            notifications_mark_read: 'Прочитать все',
            notifications_empty: 'Нет уведомлений'
        }
    };

    function getLang() {
        return localStorage.getItem('quoridor-lang') || 'en';
    }

    function normalizeLang(lang) {
        lang = String(lang || '').toLowerCase();
        if (lang.indexOf('ru') === 0) return 'ru';
        return 'en';
    }

    function t(key, lang) {
        var l = normalizeLang(lang || getLang());
        var pack = DICT[l] || DICT.en;
        return (pack && pack[key]) || (DICT.en && DICT.en[key]) || key;
    }

    /* formatGames: EN «1 game / N games», RU — стандартное правило множественного
       числа (11–14 → «игр»), ТЗ 2.6. */
    function formatGames(n, lang) {
        n = Number(n) || 0;
        if (normalizeLang(lang) === 'ru') {
            var n10 = n % 10, n100 = n % 100;
            var word;
            if (n100 >= 11 && n100 <= 14) word = 'игр';
            else if (n10 === 1) word = 'игра';
            else if (n10 >= 2 && n10 <= 4) word = 'игры';
            else word = 'игр';
            return n + ' ' + word;
        }
        return n === 1 ? n + ' game' : n + ' games';
    }

    function applyLang(lang) {
        lang = normalizeLang(lang);
        localStorage.setItem('quoridor-lang', lang);
        document.documentElement.lang = lang;
        var sel = document.getElementById('headerLang');
        if (sel) sel.value = lang;
        if (typeof PQSite.onLanguageChange === 'function') {
            try { PQSite.onLanguageChange(lang, DICT[lang]); } catch (e) { /* не мешаем языку */ }
        }
        document.dispatchEvent(new CustomEvent('pq:language', { detail: { lang: lang } }));
    }

    function setLanguage(lang) {
        applyLang(lang);
    }

    /* Масштаб контентных страниц по размеру окна (ТЗ 5, отступление см. отчёт):
       sp = clamp(1, min(W / 1440, H / 960), 1.5).
       Ограничение и по высоте: иначе на широких мониторах контент масштабируется
       быстрее вьюпорта по вертикали, и подиум+шапка съедают экран.
       Ниже 1440/960 масштаб не уменьшается.
       Элемент с атрибутом data-pq-content получает zoom. */
    function currentScale() {
        var w = window.innerWidth || document.documentElement.clientWidth;
        var h = window.innerHeight || document.documentElement.clientHeight;
        var sp = Math.min(w / 1440, h / 960);
        if (sp < 1) sp = 1;
        if (sp > 1.5) sp = 1.5;
        return sp;
    }

    function applyScale() {
        var sp = currentScale();
        document.documentElement.style.setProperty('--sp', sp);
        var target = document.querySelector('[data-pq-content]');
        if (target) {
            target.style.zoom = sp;
        }
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    window.PQSite = {
        dict: DICT,
        getLang: getLang,
        setLanguage: setLanguage,
        applyLang: applyLang,
        t: t,
        formatGames: formatGames,
        applyScale: applyScale,
        currentScale: currentScale,
        escapeHtml: escapeHtml
    };

    /* =========================================================
       Единая шапка для статических страниц (этап 1, retheme).
       Опция: <header class="main-header" data-pq-header>.
       Навигация Play / Leaderboard / Rules, язык, справа:
       гость — Sign In / Sign Up; залогиненный — колокольчик
       (список и «прочитать все» через /api/notifications),
       профиль со ссылкой на /profiles/<username>, Admin — админам.
       index.html (игра) НЕ подключает этот рендер: там та же
       разметка стоит статически и её ведёт ui.js.
       ========================================================= */

    var PQ = window.PQSite;

    var PQ_HEADER_SELECTOR = 'header.main-header[data-pq-header]';

    var NAV_LINKS = [
        { href: '/', key: 'header_play', match: ['/', '/lobby', '/play'] },
        { href: '/leaderboard', key: 'header_leaderboard' },
        { href: '/rules', key: 'header_rules' }
    ];

    var NOTIF_TYPE_CLASS = {
        friend_request: 'friend',
        friend_request_accepted: 'friend',
        game_invite: 'game',
        rematch_request: 'game',
        admin_message: 'admin',
        bug_report_update: 'admin',
        user_report: 'admin'
    };
    var NOTIF_EMOJI = {
        friend_request: '\uD83D\uDC64',
        friend_request_accepted: '\u2705',
        game_invite: '\uD83C\uDFAE',
        rematch_request: '\uD83D\uDD04',
        admin_message: '\uD83D\uDCE2',
        bug_report_update: '\uD83D\uDCCB',
        user_report: '\uD83D\uDCCB'
    };

    function activeNav(href) {
        var path = location.pathname.replace(/\/+$/, '') || '/';
        if (path === '/') path = '/';
        var link = NAV_LINKS.filter(function (l) { return l.href === href; })[0];
        if (!link) return false;
        if (link.match) {
            return link.match.some(function (m) { return path === m || path.indexOf(m + '/') === 0; });
        }
        return path.indexOf(href) === 0;
    }

    function headerLangHtml() {
        return '<select id="headerLang" class="header-lang" aria-label="Language">'
            + '<option value="ru">RU</option>'
            + '<option value="en">EN</option>'
            + '</select>';
    }

    function renderHeaderNav() {
        return NAV_LINKS.map(function (l) {
            return '<a href="' + l.href + '" class="' + (activeNav(l.href) ? 'active' : '') + '">'
                + PQ.escapeHtml(t(l.key)) + '</a>';
        }).join('');
    }

    function changeLanguageShim(lang) {
        lang = normalizeLang(lang);
        // порядок: у игровой страницы полноценно UI.changeLanguage,
        // у старых статических страниц — их собственный setLanguage,
        // иначе общий механизм оболочки.
        if (window.UI && typeof window.UI.changeLanguage === 'function') {
            window.UI.changeLanguage(lang);
            return;
        }
        if (typeof window.setLanguage === 'function' && window.setLanguage !== setLanguage) {
            // легаси-страница переводит свой контент сама; шапку обновляем сами,
            // т.к. её setLanguage не рассылает pq:language (t() читает localStorage)
            lang = normalizeLang(lang);
            localStorage.setItem('quoridor-lang', lang);
            document.documentElement.lang = lang;
            var legacySel = document.getElementById('headerLang');
            if (legacySel) legacySel.value = lang;
            try { window.setLanguage(lang); } catch (e) { /* контент страницы */ }
            refreshHeaderText();
            return;
        }
        applyLang(lang);
    }

    function renderHeaderStatic() {
        var header = document.querySelector(PQ_HEADER_SELECTOR);
        if (!header) return null;
        header.innerHTML =
            '<div class="header-left">'
            + '<a href="/" class="header-logo">PlayQuor</a>'
            + '<nav class="header-nav" aria-label="Main">' + renderHeaderNav() + '</nav>'
            + '</div>'
            + '<div class="header-right">'
            + headerLangHtml()
            + '<span data-pq-auth></span>'
            + '</div>'
            + '<button id="headerMenuBtn" class="header-menu-btn" type="button" aria-label="Menu" aria-expanded="false" aria-controls="headerNavMobile">'
            + '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'
            + '</button>';
        // мобильное меню — сиблинг шапки (fixed под ней)
        header.insertAdjacentHTML('afterend', renderHeaderNavMobile(true));
        var sel = header.querySelector('#headerLang');
        sel.value = getLang();
        sel.addEventListener('change', function () { changeLanguageShim(sel.value); });
        wireMobileNav();
        return header;
    }

    function renderHeaderNavMobile(showLogin) {
        return '<nav id="headerNavMobile" class="header-nav-mobile hidden" aria-label="Mobile">'
            + NAV_LINKS.map(function (l) {
                var dn = l.href === '/' ? 'play' : (l.href.indexOf('leaderboard') !== -1 ? 'leaderboard' : 'rules');
                return '<a href="' + l.href + '" class="header-nav-link' + (activeNav(l.href) ? ' active' : '') + '" data-nav="' + dn + '">'
                    + PQ.escapeHtml(t(l.key)) + '</a>';
            }).join('')
            + (showLogin ? '<a href="/login" class="header-nav-link" id="headerLoginBtnMobile">' + PQ.escapeHtml(t('header_sign_in')) + '</a>' : '')
            + '</nav>';
    }

    /* Мобильный бургер: открытие/закрытие, клик мимо, Escape, ресайз */
    function wireMobileNav() {
        var btn = document.getElementById('headerMenuBtn');
        var nav = document.getElementById('headerNavMobile');
        if (!btn || !nav) return;
        function close() {
            nav.classList.remove('open');
            nav.classList.add('hidden');
            btn.setAttribute('aria-expanded', 'false');
        }
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var willOpen = nav.classList.contains('hidden');
            if (!willOpen) { close(); return; }
            nav.classList.remove('hidden');
            nav.classList.add('open');
            btn.setAttribute('aria-expanded', 'true');
        });
        document.addEventListener('click', function (e) {
            if (!nav.classList.contains('open')) return;
            if (e.target.closest('#headerNavMobile') || e.target.closest('.header-menu-btn')) return;
            close();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') close();
        });
        window.addEventListener('resize', function () {
            if (window.innerWidth > 768) close();
        });
        nav.addEventListener('click', function (e) {
            if (e.target.closest('a')) close();
        });
    }

    /* Sign In в мобильном меню — только для гостей */
    function syncMobileAuth() {
        var m = document.getElementById('headerLoginBtnMobile');
        if (!m) return;
        var auth = document.querySelector(PQ_HEADER_SELECTOR + ' [data-pq-auth]');
        m.classList.toggle('hidden', !!(auth && auth.dataset.mode === 'user'));
    }

    function refreshHeaderText() {
        var header = document.querySelector(PQ_HEADER_SELECTOR);
        if (!header) return;
        var nav = header.querySelector('.header-nav');
        if (nav) nav.innerHTML = renderHeaderNav();
        // мобильное меню — те же пункты тем же языком
        var mnav = document.getElementById('headerNavMobile');
        if (mnav) {
            mnav.querySelectorAll('a[data-nav]').forEach(function (a) {
                var l = NAV_LINKS.filter(function (x) { return x.href === a.getAttribute('href'); })[0];
                if (l) a.textContent = PQ.escapeHtml(t(l.key));
            });
            var log = mnav.querySelector('#headerLoginBtnMobile');
            if (log) log.textContent = PQ.escapeHtml(t('header_sign_in'));
        }
        var auth = header.querySelector('[data-pq-auth]');
        if (auth && auth.dataset.i18nApplied) renderAuthAreaText(auth);
    }

    /* ---------- правая часть: гость / профиль ---------- */

    var HEADER_ME = null;

    function renderGuestAuth(auth) {
        auth.dataset.i18nApplied = '1'; auth.dataset.mode = 'guest';
        auth.innerHTML =
            '<a href="/login" class="h-btn h-btn-ghost">' + PQ.escapeHtml(t('header_sign_in')) + '</a>'
            + '<a href="/register" class="h-btn h-btn-primary">' + PQ.escapeHtml(t('header_sign_up')) + '</a>';
        syncMobileAuth();
    }

    function renderAuthAreaText(auth) {
        if (auth.dataset.mode === 'guest') {
            renderGuestAuth(auth);
            return;
        }
        if (auth.dataset.mode === 'user' && HEADER_ME) {
            renderUserAuth(auth, HEADER_ME);
        }
    }

    function renderUserAuth(auth, user) {
        auth.dataset.i18nApplied = '1'; auth.dataset.mode = 'user';
        var rawNick = user.username || 'player';
        var nick = deriveNick(rawNick);
        var photo = user.avatarUrl && String(user.avatarUrl).indexOf('/avatars/') !== -1;
        var avatarInner = photo
            ? '<img src="' + PQ.escapeHtml(user.avatarUrl) + '" alt="">'
            : PQ.escapeHtml(avatarLetter(nick));
        var unread = user.unreadNotifications || 0;
        auth.innerHTML =
            '<div id="notificationBell" class="notification-bell" role="button" tabindex="0" aria-label="' + PQ.escapeHtml(t('notifications_title')) + '">'
            + '<svg class="bell-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'
            + '<span id="notifBadge" class="notif-badge' + (unread > 0 ? '' : ' hidden') + '">' + unread + '</span>'
            + '</div>'
            + '<div id="notifDropdown" class="notif-dropdown hidden">'
            + '<div class="notif-header"><span>' + PQ.escapeHtml(t('notifications_title')) + '</span>'
            + '<button type="button" class="notif-mark-read">' + PQ.escapeHtml(t('notifications_mark_read')) + '</button></div>'
            + '<div class="notif-list" id="notifList"></div>'
            + '<div class="notif-empty hidden" id="notifEmpty">' + PQ.escapeHtml(t('notifications_empty')) + '</div>'
            + '</div>'
            + '<a class="header-profile" href="/profiles/' + encodeURIComponent(rawNick) + '" title="' + PQ.escapeHtml(nick) + '">'
            + '<span id="headerUsername">' + PQ.escapeHtml(nick) + '</span>'
            + '<span class="header-avatar">' + avatarInner + '</span>'
            + '</a>'
            + (user.isAdmin ? '<a href="/admin" class="h-btn h-btn-ghost">' + PQ.escapeHtml(t('header_admin')) + '</a>' : '');
        wireBell(auth);
        syncMobileAuth();
    }

    function avatarLetter(name) {
        var ch = String(name || '?').trim().charAt(0).toUpperCase();
        return /[A-Z0-9]/.test(ch) ? ch : '#';
    }

    /* mz-03 4.4: email никогда не показываем — часть до '@', обрезанная до 12 */
    function deriveNick(username) {
        var s = String(username || 'player');
        if (s.indexOf('@') === -1) return s;
        var head = s.split('@')[0];
        return head.substring(0, 12);
    }

    function wireBell(auth) {
        var bell = auth.querySelector('#notificationBell');
        var dropdown = auth.querySelector('#notifDropdown');
        var markBtn = auth.querySelector('.notif-mark-read');
        if (!bell || !dropdown) return;

        function toggle() {
            dropdown.classList.toggle('hidden');
            if (!dropdown.classList.contains('hidden')) loadNotifList();
        }
        bell.addEventListener('click', toggle);
        bell.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
        if (markBtn) markBtn.addEventListener('click', function () {
            fetch('/api/notifications/read-all', { method: 'PATCH', credentials: 'same-origin' })
                .then(function () { return loadNotifList(); })
                .catch(function () { });
        });
        document.addEventListener('click', function (e) {
            if (!dropdown.classList.contains('hidden')
                && !dropdown.contains(e.target) && !bell.contains(e.target)) {
                dropdown.classList.add('hidden');
            }
        });
    }

    var notifLoaded = false;

    function loadNotifList() {
        var list = document.querySelector('#notifList');
        var empty = document.querySelector('#notifEmpty');
        if (!list) return;
        fetch('/api/notifications?limit=20', { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                var items = (data && data.notifications) || [];
                notifLoaded = true;
                list.innerHTML = '';
                if (empty) empty.classList.toggle('hidden', items.length > 0);
                items.forEach(function (n) {
                    var item = document.createElement('div');
                    item.className = 'notif-item' + (n.read ? '' : ' unread');
                    item.innerHTML =
                        '<div class="notif-icon ' + (NOTIF_TYPE_CLASS[n.type] || '') + '">' + (NOTIF_EMOJI[n.type] || '\u26A0\uFE0F') + '</div>'
                        + '<div class="notif-body"><div class="notif-title">' + PQ.escapeHtml(n.title || '') + '</div>'
                        + (n.body ? '<div class="notif-time">' + PQ.escapeHtml(n.body) + '</div>' : '')
                        + '<div class="notif-time">' + PQ.escapeHtml(notifTime(n.createdAt)) + '</div></div>';
                    item.addEventListener('click', function () {
                        if (n.read) return;
                        fetch('/api/notifications/' + n._id + '/read', { method: 'PATCH', credentials: 'same-origin' })
                            .then(function () { item.classList.remove('unread'); badgeDecrement(); })
                            .catch(function () { });
                    });
                    list.appendChild(item);
                });
                updateBadge(items);
            })
            .catch(function () {
                if (empty) { empty.classList.remove('hidden'); empty.textContent = t('notifications_empty'); }
            });
    }

    function notifTime(iso) {
        if (!iso) return '';
        var diff = Date.now() - new Date(iso).getTime();
        var min = Math.floor(diff / 60000);
        if (min < 1) return 'now';
        if (min < 60) return min + 'm';
        var h = Math.floor(min / 60);
        if (h < 24) return h + 'h';
        return Math.floor(h / 24) + 'd';
    }

    function updateBadge(items) {
        var badge = document.querySelector('#notifBadge');
        if (!badge) return;
        var unread = items.filter(function (n) { return !n.read; }).length;
        badge.textContent = unread;
        badge.classList.toggle('hidden', unread === 0);
    }

    function badgeDecrement() {
        var badge = document.querySelector('#notifBadge');
        if (!badge) return;
        var n = parseInt(badge.textContent, 10) || 0;
        n = Math.max(0, n - 1);
        badge.textContent = n;
        badge.classList.toggle('hidden', n === 0);
    }

    function renderAuthArea() {
        var auth = document.querySelector(PQ_HEADER_SELECTOR + ' [data-pq-auth]');
        if (!auth) return Promise.resolve(null);
        return fetch('/api/auth/me', { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : { isAuthenticated: false }; })
            .then(function (me) {
                if (me && me.isAuthenticated && me.user) {
                    HEADER_ME = me.user;
                    renderUserAuth(auth, me.user);
                } else {
                    renderGuestAuth(auth);
                }
                syncMobileAuth();
                return me;
            })
            .catch(function () { renderGuestAuth(auth); syncMobileAuth(); return null; });
    }

    function initHeader() {
        if (!document.querySelector(PQ_HEADER_SELECTOR)) return;
        /* контентные страницы скроллятся обычною прокруткой (style.css для игры ставит
           html,body overflow:hidden «native app» — здесь это не нужно) */
        document.documentElement.classList.add('pq-scroll');
        renderHeaderStatic();
        refreshHeaderText(); // перевод с учётом уже сохранённого языка
        document.addEventListener('pq:language', refreshHeaderText);
        renderAuthArea();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initHeader);
    } else {
        initHeader();
    }
})();
