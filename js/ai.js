// js/ai.js — УЛУЧШЕННАЯ ВЕРСИЯ: Умный AI с правильной стратегией
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

  // Улучшенный BFS с возвратом полного пути
  findShortestPath(state, playerIdx) {
    const targetRow = playerIdx === 0 ? 0 : 8;
    const start = state.players[playerIdx].pos;
    const visited = Array(9).fill().map(() => Array(9).fill(false));
    const parent = Array(9).fill().map(() => Array(9).fill(null));
    const queue = [{ r: start.r, c: start.c }];
    visited[start.r][start.c] = true;

    while (queue.length) {
      const { r, c } = queue.shift();
      
      if (r === targetRow) {
        // Восстанавливаем путь
        const path = [];
        let curr = { r, c };
        while (curr) {
          path.unshift(curr);
          curr = parent[curr.r][curr.c];
        }
        return { distance: path.length - 1, path };
      }

      for (const { dr, dc } of Game.directions) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 && !visited[nr][nc] &&
            !Game.isWallBetweenWithState(state, r, c, nr, nc)) {
          visited[nr][nc] = true;
          parent[nr][nc] = { r, c };
          queue.push({ r: nr, c: nc });
        }
      }
    }
    return { distance: Infinity, path: [] };
  },

  shortestPathDistance(state, playerIdx) {
    return this.findShortestPath(state, playerIdx).distance;
  },

  evaluate(state) {
    // Проверка на победу
    if (state.players[0].pos.r === 0) return -100000;
    if (state.players[1].pos.r === 8) return +100000;

    const d0 = this.shortestPathDistance(state, 0);
    const d1 = this.shortestPathDistance(state, 1);

    if (d0 === Infinity) return +60000;
    if (d1 === Infinity) return -60000;

    // Основная оценка: разница в расстоянии до цели
    let score = (d0 - d1) * 150;

    // Бонус за оставшиеся стены
    score += (state.players[1].wallsLeft - state.players[0].wallsLeft) * 30;

    // Штраф за бессмысленную трату стен
    const wallsSpent = 10 - state.players[1].wallsLeft;
    if (wallsSpent > 5 && d1 > d0 + 2) {
      score -= wallsSpent * 40;
    }

    // Бонус за приближение к цели
    const botPos = state.players[1].pos;
    const distanceToGoal = Math.abs(botPos.r - 8);
    score -= distanceToGoal * 10;

    return score;
  },

  // Умная генерация ходов стенами (только эффективные позиции)
  generateSmartWallMoves(state, forPlayer) {
    const moves = [];
    const oppIdx = 1 - forPlayer;
    const oppPath = this.findShortestPath(state, oppIdx);
    
    if (oppPath.distance === Infinity || oppPath.path.length < 2) return moves;

    const oldOppDist = oppPath.distance;
    
    // Приоритет 1: Блокировка текущего пути противника
    const pathPositions = oppPath.path.slice(0, Math.min(5, oppPath.path.length));
    
    // Приоритет 2: Блокировка рядом с противником
    const oppPos = state.players[oppIdx].pos;
    const nearOpp = [
      { r: oppPos.r - 1, c: oppPos.c - 1 }, { r: oppPos.r - 1, c: oppPos.c },
      { r: oppPos.r, c: oppPos.c - 1 },     { r: oppPos.r, c: oppPos.c },
      { r: oppPos.r + 1, c: oppPos.c - 1 }, { r: oppPos.r + 1, c: oppPos.c }
    ];

    // Приоритет 3: Центральные позиции для контроля
    const centerPositions = [
      { r: 3, c: 3 }, { r: 3, c: 4 }, { r: 3, c: 5 },
      { r: 4, c: 3 }, { r: 4, c: 4 }, { r: 4, c: 5 },
      { r: 5, c: 3 }, { r: 5, c: 4 }, { r: 5, c: 5 }
    ];

    const candidates = [...pathPositions, ...nearOpp, ...centerPositions];
    const tested = new Set();

    for (const { r, c } of candidates) {
      if (r < 0 || r >= 8 || c < 0 || c >= 8) continue;
      
      const key = `${r},${c}`;
      if (tested.has(key)) continue;
      tested.add(key);

      // Горизонтальная стена
      if (Game.checkWallPlacementWithState(state, r, c, false)) {
        const temp = this.cloneState(state);
        temp.hWalls[r][c] = true;
        
        if (Game.isValidWallPlacementWithState(temp)) {
          const newOppDist = this.shortestPathDistance(temp, oppIdx);
          
          // Ставим стену только если она реально замедляет противника
          if (newOppDist > oldOppDist) {
            const effectiveness = newOppDist - oldOppDist;
            moves.push({ 
              type: 'wall', 
              r, c, 
              vertical: false, 
              priority: 50 + effectiveness * 10 
            });
          }
        }
      }

      // Вертикальная стена
      if (Game.checkWallPlacementWithState(state, r, c, true)) {
        const temp = this.cloneState(state);
        temp.vWalls[r][c] = true;
        
        if (Game.isValidWallPlacementWithState(temp)) {
          const newOppDist = this.shortestPathDistance(temp, oppIdx);
          
          if (newOppDist > oldOppDist) {
            const effectiveness = newOppDist - oldOppDist;
            moves.push({ 
              type: 'wall', 
              r, c, 
              vertical: true, 
              priority: 50 + effectiveness * 10 
            });
          }
        }
      }
    }

    return moves;
  },

  generateMoves(state, forPlayer) {
    const moves = [];
    const p = state.players[forPlayer];
    const { r, c } = p.pos;

    // Найдём оптимальный путь для приоритизации ходов
    const myPath = this.findShortestPath(state, forPlayer);
    const nextBestCell = myPath.path.length > 1 ? myPath.path[1] : null;

    // Ходы пешкой
    for (const { dr, dc } of Game.directions) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 &&
          !Game.hasPawnAtWithState(state, nr, nc) &&
          !Game.isWallBetweenWithState(state, r, c, nr, nc)) {
        
        // Бонус если это следующая клетка на оптимальном пути
        let priority = 100;
        if (nextBestCell && nr === nextBestCell.r && nc === nextBestCell.c) {
          priority = 200; // Приоритет движению к цели!
        }
        
        moves.push({ type: 'pawn', r: nr, c: nc, priority });
      }

      // Прыжки через противника
      const jr = r + dr * 2, jc = c + dc * 2;
      if (jr >= 0 && jr < 9 && jc >= 0 && jc < 9 &&
          Game.hasPawnAtWithState(state, r + dr, c + dc) &&
          Game.getPlayerAtWithState(state, r + dr, c + dc) !== forPlayer &&
          !Game.hasPawnAtWithState(state, jr, jc) &&
          !Game.isWallBetweenWithState(state, r + dr, c + dc, jr, jc)) {
        
        let priority = 150;
        if (nextBestCell && jr === nextBestCell.r && jc === nextBestCell.c) {
          priority = 250;
        }
        
        moves.push({ type: 'pawn', r: jr, c: jc, priority });
      }
    }

    // Стены — только если есть смысл
    if (p.wallsLeft > 0) {
      const wallMoves = this.generateSmartWallMoves(state, forPlayer);
      moves.push(...wallMoves);
    }

    // Сортируем: сначала движение к цели, потом стены
    moves.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return moves;
  },

  makeMove(difficulty = 'medium') {
    const botPlayer = 1;
    const moves = this.generateMoves(Game.state, botPlayer);
    
    if (moves.length === 0) { 
      Game.nextTurn(); 
      return; 
    }

    let bestMove = moves[0];

    if (difficulty === 'easy') {
      // Easy: 80% времени идём по оптимальному пути, 20% случайно
      if (Math.random() < 0.8) {
        const pawnMoves = moves.filter(m => m.type === 'pawn');
        if (pawnMoves.length > 0) {
          // Берём лучший ход пешкой (с наивысшим приоритетом)
          bestMove = pawnMoves[0];
        }
      } else {
        // Иногда делаем случайный ход для "человечности"
        bestMove = moves[Math.floor(Math.random() * Math.min(3, moves.length))];
      }
    } else if (difficulty === 'medium') {
      // Medium: minimax с ограниченной глубиной
      const depth = 3;
      let bestScore = -Infinity;
      const startTime = Date.now();

      // Рассматриваем только топ-10 ходов для скорости
      const topMoves = moves.slice(0, 10);

      for (const move of topMoves) {
        if (Date.now() - startTime > 2000) break; // Таймаут 2 секунды

        const test = this.cloneState(Game.state);
        this.applyMove(test, move, botPlayer);
        
        let score = this.minimax(test, depth - 1, -Infinity, Infinity, false);
        
        // Дополнительный бонус за движение пешкой
        if (move.type === 'pawn') {
          score += 150;
        }

        if (score > bestScore) {
          bestScore = score;
          bestMove = move;
        }
      }
    }

    // Применяем выбранный ход
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

    // Рассматриваем только топ-8 ходов на каждом уровне
    const topMoves = moves.slice(0, 8);

    if (maximizing) {
      let max = -Infinity;
      for (const m of topMoves) {
        const s = this.cloneState(state);
        this.applyMove(s, m, current);
        max = Math.max(max, this.minimax(s, depth - 1, alpha, beta, false));
        if (max >= beta) break;
        alpha = Math.max(alpha, max);
      }
      return max;
    } else {
      let min = Infinity;
      for (const m of topMoves) {
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