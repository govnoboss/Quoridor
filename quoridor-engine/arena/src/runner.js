'use strict';
const { Worker } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { computeStats, sprtLLR, sprtBounds } = require('./elo');
const { bradleyTerry } = require('./rating');

class Pool {
  constructor(size, workerData) {
    this.queue = []; this.idle = []; this.pending = new Map(); this.workers = [];
    for (let i = 0; i < size; i++) {
      const w = new Worker(path.join(__dirname, 'worker.js'), { workerData });
      w.on('message', (msg) => {
        const t = this.pending.get(w); this.pending.delete(w); this.idle.push(w);
        if (msg.error) t.reject(new Error(msg.error)); else t.resolve(msg.result);
        this._pump();
      });
      w.on('error', (err) => { const t = this.pending.get(w); if (t) t.reject(err); });
      this.workers.push(w); this.idle.push(w);
    }
  }
  exec(job) { return new Promise((resolve, reject) => { this.queue.push({ job, resolve, reject }); this._pump(); }); }
  _pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop(); const t = this.queue.shift();
      this.pending.set(w, t); w.postMessage(t.job);
    }
  }
  close() { return Promise.all(this.workers.map((w) => w.terminate())); }
}

class Arena {
  /**
   * opts: { adapterPath, botsPath, threads, seed, limits:{timeMs?,depth?,nodes?},
   *         openingPlies, maxPlies, repetitionDraw, outFile, saveMoves, quiet }
   */
  constructor(opts) {
    this.o = { threads: 4, seed: 1, limits: {}, openingPlies: 4, maxPlies: 300, repetitionDraw: 3, saveMoves: true, ...opts };
    this.pool = new Pool(this.o.threads, { adapterPath: this.o.adapterPath, botsPath: this.o.botsPath });
    this.out = this.o.outFile ? (fs.mkdirSync(path.dirname(this.o.outFile), { recursive: true }), fs.createWriteStream(this.o.outFile, { flags: 'a' })) : null;
    this.gameCounter = 0;
  }

