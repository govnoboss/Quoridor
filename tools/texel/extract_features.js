'use strict';
/**
 * Texel feature extraction: replays arena JSONL logs and emits one line per position
 * with a raw feature vector (side-to-move perspective) + game outcome label.
 *
 * Output: { f: number[], y: 0|1, label: "..." }  (y = 1 if side-to-move eventually won)
 *
 * Run:  node tools/texel/extract_features.js > tools/texel/features.jsonl
 */
const fs = require('fs');
const path = require('path');
const rules = require('../../quoridor-engine/rules/quoridor-rules');
const { generateMoves, applyInPlace } = require('../../quoridor-engine/rules/moves');

const ROOT = path.resolve(__dirname, '../..');
const LOGS = [
  'quoridor-engine/rr3.jsonl',
  'quoridor-engine/arena/results/selftest.jsonl',
  'quoridor-engine/arena/results/gui-test.jsonl',
  'quoridor-engine/arena/results/probe-hard-vs-medium.jsonl',
  'quoridor-engine/arena/results/probe-hard-vs-random.jsonl',
  'quoridor-engine/arena/results/probe-medium-vs-easy.jsonl',
  'files/quoridor-arena/quoridor-arena/results/selftest.jsonl',
];

// --- BFS distances (opponent pawn blocks the square; jumps handled by step graph) ---
function distMap(state, player) {
  const me = state.players[player];
  const opp = state.players[1 - player];
  const target = player === 0 ? 0 : 8;
  const grid = new Int16Array(81).fill(-1);
  const q = new Int32Array(81);
  let head = 0, tail = 0;
  const start = me.pos.r * 9 + me.pos.c;
  grid[start] = 0;
  q[tail++] = start;
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  while (head < tail) {
    const cur = q[head++];
    const r = (cur / 9) | 0, c = cur % 9;
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;
      const v = nr * 9 + nc;
      if (grid[v] !== -1) continue;
      // blocked by my own wall?
      if (dr === -1 && state.hWalls[r - 1] && state.hWalls[r - 1][c]) continue;
      if (dr === 1 && state.hWalls[r] && state.hWalls[r][c]) continue;
      if (dc === -1 && state.vWalls[r] && state.vWalls[r][c - 1]) continue;
      if (dc === 1 && state.vWalls[r] && state.vWalls[r][c]) continue;
      // occupied by opponent pawn -> would be a jump; treat as blocked for plain BFS
      if (nr === opp.pos.r && nc === opp.pos.c) continue;
      grid[v] = grid[cur] + 1;
      q[tail++] = v;
    }
  }
  return grid;
}

function goalDist(grid, player) {
  const target = player === 0 ? 0 : 8;
  let best = Infinity;
  for (let c = 0; c < 9; c++) {
    const v = target * 9 + c;
    if (grid[v] >= 0 && grid[v] < best) best = grid[v];
  }
  return best;
}

function manhattan(pos, player) {
  return player === 0 ? pos.r : 8 - pos.r;
}

/** count free pawn squares from pos (mobility) */
function pawnMobility(state, player) {
  const p = state.players[player];
  return rules.getJumpTargets(state, p.pos.r, p.pos.c).length;
}

/**
 * Raw feature vector, side-to-move perspective.
 * Positive = good for side to move.
 */
function features(state) {
  const me = state.currentPlayer;
  const opp = 1 - me;
  const pMe = state.players[me], pOpp = state.players[opp];

  const dMe = goalDist(distMap(state, me), me);
  const dOpp = goalDist(distMap(state, opp), opp);
  const mM = manhattan(pMe.pos, me);
  const mO = manhattan(pOpp.pos, opp);

  const cols = [
    (dOpp - dMe),                     // distance adv (positive = I'm closer)
    Math.pow(Math.max(0, 9 - dMe), 1.5) - Math.pow(Math.max(0, 9 - dOpp), 1.5), // urgency adv
    pMe.wallsLeft - pOpp.wallsLeft,   // wall material adv
    (dOpp - mO) - (dMe - mM),         // path inflation adv (my walls hurt them more than theirs hurt me)
    -Math.abs(4 - pMe.pos.c),         // centering
    pawnMobility(state, me) - pawnMobility(state, opp), // mobility adv
    mM - mO,                          // race adv (rows to go)
    pMe.wallsLeft + pOpp.wallsLeft,   // total material left
    1                                 // bias
  ];
  return cols;
}

const FEATURE_NAMES = [
  'distance', 'urgency', 'wallMaterial', 'pathInflation', 'center', 'mobility', 'race', 'wallsTotal', 'bias'
];

function outcomeFromView(aScore, aFirst, me) {
  // aScore: 1 if a won, 0 if lost (arena format). me: is side-to-move the player a?
  const aWon = aScore === 1;
  const iWon = me === aFirst ? aWon : !aWon;
  return iWon ? 1 : 0;
}

function main() {
  const out = [];
  let games = 0;
  for (const rel of LOGS) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      let d;
      try { d = JSON.parse(s); } catch (e) { continue; }
      if (!d.moves || d.aScore === undefined) continue;
      games++;
      const state = rules.createInitialState();
      // opening moves come first in d.moves? assume moves are full game including opening
      for (let i = 0; i < d.moves.length; i++) {
        const mv = d.moves[i];
        const me = state.currentPlayer;
        const f = features(state);
        out.push({ f, y: outcomeFromView(d.aScore, d.aFirst, me), gi: games, i });
        const prevPos = { ...state.players[me].pos };
        if (!applyInPlace(rules, state, mv)) {
          // opening/illegal in replay -> stop this game
          break;
        }
      }
    }
  }
  const header = JSON.stringify({ features: FEATURE_NAMES });
  const lines = [header].concat(out.map(o => JSON.stringify(o)));
  fs.writeFileSync(path.join(__dirname, 'features.jsonl'), lines.join('\n') + '\n', 'utf8');
  process.stderr.write(`games=${games} positions=${out.length}\n`);
}

main();
