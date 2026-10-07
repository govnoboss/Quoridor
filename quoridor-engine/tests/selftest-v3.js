'use strict';
/**
 * Standalone self-test for engines/v3 (plain node, no jest):  node tests/selftest-v3.js [--long]
 * Contains an INDEPENDENT reference implementation of the rules (naive style) on canonical-shaped state:
 *   { players:[{pos:{r,c},wallsLeft}], hWalls[8][8], vWalls[8][8], currentPlayer }
 * hWalls[r][c]: wall between rows r and r+1 covering columns c,c+1.  vWalls[r][c]: between columns c and c+1, rows r,r+1.
 * If the site uses other conventions, THESE tests are what tells you (compare against Rules the same way).
 */
const assert = require('assert');
const { createEngineV3 } = require('../engines/v3');

const LONG = process.argv.includes('--long');
function rngOf(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const GOAL = [8, 0];
function initial() {
  const z = () => Array.from({ length: 8 }, () => new Array(8).fill(false));
  return { players: [{ pos: { r: 0, c: 4 }, wallsLeft: 10 }, { pos: { r: 8, c: 4 }, wallsLeft: 10 }], hWalls: z(), vWalls: z(), currentPlayer: 0, history: [] };
}
const clone = (s) => JSON.parse(JSON.stringify(s));

// ---- reference rules ----
function blocked(s, r1, c1, r2, c2) {
  if (r2 < 0 || r2 > 8 || c2 < 0 || c2 > 8) return true;
  if (r1 !== r2) { const r = Math.min(r1, r2); return (c1 < 8 && s.hWalls[r][c1]) || (c1 > 0 && s.hWalls[r][c1 - 1]); }
  const c = Math.min(c1, c2); return (r1 < 8 && s.vWalls[r1][c]) || (r1 > 0 && s.vWalls[r1 - 1][c]);
}
function refPawn(s) {
  const me = s.players[s.currentPlayer].pos, op = s.players[1 - s.currentPlayer].pos, out = [];
  for (const [dr, dc] of [[-1, 0], [0, 1], [1, 0], [0, -1]]) {
    const r = me.r + dr, c = me.c + dc;
    if (blocked(s, me.r, me.c, r, c)) continue;
    if (!(r === op.r && c === op.c)) { out.push(`p${r},${c}`); continue; }
    if (!blocked(s, r, c, r + dr, c + dc)) { out.push(`p${r + dr},${c + dc}`); continue; }
    for (const [er, ec] of dr !== 0 ? [[0, 1], [0, -1]] : [[-1, 0], [1, 0]])
      if (!blocked(s, r, c, r + er, c + ec)) out.push(`p${r + er},${c + ec}`);
  }
  return out;
}
function hasPath(s, p) {
  const seen = new Set(), st = [[s.players[p].pos.r, s.players[p].pos.c]];
  while (st.length) {
    const [r, c] = st.pop(); if (r === GOAL[p]) return true;
    const k = r * 9 + c; if (seen.has(k)) continue; seen.add(k);
    for (const [dr, dc] of [[-1, 0], [0, 1], [1, 0], [0, -1]]) if (!blocked(s, r, c, r + dr, c + dc)) st.push([r + dr, c + dc]);
  }
  return false;
}
function refWalls(s) {
  const out = [];
  if (s.players[s.currentPlayer].wallsLeft <= 0) return out;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) for (const v of [false, true]) {
    if (s.hWalls[r][c] || s.vWalls[r][c]) continue;
    if (!v && ((c > 0 && s.hWalls[r][c - 1]) || (c < 7 && s.hWalls[r][c + 1]))) continue;
    if (v && ((r > 0 && s.vWalls[r - 1][c]) || (r < 7 && s.vWalls[r + 1][c]))) continue;
    const t = clone(s); (v ? t.vWalls : t.hWalls)[r][c] = true;
    if (hasPath(t, 0) && hasPath(t, 1)) out.push(`w${r},${c},${v ? 'V' : 'H'}`);
  }
  return out;
}
const refLegal = (s) => refPawn(s).concat(refWalls(s));
const fmt = (m) => (m.type === 'pawn' ? `p${m.r},${m.c}` : `w${m.r},${m.c},${m.isVertical ? 'V' : 'H'}`);
function apply(s, m) {
  const t = clone(s), p = t.currentPlayer;
  if (m.type === 'pawn') t.players[p].pos = { r: m.r, c: m.c };
  else { (m.isVertical ? t.vWalls : t.hWalls)[m.r][m.c] = true; t.players[p].wallsLeft--; }
  t.currentPlayer = 1 - p; return t;
}
const won = (s) => (s.players[0].pos.r === GOAL[0] ? 0 : s.players[1].pos.r === GOAL[1] ? 1 : null);
function parse(str) {
  const [k, rest] = [str[0], str.slice(1)]; const a = rest.split(',');
  return k === 'p' ? { type: 'pawn', r: +a[0], c: +a[1] } : { type: 'wall', r: +a[0], c: +a[1], isVertical: a[2] === 'V' };
}

