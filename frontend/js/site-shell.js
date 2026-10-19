(function () {
  'use strict';

  var PQ_VERSION = '1.04';

  var DICT = {
    en: {
      play: 'Play',
      leaderboard: 'Leaderboard',
      rules: 'Rules',
      signIn: 'Sign In',
      signUp: 'Sign Up',
      faq: 'FAQ',
      terms: 'Terms',
      privacy: 'Privacy',
      foundBug: 'Found a bug?'
    },
    ru: {
      play: 'Играть',
      leaderboard: 'Рейтинг',
      rules: 'Правила',
      signIn: 'Войти',
      signUp: 'Регистрация',
      faq: 'FAQ',
      terms: 'Условия',
      privacy: 'Конфиденциальность',
      foundBug: 'Нашли ошибку?'
    }
  };

  function getLang() {
    return localStorage.getItem('quoridor-lang') || 'en';
  }

  function t() {
    return DICT[getLang()] || DICT.en;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function currentPath() {
    var p = location.pathname.replace(/\/+$/, '');
    return p || '/';
  }

  var BURGER_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  var CHEVRON = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'14\' height=\'14\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23b9bcc4\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpath d=\'m6 9 6 6 6-6\'/%3E%3C/svg%3E';

  function navLinks(active) {
    var d = t();
    return ''
      + '<a class="header-nav-link' + (active === 'play' ? ' active' : '') + '" data-nav="play" href="/"' + (active === 'play' ? ' aria-current="page"' : '') + '>' + d.play + '</a>'
      + '<a class="header-nav-link' + (active === 'leaderboard' ? ' active' : '') + '" data-nav="leaderboard" href="/leaderboard"' + (active === 'leaderboard' ? ' aria-current="page"' : '') + '>' + d.leaderboard + '</a>'
      + '<a class="header-nav-link' + (active === 'rules' ? ' active' : '') + '" data-nav="rules" href="/rules"' + (active === 'rules' ? ' aria-current="page"' : '') + '>' + d.rules + '</a>';
  }

  function langSelect() {
    var lang = getLang();
    return '<select id="headerLang" class="header-lang" aria-label="Language">'
      + '<option value="ru"' + (lang === 'ru' ? ' selected' : '') + '>RU</option>'
      + '<option value="en"' + (lang === 'en' ? ' selected' : '') + '>EN</option>'
      + '</select>';
  }

  function renderHeader() {
    var host = document.getElementById('siteHeader');
    if (!host) return;
    var path = currentPath();
    var active = path === '/leaderboard' ? 'leaderboard' : (path === '/rules' ? 'rules' : '');
    host.innerHTML = ''
      + '<header class="main-header">'
      +   '<div class="header-left">'
      +     '<a href="/" class="header-logo">PlayQuor</a>'
      +     '<span class="header-version">v' + PQ_VERSION + '</span>'
      +   '</div>'
      +   '<nav class="header-nav" aria-label="Main">' + navLinks(active) + '</nav>'
      +   '<button id="headerMenuBtn" class="header-menu-btn" type="button" aria-label="Menu" aria-expanded="false" aria-controls="headerNavMobile">' + BURGER_SVG + '</button>'
      +   '<div class="header-right">'
      +     langSelect()
      +     '<div id="siteAuth"></div>'
      +   '</div>'
      + '</header>'
      + '<nav id="headerNavMobile" class="header-nav-mobile hidden" aria-label="Mobile">'
      +   navLinks(active)
      +   '<a class="header-nav-link js-sign-in-mobile" href="/login">' + t().signIn + '</a>'
      + '</nav>';

    var sel = host.querySelector('#headerLang');
    if (sel) {
      sel.style.backgroundImage = 'url("' + CHEVRON + '")';
      sel.addEventListener('change', function () {
        setLang(sel.value);
      });
    }
    var btn = host.querySelector('#headerMenuBtn');
    if (btn) btn.addEventListener('click', toggleMobile);
    document.addEventListener('click', outsideClose);
    document.addEventListener('keydown', escClose);
  }

  function renderAuth(user) {
    var el = document.getElementById('siteAuth');
    if (!el) return;
    var d = t();
    var mobile = document.querySelector('.js-sign-in-mobile');
    if (user) {
      var onProfile = currentPath().indexOf('/profiles/') === 0;
      var av = user.avatarUrl || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(user.username || 'User') + '&background=333&color=fff');
      el.innerHTML = '<a class="header-profile' + (onProfile ? ' active' : '') + '" href="/profiles/' + encodeURIComponent(user.username) + '">'
        + '<span class="header-username">' + esc(user.username) + '</span>'
        + '<span class="header-avatar"><img src="' + esc(av) + '" alt=""></span>'
        + '</a>';
      if (mobile) mobile.classList.add('hidden');
    } else {
      el.innerHTML = '<a href="/login" class="pq-btn pq-btn--neutral js-sign-in">' + d.signIn + '</a>'
        + '<a href="/register" class="pq-btn pq-btn--primary">' + d.signUp + '</a>';
      if (mobile) mobile.classList.remove('hidden');
    }
  }

  function renderFooter() {
    var host = document.getElementById('siteFooter');
    if (!host) return;
    var d = t();
    host.innerHTML = ''
      + '<footer class="pq-footer">'
      +   '<div class="pq-footer-left">'
      +     '<a href="/rules">' + d.rules + '</a>'
      +     '<a href="/faq">' + d.faq + '</a>'
      +     '<a href="/terms">' + d.terms + '</a>'
      +     '<a href="/privacy">' + d.privacy + '</a>'
      +   '</div>'
      +   '<div class="pq-footer-right">'
      +     '<div class="pq-footer-social">'
      +       socialIcon('https://www.tiktok.com/@playquor', 'TikTok', 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z')
      +       socialIcon('https://www.youtube.com/@playquoridor', 'YouTube', 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z')
      +       socialIcon('https://discord.gg/fbDtxcyg6B', 'Discord', 'M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z')
      +       '<a class="pq-footer-social-link" href="https://play.google.com/store/apps/details?id=org.playquor.app&amp;pcampaignid=web_share" target="_blank" rel="noopener" aria-label="Google Play"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#00A0FF" d="M3.5 2 13 12 3.5 22Z"/><path fill="#00D264" d="M3.5 2 17.5 10.5 13 12Z"/><path fill="#FF3A44" d="M3.5 22 17.5 13.5 13 12Z"/><path fill="#FFCE00" d="M17.5 10.5 20 12 17.5 13.5 13 12Z"/></svg></a>'
      +     '</div>'
      +     '<a href="/report" class="pq-footer-bug">' + d.foundBug + '</a>'
      +   '</div>'
      + '</footer>';
  }

  function socialIcon(href, label, path) {
    return '<a class="pq-footer-social-link" href="' + href + '" target="_blank" rel="noopener" aria-label="' + label + '">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg></a>';
  }

  var navOpen = false;

  function openMobile() {
    var nav = document.getElementById('headerNavMobile');
    var btn = document.getElementById('headerMenuBtn');
    if (!nav) return;
    navOpen = true;
    nav.classList.remove('hidden');
    nav.classList.add('open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }

  function closeMobile() {
    var nav = document.getElementById('headerNavMobile');
    var btn = document.getElementById('headerMenuBtn');
    if (!nav) return;
    navOpen = false;
    nav.classList.add('hidden');
    nav.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function toggleMobile(e) {
    if (e) e.stopPropagation();
    if (navOpen) closeMobile();
    else openMobile();
  }

  function outsideClose(e) {
    if (!navOpen) return;
    var nav = document.getElementById('headerNavMobile');
    var btn = document.getElementById('headerMenuBtn');
    if (btn && btn.contains(e.target)) return;
    if (nav && nav.contains(e.target)) return;
    closeMobile();
  }

  function escClose(e) {
    if (e.key === 'Escape') closeMobile();
  }

  function setLang(lang) {
    localStorage.setItem('quoridor-lang', lang);
    document.documentElement.lang = lang;
    if (typeof window.setLanguage === 'function') window.setLanguage(lang);
    renderHeader();
    renderFooter();
  }

  function loadAuth() {
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        renderAuth(data && data.isAuthenticated ? data.user : null);
      })
      .catch(function () { renderAuth(null); });
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('#headerNavMobile .header-nav-link');
    if (a) closeMobile();
  });

  renderHeader();
  renderFooter();
  loadAuth();
})();
