/* Shared, pure clock transitions. All stored durations are milliseconds; legacy
 * `timers` remains seconds on the wire for already-open timed-game clients. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GameClock = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function control(value, room) {
    if (value?.mode !== undefined && !['untimed', 'timed'].includes(value.mode)) throw new Error('Invalid time control');
    if (value && value.mode === 'untimed') return { mode: 'untimed', base: null, inc: 0 };
    const base = value && value.base, inc = value && value.inc !== undefined ? value.inc : 0;
    if (!Number.isFinite(base) || !Number.isFinite(inc) || !Number.isInteger(base) ||
        !Number.isInteger(inc) || base < 60 || base > 1800 || inc < 0 || inc > 60 ||
        (room && (![60, 180, 300, 600].includes(base) || inc !== 0))) throw new Error('Invalid time control');
    return { mode: 'timed', base, inc };
  }
  function start(game, now) {
    const tc = control(game.timeControl || { base: 600, inc: game.increment || 0 });
    game.timeControl = tc;
    game.clock = { version: 2, enabled: tc.mode !== 'untimed',
      remainingMs: tc.mode === 'untimed' ? null : [tc.base * 1000, tc.base * 1000],
      active: game.currentPlayer, startedAt: now, running: true, incrementMs: tc.inc * 1000 };
    game.startedAt = now; game.revision = 0; game.lastMoveTimestamp = now;
    game.timers = tc.mode === 'untimed' ? null : [tc.base, tc.base];
    return game;
  }
  function ensure(game) {
    if (game.clock && game.clock.version === 2) return game.clock;
    // Preserve active v1 clocks without inventing their missing original base.
    game.clock = { version: 2, enabled: true, remainingMs: game.timers.map(t => Math.max(0, t * 1000)),
      active: game.currentPlayer, startedAt: game.lastMoveTimestamp,
      running: !game.finished, incrementMs: (game.increment || 0) * 1000, legacy: true };
    game.revision = game.revision || 0;
    return game.clock;
  }
  function remaining(game, now) {
    const c = ensure(game);
    if (!c.enabled) return null;
    const out = c.remainingMs.slice();
    if (c.running) out[c.active] = Math.max(0, out[c.active] - Math.max(0, now - c.startedAt));
    return out;
  }
  function deadline(game) {
    const c = ensure(game);
    return c.enabled && c.running ? c.startedAt + c.remainingMs[c.active] : null;
  }
  function expired(game, now) { const d = deadline(game); return d !== null && now >= d; }
  function settle(game, now) {
    const c = ensure(game), out = remaining(game, now);
    c.remainingMs = out; c.startedAt = now;
    game.lastMoveTimestamp = now; game.timers = out && out.map(t => t / 1000);
    return out;
  }
  function moved(game, player, now, elapsedMs) {
    const c = ensure(game);
    if (c.enabled) c.remainingMs[player] += c.incrementMs;
    c.active = game.currentPlayer; c.startedAt = now;
    game.lastMoveTimestamp = now; game.revision = (game.revision || 0) + 1;
    game.timers = c.enabled ? c.remainingMs.map(t => t / 1000) : null;
    const record = game.history && game.history[game.history.length - 1];
    if (record) { record.clock = snapshot(game, now); record.elapsedMs = elapsedMs; record.timestamp = now; }
  }
  function stop(game, now) { settle(game, now); game.clock.running = false; game.revision = (game.revision || 0) + 1; }
  function snapshot(game, now) {
    const c = ensure(game);
    return { version: 2, enabled: c.enabled, remainingMs: remaining(game, now), active: c.active,
      running: c.running && !game.finished, sampledAt: now, revision: game.revision || 0,
      legacy: !!c.legacy };
  }
  function payload(game, now) {
    const clock = snapshot(game, now);
    return { clock, timers: clock.remainingMs && clock.remainingMs.map(t => t / 1000),
      serverNow: now, revision: game.revision || 0, timeControl: game.timeControl || null,
      initialTime: game.timeControl && game.timeControl.base || 0, gameMode: game.gameMode || (game.isRanked ? 'ranked' : 'normal') };
  }
  return { control, start, ensure, remaining, deadline, expired, settle, moved, stop, snapshot, payload };
});
