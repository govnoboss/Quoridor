'use strict';
/**
 * Quoridor engine v3  —  quoridor-engine/engines/v3/index.js
 *
 * A self-contained search engine written independently of v0/v1/v2 (it replaces neither: it sits next
 * to them until the arena says otherwise). It reads the canonical state ONCE per think() into its own
 * compact board (the input state is never touched), searches, and converts the answer back to a
 * canonical move.
 *
 * Techniques:
 *  - board: 81-cell array with per-cell "blocked edge" bitmask (O(1) wall set/unset), boundary bits pre-set
 *  - incremental 2x32-bit Zobrist hashing (seeded), 2-way bucket transposition table on typed arrays
 *  - negamax + PVS + iterative deepening + aspiration windows + LMR + killers + history heuristic
 *  - shortest-path DAG analysis per node: BFS distance fields AND counts of shortest paths (forward/backward)
 *      -> wall candidates = walls that cut ALL shortest paths of the opponent ("attack") plus a few
 *         "funnel" walls that remove >= 50% of them; legality of a wall is checked by BFS only when the wall
 *         touches a bridge of the shortest-path DAG (otherwise both players provably keep their paths)
 *  - exact immediate-win detection (incl. jumps), threat extensions near the goal
 *  - evaluation: path-length race, tempo, wall economy, path flexibility, urgency curve, pure-race endgame
 *  - repetition handling: in-search path repetition + real game history, root-relative contempt (anti-loop)
 *  - node budget (deterministic) and/or wall-clock budget, both hard-enforced
 *
 * Arena rules (see "Как добавить бота"): no Math.random (seeded rng), all state on the instance,
 * wrong player throws, no console output.
 *
 * DELIBERATE DEVIATION — think() BEFORE newGame(): the other engines in this repo have no newGame()
 * at all (the arena adapter re-runs the factory per game), while every site caller — BotManager,
 * the browser worker, the demo board — goes straight to think(). So the factory calls newGame(opt.seed)
 * itself and an explicit newGame(seed) merely re-seeds. There is no "not started" error path.
 *
 * ADAPT markers = the only places that depend on the canonical rules module conventions.
 */

let Rules = null;
try { Rules = require('../../rules'); } catch (_) { /* engine works without it */ }
let externalMakeRng = null;
try { externalMakeRng = require('../../tools/rng').makeRng; } catch (_) { /* fallback below */ }

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeSeededRng(seed) {
  if (externalMakeRng) {
    const r = externalMakeRng(seed);
    if (typeof r === 'function') return r;
    if (r && typeof r.next === 'function') return () => r.next();
    if (r && typeof r.random === 'function') return () => r.random();
  }
  return mulberry32(seed >>> 0);
}

// ---------- constants ----------
const MAXPLY = 64;
const MAXM = 160;            // move list stride per ply
const WIN = 100000;
const INF = 1000000;
const B_N = 1, B_E = 2, B_S = 4, B_W = 8;
const EXACT = 0, LOWER = 1, UPPER = 2;
const DIFFICULTY_DEPTH = { easy: 2, medium: 4, hard: 56 };
const DIFFICULTY_MS = { easy: 100, medium: 300, hard: 1000 }; // used only if neither nodes nor timeMs given

// Site tiers: eval profiles layered on the default weights (path: 100 stays the anchor everywhere).
// Depth is external (src/core/ai-v1-bundle.js DIFFICULTY_DEPTH); these only shape the evaluation.
// hard/impossible are empty: their gap is search depth, everything else is the full tuned eval.
const DIFFICULTY_WEIGHTS = {
  easy:       { tempo: 30, wall: 0,  flex: 0, race: 300,  urg: 0,   center: 0,  infl: 0 },
  medium:     { tempo: 35, wall: 12, flex: 4, race: 700,  urg: 2,   center: 15, infl: 30 },
  hard:       {},
  impossible: {},
};

// Probability of playing a random pawn move instead of a searched one, per site tier. Measured in
// the arena: p=0.3 costs ~400 Elo — the only cheap lever that makes a tier genuinely weak without
// teaching the eval to play badly (a "simpler" eval at low depth turns out to play BETTER).
// Explicit opt.randomP overrides the table for experiments.
const DIFFICULTY_RANDOM = { easy: 0.3, medium: 0.1, hard: 0, impossible: 0 };

// ---------- ADAPT: canonical move encoding ----------
// Canonical wall move shape used by the site: { type:'wall', r, c, isVertical }. Pawn: { type:'pawn', r, c }.
function encodeMove(code) {
  if (code < 128) return { type: 'pawn', r: (code / 9) | 0, c: code % 9 };
  const w = code - 128, isV = w >= 64, i = isV ? w - 64 : w;
  return { type: 'wall', r: i >> 3, c: i & 7, isVertical: isV };
}

