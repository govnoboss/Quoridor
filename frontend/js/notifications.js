(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else {
    window.PQNotifications = factory(window);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.PQNotifications.init());
    else window.PQNotifications.init();
  }
})(function (env) {
  'use strict';
  const doc = env.document;
  const state = { items: [], unreadTotal: 0, total: 0, pages: 1, drafts: new Map(), pending: new Set(), opened: new Set(), authenticated: false };
  let generation = 0, panel, list, status, badge, more, bell, email;
  const ru = () => { try { return env.localStorage?.getItem('quoridor-lang') === 'ru'; } catch { return false; } };
  const t = (en, russian) => ru() ? russian : en;
  const key = () => env.crypto?.randomUUID?.() || `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  async function api(url, options) {
    const response = await env.fetch(url, { credentials: 'same-origin', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `${t('Request failed', 'Ошибка запроса')} (${response.status})`);
    return data;
  }
  const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  function say(value) { if (status) { status.textContent = value; status.hidden = !value; } }
  function updateBadge() {
    if (badge) { badge.textContent = state.unreadTotal > 99 ? '99+' : String(state.unreadTotal); badge.classList.toggle('hidden', !state.unreadTotal); badge.hidden = !state.unreadTotal; }
  }
  function element(tag, text, className) { const el = doc.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; }
  function button(text, action, parent) {
    const el = element('button', text, 'pq-notif-button'); el.type = 'button';
    el.addEventListener('click', async e => {
      e.stopPropagation(); if (el.disabled) return; el.disabled = true; say('');
      try { await action(); } catch (error) { say(error.message || t('Network error. Retry.', 'Ошибка сети. Повторите попытку.')); }
      finally { el.disabled = false; }
    }); parent.appendChild(el); return el;
  }
  function link(text, href, parent) { const el = element('a', text, 'pq-notif-button'); el.href = href; parent.appendChild(el); return el; }
  function renderItem(n) {
    const item = element('article', '', 'pq-notif-item' + (n.read ? '' : ' pq-unread')); item.dataset.id = n._id;
    item.appendChild(element('strong', n.title));
    item.appendChild(element('time', new Date(n.createdAt).toLocaleString()));
    if (n.body) item.appendChild(element('p', n.body));
    const actions = element('div', '', 'pq-notif-actions'); item.appendChild(actions);
    if (!n.read) button(t('Mark read', 'Прочитано'), () => center.markRead(n._id), actions);
    const data = n.data || {};
    if (data.reportId) {
      link(t('Open conversation', 'Открыть переписку'), `${n.type === 'admin_message' ? '/profile/reports' : '/admin/reports'}?report=${encodeURIComponent(data.reportId)}`, actions);
      if (n.type === 'admin_message') {
        const area = element('div', '', 'pq-notif-reply'); area.hidden = !state.opened.has(n._id);
        button(t('Reply', 'Ответить'), () => { state.opened.add(n._id); area.hidden = false; input.focus(); }, actions);
        const input = element('textarea'); input.maxLength = 5000; input.setAttribute('aria-label', t('Your reply', 'Ваш ответ'));
        input.placeholder = t('Write a reply…', 'Напишите ответ…'); input.value = state.drafts.get(n._id)?.text || '';
        input.addEventListener('input', () => state.drafts.set(n._id, { text: input.value, key: key() }));
        input.addEventListener('click', e => e.stopPropagation());
        area.appendChild(input);
        button(t('Send', 'Отправить'), async () => {
          if (!input.value.trim()) return;
          await center.reply(n._id, data.reportId, input.value.trim());
          input.value = ''; state.opened.delete(n._id); area.hidden = true;
          say(t('Reply sent', 'Ответ отправлен'));
        }, area);
        item.appendChild(area);
      }
    } else if (n.type === 'user_report') link(t('Open report', 'Открыть жалобу'), '/admin/user-reports', actions);
    if (n.type === 'friend_request' && !n.read) {
      for (const [label, endpoint] of [[t('Accept', 'Принять'), 'accept'], [t('Decline', 'Отклонить'), 'decline']]) button(label, async () => {
        await api(`/api/friends/${endpoint}`, json({ requesterId: data.requesterId })); await center.markRead(n._id); render();
      }, actions);
    }
    if (n.type === 'game_invite' || n.type === 'rematch_request') {
      const expiry = n.expiresAt || new Date(new Date(n.createdAt).getTime() + (n.type === 'game_invite' ? 120000 : 30000));
      if (n.actionable === false || new Date(expiry).getTime() <= Date.now()) actions.appendChild(element('span', t('Invitation expired or handled', 'Приглашение истекло или обработано')));
      else if (!env.Net?.socket) link(t('Open game to respond', 'Открыть игру для ответа'), '/?notification=' + encodeURIComponent(n._id), actions);
      else button(t('Join', 'Принять'), async () => {
        if (n.type === 'game_invite') {
          await new Promise((resolve, reject) => env.Net.socket.timeout(10000).emit('acceptGameInvite', { fromId: data.requesterId, notificationId: n._id }, (error, result) => {
            if (error) reject(new Error(t('No confirmation. Refresh before retrying.', 'Нет подтверждения. Обновите перед повтором.')));
            else if (!result?.ok) reject(new Error(result?.error || t('Invitation failed', 'Не удалось принять приглашение'))); else resolve();
          }));
          n.actionable = false; await center.markRead(n._id); render();
        } else {
          env.Net.requestRematch(data.gameId);
          say(t('Rematch requested; waiting for confirmation', 'Реванш запрошен, ожидаем подтверждение'));
        }
      }, actions);
    }
    return item;
  }
  function render() {
    updateBadge(); if (!list) return;
    // Background updates must not remove a focused draft or a pending action.
    if (state.pending.size || (list.contains(doc.activeElement) && doc.activeElement?.tagName === 'TEXTAREA')) return;
    list.replaceChildren();
    if (!state.items.length) list.appendChild(element('p', t('No notifications', 'Нет уведомлений')));
    state.items.forEach(n => list.appendChild(renderItem(n)));
    if (more) more.hidden = state.items.length >= state.total;
  }
  const center = {
    state,
    async refresh() {
      const request = ++generation;
      const pages = await Promise.all(Array.from({ length: state.pages }, (_, i) => api('/api/notifications?page=' + (i + 1)))).catch(error => { say(error.message); throw error; });
      if (request !== generation) return;
      const unique = new Map(); pages.forEach(p => (Array.isArray(p) ? p : p.notifications || []).forEach(n => unique.set(n._id, n)));
      state.items = [...unique.values()]; state.total = pages[0].total ?? state.items.length;
      state.unreadTotal = pages[0].unreadTotal ?? state.items.filter(n => !n.read).length;
      render();
    },
    async markRead(id) {
      await api('/api/notifications/' + encodeURIComponent(id) + '/read', { method: 'PATCH' });
      const n = state.items.find(row => row._id === id); if (n && !n.read) { n.read = true; state.unreadTotal = Math.max(0, state.unreadTotal - 1); }
      updateBadge(); if (list) { const item = [...list.children].find(el => el.dataset.id === id); item?.classList.remove('pq-unread'); }
    },
    async markAll() { await api('/api/notifications/read-all', { method: 'PATCH' }); state.items.forEach(n => { n.read = true; }); state.unreadTotal = 0; render(); },
    async reply(notificationId, reportId, value) {
      if (state.pending.has(notificationId)) return;
      let draft = state.drafts.get(notificationId); if (!draft || draft.text.trim() !== value) { draft = { text: value, key: key() }; state.drafts.set(notificationId, draft); }
      state.pending.add(notificationId);
      try {
        await api('/api/reports/' + encodeURIComponent(reportId) + '/reply', json({ text: value, clientRequestId: draft.key }));
        state.drafts.delete(notificationId);
        // The reply is already saved: a separate read failure must never cause a duplicate retry.
        await center.markRead(notificationId).catch(() => {});
      } finally { state.pending.delete(notificationId); }
    },
    toggle() { if (!panel) return; panel.hidden = !panel.hidden; panel.classList.remove('hidden'); bell?.setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) center.refresh().catch(e => say(e.message)); },
    close(event) { if (panel && !panel.hidden && event && !panel.contains(event.target) && !bell?.contains(event.target)) { panel.hidden = true; bell?.setAttribute('aria-expanded', 'false'); } },
    setAuthenticated(value) {
      state.authenticated = value; if (bell) { bell.hidden = !value; bell.classList.toggle('hidden', !value); }
      if (!value) { ++generation; state.items = []; state.unreadTotal = 0; state.drafts.clear(); if (panel) panel.hidden = true; updateBadge(); return; }
      center.refresh().catch(e => say(e.message));
    },
    async init() {
      if (!doc || doc.getElementById('pqNotificationCentre')) return;
      const style = element('link'); style.rel = 'stylesheet'; style.href = '/css/notifications.css?v=1.0.0'; doc.head.appendChild(style);
      // Replace the old main-page dropdown; standalone pages get the same centre.
      bell = doc.getElementById('notificationBell');
      const oldDropdown = doc.getElementById('notifDropdown'); if (oldDropdown) oldDropdown.remove();
      const oldBadge = doc.getElementById('notifBadge'); if (oldBadge) oldBadge.remove();
      if (!bell) { bell = element('button', '🔔', 'notification-bell pq-notif-bell'); bell.id = 'notificationBell'; bell.type = 'button'; const target = doc.querySelector('.header-right') || doc.getElementById('siteHeaderAuth') || doc.querySelector('.main-header') || doc.querySelector('.admin-topbar'); if (!target) return; target.prepend(bell); }
      bell.removeAttribute('onclick'); bell.setAttribute('role', 'button'); bell.tabIndex = 0; bell.setAttribute('aria-label', t('Notifications', 'Уведомления')); bell.setAttribute('aria-expanded', 'false');
      bell.addEventListener('click', e => { e.stopPropagation(); center.toggle(); }); bell.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); center.toggle(); } });
      badge = element('span', '', 'pq-notif-badge'); badge.id = 'notifBadge'; bell.appendChild(badge);
      panel = element('section', '', 'pq-notif-panel'); panel.id = 'pqNotificationCentre'; panel.hidden = true; panel.setAttribute('aria-label', t('Notification centre', 'Центр уведомлений'));
      const heading = element('div', '', 'pq-notif-heading'); heading.appendChild(element('strong', t('Notifications', 'Уведомления')));
      button(t('Close', 'Закрыть'), () => { panel.hidden = true; bell.setAttribute('aria-expanded', 'false'); bell.focus(); }, heading); panel.appendChild(heading);
      const tools = element('div', '', 'pq-notif-actions'); button(t('Refresh', 'Обновить'), () => center.refresh(), tools); button(t('Mark all read', 'Прочитано всё'), () => center.markAll(), tools); link(t('My reports', 'Мои обращения'), '/profile/reports', tools); panel.appendChild(tools);
      status = element('p', '', 'pq-notif-status'); status.setAttribute('role', 'status'); status.hidden = true; panel.appendChild(status);
      list = element('div', '', 'pq-notif-list'); panel.appendChild(list);
      more = button(t('Load more', 'Загрузить ещё'), async () => { state.pages++; try { await center.refresh(); } catch (e) { state.pages--; throw e; } }, panel);
      const preferences = element('label', '', 'pq-notif-preference'); email = element('input'); email.type = 'checkbox'; preferences.appendChild(email); preferences.appendChild(doc.createTextNode(t('Email me replies to my support reports', 'Получать ответы поддержки по e-mail'))); panel.appendChild(preferences);
      email.addEventListener('change', async () => { const value = email.checked; email.disabled = true; try { await api('/api/notifications/preferences', { ...json({ supportEmail: value }), method: 'PATCH' }); say(t('Preference saved', 'Настройка сохранена')); } catch (e) { email.checked = !value; say(e.message); } finally { email.disabled = false; } });
      doc.body.appendChild(panel); doc.addEventListener('click', e => center.close(e)); doc.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) { panel.hidden = true; bell.focus(); } });
      try {
        const auth = await api('/api/auth/me'); center.setAuthenticated(Boolean(auth.isAuthenticated));
        if (state.authenticated) {
          try { const prefs = await api('/api/notifications/preferences'); email.checked = prefs.supportEmail; email.disabled = !prefs.emailAvailable; if (!prefs.emailAvailable) preferences.title = t('Email delivery unavailable', 'Почтовая доставка недоступна'); }
          catch (error) { email.disabled = true; say(error.message); }
        }
        if (state.authenticated && new env.URLSearchParams(env.location.search).has('notification')) center.toggle();
      } catch { center.setAuthenticated(false); }
      env.setInterval(() => { if (state.authenticated && !doc.hidden) center.refresh().catch(e => say(e.message)); }, 15000);
      doc.addEventListener('visibilitychange', () => { if (state.authenticated && !doc.hidden) center.refresh().catch(e => say(e.message)); });
      env.addEventListener('pageshow', () => { if (state.authenticated && !doc.hidden) center.refresh().catch(e => say(e.message)); });
    }
  };
  return center;
});
