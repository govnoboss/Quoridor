/**
 * Единая точка подключения внешней аналитики PlayQuor.
 * Ставит на страницу тег Umami (self-hosted, https://analytics.playquor.org/script.js, defer)
 * с data-domains="playquor.org" — localhost/стейджинг/чужие домены не шлют данные.
 *
 * Подключение на странице (обычно в <head>, до остальных скриптов) — два тега:
 *   <script src="/js/analytics-boot.js?v=1.2.0"></script>
 *   <script src="/js/analytics.js?v=1.2.0"></script>
 *
 * Ранее analytics.js подгружался из boot через document.write; от этого отказались:
 * Chrome на медленных соединениях может блокировать document.write-вставки.
 *
 * Админские и служебные страницы Umami НЕ подключают: там достаточно одного тега
 * /js/analytics.js (см. admin-metrics.html).
 *
 * Отключить Umami для своего браузера: localStorage.setItem('umami.disabled', 1)
 * (это же ключ, который проверяет сам script.js).
 */
(function () {
    'use strict';

    var UMAMI_SRC = 'https://analytics.playquor.org/script.js';
    var UMAMI_WEBSITE_ID = '4efbc356-ed5e-4f8b-9761-c00a500f67c2';
    var UMAMI_DOMAINS = 'playquor.org';

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
})();
