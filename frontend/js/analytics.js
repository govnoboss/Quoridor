window.trackEvent = function (event, data) {
  if (typeof umami !== "undefined") {
    try { umami.track(event, data || {}); } catch (e) {}
  }
};
