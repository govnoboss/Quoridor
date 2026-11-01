/**
 * Pure Undo logic for bot games.
 *
 * Two independently-testable pieces:
 *   - undoPlies(...)          how many half-moves the Undo button must remove
 *   - stateFromHistory(...)   board/walls/currentPlayer reconstructed from the
 *                             kept prefix of the history (never by "reverse"
 *                             operations on the live state)
 *
 * No DOM, no Game/AI: safe to unit-test. Loads the canonical rules via
 * Shared (browser global) or require() (Node).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('../../quoridor-engine/rules'));
  } else {
    root.GameUndo = factory(root.Shared);
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (Shared) {
  'use strict';

  /**
   * Number of half-moves to remove for one Undo.
   *  - game over                          -> 0 (Undo unavailable)
   *  - empty history                      -> 0
   *  - player to move                     -> 2 (bot reply + player move), if
   *                                          the history is long enough;
   *                                          otherwise 0 (e.g. Black after the
   *                                          bot's single opening move)
   *  - bot to move (it may be thinking)   -> 1 (the player's last move)
   *
   * @param {Array} history
   * @param {number} currentPlayer
   * @param {number} myPlayerIndex
   * @param {boolean} isGameOver
   * @returns {number}
   */
  function undoPlies(history, currentPlayer, myPlayerIndex, isGameOver) {
    if (isGameOver) return 0;
    var len = (history && history.length) || 0;
    if (len === 0) return 0;
    if (currentPlayer === myPlayerIndex) {
      return len >= 2 ? 2 : 0;
    }
    return 1;
  }

  /**
   * Rebuild the game state after keeping the first `keepCount` half-moves.
   * Replays the canonical reducer from the initial position, so the side to
   * move and every counter come out correct. Returns a fresh state whose
   * hWalls/vWalls/players/currentPlayer the caller copies onto Game.state.
   *
   * @param {Array} history
   * @param {number} keepCount
   * @returns {object} full rules state
   */
  function stateFromHistory(history, keepCount) {
    var state = Shared.createInitialState({ base: 600 });
    var n = Math.max(0, Math.min(keepCount, (history && history.length) || 0));
    for (var i = 0; i < n; i++) {
      var rec = history[i];
      var m = (rec && rec.move) || {};
      state = Shared.gameReducer(state, {
        type: m.type,
        r: m.r,
        c: m.c,
        isVertical: !!m.isVertical,
        playerIdx: (typeof m.playerIdx === 'number') ? m.playerIdx : rec.playerIdx
      });
    }
    return state;
  }

  return {
    undoPlies: undoPlies,
    stateFromHistory: stateFromHistory
  };
});
