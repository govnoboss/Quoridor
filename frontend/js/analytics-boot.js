/**
 * Единая точка подключения аналитики PlayQuor.
 * Ставит на страницу:
 *   1. Umami (self-hosted, https://analytics.playquor.org/script.js, defer)
 *      с data-domains="playquor.org" — localhost/стейджинг/чужие домены не шлют данные;
 *   2. /js/analytics.js — общая точка входа trackEvent (Mongo + копия в Umami).
 *
 * Подключение на странице (обычно в <head>, до остальных скриптов):
 *   <script src="/js/analytics-boot.js?v=1.2.0"></script>
 *
 * Админские и служебные страницы Umami НЕ подключают: там достаточно
 * <script src="/js/analytics.js?v=1.2.0"></script> (см. admin-metrics.html).
 *
 * Отключить Umami для своего браузера: localStorage.setItem('umami.disabled', 1)
 */
(function () {
    'use strict';

    var UMAMI_SRC = 'https://analytics.playquor.org/script.js';
    var UMAMI_WEBSITE_ID = '4efbc356-ed5e-4f8b-9761-c00a500f67c2';
    var UMAMI_DOMAINS = 'playquor.org';
    var ANALYTICS_JS = '/js/analytics.js?v=1.2.0';

    function umamiDisabled() {
        try {
            return localStorage.getItem('umami.disabled') === '1';
        } catch (e) {
            return false;
        }
    }

    if (!umamiDisabled() && !document.getElementById('umamiScript')) {
        var s = document.createElement('script');
        s.id = 'umamiScript';
        s.src = UMAMI_SRC;
        s.setAttribute('data-website-id', UMAMI_WEBSITE_ID);
        s.setAttribute('data-domains', UMAMI_DOMAINS);
        s.defer = true;
        document.head.appendChild(s);
    }

    // analytics.js должен исполниться в той же позиции загрузки, что и раньше
    // (до ui.js/net.js/game.js на index.html) — поэтому document.write, а не defer.
    document.write('<script src="' + ANALYTICS_JS + '"><\/script>');
})();