  /**
   * Match a vs b. games must be even: game 2k and 2k+1 share the opening, colours swapped.
   * sprt: { elo0, elo1, alpha?, beta? } -> stops early when H0 or H1 is accepted.
   */
  async match({ a, b, games, sprt }) {
    const o = this.o;
    if (games % 2) games += 1;
    const wdl = { w: 0, d: 0, l: 0 };
    const reasons = {};
    // Диагностика петель: доля повторов и медиана хода, на котором петля началась. Повтор — не ничья
    // по правилам Quoridor, а признак того, что бот не умеет выбираться из цикла, поэтому это
    // измеряется отдельно от score и не должно им маскироваться.
    const loops = { repetitions: 0, firstPlies: [], lengths: [] };
    // Длины партий. Нужны, чтобы отличить «бот выиграл быстро» от «бот выиграл, едва не застряв»: score
    // этого не показывает, а при подборе версий средняя длина партии — первый сигнал, что движок
    // начал меедлить или, наоборот, зарубил.
    const pliesList = [];
    const bounds = sprt ? sprtBounds(sprt.alpha, sprt.beta) : null;
    let next = 0, running = 0, done = 0, stop = false, cancelled = false, verdict = null, llr = 0, failed = false;

    await new Promise((resolve, reject) => {
      const check = () => { if (running === 0 && (stop || next >= games)) resolve(); };
      const handle = (res) => {
        done++;
        if (res.aScore === 1) wdl.w++; else if (res.aScore === 0) wdl.l++; else wdl.d++;
        const rk = String(res.reason).split(':')[0];
        reasons[rk] = (reasons[rk] || 0) + 1;
        if (typeof res.plies === 'number') pliesList.push(res.plies);
        if (rk === 'repetition') {
          loops.repetitions++;
          if (res.loopStartPly !== undefined) loops.firstPlies.push(res.loopStartPly);
          if (res.loopLength !== undefined) loops.lengths.push(res.loopLength);
        }
        if (this.out) {
          const line = { a, b, gameId: res.gameId, openingId: res.openingId, aFirst: res.aFirst, aScore: res.aScore, plies: res.plies, openingLen: res.openingLen, reason: res.reason, timeMs: res.timeMs };
          if (res.loopStartPly !== undefined) line.loopStartPly = res.loopStartPly;
          if (res.loopLength !== undefined) line.loopLength = res.loopLength;
          if (o.saveMoves) line.moves = res.moves;
          this.out.write(JSON.stringify(line) + '\n');
        }
        if (sprt && done % 2 === 0 && !stop) {
          llr = sprtLLR(wdl, sprt.elo0, sprt.elo1);
          if (llr >= bounds.upper) { verdict = 'H1'; stop = true; }
          else if (llr <= bounds.lower) { verdict = 'H0'; stop = true; }
        }
        if (!o.quiet && done % Math.max(1, Math.min(50, Math.floor(games / 10))) === 0) {
          const s = computeStats(wdl);
          console.log(`[${a} vs ${b}] ${done}/${games}  +${wdl.w} =${wdl.d} -${wdl.l}  Elo ${s.elo.toFixed(1)} ±${s.eloErr.toFixed(1)}` + (sprt ? `  LLR ${llr.toFixed(2)} [${bounds.lower.toFixed(2)}, ${bounds.upper.toFixed(2)}]` : ''));
        }
        // Хук прогресса для GUI. Считаем «сырые» партии, а не проценты: вызывающий сам решает, как
        // часто слать обновление, иначе HTTP-сервер утонет в событиях на тысячи партий.
        if (o.onProgress) {
          try {
            o.onProgress({
              done, games, w: wdl.w, d: wdl.d, l: wdl.l,
              elo: computeStats(wdl).elo, llr: sprt ? llr : null,
              reason: String(res.reason).split(':')[0],
              loops: loops.repetitions,
            });
          } catch (e) { /* GUI не должен ронять матч */ }
        }
      };
      const pump = () => {
        // Отмена пользователем: новые партии не запускаются, уже запущенные дорабатываются. Проверяется
        // здесь, а не только при постановке, потому что очередь накапливается по мере завершения.
        if (o.shouldStop && o.shouldStop()) { stop = true; cancelled = true; }
        while (!stop && !failed && running < o.threads && next < games) {
          const i = next++; running++;
          const job = {
            gameId: this.gameCounter++, a, b, seed: o.seed, openingId: Math.floor(i / 2), aFirst: i % 2 === 0,
            openingPlies: o.openingPlies, maxPlies: o.maxPlies, repetitionDraw: o.repetitionDraw, limits: o.limits,
          };
          this.pool.exec(job).then((res) => { running--; handle(res); pump(); check(); }, (err) => { failed = true; reject(err); });
        }
        check();
      };
      pump();
    });

    const stats = computeStats(wdl);
    const median = (xs) => {
      if (!xs.length) return null;
      const s = [...xs].sort((x, y) => x - y);
      const m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const loopStats = {
      repetitions: loops.repetitions,
      share: done ? loops.repetitions / done : 0,
      medianFirstPly: median(loops.firstPlies),
      medianLength: median(loops.lengths),
    };
    const meanPly = pliesList.length
      ? pliesList.reduce((s, x) => s + x, 0) / pliesList.length : null;
    const sortedPlies = pliesList.slice().sort((x, y) => x - y);
    const medianPly = sortedPlies.length
      ? (sortedPlies.length % 2
        ? sortedPlies[(sortedPlies.length - 1) / 2]
        : (sortedPlies[sortedPlies.length / 2 - 1] + sortedPlies[sortedPlies.length / 2]) / 2)
      : null;
    return {
      a, b, ...wdl, stats, reasons, loops: loopStats, cancelled,
      // gamesPlanned против фактически сыгранных: при отмене или ранней остановке SPRT они расходятся,
      // и вердикт по неполной выборке нельзя читать как окончательный.
      gamesPlanned: games, gamesPlayed: done,
      plies: { mean: meanPly, median: medianPly, min: sortedPlies[0] ?? null, max: sortedPlies[sortedPlies.length - 1] ?? null },
      sprt: sprt ? { ...sprt, llr, bounds, verdict: verdict || 'inconclusive' } : null,
    };
  }

  async roundRobin({ names, games, anchor }) {
    const pairs = [];
    const totalPairs = (names.length * (names.length - 1)) / 2;
    let pairNo = 0;
    for (let i = 0; i < names.length; i++)
      for (let j = i + 1; j < names.length; j++) {
        const r = await this.match({ a: names[i], b: names[j], games });
        pairs.push({ a: names[i], b: names[j], w: r.w, d: r.d, l: r.l, loopShare: r.loops.share, elo: r.stats.elo });
        if (this.o.onRoundRobin) {
          try { this.o.onRoundRobin({ pair: ++pairNo, totalPairs, a: names[i], b: names[j], rows: [...pairs] }); } catch (e) { /* как и выше */ }
        }
      }
    const elo = bradleyTerry(names, pairs, anchor);
    const table = names.map((n) => ({ name: n, elo: elo[n] })).sort((x, y) => y.elo - x.elo);
    return { pairs, table };
  }

  async close() {
    await this.pool.close();
    if (this.out) await new Promise((r) => this.out.end(r));
  }
}

module.exports = { Arena };