function createEngineV3(options = {}) {
  const opt = {
    seed: 1, timeMs: null, nodes: null, maxDepth: null, difficulty: null,
    randomP: null, ttBits: 18, contempt: 35,
    maxWallsNode: 8, maxWallsRoot: 16, funnelNode: 3, funnelRoot: 6,
    goalRows: null, weights: {}, encodeMove,
    ...options,
  };
  // Eval weights resolve from the effective difficulty at think() time (limits.difficulty wins,
  // same as DIFFICULTY_MS / DIFFICULTY_DEPTH / the random-move branch), so a caller that only passes
  // difficulty per think still gets the tier's eval. opt.weights always overrides the profile.
  let W = null, URG = null, appliedDifficulty;
  function applyDifficultyWeights(d) {
    if (d === appliedDifficulty) return;
    appliedDifficulty = d;
    W = { path: 100, tempo: 45, wall: 26, flex: 9, race: 1200, urg: 5, center: 35, infl: 60, ...(DIFFICULTY_WEIGHTS[d] || null), ...opt.weights };
    URG = new Int32Array(20);
    for (let i = 0; i < 20; i++) URG[i] = i < 9 ? Math.round(Math.pow(9 - i, 1.5) * W.urg) : 0;
  }
  applyDifficultyWeights(opt.difficulty || 'hard');

  // ---------- per-instance state (allocated in newGame) ----------
  let started = false, rng = null, seed0 = opt.seed;
  let zP1, zP2, zH1, zH2, zV1, zV2, zW1, zW2, zT1 = 0, zT2 = 0;
  let tt = null, ttMask = 0;
  const edges = new Uint8Array(81), hW = new Uint8Array(64), vW = new Uint8Array(64);
  const cell = [0, 0], wallsLeft = [0, 0];
  const goalRow = [8, 0];
  let goalKnown = false, turn = 0, h1 = 0, h2 = 0;

  const dist = [new Uint8Array(81), new Uint8Array(81)];
  const cG = [new Float64Array(81), new Float64Array(81)];
  const cF = [new Float64Array(81), new Float64Array(81)];
  const ord = [new Uint8Array(81), new Uint8Array(81)];
  const ordN = [0, 0];
  const tmpD = new Uint8Array(81), tmpC = new Float64Array(81), tmpO = new Uint8Array(81);
  const tmpMoves = new Int32Array(8);
  const mvBuf = new Int32Array(MAXPLY * MAXM), scBuf = new Int32Array(MAXPLY * MAXM);
  const pathH1 = new Int32Array(MAXPLY + 4), pathH2 = new Int32Array(MAXPLY + 4);
  const killer1 = new Int32Array(MAXPLY + 4), killer2 = new Int32Array(MAXPLY + 4);
  const hist = new Int32Array(512);
  const wStamp = new Int32Array(128); let stampId = 0;
  const cAttCode = new Int32Array(140), cAttNet = new Int32Array(140);
  const cFunCode = new Int32Array(140), cFunRat = new Float64Array(140);
  let gameSeen = new Map();

  // search-time
  let nodes = 0, nodeLimit = Infinity, deadline = Infinity, stopped = false, rootSide = 0, extLimit = 0;
  let rootIterMove = -1, rootIterScore = 0, rootBanOn = false;

  // ---------- board primitives ----------
  function resetEdges() {
    edges.fill(0);
    for (let c = 0; c < 9; c++) { edges[c] |= B_N; edges[72 + c] |= B_S; }
    for (let r = 0; r < 9; r++) { edges[r * 9] |= B_W; edges[r * 9 + 8] |= B_E; }
  }
  function setWall(isV, r, c, on) {
    const a = r * 9 + c;
    if (!isV) {
      if (on) { edges[a] |= B_S; edges[a + 1] |= B_S; edges[a + 9] |= B_N; edges[a + 10] |= B_N; }
      else { edges[a] &= ~B_S; edges[a + 1] &= ~B_S; edges[a + 9] &= ~B_N; edges[a + 10] &= ~B_N; }
    } else if (on) { edges[a] |= B_E; edges[a + 9] |= B_E; edges[a + 1] |= B_W; edges[a + 10] |= B_W; }
    else { edges[a] &= ~B_E; edges[a + 9] &= ~B_E; edges[a + 1] &= ~B_W; edges[a + 10] &= ~B_W; }
  }
  function wallFree(isV, r, c) {
    const i = r * 8 + c;
    if (hW[i] || vW[i]) return false;
    if (!isV) { if (c > 0 && hW[i - 1]) return false; if (c < 7 && hW[i + 1]) return false; }
    else { if (r > 0 && vW[i - 8]) return false; if (r < 7 && vW[i + 8]) return false; }
    return true;
  }

  function computeHash() {
    h1 = 0; h2 = 0;
    for (let p = 0; p < 2; p++) {
      h1 ^= zP1[p * 81 + cell[p]]; h2 ^= zP2[p * 81 + cell[p]];
      const wl = Math.min(10, wallsLeft[p]);
      h1 ^= zW1[p * 11 + wl]; h2 ^= zW2[p * 11 + wl];
    }
    for (let i = 0; i < 64; i++) {
      if (hW[i]) { h1 ^= zH1[i]; h2 ^= zH2[i]; }
      if (vW[i]) { h1 ^= zV1[i]; h2 ^= zV2[i]; }
    }
    if (turn === 1) { h1 ^= zT1; h2 ^= zT2; }
  }

  function make(code, ply) {
    const p = turn;
    if (code < 128) {
      const from = cell[p];
      h1 ^= zP1[p * 81 + from] ^ zP1[p * 81 + code]; h2 ^= zP2[p * 81 + from] ^ zP2[p * 81 + code];
      cell[p] = code;
      stFrom[ply] = from;
    } else {
      const w = code - 128, isV = w >= 64, i = isV ? w - 64 : w;
      if (isV) { vW[i] = 1; h1 ^= zV1[i]; h2 ^= zV2[i]; } else { hW[i] = 1; h1 ^= zH1[i]; h2 ^= zH2[i]; }
      setWall(isV, i >> 3, i & 7, true);
      const wl = wallsLeft[p];
      h1 ^= zW1[p * 11 + wl] ^ zW1[p * 11 + wl - 1]; h2 ^= zW2[p * 11 + wl] ^ zW2[p * 11 + wl - 1];
      wallsLeft[p] = wl - 1;
    }
    turn = 1 - p; h1 ^= zT1; h2 ^= zT2;
  }
  const stFrom = new Int32Array(MAXPLY + 4);
  function unmake(code, ply) {
    turn = 1 - turn; const p = turn;
    if (code < 128) cell[p] = stFrom[ply];
    else {
      const w = code - 128, isV = w >= 64, i = isV ? w - 64 : w;
      if (isV) vW[i] = 0; else hW[i] = 0;
      setWall(isV, i >> 3, i & 7, false);
      wallsLeft[p]++;
    }
    h1 = pathH1[ply]; h2 = pathH2[ply];
  }

  // ---------- shortest-path analysis ----------
  function bfs(p, d, cg, o) {
    d.fill(255);
    const gr = goalRow[p] * 9; let qh = 0, qt = 0;
    for (let c = 0; c < 9; c++) { const i = gr + c; d[i] = 0; cg[i] = 1; o[qt++] = i; }
    while (qh < qt) {
      const u = o[qh++], e = edges[u], du = d[u] + 1, cu = cg[u];
      let v, dv;
      if (!(e & B_N)) { v = u - 9; dv = d[v]; if (dv === 255) { d[v] = du; cg[v] = cu; o[qt++] = v; } else if (dv === du) cg[v] += cu; }
      if (!(e & B_E)) { v = u + 1; dv = d[v]; if (dv === 255) { d[v] = du; cg[v] = cu; o[qt++] = v; } else if (dv === du) cg[v] += cu; }
      if (!(e & B_S)) { v = u + 9; dv = d[v]; if (dv === 255) { d[v] = du; cg[v] = cu; o[qt++] = v; } else if (dv === du) cg[v] += cu; }
      if (!(e & B_W)) { v = u - 1; dv = d[v]; if (dv === 255) { d[v] = du; cg[v] = cu; o[qt++] = v; } else if (dv === du) cg[v] += cu; }
    }
    return qt;
  }
  function fwd(start, d, o, qt, cf) {
    cf.fill(0); cf[start] = 1;
    for (let k = qt - 1; k >= 0; k--) {
      const u = o[k], c = cf[u];
      if (c === 0 || d[u] === 0) continue;
      const e = edges[u], dn = d[u] - 1;
      if (!(e & B_N) && d[u - 9] === dn) cf[u - 9] += c;
      if (!(e & B_E) && d[u + 1] === dn) cf[u + 1] += c;
      if (!(e & B_S) && d[u + 9] === dn) cf[u + 9] += c;
      if (!(e & B_W) && d[u - 1] === dn) cf[u - 1] += c;
    }
  }
  function analyzeDist() {
    ordN[0] = bfs(0, dist[0], cG[0], ord[0]);
    ordN[1] = bfs(1, dist[1], cG[1], ord[1]);
  }
  function analyzeCounts() {
    fwd(cell[0], dist[0], ord[0], ordN[0], cF[0]);
    fwd(cell[1], dist[1], ord[1], ordN[1], cF[1]);
  }
  // number of shortest paths of player p that use the undirected edge a-b
  function through(p, a, b) {
    const d = dist[p];
    if (d[b] + 1 === d[a]) return cF[p][a] * cG[p][b];
    if (d[a] + 1 === d[b]) return cF[p][b] * cG[p][a];
    return 0;
  }

  // ---------- pawn moves ----------
  function genPawn(me, out, base) {
    const c0 = cell[me], oc = cell[1 - me], e = edges[c0];
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const bit = 1 << k;
      if (e & bit) continue;
      const dl = k === 0 ? -9 : k === 1 ? 1 : k === 2 ? 9 : -1;
      const v = c0 + dl;
      if (v !== oc) { out[base + n++] = v; continue; }
      const ev = edges[v];
      if (!(ev & bit)) { out[base + n++] = v + dl; continue; }
      // straight jump blocked: diagonals
      if (k & 1) { // moving E/W -> diagonals go N or S
        if (!(ev & B_N)) out[base + n++] = v - 9;
        if (!(ev & B_S)) out[base + n++] = v + 9;
      } else {     // moving N/S -> diagonals go E or W
        if (!(ev & B_E)) out[base + n++] = v + 1;
        if (!(ev & B_W)) out[base + n++] = v - 1;
      }
    }
    return n;
  }
  // returns the winning pawn move (cell code) or -1
  function canWinNow(me) {
    const n = genPawn(me, tmpMoves, 0), gr = goalRow[me];
    for (let i = 0; i < n; i++) if (((tmpMoves[i] / 9) | 0) === gr) return tmpMoves[i];
    return -1;
  }

  // ---------- wall candidates ----------
  function tryWall(isV, r, c, me, st) {
    const op = 1 - me, i = r * 8 + c, wid = (isV ? 64 : 0) + i;
    if (wStamp[wid] === stampId) return;
    wStamp[wid] = stampId;
    if (!wallFree(isV, r, c)) return;
    let a1, b1, a2, b2;
    if (!isV) { a1 = r * 9 + c; b1 = a1 + 9; a2 = a1 + 1; b2 = b1 + 1; }
    else { a1 = r * 9 + c; b1 = a1 + 1; a2 = a1 + 9; b2 = b1 + 9; }
    const sumO = through(op, a1, b1) + through(op, a2, b2);
    const sumS = through(me, a1, b1) + through(me, a2, b2);
    const selfBridge = sumS >= st.Ts - 0.5;
    const code = 128 + wid;
    if (sumO >= st.To - 0.5) {
      setWall(isV, r, c, true);
      bfs(op, tmpD, tmpC, tmpO);
      const nd = tmpD[cell[op]];
      let ok = nd !== 255, selfCost = 0;
      if (ok && selfBridge) {
        bfs(me, tmpD, tmpC, tmpO);
        const ns = tmpD[cell[me]];
        if (ns === 255) ok = false; else selfCost = ns - st.curS;
      }
      setWall(isV, r, c, false);
      if (!ok) return;
      const gain = nd - st.curO, net = gain - selfCost;
      if (net > 0) { cAttCode[st.na] = code; cAttNet[st.na++] = net; }
      else if (selfCost === 0) { cFunCode[st.nf] = code; cFunRat[st.nf++] = 1; }
    } else if (!selfBridge && sumO / st.To >= 0.5) {
      cFunCode[st.nf] = code; cFunRat[st.nf++] = sumO / st.To;
    }
  }
  function genWallCands(me, base, n, isRoot) {
    const op = 1 - me, dO = dist[op], cFo = cF[op], ordO = ord[op], nO = ordN[op];
    const st = {
      To: cG[op][cell[op]], Ts: cG[me][cell[me]], curO: dO[cell[op]], curS: dist[me][cell[me]], na: 0, nf: 0,
    };
    stampId++;
    for (let k = 0; k < nO; k++) {
      const u = ordO[k];
      if (cFo[u] === 0) continue;
      const du = dO[u];
      if (du === 0) continue;
      const e = edges[u], ur = (u / 9) | 0, uc = u - ur * 9;
      if (!(e & B_N) && dO[u - 9] === du - 1) { // boundary between rows ur-1 and ur
        const r1 = ur - 1;
        if (uc <= 7) tryWall(false, r1, uc, me, st);
        if (uc >= 1) tryWall(false, r1, uc - 1, me, st);
      }
      if (!(e & B_S) && dO[u + 9] === du - 1) {
        if (uc <= 7) tryWall(false, ur, uc, me, st);
        if (uc >= 1) tryWall(false, ur, uc - 1, me, st);
      }
      if (!(e & B_E) && dO[u + 1] === du - 1) { // boundary between columns uc and uc+1
        if (ur <= 7) tryWall(true, ur, uc, me, st);
        if (ur >= 1) tryWall(true, ur - 1, uc, me, st);
      }
      if (!(e & B_W) && dO[u - 1] === du - 1) {
        const c1 = uc - 1;
        if (ur <= 7) tryWall(true, ur, c1, me, st);
        if (ur >= 1) tryWall(true, ur - 1, c1, me, st);
      }
    }
    const maxA = isRoot ? opt.maxWallsRoot : opt.maxWallsNode;
    const maxF = isRoot ? opt.funnelRoot : opt.funnelNode;
    // partial selection sorts (counts are small)
    for (let i = 0; i < Math.min(maxA, st.na); i++) {
      let b = i;
      for (let j = i + 1; j < st.na; j++) if (cAttNet[j] > cAttNet[b]) b = j;
      if (b !== i) { const c = cAttCode[i], v = cAttNet[i]; cAttCode[i] = cAttCode[b]; cAttNet[i] = cAttNet[b]; cAttCode[b] = c; cAttNet[b] = v; }
      mvBuf[base + n] = cAttCode[i]; scBuf[base + n++] = 3000 + cAttNet[i] * 1500;
    }
    for (let i = 0; i < Math.min(maxF, st.nf); i++) {
      let b = i;
      for (let j = i + 1; j < st.nf; j++) if (cFunRat[j] > cFunRat[b]) b = j;
      if (b !== i) { const c = cFunCode[i], v = cFunRat[i]; cFunCode[i] = cFunCode[b]; cFunRat[i] = cFunRat[b]; cFunCode[b] = c; cFunRat[b] = v; }
      mvBuf[base + n] = cFunCode[i]; scBuf[base + n++] = 2500 + ((cFunRat[i] * 400) | 0);
    }
    return n;
  }
  function genMoves(me, ply, ttMove, isRoot) {
    const base = ply * MAXM;
    let n = genPawn(me, mvBuf, base);
    const d = dist[me], cur = d[cell[me]];
    for (let i = 0; i < n; i++) scBuf[base + i] = 4000 + (cur - d[mvBuf[base + i]]) * 1200;
    if (wallsLeft[me] > 0) n = genWallCands(me, base, n, isRoot);
    const k1 = killer1[ply], k2 = killer2[ply];
    for (let i = 0; i < n; i++) {
      const code = mvBuf[base + i];
      let s = scBuf[base + i];
      if (code === ttMove) s += 10000000;
      else if (code === k1) s += 3000;
      else if (code === k2) s += 2500;
      const hh = hist[me * 256 + code];
      s += hh > 2000 ? 2000 : hh;
      scBuf[base + i] = s;
    }
    return n;
  }

  // ---------- evaluation (side to move) ----------
  function flex(p) {
    const c = cell[p], d = dist[p], e = edges[c], dn = d[c] - 1;
    let f = 0;
    if (!(e & B_N) && d[c - 9] === dn) f++;
    if (!(e & B_E) && d[c + 1] === dn) f++;
    if (!(e & B_S) && d[c + 9] === dn) f++;
    if (!(e & B_W) && d[c - 1] === dn) f++;
    return f;
  }
  function evaluate(me, dm, dO) {
    const op = 1 - me, wm = wallsLeft[me], wo = wallsLeft[op];
    if (wm === 0 && wo === 0) { // pure race, side to move moves first
      const lead = dO - dm;
      return lead >= 0 ? 3000 + lead * 30 : -3000 + lead * 30;
    }
    let s = (dO - dm) * W.path + W.tempo;
    const ww = (wm === 0 || wo === 0) ? W.wall * 2 : W.wall;
    s += (wm - wo) * ww;
    s += (flex(me) - flex(op)) * W.flex;
    s += (dm < 20 ? URG[dm] : 0) - (dO < 20 ? URG[dO] : 0);
    if (wo === 0 && dm <= dO) s += W.race;
    else if (wm === 0 && dO < dm) s -= W.race;
    if (W.center) {
      const colM = cell[me] % 9, colO = cell[op] % 9;
      s += (Math.abs(4 - colO) - Math.abs(4 - colM)) * W.center;
    }
    if (W.infl) {
      const rM = (cell[me] / 9) | 0, rO = (cell[op] / 9) | 0;
      const rowsM = goalRow[me] === 0 ? rM : 8 - rM;
      const rowsO = goalRow[op] === 0 ? rO : 8 - rO;
      s += ((dO - rowsO) - (dm - rowsM)) * W.infl;
    }
    return s;
  }

  // ---------- TT ----------
  function ttProbe() {
    const b = ((h1 & ttMask) & ~1) * 4;
    if (tt[b] === h2 && tt[b + 3] !== 0) return b;
    if (tt[b + 4] === h2 && tt[b + 7] !== 0) return b + 4;
    return -1;
  }
  function ttStore(depth, score, flag, move) {
    const b0 = ((h1 & ttMask) & ~1) * 4;
    let b;
    if (tt[b0] === h2 && tt[b0 + 3] !== 0) b = b0;
    else if (tt[b0 + 4] === h2 && tt[b0 + 7] !== 0) b = b0 + 4;
    else b = ((tt[b0 + 3] & 255) <= (tt[b0 + 7] & 255)) ? b0 : b0 + 4;
    tt[b] = h2; tt[b + 1] = score; tt[b + 2] = move; tt[b + 3] = (depth + 1) | (flag << 8);
  }

  const hkey = () => (h1 >>> 0) + (h2 & 0x1fffff) * 4294967296;
  const repScore = (side) => (side === rootSide ? -opt.contempt : opt.contempt);
  // true if playing `code` from the current position leads to a position (same walls, pawns, walls left,
  // side to move) that already occurred in THIS game. Used as a hard ban at the root (see think()).
  function repeatsGame(code, ply) {
    pathH1[ply] = h1; pathH2[ply] = h2;
    make(code, ply);
    const k = hkey();
    unmake(code, ply);
    return gameSeen.get(k) > 0;
  }
  // remember the position that results from the move we are about to play (opponent to move)
  function recordAfter(state, code) {
    load(state);
    pathH1[0] = h1; pathH2[0] = h2;
    make(code, 0);
    const k = hkey();
    gameSeen.set(k, (gameSeen.get(k) || 0) + 1);
    unmake(code, 0);
  }

  // ---------- search ----------
  function negamax(depth, alpha, beta, ply) {
    if (stopped) return 0;
    nodes++;
    if (nodes >= nodeLimit) { stopped = true; return 0; }
    if ((nodes & 2047) === 0 && Date.now() >= deadline) { stopped = true; return 0; }

    const me = turn, op = 1 - me;
    if (((cell[op] / 9) | 0) === goalRow[op]) return -(WIN - ply);
    pathH1[ply] = h1; pathH2[ply] = h2;
    if (ply > 0) {
      for (let i = ply - 2; i >= 0; i -= 2) if (pathH1[i] === h1 && pathH2[i] === h2) return repScore(me);
      if (gameSeen.size && gameSeen.get(hkey()) > 0) return repScore(me);
    }
    const isRoot = ply === 0;
    let ttMove = -1;
    const slot = ttProbe();
    if (slot >= 0) {
      const meta = tt[slot + 3];
      ttMove = tt[slot + 2];
      if (!isRoot && (meta & 255) - 1 >= depth) {
        let s = tt[slot + 1];
        if (s > WIN - 200) s -= ply; else if (s < -WIN + 200) s += ply;
        const f = (meta >> 8) & 3;
        if (f === EXACT || (f === LOWER && s >= beta) || (f === UPPER && s <= alpha)) return s;
      }
    }

    analyzeDist();
    const dm = dist[me][cell[me]], dO = dist[op][cell[op]];
    if (dm <= 2) {
      const wc = canWinNow(me);
      if (wc >= 0) {
        if (isRoot) { rootIterMove = wc; rootIterScore = WIN - 1; }
        return WIN - ply - 1;
      }
    }
    if (ply >= MAXPLY - 2) return evaluate(me, dm, dO);
    if (depth <= 0) {
      if ((dm <= 1 || dO <= 1) && ply < extLimit) depth = 1;
      else return evaluate(me, dm, dO);
    }
    analyzeCounts();
    const n = genMoves(me, ply, ttMove, isRoot);
    if (n === 0) return evaluate(me, dm, dO);

    const base = ply * MAXM, origAlpha = alpha;
    let best = -INF, bestMove = mvBuf[base];
    const tactical = dm <= 2 || dO <= 2;
    let searched = 0;
    for (let i = 0; i < n; i++) {
      // selection sort step
      let bi = i, bs = scBuf[base + i];
      for (let j = i + 1; j < n; j++) if (scBuf[base + j] > bs) { bs = scBuf[base + j]; bi = j; }
      if (bi !== i) {
        const c = mvBuf[base + i], s = scBuf[base + i];
        mvBuf[base + i] = mvBuf[base + bi]; scBuf[base + i] = scBuf[base + bi];
        mvBuf[base + bi] = c; scBuf[base + bi] = s;
      }
      const code = mvBuf[base + i];
      if (isRoot && rootBanOn && repeatsGame(code, 0)) continue;   // anti-loop: a repeated position is not a legal choice
      make(code, ply);
      let score;
      if (searched++ === 0) score = -negamax(depth - 1, -beta, -alpha, ply + 1);
      else {
        let red = 0;
        if (depth >= 3 && i >= 3 && !tactical) red = (i >= 8 && depth >= 5) ? 2 : 1;
        score = -negamax(depth - 1 - red, -alpha - 1, -alpha, ply + 1);
        if (score > alpha && red > 0 && !stopped) score = -negamax(depth - 1, -alpha - 1, -alpha, ply + 1);
        if (score > alpha && score < beta && !stopped) score = -negamax(depth - 1, -beta, -alpha, ply + 1);
      }
      unmake(code, ply);
      if (stopped) return 0;
      if (score > best) {
        best = score;
        if (score > alpha) {
          bestMove = code; alpha = score;
          if (isRoot) { rootIterMove = code; rootIterScore = score; }
        }
        if (score >= beta) {
          if (killer1[ply] !== code) { killer2[ply] = killer1[ply]; killer1[ply] = code; }
          const hi = me * 256 + code; hist[hi] = Math.min(1 << 20, hist[hi] + depth * depth);
          break;
        }
      }
    }
    const flag = best <= origAlpha ? UPPER : best >= beta ? LOWER : EXACT;
    let sv = best;
    if (sv > WIN - 200) sv += ply; else if (sv < -WIN + 200) sv -= ply;
    ttStore(depth, sv, flag, bestMove);
    return best;
  }

  // ---------- state I/O ----------
  function resolveGoalRows(state) {
    if (goalKnown) return;
    let g = opt.goalRows;
    if (!g && Rules) {
      try { // ADAPT: whichever the canonical rules module exposes
        if (Array.isArray(Rules.GOAL_ROW)) g = Rules.GOAL_ROW;
        else if (Array.isArray(Rules.GOAL_ROWS)) g = Rules.GOAL_ROWS;
        else if (typeof Rules.getGoalRow === 'function') g = [Rules.getGoalRow(0), Rules.getGoalRow(1)];
        else if (typeof Rules.goalRow === 'function') g = [Rules.goalRow(0), Rules.goalRow(1)];
      } catch (_) { g = null; }
    }
    if (!g || g[0] === undefined || g[1] === undefined) {
      const r0 = state.players[0].pos.r, r1 = state.players[1].pos.r; // whoever is higher on the board heads down
      g = r0 <= r1 ? [8, 0] : [0, 8];
    }
    goalRow[0] = g[0]; goalRow[1] = g[1]; goalKnown = true;
  }
  function load(state) {
    resolveGoalRows(state);
    resetEdges(); hW.fill(0); vW.fill(0);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (state.hWalls && state.hWalls[r] && state.hWalls[r][c]) { hW[r * 8 + c] = 1; setWall(false, r, c, true); }
      if (state.vWalls && state.vWalls[r] && state.vWalls[r][c]) { vW[r * 8 + c] = 1; setWall(true, r, c, true); }
    }
    for (let p = 0; p < 2; p++) { cell[p] = state.players[p].pos.r * 9 + state.players[p].pos.c; wallsLeft[p] = state.players[p].wallsLeft; }
    turn = state.currentPlayer;
    computeHash();
  }

  // every legal move (full, unpruned) — used for tests and the easy bot
  function allLegal() {
    const me = turn, out = [];
    const buf = new Int32Array(8);
    const n = genPawn(me, buf, 0);
    for (let i = 0; i < n; i++) out.push(buf[i]);
    if (wallsLeft[me] > 0) {
      for (let wid = 0; wid < 128; wid++) {
        const isV = wid >= 64, i = isV ? wid - 64 : wid, r = i >> 3, c = i & 7;
        if (!wallFree(isV, r, c)) continue;
        setWall(isV, r, c, true);
        bfs(0, tmpD, tmpC, tmpO); const ok0 = tmpD[cell[0]] !== 255;
        bfs(1, tmpD, tmpC, tmpO); const ok1 = tmpD[cell[1]] !== 255;
        setWall(isV, r, c, false);
        if (ok0 && ok1) out.push(128 + wid);
      }
    }
    return out;
  }

  // ---------- public API ----------
  function newGame(seed) {
    seed0 = seed === undefined ? opt.seed : seed;
    rng = makeSeededRng(seed0);
    const r32 = () => (rng() * 4294967296) | 0;
    const mk = (n) => { const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = r32(); return a; };
    zP1 = mk(162); zP2 = mk(162); zH1 = mk(64); zH2 = mk(64); zV1 = mk(64); zV2 = mk(64);
    zW1 = mk(22); zW2 = mk(22); zT1 = r32(); zT2 = r32();
    const size = 1 << opt.ttBits;
    tt = new Int32Array(size * 4); ttMask = size - 1;
    killer1.fill(0); killer2.fill(0); hist.fill(0);
    gameSeen = new Map(); goalKnown = false; started = true;
  }

  function think(state, limits = {}) {
    if (!started) throw new Error('v3.think() called before newGame()');
    const t0 = Date.now();
    load(state);
    if (limits.player !== undefined && limits.player !== null && limits.player !== turn)
      throw new Error(`v3.think(): asked to move for player ${limits.player}, but player ${turn} is to move`);

    const difficulty = limits.difficulty || opt.difficulty || 'hard';
    applyDifficultyWeights(difficulty);
    const me = turn;
    rootSide = me;

    // random pawn move with probability randomP (tier table or explicit override); moves leading to
    // an already-seen position are filtered out so randomness can never create a repetition loop
    const rp = opt.randomP !== null && opt.randomP !== undefined
      ? opt.randomP
      : (DIFFICULTY_RANDOM[difficulty] || 0);
    if (rp > 0 && rng() < rp) {
      const buf = new Int32Array(8), n = genPawn(me, buf, 0);
      let free = 0;
      for (let i = 0; i < n; i++) if (!repeatsGame(buf[i], 0)) free++;
      let idx;
      if (free > 0) {
        let k = Math.floor(rng() * free);
        for (let i = 0; i < n; i++) { if (repeatsGame(buf[i], 0)) continue; if (k-- === 0) { idx = i; break; } }
      } else idx = Math.floor(rng() * n);
      const code = buf[idx];
      recordAfter(state, code);
      return { move: opt.encodeMove(code), depth: 0, nodes: 0, timeMs: Date.now() - t0, score: 0 };
    }

    const pick = (a, b) => (a !== undefined && a !== null ? a : b);
    let nodesBudget = pick(limits.nodes, opt.nodes);
    let timeBudget = pick(limits.timeMs, opt.timeMs);
    nodeLimit = nodesBudget !== null && nodesBudget !== undefined ? nodesBudget : Infinity;
    if (nodeLimit === Infinity && (timeBudget === null || timeBudget === undefined)) timeBudget = DIFFICULTY_MS[difficulty] || 1000;
    deadline = timeBudget !== null && timeBudget !== undefined ? t0 + timeBudget : Infinity;
    const maxDepth = Math.min(MAXPLY - 10, pick(limits.maxDepth, pick(opt.maxDepth, DIFFICULTY_DEPTH[difficulty] || 56)));

    gameSeen.set(hkey(), (gameSeen.get(hkey()) || 0) + 1);
    nodes = 0; stopped = false; killer1.fill(0); killer2.fill(0);
    for (let i = 0; i < hist.length; i++) hist[i] >>= 2; // age history between moves

    // fallback move = best-ordered move at depth 0
    analyzeDist(); analyzeCounts();
    let ttm = -1; const s0 = ttProbe(); if (s0 >= 0) ttm = tt[s0 + 2];
    const n0 = genMoves(me, 0, ttm, true);
    // hard anti-loop: candidates leading to an already seen position are skipped (unless ALL of them repeat)
    let bi = -1, free = 0;
    for (let j = 0; j < n0; j++) {
      if (repeatsGame(mvBuf[j], 0)) continue;
      free++;
      if (bi < 0 || scBuf[j] > scBuf[bi]) bi = j;
    }
    rootBanOn = free > 0 && free < n0;
    if (bi < 0) { bi = 0; for (let j = 1; j < n0; j++) if (scBuf[j] > scBuf[bi]) bi = j; }
    let bestMove = mvBuf[bi], bestScore = 0, completed = 0, prev = 0;

    for (let d = 1; d <= maxDepth; d++) {
      extLimit = d + 8;
      let lo = -INF, hi = INF;
      if (d >= 5 && Math.abs(prev) < WIN - 1000) { lo = prev - 50; hi = prev + 50; }
      rootIterMove = -1;
      let score = negamax(d, lo, hi, 0);
      if (!stopped && (score <= lo || score >= hi) && (lo > -INF || hi < INF)) {
        rootIterMove = -1;
        score = negamax(d, -INF, INF, 0);
      }
      // Adopt the in-flight iteration's best BEFORE the stopped check on purpose: with a node budget
      // the aborted iteration at depth d+1 is usually stronger than the completed depth d, and the
      // loop above only ever writes rootIterMove from genuinely searched scores (it returns on
      // `stopped` before the update block). Measured: moving this after the stopped check cost ~20pp
      // against the shortest-path walker in tests/selftest-v3.js.
      if (rootIterMove !== -1) { bestMove = rootIterMove; bestScore = rootIterScore; }
      if (stopped) break;
      completed = d; prev = score; bestScore = score;
      if (score >= WIN - MAXPLY || score <= -WIN + MAXPLY) break;   // forced result found
      if (deadline !== Infinity && Date.now() - t0 > (deadline - t0) * 0.45) break; // next depth will not fit
    }
    rootBanOn = false;
    recordAfter(state, bestMove);
    return { move: opt.encodeMove(bestMove), depth: completed, nodes, timeMs: Date.now() - t0, score: bestScore };
  }

  // The factory starts the engine (see the header: every site caller goes straight to think()).
  newGame(opt.seed);

  return {
    name: 'v3', version: '1.0.0', think, newGame, reset: () => {},
    // ADAPT: exposed like v1, so the site bundle test can assert the engine wired the shared rules
    // object rather than a private copy.
    rules: Rules,
    // debugging / tests
    _debug: {
      load, allLegal, computeHash, encodeMove: opt.encodeMove,
      hash: () => [h1, h2], setSide: (t) => { turn = t; },
      makeMove: (code) => { pathH1[0] = h1; pathH2[0] = h2; make(code, 0); },
      unmakeMove: (code) => unmake(code, 0),
      walls: () => ({ hW: Array.from(hW), vW: Array.from(vW) }),
    },
  };
}

module.exports = { createEngineV3, encodeMove, DIFFICULTY_WEIGHTS, DIFFICULTY_RANDOM };
