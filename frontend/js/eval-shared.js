/**
 * Shared engine-evaluation helpers.
 *
 * This module is the single source of truth for the eval constants and the
 * formatting functions used by BOTH the replay viewer (replay.js /
 * replay-eval-worker.js) and the in-game eval bar (game.js /
 * game-eval-worker.js). Keeping them in one place stops the two screens from
 * drifting apart.
 *
 * Works as a browser global (classic script / importScripts) and as a CommonJS
 * module (Node tests).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    for (var k in api) {
      if (Object.prototype.hasOwnProperty.call(api, k)) root[k] = api[k];
    }
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // Version of the shipped engine bundle. Must match the ?v= used for
  // /js/ai-v1.js by the bot, the replay worker and the in-game eval worker.
  var EVAL_ENGINE_VERSION = '1.3.2';

  // Raw score of a decisive terminal position. Mate scores are WIN - ply, so a
  // position is "mate range" while |s| is within MATE_BAND of WIN.
  var EVAL_WIN = 100000;
  var EVAL_MATE_BAND = 64;

  // Per-position node budget (same value measured for the replay harness).
  var EVAL_DEFAULT_NODES = 250000;

  var EVAL_DEPTH_DEFAULT = 6;

  // winProb = 1 / (1 + exp(-s / EVAL_K)), s in raw engine units.
  // Calibration is NOT finished: the engine's raw scale reaches +/-1800..3000,
  // so the original 130 pinned the bar to the edge. 1000 matches the replay
  // harness; the exact value still needs tuning on a bigger sample.
  var EVAL_K = 1000;

  function winProb(s) {
    return 1 / (1 + Math.exp(-s / EVAL_K));
  }

  function isMate(ev) {
    return !!ev && Math.abs(ev.s) > EVAL_WIN - EVAL_MATE_BAND;
  }

  // Moves until the winning side promotes: ceil((WIN - |s|) / 2).
  function matePlies(ev) {
    return Math.ceil((EVAL_WIN - Math.abs(ev.s)) / 2);
  }

  // White-relative label used by the replay bar. Behaviour is byte-for-byte
  // identical to the original replay.js implementation.
  function formatEval(ev) {
    if (!ev) return '\u2013';
    if (ev.term && ev.draw) return '=';
    var s = ev.s;
    if (Math.abs(s) > EVAL_WIN - EVAL_MATE_BAND) {
      var n = Math.ceil((EVAL_WIN - Math.abs(s)) / 2);
      return (s > 0 ? '+' : '-') + 'M' + n;
    }
    var v = s / 100;
    if (v >= 20) return '+20+';
    if (v <= -20) return '-20+';
    return (v > 0 ? '+' : '') + v.toFixed(1);
  }

  // In-game bar label, relative to the player shown at the BOTTOM of the board.
  // bottomIdx is 0 (White) or 1 (Black). Positive means the bottom player is
  // ahead. Uses a real minus sign for negatives.
  function evalBarText(ev, bottomIdx) {
    if (!ev) return '';
    var s = (bottomIdx === 1) ? -ev.s : ev.s;
    if (ev.term && ev.draw) return '=';
    if (Math.abs(ev.s) > EVAL_WIN - EVAL_MATE_BAND) {
      var n = Math.ceil((EVAL_WIN - Math.abs(ev.s)) / 2);
      return (s > 0 ? '' : '\u2212') + 'M' + n;
    }
    var v = s / 100;
    if (v >= 20) return '+20+';
    if (v <= -20) return '\u221220+';
    if (Math.abs(v) < 0.05) return '=';
    return (v > 0 ? '+' : '\u2212') + Math.abs(v).toFixed(1);
  }

  // Fraction of the bar filled from the bottom player's side, clamped to
  // 2%..98% except for terminal/mate positions (exact 0% or 100%).
  function evalBarHeight(ev, bottomIdx) {
    if (!ev) return 0.5;
    var s = (bottomIdx === 1) ? -ev.s : ev.s;
    if (Math.abs(ev.s) > EVAL_WIN - EVAL_MATE_BAND) {
      return s > 0 ? 1 : 0;
    }
    if (ev.term && ev.draw) return 0.5;
    var p = winProb(s);
    return Math.max(0.02, Math.min(0.98, p));
  }

  // Screen-reader label for the bar (English; the bar title stays English in
  // both the original replay and the design).
  function evalBarAria(ev) {
    if (!ev) return 'Evaluation: even';
    if (Math.abs(ev.s) > EVAL_WIN - EVAL_MATE_BAND) {
      return (ev.s > 0 ? 'White' : 'Black') + ' wins in ' + matePlies(ev) + ' moves';
    }
    if (ev.term && ev.draw) return 'Evaluation: even';
    var v = ev.s / 100;
    if (Math.abs(v) < 0.1) return 'Evaluation: even';
    return 'Evaluation: ' + (v > 0 ? 'White' : 'Black') + ' ahead by ' + Math.abs(v).toFixed(1);
  }

  // {key, n, fixed} so the caller can do translate(key).replace('{n}', ...).
  // `fixed` is the number of decimals for n.
  function describeEval(ev) {
    if (!ev) return { key: 'eval_analyzing', n: 0, fixed: 0 };
    if (ev.term && ev.draw) return { key: 'eval_even', n: 0, fixed: 0 };
    if (Math.abs(ev.s) > EVAL_WIN - EVAL_MATE_BAND) {
      return {
        key: ev.s > 0 ? 'eval_white_mate' : 'eval_black_mate',
        n: matePlies(ev),
        fixed: 0
      };
    }
    var v = ev.s / 100;
    if (Math.abs(v) < 0.1) return { key: 'eval_even', n: 0, fixed: 0 };
    return {
      key: v > 0 ? 'eval_white_better' : 'eval_black_better',
      n: Math.abs(v),
      fixed: 1
    };
  }

  // Slim copy of a position for structured-clone to a worker. think() only
  // reads hWalls, vWalls, players[].pos, players[].wallsLeft, currentPlayer.
  function slimEvalState(s) {
    return {
      hWalls: s.hWalls,
      vWalls: s.vWalls,
      players: [
        { color: s.players[0].color, pos: { r: s.players[0].pos.r, c: s.players[0].pos.c }, wallsLeft: s.players[0].wallsLeft },
        { color: s.players[1].color, pos: { r: s.players[1].pos.r, c: s.players[1].pos.c }, wallsLeft: s.players[1].wallsLeft }
      ],
      currentPlayer: s.currentPlayer
    };
  }

  return {
    EVAL_ENGINE_VERSION: EVAL_ENGINE_VERSION,
    EVAL_WIN: EVAL_WIN,
    EVAL_MATE_BAND: EVAL_MATE_BAND,
    EVAL_DEFAULT_NODES: EVAL_DEFAULT_NODES,
    EVAL_DEPTH_DEFAULT: EVAL_DEPTH_DEFAULT,
    EVAL_K: EVAL_K,
    winProb: winProb,
    isMate: isMate,
    matePlies: matePlies,
    formatEval: formatEval,
    evalBarText: evalBarText,
    evalBarHeight: evalBarHeight,
    evalBarAria: evalBarAria,
    describeEval: describeEval,
    slimEvalState: slimEvalState
  };
});
