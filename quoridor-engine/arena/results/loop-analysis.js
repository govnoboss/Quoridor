const fs = require('fs');
const path = require('path');
const RES = __dirname;
const A = require(path.join(RES, '..', 'adapters', 'quoridor.js'));

const argvFiles = process.argv.slice(2);
const files = argvFiles.length ? argvFiles : [
  'v1d5-vs-v2d5', 'v1-d2-vs-v2-d2', 'v1-d3-vs-v2-d3',
  'v1-d2-self', 'v2-d2-self', 'v1-d3-self', 'v2-d3-self',
  'v1-d4-self', 'v2-d4-self', 'v1d5-self', 'v2d5-self',
];

function analyze(name) {
  const file = path.join(RES, name + '.jsonl');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const r = { name, games: 0, revGames: 0, revisits: 0, hist: {}, repeatGames: 0, sideA: 0, sideB: 0, repReason: 0, loopStartSum: 0, loopLenSum: 0 };
  for (const line of lines) {
    const g = JSON.parse(line);
    if (!g.moves || !g.moves.length) continue;
    r.games++;
    if (g.reason === 'repetition') { r.repReason++; r.loopStartSum += g.loopStartPly || 0; r.loopLenSum += g.loopLength || 0; }
    let s = A.createInitialState();
    const counts = new Map();
    counts.set(A.positionKey(s), 1);
    let gameRevs = 0, maxC = 1;
    for (let i = 0; i < g.moves.length; i++) {
      const out = A.applyMove(s, g.moves[i]);
      if (out.error) break;
      s = out.state;
      const k = A.positionKey(s);
      const c = (counts.get(k) || 0) + 1;
      counts.set(k, c);
      if (c > maxC) maxC = c;
      if (c >= 2) {
        gameRevs++;
        const moverIsA = g.aFirst ? (i % 2 === 0) : (i % 2 === 1);
        if (g.a !== g.b) { if (moverIsA) r.sideA++; else r.sideB++; }
      }
    }
    if (maxC >= 2) r.revGames++;
    r.hist[maxC] = (r.hist[maxC] || 0) + 1;
    r.revisits += gameRevs;
    if (gameRevs >= 2) r.repeatGames++;
  }
  return r;
}

console.log('match                     games  revisit-games        rev/100g  maxOccur-hist      >=2revs  side(a/b)');
for (const name of files) {
  const r = analyze(name);
  const mc = Object.keys(r.hist).sort((x, y) => x - y).map(k => `${k}:${r.hist[k]}`).join(' ');
  console.log(
    r.name.padEnd(24) +
    String(r.games).padStart(5) +
    (` ${r.revGames}/${r.games} (${(100 * r.revGames / r.games).toFixed(1)}%)`).padStart(21) +
    (r.revisits * 100 / r.games).toFixed(2).padStart(10) +
    ('  ' + mc).padEnd(22) +
    String(r.repeatGames).padStart(7) +
    (r.sideA || r.sideB ? `  ${r.sideA}/${r.sideB}` : '')
  );
}
