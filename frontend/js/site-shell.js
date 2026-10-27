/* PlayQuor site shell (header + footer) for static pages.
   Source: design-reference Main.html. Uses .main-header / .site-footer from header.css. */
(function () {
  'use strict';

  var PQ_VERSION = '1.04';

  var CSS_SVGS = {
    chevron: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    bell: '<svg class="bell-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    burger: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'
  };

  var SOCIAL_SVGS = {
    tiktok: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>',
    youtube: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
    discord: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>',
    gplay: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.5 2 13 12 3.5 22Z"/><path d="M3.5 2 17.5 10.5 13 12Z"/><path d="M3.5 22 17.5 13.5 13 12Z"/><path d="M17.5 10.5 20 12 17.5 13.5 13 12Z"/></svg>'
  };

  var dict = {
    en: {
      play: 'Play', leaderboard: 'Leaderboard', rules: 'Rules', faq: 'FAQ',
      signIn: 'Sign In', signUp: 'Sign Up',
      bug: 'Found a bug?', terms: 'Terms', privacy: 'Privacy'
    },
    ru: {
      play: 'Играть', leaderboard: 'Рейтинг', rules: 'Правила', faq: 'FAQ',
      signIn: 'Войти', signUp: 'Регистрация',
      bug: 'Нашли ошибку?', terms: 'Условия', privacy: 'Конфиденциальность'
    }
  };

  function getLang() {
    return localStorage.getItem('quoridor-lang') || 'en';
  }

  function t() {
    return dict[getLang()] || dict.en;
  }

  function isProfilePage() {
    return /^\/profiles\//.test(location.pathname.replace(/\/+$/, ''));
  }

  function navLinks() {
    return '' +
      '<a class="header-nav-link" data-nav="play" href="/"></a>' +
      '<a class="header-nav-link" data-nav="leaderboard" href="/leaderboard"></a>' +
      '<a class="header-nav-link" data-nav="rules" href="/rules"></a>';
  }

  function avatarHtml(name, url, mod) {
    if (url) {
      return '<span class="pq-avatar ' + (mod || '') + '"><img src="' + url + '" alt=""></span>';
    }
    return '<span class="pq-avatar ' + (mod || '') + '">' + initials(name) + '</span>';
  }

  // Первые 1-2 символа буквы ника для аватара-заглушки (как на макетах)
  function initials(name) {
    var s = String(name || '?').trim();
    if (!s) return '?';
    var letter = /[A-Za-zА-Яа-я]/.exec(s.charAt(0));
    var c = letter ? letter[0].toUpperCase() : s.charAt(0).toUpperCase();
    return c;
  }

  function mountHeader() {
    var mount = document.getElementById('siteHeader');
    if (!mount) return;
    mount.innerHTML = '' +
      '<header id="mainHeader" class="main-header">' +
        '<div class="header-left">' +
          '<a class="header-logo" href="/">PlayQuor</a>' +
          '<span class="header-version">v' + PQ_VERSION + '</span>' +
        '</div>' +
        '<nav class="header-nav" aria-label="Main">' + navLinks() + '</nav>' +
        '<div class="header-right">' +
          '<select id="headerLang" class="header-lang">' +
            '<option value="ru">RU</option>' +
            '<option value="en">EN</option>' +
          '</select>' +
          '<div id="siteHeaderAuth"></div>' +
          '<button class="header-menu-btn" id="headerMenuBtn" type="button" aria-label="Menu" aria-expanded="false" aria-controls="headerNavMobile">' + CSS_SVGS.burger + '</button>' +
        '</div>' +
        '<div id="headerNavMobile" class="header-nav-mobile hidden">' + navLinks() + '</div>' +
      '</header>';
  }

  function mountFooter() {
    var slot = document.getElementById('siteFooter');
    if (!slot) return;
    slot.innerHTML = '' +
      '<footer class="site-footer">' +
        '<div class="footer-links">' +
          '<a class="footer-link" data-i18n="footer_rules" href="/rules"></a>' +
          '<a class="footer-link" data-i18n="footer_faq" href="/faq"></a>' +
          '<a class="footer-link" data-i18n="footer_terms" href="/terms"></a>' +
          '<a class="footer-link" data-i18n="footer_privacy" href="/privacy"></a>' +
        '</div>' +
        '<div class="footer-right">' +
          '<div class="footer-social">' +
            '<a class="social-link" href="https://www.tiktok.com/@playquor" target="_blank" rel="noopener" aria-label="TikTok">' + SOCIAL_SVGS.tiktok + '</a>' +
            '<a class="social-link" href="https://www.youtube.com/@playquoridor" target="_blank" rel="noopener" aria-label="YouTube">' + SOCIAL_SVGS.youtube + '</a>' +
            '<a class="social-link" href="https://discord.gg/fbDtxcyg6B" target="_blank" rel="noopener" aria-label="Discord">' + SOCIAL_SVGS.discord + '</a>' +
            '<a class="social-link" href="https://play.google.com/store/apps/details?id=org.playquor.app&amp;pcampaignid=web_share" target="_blank" rel="noopener" aria-label="Google Play">' + SOCIAL_SVGS.gplay + '</a>' +
          '</div>' +
          '<a class="footer-bug" data-i18n="footer_bug" href="/report"></a>' +
        '</div>' +
      '</footer>';
  }

  function applyLabels() {
    var d = t();
    var labels = { play: d.play, leaderboard: d.leaderboard, rules: d.rules, faq: d.faq };
    Object.keys(labels).forEach(function (key) {
      document.querySelectorAll('.header-nav-link[data-nav="' + key + '"]').forEach(function (a) {
        a.textContent = labels[key];
      });
    });
    var fLabels = { footer_rules: d.rules, footer_faq: d.faq, footer_terms: d.terms, footer_privacy: d.privacy, footer_bug: d.bug };
    Object.keys(fLabels).forEach(function (key) {
      document.querySelectorAll('[data-i18n="' + key + '"]').forEach(function (a) {
        a.textContent = fLabels[key];
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
    var map = { '/leaderboard': 'leaderboard', '/rules': 'rules' };
    var active = map[path];
    if (!active) return;
    document.querySelectorAll('.header-nav-link[data-nav="' + active + '"]').forEach(function (a) {
      a.setAttribute('aria-current', 'page');
    });
  }

  function markProfileActive() {
    if (!isProfilePage()) return;
    var pill = document.querySelector('.header-profile');
    if (pill) pill.classList.add('is-active');
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
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && data.isAuthenticated && data.user) {
          var u = data.user;
          var name = u.username || 'User';
          var html = '<a class="header-profile" id="headerProfile" href="/profiles/' + encodeURIComponent(name) + '">' +
            avatarHtml(name, u.avatarUrl, '') +
            '<span id="headerUsername"></span>' +
            '</a>';
          slot.innerHTML = html;
          slot.querySelector('#headerUsername').textContent = name;
        } else {
          slot.innerHTML = '<a href="/login" class="pq-btn pq-btn--neutral" id="siteHeaderSignIn"></a>' +
            '<a href="/register" class="pq-btn pq-btn--primary" id="siteHeaderSignUp"></a>';
        }
        applyLabels();
        markProfileActive();
      })
      .catch(function () {
        applyLabels();
      });
  }

  mountHeader();
  mountFooter();
  applyLabels();
  setActiveNav();
  markProfileActive();
  bindMenu();
  bindLang();
  loadAuth();
})();
