(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else window.PQSupportClient = factory;
})(function (env, options) {
  'use strict';
  options = options || {};
  const doc = env.document, admin = Boolean(options.admin);
  const drafts = new Map(), pending = new Set(), requestKeys = new Map();
  let current = null, loaded = null, revision = 0, lastMessages = '';
  const el = id => doc.getElementById(id);
  const ru = () => { try { return env.localStorage?.getItem('quoridor-lang') === 'ru'; } catch { return false; } };
  const label = (en, russian) => ru() ? russian : en;
  const key = () => env.crypto?.randomUUID?.() || `reply-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  async function api(url, body, method) {
    const response = await env.fetch(url, body === undefined ? { credentials: 'same-origin' } : { credentials: 'same-origin', method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }
  function status(message, failed = false) {
    const node = el('replyStatus'); node.textContent = message; node.style.display = message ? 'inline' : 'none'; node.style.color = failed ? '#ffaaaa' : 'var(--ok, #8dd8a0)'; node.setAttribute('role', failed ? 'alert' : 'status');
  }
  function write(id, value) { const node = el(id); if (node) node.textContent = value || ''; }
  async function open(id, background = false) {
    if (!/^[a-f\d]{24}$/i.test(id)) { status(label('Invalid report link', 'Некорректная ссылка на обращение'), true); return; }
    if (current && !background) drafts.set(current, el('replyInput').value);
    if (current !== id) {
      current = id; loaded = null; lastMessages = ''; el('replyInput').value = drafts.get(id) || ''; status('');
      write('detailSubject', label('Loading…', 'Загрузка…')); write('detailDesc', ''); el('msgList').replaceChildren();
      if (el('sendReplyBtn')) el('sendReplyBtn').disabled = true;
    }
    const request = ++revision, through = new Date().toISOString();
    try {
      const r = await api('/api/reports/' + id);
      if (current !== id || revision !== request) return;
      loaded = id; if (el('sendReplyBtn')) el('sendReplyBtn').disabled = pending.has(id);
      write('detailSubject', r.subject); write('detailDesc', r.description); write('detailDate', new Date(r.createdAt).toLocaleString()); write('detailStatus', r.status.replace('_', ' '));
      if (admin) {
        write('detailPlayer', r.userId?.username || 'Deleted account'); if (el('detailPlayer')) el('detailPlayer').href = r.userId ? '/profiles/' + encodeURIComponent(r.userId.username) : '#';
        write('detailIp', r.ip || '—'); write('detailDevice', r.deviceInfo?.userAgent || '—'); write('detailPlatform', r.deviceInfo?.platform || '—'); write('detailScreen', r.deviceInfo?.screenSize || '—'); write('detailLang', r.deviceInfo?.language || '—');
        el('detailModal').style.display = 'flex';
      } else {
        el('listView').style.display = 'none'; el('detailView').style.display = 'block'; el('detailView').classList.add('active'); el('replySection').style.display = 'block';
        if (r.status === 'closed') status(label('Your reply will reopen this report.', 'Ваш ответ заново откроет обращение.'));
      }
      const serialized = JSON.stringify(r.messages || []), container = el('msgList');
      if (serialized !== lastMessages) {
        const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 30;
        container.replaceChildren();
        (r.messages || []).forEach(m => {
          const row = doc.createElement('div'); row.className = 'msg msg-' + (m.role === 'admin' ? 'admin' : 'user');
          const role = doc.createElement('div'); role.className = 'msg-role'; role.textContent = m.role === 'admin' ? label('Support', 'Поддержка') : label('Player', 'Игрок');
          const text = doc.createElement('div'); text.textContent = m.text;
          const time = doc.createElement('div'); time.className = 'msg-time'; time.textContent = m.createdAt ? new Date(m.createdAt).toLocaleString() : '';
          row.appendChild(role); row.appendChild(text); row.appendChild(time); container.appendChild(row);
        });
        if (!background || atBottom) container.scrollTop = container.scrollHeight;
        lastMessages = serialized;
      }
      // Do not acknowledge background conversations while another page is visible.
      if (!doc.hidden) await api('/api/reports/' + id + '/read', { through: r.readThrough || through }).then(() => env.PQNotifications?.refresh()).catch(() => {});
    } catch (e) { if (current === id && revision === request) { status(e.message, true); if (!background) { if (admin) el('detailModal').style.display = 'flex'; else { el('detailView').style.display = 'block'; el('listView').style.display = 'none'; } } } }
  }
  async function send() {
    const id = current, input = el('replyInput'), text = input.value.trim();
    if (!id || loaded !== id || !text || pending.has(id)) return;
    const button = el('sendReplyBtn'); pending.add(id); if (button) button.disabled = true; status('');
    let attempt = requestKeys.get(id); if (!attempt || attempt.text !== text) { attempt = { text, key: key() }; requestKeys.set(id, attempt); }
    drafts.set(id, input.value);
    try {
      await api((admin ? '/api/admin/reports/' : '/api/reports/') + id + (admin ? '' : '/reply'), { [admin ? 'reply' : 'text']: text, clientRequestId: attempt.key }, admin ? 'PATCH' : 'POST');
      requestKeys.delete(id); drafts.delete(id);
      if (current === id) {
        // Preserve any newer edit made while the earlier message was in flight.
        if (input.value.trim() === text) input.value = '';
        status(label('Reply sent', 'Ответ отправлен')); await open(id, true);
      }
      options.afterSend?.();
    } catch (e) { if (current === id) status(e.message, true); }
    finally { pending.delete(id); if (button) button.disabled = false; }
  }
  function close(event) {
    if (event && event.target !== event.currentTarget) return;
    if (current) drafts.set(current, el('replyInput').value);
    current = null; loaded = null; revision++;
    if (admin) el('detailModal').style.display = 'none';
    else { el('listView').style.display = 'block'; el('detailView').style.display = 'none'; el('detailView').classList.remove('active'); options.afterSend?.(); }
  }
  const initial = env.location?.search && new env.URLSearchParams(env.location.search).get('report');
  if (initial) open(initial);
  env.setInterval?.(() => { if (!doc.hidden && current && !pending.has(current)) open(current, true); }, 15000);
  return { open, send, close, drafts, pending, get current() { return current; } };
});
