(function () {
    'use strict';

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
        try {
            queue.push({ name: event, props: data || {}, ts: new Date().toISOString() });
        } catch (e) {}
        schedule();
        if (typeof umami !== 'undefined') {
            try { umami.track(event, data || {}); } catch (e) {}
        }
    };

    try {
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') flush();
        });
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