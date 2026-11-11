(function () {
    'use strict';

    // --- Константы/флаги внешней аналитики (Umami) ---
    // Куда уходят события: internal = POST /api/analytics/events (Mongo), umami = analytics.playquor.org.
    // В Umami идут только события воронки и ключевые действия; мелкие клики — только в Mongo.
    var UMAMI_EVENTS = {
        'session-start': 1,
        'screen-view': 1,
        'register-click': 1,
        'register-complete': 1,
        'login-complete': 1,
        'play-online-click': 1,
        'play-friend-click': 1,
        'play-bot-click': 1,
        'search-started': 1,
        'search-matched': 1,
        'search-timeout': 1,
        'search-cancelled': 1,
        'search-fallback-to-bot': 1,
        'room-created': 1,
        'room-joined': 1,
        'room-link-copied': 1,
        'room-opened-via-link': 1,
        'game-started': 1,
        'game-finished': 1,
        'game-abandoned': 1,
        'rematch-click': 1,
        'net-latency': 1
    };

    // Отключение Umami для своего браузера: localStorage.setItem('umami.disabled', 1)
    function umamiDisabled() {
        try {
            return localStorage.getItem('umami.disabled') === '1';
        } catch (e) {
            return false;
        }
    }

    // Анонимная идентификация в Umami: случайный id устройства (не связан с аккаунтом).
    var UMAMI_IDENTIFY_ENABLED = true;

    // Пока script.js (defer) не загрузился, события для Umami копятся здесь.
    var UMAMI_POLL_MS = 250;
    var UMAMI_MAX_ATTEMPTS = 60; // ~15 c, после этого umami-копии отбрасываются (Mongo-копия уже отправлена)

    function umamiReady() {
        return typeof window.umami !== 'undefined' && typeof window.umami.track === 'function';
    }

    var pendingUmami = [];   // { event, data } — ещё не отправленные в Umami
    var umamiPollTimer = null;
    var umamiAttempts = 0;
    var umamiIdentified = false;

    function sendToUmami(event, data) {
        try {
            window.umami.track(event, data);
            return true;
        } catch (e) {
            return false;
        }
    }

    function identifyOnce() {
        if (!UMAMI_IDENTIFY_ENABLED || umamiDisabled() || umamiIdentified) return;
        if (!umamiReady()) return;
        try {
            // Строковая форма: script.js записывает id в сессию и шлёт его в payload.id всех
            // последующих запросов — это склеивает визиты одного устройства между месяцами.
            // Объектная форма (identify({...})) лишь добавляет свойство сессии и склейку не делает.
            // DEVICE_ID — случайный id из localStorage, не связан с аккаунтом и не содержит PII.
            window.umami.identify(DEVICE_ID);
            umamiIdentified = true;
        } catch (e) {}
    }

    function flushUmamiQueue() {
        umamiPollTimer = null;
        identifyOnce();
        while (pendingUmami.length && umamiReady()) {
            var item = pendingUmami.shift();
            // Отправляем ровно один раз: при неудаче track() событие остаётся в очереди.
            if (!sendToUmami(item.event, item.data)) {
                pendingUmami.unshift(item);
                break;
            }
        }
        if (pendingUmami.length) {
            if (umamiAttempts < UMAMI_MAX_ATTEMPTS) {
                umamiAttempts++;
                umamiPollTimer = setTimeout(flushUmamiQueue, UMAMI_POLL_MS);
            }
            // Лимит попыток исчерпан — очередь просто перестаёт опрашиваться,
            // неотправленные umami-копии отбрасываются (дублей не будет).
        }
    }

    function scheduleUmamiFlush() {
        if (umamiPollTimer) return;
        umamiPollTimer = setTimeout(flushUmamiQueue, UMAMI_POLL_MS);
    }

    // Если script.js загрузился позже — дожимаем очередь ещё раз на load.
    try {
        window.addEventListener('load', function () {
            umamiAttempts = 0; // свежий бюджет попыток после полной загрузки страницы
            scheduleUmamiFlush();
        });
    } catch (e) {}

    function getOrCreate(key) {
        try {
            var v = localStorage.getItem(key);
            if (!v) {
                v = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
                localStorage.setItem(key, v);
            }
            return v;
        } catch (e) {
            return '';
        }
    }

    var DEVICE_ID = getOrCreate('quoridor_device_id');
    var SESSION_ID = Math.random().toString(36).slice(2, 12);
    var PLATFORM = (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ? 'android' : 'web';

    // Стандартизация значений mode: 'normal' (обычный онлайн) → 'online'.
    // Допустимые значения: bot | local | online | friend | ranked.
    function normalizeMode(props) {
        if (props && props.mode === 'normal') props.mode = 'online';
        return props;
    }

    var queue = [];
    var timer = null;

    function flush() {
        timer = null;
        if (!queue.length) return;
        var events = queue.splice(0, queue.length);
        var payload = JSON.stringify({
            events: events,
            deviceId: DEVICE_ID,
            sessionId: SESSION_ID,
            platform: PLATFORM
        });
        try {
            if (navigator.sendBeacon) {
                var blob = new Blob([payload], { type: 'application/json' });
                navigator.sendBeacon('/api/analytics/events', blob);
            } else {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', '/api/analytics/events');
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.send(payload);
            }
        } catch (e) {}
    }

    function schedule() {
        if (timer) return;
        timer = setTimeout(flush, 5000);
    }

    window.trackEvent = function (event, data) {
        if (!event) return;
        var props = normalizeMode(data && typeof data === 'object' ? Object.assign({}, data) : {});
        try {
            queue.push({ name: event, props: props, ts: new Date().toISOString() });
        } catch (e) {}
        schedule();

        // Копия в Umami — только для событий из allowlist и только если Umami не отключена.
        if (!umamiDisabled() && UMAMI_EVENTS[event]) {
            // platform добавляется только в umami-копию (Mongo берёт платформу из payload).
            var umamiProps = Object.assign({ platform: PLATFORM }, props);
            pendingUmami.push({ event: event, data: umamiProps });
            umamiAttempts = 0;
            scheduleUmamiFlush();
        }
    };

    try {
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') flush();
        });
        // pagehide надёжнее beforeunload на мобильных (bfcache), оба — для страховки.
        window.addEventListener('pagehide', flush);
        window.addEventListener('beforeunload', flush);
    } catch (e) {}

    window.Analytics = {
        track: window.trackEvent,
        flush: flush,
        deviceId: DEVICE_ID,
        sessionId: SESSION_ID,
        platform: PLATFORM
    };

    window.trackEvent('session-start');
})();
