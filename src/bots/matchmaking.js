'use strict';
/**
 * Bot matchmaking — pure helpers used by BotManager to pick a human player's next bot opponent.
 *
 * The problem: with a small pool of bot accounts and a handful of opening styles, a player who plays
 * several bot games in a row tends to meet the same bot (or the same style) over and over. Two of the
 * three rules here fix that and the third keeps it from over-correcting:
 *
 *   1. avoid-repeat — the last `avoidLast` opponent identities are excluded when other options exist.
 *   2. least-recently-seen — among the rest, bots the player has not faced (or faced longest ago) win.
 *   3. contrast — occasionally force an opponent whose tier/style differs most from the previous one.
 *
 * Everything is a pure function of (candidates, recent, rng) so it can be unit-tested without Mongo,
 * Redis or the socket server. `recent` is ordered most-recent-first: [{ id, difficulty, style, at }].
 */

const { personality } = require('../../quoridor-engine/engines/personality');

/**
 * Stable per-bot identity. Account bots key off the DB id so the same bot keeps its style (and its
 * place in a player's history) across matches; guests are re-created per match, so their template name
 * is the only stable handle they have.
 */
function botIdentity({ kind, userId, name } = {}) {
    if (kind === 'account' && userId) return `acct:${userId}`;
    return `guest:${name || 'unknown'}`;
}

/**
 * Compact style signature: tier plus the bot's signature opening plan. Two bots with the same signature
 * look alike to a player (same strength, same opening idea), which is exactly what matchmaking spreads.
 */
function styleOf(identity, difficulty) {
    const p = personality(identity);
    return `${difficulty}/${p.archetypes[0]}`;
}

/**
 * Pick a candidate. `candidates` are normalized objects ({ identity, difficulty, style, ... }); `recent`
 * is the player's opponent history, newest first. `opts.rng` defaults to Math.random; `opts.avoidLast`
 * and `opts.contrastP` tune the two matchmaking rules.
 */
function chooseBot(candidates, recent, opts = {}) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const rng = opts.rng || Math.random;
    const avoidLast = opts.avoidLast != null ? opts.avoidLast : 2;
    const contrastP = opts.contrastP != null ? opts.contrastP : 0.2;
    const hist = Array.isArray(recent) ? recent : [];
    const last = hist[0] || null;

    // 1. avoid-repeat: drop the identities seen in the last `avoidLast` games, if that leaves anyone.
    const recentIds = new Set(hist.slice(0, avoidLast).map((r) => r && r.id));
    let pool = candidates.filter((c) => !recentIds.has(c.identity));
    if (pool.length === 0) pool = candidates.slice();

    // Soft avoid the immediately previous STYLE too (same tier + same opening plan), when alternatives
    // remain — "not the same bot or the same style twice in a row".
    if (last && last.style) {
        const noSameStyle = pool.filter((c) => c.style !== last.style);
        if (noSameStyle.length) pool = noSameStyle;
    }

    // 3. contrast: sometimes deliberately change opponent type/tier from the previous game.
    if (last && rng() < contrastP) {
        const diff = (c) => (c.difficulty !== last.difficulty ? 2 : 0) + (c.style !== last.style ? 1 : 0);
        let bestD = -1;
        for (const c of pool) { const d = diff(c); if (d > bestD) bestD = d; }
        const contrast = pool.filter((c) => diff(c) === bestD);
        return contrast[Math.floor(rng() * contrast.length)] || pool[0];
    }

    // 2. least-recently-seen: never-faced (rank Infinity) first, else the stalest entries. A small bucket
    // is chosen among at random so the same "new" bot is not always the winner.
    const rank = new Map();
    hist.forEach((r, i) => { if (r && !rank.has(r.id)) rank.set(r.id, i); });
    const ranks = pool.map((c) => (rank.has(c.identity) ? rank.get(c.identity) : Infinity));
    const maxR = Math.max(...ranks);
    const floor = maxR === Infinity ? Infinity : maxR - 1;
    const bucket = pool.filter((_, i) => ranks[i] >= floor);
    const list = bucket.length ? bucket : pool;
    return list[Math.floor(rng() * list.length)];
}

module.exports = { botIdentity, styleOf, chooseBot };
