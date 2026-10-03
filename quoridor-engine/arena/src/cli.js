#!/usr/bin/env node
'use strict';
const path = require('path');
const os = require('os');
const { Arena } = require('./runner');

function parseArgs(argv) {
  const cmd = argv[0]; const a = {};
  for (let i = 1; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    a[k] = v;
  }
  return { cmd, a };
}

(async () => {
  const { cmd, a } = parseArgs(process.argv.slice(2));
  if (!cmd || !a.adapter || !a.bots) {
    console.log(`usage:
  node src/cli.js match      --adapter <file> --bots <bots.json> --a <name> --b <name> --games N [--sprt elo0,elo1]
  node src/cli.js roundrobin --adapter <file> --bots <bots.json> [--names a,b,c] --games N [--anchor name]
common: --threads N --seed N --movetime ms --depth N --nodes N --opening-plies N --max-plies N --repetition N --out file.jsonl --no-moves`);
    process.exit(1);
  }
  const limits = {};
  if (a.movetime) limits.timeMs = +a.movetime;
  if (a.depth) limits.depth = +a.depth;
  if (a.nodes) limits.nodes = +a.nodes;

  const arena = new Arena({
    adapterPath: path.resolve(a.adapter), botsPath: path.resolve(a.bots),
    threads: a.threads ? +a.threads : Math.max(1, os.cpus().length - 1),
    seed: a.seed ? +a.seed : 1, limits,
    openingPlies: a['opening-plies'] !== undefined ? +a['opening-plies'] : 4,
    maxPlies: a['max-plies'] ? +a['max-plies'] : 300,
    // --repetition N — сколько встреч одной позиции считать петлёй. N=0 ОТКЛЮЧАЕТ правило (партия
    // уходит до maxPlies): это режим для замера, МЕДЛЯЕТ ли бот, а не застревает ли в цикле.
    // Внимание: N=1 не «выключает», а наоборот срабатывает на первом же повторе — партия кончается
    // почти сразу, и это не диагностика, а мусор в результатах.
    // Раньше флаг парсился, но терялся до Arena, и матч с любым значением был идентичен значению по
    // умолчанию — молча, без предупреждения.
    repetitionDraw: a.repetition !== undefined ? +a.repetition : 3,
    outFile: a.out, saveMoves: !a['no-moves'],
  });

  try {
    if (cmd === 'match') {
      let sprt;
      if (a.sprt) { const [e0, e1] = String(a.sprt).split(',').map(Number); sprt = { elo0: e0, elo1: e1 }; }
      const r = await arena.match({ a: a.a, b: a.b, games: +a.games || 100, sprt });
      const s = r.stats;
      console.log(`\n${r.a} vs ${r.b}: ${s.n} games  +${r.w} =${r.d} -${r.l}  score ${(s.score * 100).toFixed(1)}%  Elo ${s.elo.toFixed(1)} [${s.eloLo.toFixed(1)}, ${s.eloHi.toFixed(1)}]  LOS ${(s.los * 100).toFixed(1)}%`);
      console.log('game end reasons:', r.reasons);
      const pl = r.plies;
      if (pl && pl.mean !== null) {
        console.log(`plies: mean ${pl.mean.toFixed(1)}  median ${pl.median}  min ${pl.min}  max ${pl.max}`);
      }
      const lp = r.loops;
      console.log(`loops: ${lp.repetitions}/${s.n} (${(lp.share * 100).toFixed(1)}%)` +
        (lp.medianFirstPly !== null ? `  loop starts at ply ~${lp.medianFirstPly}  median loop ${lp.medianLength} plies` : '') +
        (lp.share > 0.2 ? '   <-- HIGH: score is dominated by stalls, not by play' : ''));
      if (r.sprt) console.log(`SPRT(${r.sprt.elo0},${r.sprt.elo1}): ${r.sprt.verdict}  LLR ${r.sprt.llr.toFixed(2)}`);
    } else if (cmd === 'roundrobin') {
      const all = Object.keys(require(path.resolve(a.bots)));
      const names = a.names ? String(a.names).split(',') : all;
      const r = await arena.roundRobin({ names, games: +a.games || 100, anchor: a.anchor });
      console.log('\nRank  Name            Elo');
      r.table.forEach((row, i) => console.log(`${String(i + 1).padStart(4)}  ${row.name.padEnd(14)} ${row.elo.toFixed(0).padStart(5)}`));
    }
  } finally {
    await arena.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
