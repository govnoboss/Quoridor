'use strict';
// Plays ONE game between two bot instances using an adapter (rules referee).

const { makeRng, deriveSeed } = require('../../tools/rng');

/**
 * job: { seed, openingId, openingPlies, aFirst, limits, maxPlies, repetitionDraw }
 * Player index 0 moves first from the initial position; aFirst decides who is player 0.
 * Returns { aScore, plies, reason, timeMs:[a,b], moves, openingLen, loopStartPly?, loopLength?, positionsSeen? }
 */
function playGame(adapter, botA, botB, job) {
  const rng = makeRng(deriveSeed(job.seed, job.openingId));
  let state = adapter.createInitialState();
  const moves = [];

  // 1) seeded random opening (same opening is used for both colours of a pair)
  for (let i = 0; i < job.openingPlies; i++) {
    if (adapter.winner(state) !== null) break;
    const legal = adapter.legalMoves(state);
    if (!legal.length) break;
    const m = legal[Math.floor(rng.next() * legal.length)];
    const r = adapter.applyMove(state, m);
    if (r.error) throw new Error('adapter produced illegal opening move: ' + r.error);
    state = r.state; moves.push(m);
  }
  const openingLen = moves.length;

  const bots = job.aFirst ? [botA, botB] : [botB, botA];
  const aIdx = job.aFirst ? 0 : 1;

  // Сид партии выводим из параметров матча (seed + номер партии в паре), а НЕ из gameId: gameId
  // присваивается в порядке постановки в пул и зависит от числа потоков. Иначе один и тот же матч
  // с --threads 2 и --threads 4 давал бы разные результаты, и баг нельзя было бы воспроизвести.
  const gameIndex = job.openingId * 2 + (job.aFirst ? 0 : 1);
  const gameSeed = deriveSeed(job.seed ^ 0x9e3779b9, gameIndex);
  bots.forEach((b) => b.newGame && b.newGame(gameSeed));
  const timeMs = [0, 0];
  // key -> { c: сколько раз встретилась, lastPly: последний полуход, на котором стояла, firstPly: первый }.
  //
  // ВАЖНО, здесь была ошибка, которая делала метрику петель бесполезной: начало петли бралось по
  // ПЕРВОМУ появлению позиции за партию, а не по последнему предыдущему. Если позиция встречалась три
  // раза, первое появление не имеет ничего общего с текущим циклом — цикл начинается с последнего
  // повторения. На замере это давало loopLength 16 при настоящей длине цикла 8, то есть метрика врала
  // вдвое. Теперь начало петли — это lastPly, а firstPly сохраняется отдельно для диагностики.
  const seen = new Map();

  const finish = (winnerIdx, reason, extra) => ({
    aScore: winnerIdx === null ? 0.5 : winnerIdx === aIdx ? 1 : 0,
    plies: moves.length, reason, timeMs: job.aFirst ? [timeMs[0], timeMs[1]] : [timeMs[1], timeMs[0]],
    moves, openingLen, ...extra,
  });

  while (moves.length < job.maxPlies) {
    const w = adapter.winner(state);
    if (w !== null) return finish(w, 'win');

    // repetitionDraw falsy (0/undefined) отключает правило ничьей по повтору: партия уходит до
    // maxPlies. Такой режим нужен, чтобы отличить «бот застрял в петле» от «бот долго меедлит».
    // ВНИМАНИЕ: repetitionDraw = 1 не отключает правило, а наоборот срабатывает на ПЕРВОМ же
    // появлении позиции, и партия заканчивается почти сразу. Для отключения нужно 0.
    if (job.repetitionDraw) {
      const k = adapter.positionKey(state);
      const e = seen.get(k);
      if (!e) {
        seen.set(k, { c: 1, lastPly: moves.length, firstPly: moves.length });
        // Первое появление — повторения ещё не было, но при repetitionDraw = 1 партия сдаётся сразу.
        if (1 >= job.repetitionDraw) {
          return finish(null, 'repetition', {
            loopStartPly: moves.length, loopLength: 0, positionsSeen: seen.size,
          });
        }
      } else {
        const startPly = e.lastPly; // начало ТЕКУЩЕГО цикла, а не первого появления за партию
        e.c++;
        if (e.c >= job.repetitionDraw) {
          return finish(null, 'repetition', {
            loopStartPly: startPly,        // ход, на котором началась петля
            loopLength: moves.length - startPly, // длина текущего цикла в полуходах
            positionsSeen: seen.size,      // сколько разных позиций встретилось
            loopFirstSeenPly: e.firstPly,  // когда эта позиция встречалась впервые (диагностика)
          });
        }
        e.lastPly = moves.length;
      }
    }

    const p = adapter.currentPlayer(state);
    const t0 = process.hrtime.bigint();
    let move;
    try {
      move = bots[p].think(adapter.cloneState(state), p, job.limits);
    } catch (e) {
      return finish(1 - p, 'crash:' + (e && e.message));
    }
    timeMs[p] += Number(process.hrtime.bigint() - t0) / 1e6;

    if (!move) return finish(1 - p, 'no-move');
    const r = adapter.applyMove(state, move);
    if (r.error) return finish(1 - p, 'illegal:' + r.error);
    state = r.state; moves.push(move);
  }
  return finish(null, 'maxplies');
}

module.exports = { playGame };
