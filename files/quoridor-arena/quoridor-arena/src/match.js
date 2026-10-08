'use strict';
// Plays ONE game between two bot instances using an adapter (rules referee).

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mixSeed = (seed, id) => (Math.imul(seed | 0, 2654435761) ^ Math.imul(id + 1, 40503)) >>> 0;

/**
 * job: { seed, openingId, openingPlies, aFirst, limits, maxPlies, repetitionDraw }
 * Player index 0 moves first from the initial position; aFirst decides who is player 0.
 * Returns { aScore, plies, reason, timeMs:[a,b], moves, openingLen }
 */
function playGame(adapter, botA, botB, job) {
  const rng = mulberry32(mixSeed(job.seed, job.openingId));
  let state = adapter.createInitialState();
  const moves = [];

  // 1) seeded random opening (same opening is used for both colours of a pair)
  for (let i = 0; i < job.openingPlies; i++) {
    if (adapter.winner(state) !== null) break;
    const legal = adapter.legalMoves(state);
    if (!legal.length) break;
    const m = legal[Math.floor(rng() * legal.length)];
    const r = adapter.applyMove(state, m);
    if (r.error) throw new Error('adapter produced illegal opening move: ' + r.error);
    state = r.state; moves.push(m);
  }
  const openingLen = moves.length;

  const bots = job.aFirst ? [botA, botB] : [botB, botA];
  const aIdx = job.aFirst ? 0 : 1;
  bots.forEach((b) => b.newGame && b.newGame());
  const timeMs = [0, 0];
  const seen = new Map();

  const finish = (winnerIdx, reason) => ({
    aScore: winnerIdx === null ? 0.5 : winnerIdx === aIdx ? 1 : 0,
    plies: moves.length, reason, timeMs: job.aFirst ? [timeMs[0], timeMs[1]] : [timeMs[1], timeMs[0]],
    moves, openingLen,
  });

  while (moves.length < job.maxPlies) {
    const w = adapter.winner(state);
    if (w !== null) return finish(w, 'win');

    if (job.repetitionDraw) {
      const k = adapter.positionKey(state);
      const c = (seen.get(k) || 0) + 1;
      seen.set(k, c);
      if (c >= job.repetitionDraw) return finish(null, 'repetition');
    }

    const p = adapter.currentPlayer(state);
    const t0 = process.hrtime.bigint();
    let move;
    try {
      move = bots[p].think(adapter.cloneState(state), p, job.limits);
    } catch (e) {
      return finish(1 - p, 'crash:' + (e && e.message));
    }
    timeMs[p] += Number(process.hrtime.bigint() - t0) / 1e6;

    if (!move) return finish(1 - p, 'no-move');
    const r = adapter.applyMove(state, move);
    if (r.error) return finish(1 - p, 'illegal:' + r.error);
    state = r.state; moves.push(move);
  }
  return finish(null, 'maxplies');
}

module.exports = { playGame, mulberry32 };
