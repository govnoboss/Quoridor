/**
 * In-game eval worker.
 *
 * Computes ONE deterministic fixed-depth score per call, for the position the
 * player currently sees. Same deterministic recipe as the replay harness:
 * fixed seed, no opening variety, no archetypes, finite node budget (so v3
 * never falls back to a wall-clock deadline).
 *
 * Scores are returned from Player 0's (White) perspective. The main thread
 * converts them to the bottom player before drawing the bar.
 */

importScripts('/js/eval-shared.js?v=1.0.0');
importScripts('/shared.js');
importScripts('/js/ai-v1.js?v=' + EVAL_ENGINE_VERSION);

var engine = null;

function getEngine() {
  if (!engine) {
    engine = AiV1.createEngineV1({ seed: 1, variety: null, archetype: null });
  }
  return engine;
}

function terminalEval(winner, depth) {
  var s = 0;
  if (winner === 0) s = EVAL_WIN;
  else if (winner === 1) s = -EVAL_WIN;
  return {
    s: s,
    mate: winner === 0 || winner === 1,
    draw: winner === -1,
    depth: depth,
    truncated: false,
    term: true
  };
}

function computeOne(msg) {
  // Terminal result supplied by the caller (goal / timeout / surrender / draw).
  if (msg.terminal) {
    return terminalEval(msg.winner, msg.depth);
  }

  var snap = msg.snapshot;
  var go = Shared.isGameOver(snap);
  if (go && go.over) {
    return terminalEval(go.winner, msg.depth);
  }

  try {
    var eng = getEngine();
    eng.newGame(1);
    var res = eng.think(slimEvalState(snap), {
      player: snap.currentPlayer,
      maxDepth: msg.depth,
      nodes: EVAL_DEFAULT_NODES
    });
    var score = (snap.currentPlayer === 0) ? res.score : -res.score;
    var mate = Math.abs(score) > EVAL_WIN - EVAL_MATE_BAND;
    return {
      s: score,
      mate: mate,
      draw: false,
      depth: res.depth,
      truncated: res.nodes >= EVAL_DEFAULT_NODES && !mate,
      term: false
    };
  } catch (err) {
    return {
      s: 0,
      mate: false,
      draw: false,
      depth: 0,
      truncated: true,
      term: false,
      error: String((err && err.message) || err)
    };
  }
}

self.onmessage = function (e) {
  var msg = e.data || {};
  if (msg.type !== 'eval') return;
  var ev;
  try {
    ev = computeOne(msg);
  } catch (err) {
    ev = { s: 0, mate: false, draw: false, depth: 0, truncated: true, term: false, error: String((err && err.message) || err) };
  }
  self.postMessage({ type: 'result', token: msg.token, eval: ev });
};
