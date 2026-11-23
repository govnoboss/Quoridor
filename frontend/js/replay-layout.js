(function () {
  'use strict';
  // Keep one set of controls and preserve the existing replay handlers.
  document.querySelector('.board-area').appendChild(document.getElementById('replayTransport'));
  var back = document.getElementById('replayBack');
  try {
    var source = new URL(document.referrer);
    if (source.origin === location.origin && source.pathname.startsWith('/profiles/')) {
      back.href = source.pathname;
      back.textContent = '\u2190 Profile';
    }
  } catch (_) { /* Direct links keep the Home fallback. */ }
  var mobile = window.matchMedia('(max-width: 960px)');
  document.querySelectorAll('.replay-section').forEach(function (section) {
    section.open = !mobile.matches;
  });
})();
