// js/ai.js — ИСПРАВЛЕННАЯ ВЕРСИЯ: Бот не "залипает" на стенах
const AI = {
  cloneState(state) {
    return {
      hWalls: state.hWalls.map(row => row.slice()),
      vWalls: state.vWalls.map(row => row.slice()),
      players: state.players.map(p => ({
        color: p.color,
        pos: { ...p.pos },
        wallsLeft: p.wallsLeft
      })),
      currentPlayer: state.currentPlayer
    };
  },

  shortestPathDistance(state, playerIdx) {
    const targetRow = playerIdx === 0 ? 0 : 8;
    const start = state.players[playerIdx].pos;
    const visited = Array(9).fill().map(() => Array(9).fill(false));
    const queue = [{ r: start.r, c: start.c, dist: 0 }];
    visited[start.r][start.c] = true;

    while (queue.length) {
      const { r, c, dist } = queue.shift();
      if (r === targetRow) return dist;

      for (const { dr, dc } of Game.directions) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 && !visited[nr][nc] &&
            !Game.isWallBetweenWithState(state, r, c, nr, nc)) {
          visited[nr][nc] = true;
          queue.push({ r: nr, c: nc, dist: dist + 1 });
        }
      }
    }
    return Infinity;
  },

  evaluate(state) {
    if (state.players[0].pos.r === 0) return -100000;
    if (state.players[1].pos.r === 8) return +100000;

    const d0 = this.shortestPathDistance(state, 0);
    const d1 = this.shortestPathDistance(state, 1);

    if (d0 === Infinity) return +60000;
    if (d1 === Infinity) return -60000;

    let score = (d0 - d1) * 110;
    score += (state.players[0].wallsLeft - state.players[1].wallsLeft) * 20;

    // Штраф за "лишние" стены: если бот потратил много стен, но не приблизился
    const wallsSpent = 10 - state.players[1].wallsLeft;
    if (wallsSpent > 4 && d1 > d0) score -= wallsSpent * 50;

    return score;
  },

  generateSmartWallMoves(state, forPlayer) {
    const moves = [];
    const myPos = state.players[forPlayer].pos;
    const oppPos = state.players[1 - forPlayer].pos;

    const candidates = [
      { r: myPos.r - 1, c: myPos.c - 1 }, { r: myPos.r - 1, c: myPos.c },
      { r: myPos.r, c: myPos.c - 1 },     { r: myPos.r, c: myPos.c },
      { r: oppPos.r - 1, c: oppPos.c - 1 }, { r: oppPos.r - 1, c: oppPos.c },
      { r: oppPos.r, c: oppPos.c - 1 },     { r: oppPos.r, c: oppPos.c },
      { r: 3, c: 3 }, { r: 3, c: 4 }, { r: 4, c: 3 }, { r: 4, c: 4 }
    ];

    const oldOppDist = this.shortestPathDistance(state, 1 - forPlayer);

    for (const { r, c } of candidates) {
      if (r < 0 || r >= 8 || c < 0 || c >= 8) continue;

      // Горизонтальная
      if (Game.checkWallPlacementWithState(state, r, c, false)) {
        const temp = this.cloneState(state);
        temp.hWalls[r][c] = true;
        const newOppDist = this.shortestPathDistance(temp, 1 - forPlayer);
        if (Game.isValidWallPlacementWithState(temp) && newOppDist > oldOppDist) {
          moves.push({ type: 'wall', r, c, vertical: false });
        }
      }

      // Вертикальная
      if (Game.checkWallPlacementWithState(state, r, c, true)) {
        const temp = this.cloneState(state);
        temp.vWalls[r][c] = true;
        const newOppDist = this.shortestPathDistance(temp, 1 - forPlayer);
        if (Game.isValidWallPlacementWithState(temp) && newOppDist > oldOppDist) {
          moves.push({ type: 'wall', r, c, vertical: true });
        }
      }
    }
    return moves;
  },

  generateMoves(state, forPlayer) {
    const moves = [];
    const p = state.players[forPlayer];
    const { r, c } = p.pos;

    // Ходы пешкой — первыми в списке (приоритет)
    for (const { dr, dc } of Game.directions) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 &&
          !Game.hasPawnAtWithState(state, nr, nc) &&
          !Game.isWallBetweenWithState(state, r, c, nr, nc)) {
        moves.push({ type: 'pawn', r: nr, c: nc, priority: 100 });  // бонус приорити
      }
      const jr = r + dr * 2, jc = c + dc * 2;
      if (jr >= 0 && jr < 9 && jc >= 0 && jc < 9 &&
          Game.hasPawnAtWithState(state, r + dr, c + dc) &&
          Game.getPlayerAtWithState(state, r + dr, c + dc) !== forPlayer &&
          !Game.hasPawnAtWithState(state, jr, jc) &&
          !Game.isWallBetweenWithState(state, r + dr, c + dc, jr, jc)) {
        moves.push({ type: 'pawn', r: jr, c: jc, priority: 150 });  // прыжки ещё лучше
      }
    }

    // Стены — только умные, и с меньшим приоритетом
    if (p.wallsLeft > 0) {
      const wallMoves = this.generateSmartWallMoves(state, forPlayer);
      wallMoves.forEach(m => m.priority = 50);  // стены хуже ходов пешкой
      moves.push(...wallMoves);
    }

    // Сортируем по приоритету (пешка > стены)
    moves.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return moves;
  },

  makeMove(difficulty = 'medium') {
    const botPlayer = 1;
    const depth = difficulty === 'easy' ? 2 : 3;
    const moves = this.generateMoves(Game.state, botPlayer);
    if (moves.length === 0) { Game.nextTurn(); return; }

    let bestMove = moves[0];
    let bestScore = -Infinity;
    const startTime = Date.now();

    // Для Easy: 70% шанс выбрать ход пешкой
    if (difficulty === 'easy' && Math.random() < 0.7) {
      const pawnMoves = moves.filter(m => m.type === 'pawn');
      if (pawnMoves.length > 0) bestMove = pawnMoves[Math.floor(Math.random() * pawnMoves.length)];
    } else {
      for (const move of moves) {
        if (Date.now() - startTime > 2500) break;  // таймаут

        const test = this.cloneState(Game.state);
        this.applyMove(test, move, botPlayer);
        let score = this.minimax(test, depth - 1, -Infinity, Infinity, false);
        if (move.type === 'pawn') score += 200;  // бонус за движение пешкой

        if (score > bestScore) {
          bestScore = score;
          bestMove = move;
        }
      }
    }

    this.applyMove(Game.state, bestMove, botPlayer);
    Game.draw();
    if (Game.checkVictory()) return;
    Game.nextTurn();
  },

  minimax(state, depth, alpha, beta, maximizing) {
    if (depth === 0) return this.evaluate(state);

    const botPlayer = 1;
    const current = maximizing ? botPlayer : 0;
    const moves = this.generateMoves(state, current);

    if (maximizing) {
      let max = -Infinity;
      for (const m of moves) {
        const s = this.cloneState(state);
        this.applyMove(s, m, current);
        max = Math.max(max, this.minimax(s, depth - 1, alpha, beta, false));
        if (max >= beta) break;
        alpha = Math.max(alpha, max);
      }
      return max;
    } else {
      let min = Infinity;
      for (const m of moves) {
        const s = this.cloneState(state);
        this.applyMove(s, m, current);
        min = Math.min(min, this.minimax(s, depth - 1, alpha, beta, true));
        if (min <= alpha) break;
        beta = Math.min(beta, min);
      }
      return min;
    }
  },

  applyMove(state, move, playerIdx) {
    if (move.type === 'pawn') {
      state.players[playerIdx].pos.r = move.r;
      state.players[playerIdx].pos.c = move.c;
    } else {
      if (move.vertical) state.vWalls[move.r][move.c] = true;
      else state.hWalls[move.r][move.c] = true;
      state.players[playerIdx].wallsLeft--;
    }
  }
};