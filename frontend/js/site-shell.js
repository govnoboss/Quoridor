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
            lb_loading: 'Loading…'
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
            lb_loading: 'Загрузка…'
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

    /* Масштаб контентных страниц по ширине окна (ТЗ 5):
       sp = clamp(1, W / 1440, 1.5). Ниже 1440 масштаб не уменьшается.
       Элемент с атрибутом data-pq-content получает zoom. */
    function currentScale() {
        var w = window.innerWidth || document.documentElement.clientWidth;
        var sp = w / 1440;
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
})();
