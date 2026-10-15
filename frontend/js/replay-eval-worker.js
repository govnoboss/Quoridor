/**
 * Replay eval worker.
 *
 * Computes a deterministic, fixed-depth search score for every replay position.
 * Scores are always expressed from Player 0's (White) perspective, regardless of
 * who is to move.
 *
 * Determinism contract:
 *   - fixed seed, no opening variety, no archetypes, no randomness in v3
 *   - fixed maxDepth for every position
 *   - a finite `nodes` budget so the engine never falls back to a wall-clock
 *     deadline (v3 checks time only when nodes === Infinity)
 *   - the transposition table is reset per position via engine.newGame(seed)
 *
 * The last replay position is terminal: it is never searched. Its score comes
 * from the game result (goal / timeout / surrender / draw), because the canonical
 * isGameOver() only detects wins by reaching the goal row.
 */

importScripts('/shared.js');
importScripts('/js/ai-v1.js?v=1.3.2');

var ENGINE_VERSION = '1.3.2';
var WIN = 100000;
var MATE_BAND = 64; // mate scores are +/- (WIN - ply), ply < MAXPLY (64)

// Per-position node budget. Measured over 167 real replays at depth 8: the
// worst single position used 75,893 nodes (~250 ms here); 250k gives ~3x
// headroom while staying deterministic (v3 only falls back to a wall-clock
// deadline when nodes === Infinity). The main thread still keeps a watchdog.
var DEFAULT_NODES = 250000;

var engine = null;

function getEngine() {
  if (!engine) {
    engine = AiV1.createEngineV1({ seed: 1, variety: null, archetype: null });
  }
  return engine;
}

// think()/load() only reads hWalls, vWalls, players[].pos, players[].wallsLeft
// and currentPlayer. Sending a slim copy keeps the structured clone cheap.
function slim(snapshot) {
  return {
    hWalls: snapshot.hWalls,
    vWalls: snapshot.vWalls,
    players: [
      {
        color: snapshot.players[0].color,
        pos: { r: snapshot.players[0].pos.r, c: snapshot.players[0].pos.c },
        wallsLeft: snapshot.players[0].wallsLeft
      },
      {
        color: snapshot.players[1].color,
        pos: { r: snapshot.players[1].pos.r, c: snapshot.players[1].pos.c },
        wallsLeft: snapshot.players[1].wallsLeft
      }
    ],
    currentPlayer: snapshot.currentPlayer
  };
}

function terminalEval(winner, depth) {
  var s = 0;
  if (winner === 0) s = WIN;
  else if (winner === 1) s = -WIN;
  return {
    s: s,
    mate: winner === 0 || winner === 1,
    draw: winner === -1,
    depth: depth,
    truncated: false,
    term: true
  };
}

function analyze(snapshots, depth, nodes, winner, token) {
  var eng = getEngine();
  var evals = [];
  var last = snapshots.length - 1;

  for (var i = 0; i < snapshots.length; i++) {
    var snap = snapshots[i];
    var go = Shared.isGameOver(snap);
    var over = (i === last) || go.over === true;
    var ev;

    if (over) {
      // A position that reached the goal row is authoritative; otherwise (last
      // position ended by timeout / surrender) fall back to the game result.
      var w = go.over ? go.winner : winner;
      ev = terminalEval(w, depth);
    } else {
      try {
        eng.newGame(1);
        var res = eng.think(slim(snap), {
          player: snap.currentPlayer,
          maxDepth: depth,
          nodes: nodes
        });
        var score = (snap.currentPlayer === 0) ? res.score : -res.score;
        var mate = Math.abs(score) > WIN - MATE_BAND;
        // Only the node budget binding counts as truncation. v3 also stops
        // early when a forced mate is proven (reached < depth) — that is a
        // correct, exact result, not an inaccurate one.
        ev = {
          s: score,
          mate: mate,
          draw: false,
          depth: res.depth,
          truncated: res.nodes >= nodes && !mate,
          term: false
        };
      } catch (err) {
        ev = {
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

    evals.push(ev);
    self.postMessage({ type: 'progress', token: token, i: i, eval: ev });
  }

  self.postMessage({ type: 'done', token: token, evals: evals });
}

self.onmessage = function (e) {
  var msg = e.data || {};
  if (msg.type === 'analyze') {
    try {
      analyze(msg.snapshots, msg.depth, msg.nodes, msg.winner, msg.token);
    } catch (err) {
      self.postMessage({ type: 'error', token: msg.token, message: String((err && err.message) || err) });
    }
  }
};
