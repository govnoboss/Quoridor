(function () {
  'use strict';

  var mount = document.getElementById('siteHeader');
  if (!mount) return;

  var dict = {
    en: { play: 'Play', leaderboard: 'Leaderboard', rules: 'Rules', faq: 'FAQ', signIn: 'Sign In', signUp: 'Sign Up' },
    ru: { play: 'Играть', leaderboard: 'Рейтинг', rules: 'Правила', faq: 'FAQ', signIn: 'Войти', signUp: 'Регистрация' }
  };

  function getLang() {
    return localStorage.getItem('quoridor-lang') || 'en';
  }

  function t() {
    return dict[getLang()] || dict.en;
  }

  function navLinks() {
    return '' +
      '<a class="header-nav-link" data-nav="play" href="/"></a>' +
      '<a class="header-nav-link" data-nav="leaderboard" href="/leaderboard"></a>' +
      '<a class="header-nav-link" data-nav="rules" href="/rules"></a>' +
      '<a class="header-nav-link" data-nav="faq" href="/faq"></a>';
  }

  function mountHeader() {
    mount.innerHTML = '' +
      '<header id="mainHeader" class="main-header">' +
        '<div class="header-left">' +
          '<a class="header-logo" href="/">PlayQuor</a>' +
        '</div>' +
        '<nav class="header-nav" aria-label="Main">' + navLinks() + '</nav>' +
        '<div class="header-right">' +
          '<select id="headerLang" class="header-lang">' +
            '<option value="ru">RU</option>' +
            '<option value="en">EN</option>' +
          '</select>' +
          '<div id="siteHeaderAuth"></div>' +
          '<button class="header-menu-btn" id="headerMenuBtn" type="button" aria-label="Menu" aria-expanded="false" aria-controls="headerNavMobile">' +
            '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>' +
          '</button>' +
        '</div>' +
        '<div id="headerNavMobile" class="header-nav-mobile hidden">' + navLinks() + '</div>' +
      '</header>';
  }

  function applyLabels() {
    var d = t();
    var labels = { play: d.play, leaderboard: d.leaderboard, rules: d.rules, faq: d.faq };
    Object.keys(labels).forEach(function (key) {
      document.querySelectorAll('.header-nav-link[data-nav="' + key + '"]').forEach(function (a) {
        a.textContent = labels[key];
      });
    });
    var si = document.getElementById('siteHeaderSignIn');
    if (si) si.textContent = d.signIn;
    var su = document.getElementById('siteHeaderSignUp');
    if (su) su.textContent = d.signUp;
    var sel = document.getElementById('headerLang');
    if (sel) sel.value = getLang();
    document.documentElement.lang = getLang();
  }

  function setActiveNav() {
    var path = location.pathname.replace(/\/+$/, '');
    var map = { '/leaderboard': 'leaderboard', '/rules': 'rules', '/faq': 'faq' };
    var active = map[path];
    if (!active) return;
    document.querySelectorAll('.header-nav-link[data-nav="' + active + '"]').forEach(function (a) {
      a.setAttribute('aria-current', 'page');
    });
  }

  function bindMenu() {
    var btn = document.getElementById('headerMenuBtn');
    var panel = document.getElementById('headerNavMobile');
    if (!btn || !panel) return;
    var close = function () {
      panel.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
    };
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      panel.classList.toggle('hidden');
      btn.setAttribute('aria-expanded', panel.classList.contains('hidden') ? 'false' : 'true');
    });
    panel.addEventListener('click', function (e) {
      if (e.target.closest('a')) close();
    });
    document.addEventListener('click', function (e) {
      if (panel.classList.contains('hidden')) return;
      if (e.target.closest('#headerMenuBtn') || e.target.closest('#headerNavMobile')) return;
      close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  }

  function bindLang() {
    var sel = document.getElementById('headerLang');
    if (!sel) return;
    sel.addEventListener('change', function () {
      var lang = this.value;
      localStorage.setItem('quoridor-lang', lang);
      if (typeof window.setLanguage === 'function') window.setLanguage(lang);
      applyLabels();
    });
  }

  function loadAuth() {
    var slot = document.getElementById('siteHeaderAuth');
    if (!slot) return;
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.isAuthenticated && data.user) {
          var u = data.user;
          var name = u.username || 'User';
          var avatar = u.avatarUrl || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=333&color=fff');
          slot.innerHTML = '<a class="header-profile" id="headerProfile" href="/profiles/' + encodeURIComponent(name) + '">' +
            '<span id="headerUsername"></span>' +
            '<div class="header-avatar"><img alt="Avatar"></div>' +
            '</a>';
          slot.querySelector('#headerUsername').textContent = name;
          slot.querySelector('.header-avatar img').src = avatar;
        } else {
          slot.innerHTML = '<a href="/login" class="h-btn h-btn-ghost" id="siteHeaderSignIn"></a>' +
            '<a href="/register" class="h-btn h-btn-primary" id="siteHeaderSignUp"></a>';
        }
        applyLabels();
      })
      .catch(function () {});
  }

  mountHeader();
  applyLabels();
  setActiveNav();
  bindMenu();
  bindLang();
  loadAuth();
})();
