/**
 * Unit tests for the pure Undo logic (frontend/js/game-undo.js).
 * Covers the minimum matrix from the spec §11.
 */
const GameUndo = require('../frontend/js/game-undo.js');

// Simple alternating pawn shoves down the middle; builds a history of
// half-moves with correct playerIdx values.
function buildHistory() {
  const seq = [
    { r: 7, c: 4 }, // white
    { r: 1, c: 4 }, // black
    { r: 6, c: 4 }, // white
    { r: 2, c: 4 }, // black
    { r: 5, c: 4 }, // white
    { r: 3, c: 4 }  // black
  ];
  return seq.map((pos, i) => ({
    playerIdx: i % 2,
    move: { type: 'pawn', r: pos.r, c: pos.c }
  }));
}

describe('GameUndo.undoPlies', () => {
  it('player to move, long history -> removes 2 half-moves', () => {
    const history = buildHistory().slice(0, 4); // white just... it's White's turn (len 4)
    expect(GameUndo.undoPlies(history, 0, 0, false)).toBe(2);
  });

  it('bot to move (thinking) -> removes 1 half-move', () => {
    const history = buildHistory().slice(0, 3); // after White's 2nd move, Black to move
    expect(GameUndo.undoPlies(history, 1, 0, false)).toBe(1);
  });

  it('player is Black, only the bot opening move -> unavailable', () => {
    const history = buildHistory().slice(0, 1);
    expect(GameUndo.undoPlies(history, 1, 1, false)).toBe(0);
  });

  it('empty history -> unavailable', () => {
    expect(GameUndo.undoPlies([], 0, 0, false)).toBe(0);
    expect(GameUndo.undoPlies(null, 0, 0, false)).toBe(0);
  });

  it('game over -> unavailable', () => {
    const history = buildHistory().slice(0, 4);
    expect(GameUndo.undoPlies(history, 0, 0, true)).toBe(0);
  });
});

describe('GameUndo.stateFromHistory', () => {
  it('rebuilds the position and side to move for a kept prefix', () => {
    const history = buildHistory();
    const s = GameUndo.stateFromHistory(history, 2);
    expect(s.players[0].pos).toEqual({ r: 7, c: 4 });
    expect(s.players[1].pos).toEqual({ r: 1, c: 4 });
    expect(s.currentPlayer).toBe(0);
  });

  it('keepCount 0 returns the starting position', () => {
    const s = GameUndo.stateFromHistory(buildHistory(), 0);
    expect(s.players[0].pos).toEqual({ r: 8, c: 4 });
    expect(s.players[1].pos).toEqual({ r: 0, c: 4 });
    expect(s.currentPlayer).toBe(0);
  });

  it('wall moves are restored, including wall counters', () => {
    const history = [
      { playerIdx: 0, move: { type: 'pawn', r: 7, c: 4 } },
      { playerIdx: 1, move: { type: 'pawn', r: 1, c: 4 } },
      { playerIdx: 0, move: { type: 'wall', r: 6, c: 3, isVertical: false } },
      { playerIdx: 1, move: { type: 'pawn', r: 2, c: 4 } }
    ];
    const s = GameUndo.stateFromHistory(history, 3);
    expect(s.hWalls[6][3]).toBe(true);
    expect(s.players[0].wallsLeft).toBe(9);
    expect(s.players[0].pos).toEqual({ r: 7, c: 4 });
    expect(s.currentPlayer).toBe(1);
  });
});

describe('Three Undos in a row', () => {
  it('walks back to the starting position', () => {
    let history = buildHistory(); // len 6, White to move
    let currentPlayer = 0;

    let remove = GameUndo.undoPlies(history, currentPlayer, 0, false);
    expect(remove).toBe(2);
    history = history.slice(0, history.length - remove);
    let s = GameUndo.stateFromHistory(history, history.length);
    currentPlayer = s.currentPlayer;
    expect(s.players[0].pos).toEqual({ r: 6, c: 4 });
    expect(s.players[1].pos).toEqual({ r: 2, c: 4 });

    remove = GameUndo.undoPlies(history, currentPlayer, 0, false);
    expect(remove).toBe(2);
    history = history.slice(0, history.length - remove);
    s = GameUndo.stateFromHistory(history, history.length);
    currentPlayer = s.currentPlayer;
    expect(s.players[0].pos).toEqual({ r: 7, c: 4 });
    expect(s.players[1].pos).toEqual({ r: 1, c: 4 });

    remove = GameUndo.undoPlies(history, currentPlayer, 0, false);
    expect(remove).toBe(2);
    history = history.slice(0, history.length - remove);
    s = GameUndo.stateFromHistory(history, history.length);
    expect(s.players[0].pos).toEqual({ r: 8, c: 4 });
    expect(s.players[1].pos).toEqual({ r: 0, c: 4 });
    expect(history.length).toBe(0);
  });
});