let passed = 0; const ok = (name) => { passed++; console.log('  ok  ' + name); };

// ---- 1. legality cross-check on random playouts ----
{
  const rnd = rngOf(7), eng = createEngineV3({ seed: 1, goalRows: [8, 0] }); eng.newGame(1);
  let positions = 0; const games = LONG ? 300 : 80;
  for (let g = 0; g < games; g++) {
    let s = initial();
    for (let ply = 0; ply < 140 && won(s) === null; ply++) {
      eng._debug.load(s);
      const mine = eng._debug.allLegal().map((c) => fmt(eng._debug.encodeMove(c))).sort();
      const ref = refLegal(s).sort();
      assert.deepStrictEqual(mine, ref, `legal move mismatch game ${g} ply ${ply}`);
      positions++;
      const legal = ref; const pawns = legal.filter((x) => x[0] === 'p'), walls = legal.filter((x) => x[0] === 'w');
      const pick = walls.length && rnd() < 0.45 ? walls[Math.floor(rnd() * walls.length)] : pawns[Math.floor(rnd() * pawns.length)];
      s = apply(s, parse(pick));
    }
  }
  ok(`move generation == reference rules on ${positions} positions`);
}

// ---- 2. incremental Zobrist == recomputed after make/unmake ----
{
  const eng = createEngineV3({ seed: 3, goalRows: [8, 0] }); eng.newGame(3); const rnd = rngOf(11);
  let s = initial(); let checks = 0;
  for (let ply = 0; ply < 60 && won(s) === null; ply++) {
    eng._debug.load(s);
    const legal = eng._debug.allLegal(); const before = eng._debug.hash().slice(); const w0 = JSON.stringify(eng._debug.walls());
    for (const code of legal.slice(0, 40)) {
      eng._debug.makeMove(code);
      const inc = eng._debug.hash().slice(); eng._debug.computeHash(); assert.deepStrictEqual(eng._debug.hash(), inc, 'hash drift'); checks++;
      eng._debug.unmakeMove(code);
      assert.deepStrictEqual(eng._debug.hash(), before, 'unmake did not restore hash');
      assert.strictEqual(JSON.stringify(eng._debug.walls()), w0, 'unmake did not restore walls');
    }
    s = apply(s, parse(refLegal(s)[Math.floor(rnd() * refLegal(s).length)]));
  }
  ok(`zobrist incremental == recomputed, make/unmake restores state (${checks} checks)`);
}

// ---- 3. contract: no mutation, determinism, node limit, throws ----
{
  const s = initial(); s.hWalls[3][3] = true; s.players[0].pos = { r: 2, c: 4 };
  const snap = JSON.stringify(s);
  const a = createEngineV3({ seed: 5, goalRows: [8, 0] }); a.newGame(5); const b = createEngineV3({ seed: 5, goalRows: [8, 0] }); b.newGame(5);
  const ra = a.think(s, { nodes: 20000, difficulty: 'hard', player: 0 }), rb = b.think(s, { nodes: 20000, difficulty: 'hard', player: 0 });
  assert.strictEqual(JSON.stringify(s), snap, 'input state was mutated');
  assert.deepStrictEqual(ra.move, rb.move); assert.strictEqual(ra.nodes, rb.nodes); ok('input not mutated; same seed -> identical answer and node count');
  assert(ra.nodes <= 20000, 'node limit exceeded'); ok(`node limit respected (${ra.nodes} <= 20000, depth ${ra.depth})`);
  assert(refLegal(s).includes(fmt(ra.move)), 'illegal move returned'); ok('returned move is legal');
  const c = createEngineV3({ goalRows: [8, 0] }); const rc = c.think(s, {});
  assert(refLegal(s).includes(fmt(rc.move)), 'auto-started engine returned an illegal move');
  ok('factory auto-starts: think() works without an explicit newGame');
  assert.throws(() => a.think(s, { player: 1 }), /player/); ok('throws for the wrong player');
  const t = a.think(s, { timeMs: 50, difficulty: 'hard' }); assert(t.timeMs < 250, 'time limit ignored'); ok(`time limit respected (${t.timeMs} ms)`);
}

