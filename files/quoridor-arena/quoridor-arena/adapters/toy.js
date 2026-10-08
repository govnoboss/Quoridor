'use strict';
// Self-test adapter: Nim (21 stones, take 1..3, last stone wins). Not Quoridor — only for testing the arena.

module.exports = {
  createInitialState: () => ({ pile: 21, turn: 0, winner: null }),
  cloneState: (s) => ({ ...s }),
  currentPlayer: (s) => s.turn,
  winner: (s) => s.winner,
  positionKey: (s) => s.pile + ':' + s.turn,
  legalMoves: (s) => { const m = []; for (let k = 1; k <= Math.min(3, s.pile); k++) m.push({ take: k }); return m; },
  applyMove(s, m) {
    if (!m || !Number.isInteger(m.take) || m.take < 1 || m.take > 3 || m.take > s.pile) return { error: 'bad take' };
    const pile = s.pile - m.take;
    return { state: { pile, turn: 1 - s.turn, winner: pile === 0 ? s.turn : null } };
  },
  makeBot(spec) {
    return {
      newGame() {},
      think(state, playerIdx, limits) {
        const legal = module.exports.legalMoves(state);
        if (Math.random() < spec.pSmart && state.pile % 4 !== 0) return { take: state.pile % 4 };
        return legal[Math.floor(Math.random() * legal.length)];
      },
    };
  },
};
