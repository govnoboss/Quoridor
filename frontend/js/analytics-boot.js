/**
 * Единая точка подключения телеметрии и аналитики PlayQuor.
 * Ставит на страницу:
 *   1. Sentry (@sentry/browser, CDN-бандл) — клиентские ошибки; DSN приходит с сервера
 *      через /js/telemetry-config.js (DSN не хранится в публичном репозитории).
 *      Отключить: localStorage.setItem('sentry.disabled', 1)
 *   2. Umami (self-hosted, https://analytics.playquor.org/script.js, defer)
 *      с data-domains="playquor.org" (чужие домены не шлют) и
 *      data-performance="true" (web vitals: TTFB/FCP/LCP/CLS/INP в Umami).
 *      Отключить: localStorage.setItem('umami.disabled', 1)
 *   3. (подключается тегом рядом) /js/analytics.js — общая точка входа trackEvent.
 *
 * Подключение на странице (обычно в <head>, до остальных скриптов) — два тега:
 *   <script src="/js/analytics-boot.js?v=1.2.0"></script>
 *   <script src="/js/analytics.js?v=1.2.0"></script>
 *
 * Админские и служебные страницы телеметрию НЕ подключают: там достаточно одного
 * тега /js/analytics.js (см. admin-metrics.html).
 */
(function () {
    'use strict';

    var SENTRY_CDN = 'https://browser.sentry-cdn.com/10.78.0/bundle.min.js';
    var UMAMI_SRC = 'https://analytics.playquor.org/script.js';
    var UMAMI_WEBSITE_ID = '4efbc356-ed5e-4f8b-9761-c00a500f67c2';
    var UMAMI_DOMAINS = 'playquor.org';

    function disabled(key) {
        try {
            return localStorage.getItem(key) === '1';
        } catch (e) {
            return false;
        }
    }

    // --- Sentry (клиентские ошибки) ---
    // async=false, чтобы конфиг гарантированно исполнился раньше CDN-бандла.
    if (!disabled('sentry.disabled')) {
        var cfg = document.createElement('script');
        cfg.src = '/js/telemetry-config.js';
        cfg.async = false;
        document.head.appendChild(cfg);

        var sen = document.createElement('script');
        sen.src = SENTRY_CDN;
        sen.async = false;
        sen.onload = function () {
            if (!window.Sentry || !window.__TELEMETRY || !window.__TELEMETRY.sentryDsn) return;
            try {
                window.Sentry.init({
                    dsn: window.__TELEMETRY.sentryDsn,
                    environment: 'production',
                    release: 'web@' + (window.__APP_VERSION || 'unknown'),
                    sampleRate: 1.0,      // все ошибки
                    tracesSampleRate: 0.2 // 20% транзакций (нагрузка минимальная)
                });
            } catch (e) {
                // Sentry недоступен/конфиг неполон — страница работает без телеметрии ошибок.
            }
        };
        document.head.appendChild(sen);
    }

    // --- Umami (трафик + события + web vitals) ---
    if (!disabled('umami.disabled') && !document.getElementById('umamiScript')) {
        var s = document.createElement('script');
        s.id = 'umamiScript';
        s.src = UMAMI_SRC;
        s.setAttribute('data-website-id', UMAMI_WEBSITE_ID);
        s.setAttribute('data-domains', UMAMI_DOMAINS);
        s.setAttribute('data-performance', 'true');
        s.defer = true;
        document.head.appendChild(s);
    }
})();