// ---- 4. legality of returned moves in many random positions + tactical checks ----
{
  const rnd = rngOf(21); let n = 0;
  for (let g = 0; g < (LONG ? 60 : 20); g++) {
    const eng = createEngineV3({ seed: g, goalRows: [8, 0] }); eng.newGame(g);
    let s = initial();
    for (let ply = 0; ply < 80 && won(s) === null; ply++) {
      if (rnd() < 0.5) { const l = refLegal(s); s = apply(s, parse(l[Math.floor(rnd() * l.length)])); continue; }
      const r = eng.think(s, { nodes: 3000, difficulty: 'hard', player: s.currentPlayer });
      assert(refLegal(s).includes(fmt(r.move)), `illegal engine move ${fmt(r.move)}`); n++;
      s = apply(s, r.move);
    }
  }
  ok(`${n} engine answers in random positions were all legal`);

  // mate in 1: pawn one step from goal, must take it
  const s = initial(); s.players[0].pos = { r: 7, c: 4 }; s.players[1].pos = { r: 2, c: 0 };
  const e = createEngineV3({ goalRows: [8, 0] }); e.newGame(1); const r = e.think(s, { nodes: 5000, player: 0 });
  assert.strictEqual(r.move.r, 8); ok('takes the immediate win');
  // must-block: opponent one step from goal and we are far -> wall that increases opp distance
  const s2 = initial(); s2.players[0].pos = { r: 2, c: 4 }; s2.players[1].pos = { r: 1, c: 4 };
  const r2 = e.think(s2, { nodes: 20000, player: 0 });
  assert.strictEqual(r2.move.type, 'wall'); ok('blocks with a wall when the opponent is about to win');
}

// ---- 5. strength sanity: vs random, vs shortest-path walker, vs smaller budget; speed ----
function playMatch(makeA, makeB, games, seed) {
  const rnd = rngOf(seed); let aw = 0, plies = 0, nodes = 0, ms = 0, moves = 0;
  for (let g = 0; g < games; g++) {
    const A = makeA(g), B = makeB(g), aFirst = g % 2 === 0; let s = initial();
    // 2 random opening moves shared per pair
    const orng = rngOf(seed * 1000 + (g >> 1));
    for (let i = 0; i < 2; i++) { const l = refLegal(s); s = apply(s, parse(l[Math.floor(orng() * l.length)])); }
    let winner = null;
    while (s.players.length && plies < 1e9) {
      const w = won(s); if (w !== null) { winner = w; break; }
      if (s.hist === undefined) s.hist = 0; if (++s.hist > 200) break;
      const p = s.currentPlayer, bot = (p === 0) === aFirst ? A : B;
      const r = bot.think(s, p); if (bot === A && r.nodes) { nodes += r.nodes; ms += r.timeMs; moves++; }
      s = apply(s, r.move); s.hist = (s.hist || 0);
    }
    if (winner !== null && (winner === 0) === aFirst) aw++;
    else if (winner === null) aw += 0.5;
  }
  return { score: aw / games, nps: ms ? Math.round(nodes / ms * 1000) : 0, avgNodes: moves ? Math.round(nodes / moves) : 0 };
}
function walker() { // shortest path, no walls
  return { think(s) {
    const p = s.currentPlayer; const opts = refPawn(s).map(parse);
    const d = (r, c) => { const seen = new Map(); const q = [[r, c, 0]]; seen.set(r * 9 + c, 1); while (q.length) { const [a, b, k] = q.shift(); if (a === GOAL[p]) return k; for (const [dr, dc] of [[-1, 0], [0, 1], [1, 0], [0, -1]]) { const x = a + dr, y = b + dc; if (!blocked(s, a, b, x, y) && !seen.has(x * 9 + y)) { seen.set(x * 9 + y, 1); q.push([x, y, k + 1]); } } } return 99; };
    opts.sort((m, n) => d(m.r, m.c) - d(n.r, n.c)); return { move: opts[0] }; } };
}
function rand(seed) { const r = rngOf(seed); return { think(s) { const l = refLegal(s); return { move: parse(l[Math.floor(r() * l.length)]) }; } }; }
// goalRows: GOAL is mandatory here — inside the repo the engine resolves the canonical GOAL_ROW
// ([0, 8]) from the real rules, but THIS file plays in its own flipped world (p0 starts on row 0).
function eng(seed, lim) { const e = createEngineV3({ seed, goalRows: GOAL }); e.newGame(seed); return { think: (s, p) => e.think(s, { ...lim, player: p, difficulty: 'hard' }) }; }
{
  const G = LONG ? 60 : 16;
  const r1 = playMatch((g) => eng(g, { nodes: 4000 }), (g) => rand(100 + g), G, 1);
  assert(r1.score >= 0.95, 'engine should crush random: ' + r1.score); ok(`vs random: score ${(r1.score * 100).toFixed(0)}% (${G} games)`);
  const r2 = playMatch((g) => eng(g, { nodes: 4000 }), () => walker(), G, 2);
  assert(r2.score >= 0.85, 'engine should beat the walker: ' + r2.score); ok(`vs shortest-path walker: score ${(r2.score * 100).toFixed(0)}%`);
  const r3 = playMatch((g) => eng(g, { nodes: 20000 }), (g) => eng(50 + g, { nodes: 2000 }), G, 3);
  ok(`20k nodes vs 2k nodes: score ${(r3.score * 100).toFixed(0)}%  (expected > 50%; avg ${r3.avgNodes} nodes/move, ${r3.nps} nodes/s)`);
  if (r3.score < 0.5) console.log('  WARN: more nodes did not win — investigate search/eval');
}
console.log(`\n${passed} checks passed`);
