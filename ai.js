// js/ai.js — УЛУЧШЕННАЯ ВЕРСИЯ: ИИ уровня "непобедимый"
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

  /**
   * Усиленная функция оценки состояния доски.
   * Повышенные веса для дистанции и стен, штрафы за чрезмерное использование стен.
   */
  evaluate(state) {
    // 1. Оценка победы/поражения (терминальные состояния)
    if (state.players[0].pos.r === 0) return -1000000;
    if (state.players[1].pos.r === 8) return +1000000;

    const d0 = this.shortestPathDistance(state, 0); // Дистанция игрока (r=0)
    const d1 = this.shortestPathDistance(state, 1); // Дистанция бота (r=8)

    // 2. Оценка недоступности (блокировка)
    if (d0 === Infinity) return +600000;
    if (d1 === Infinity) return -600000;

    let score = 0;

    // 3. Основная позиционная оценка (разница кратчайших путей). Вес 150.
    score += (d0 - d1) * 150; 

    // 4. Оценка ресурсов (стены). Вес 40.
    const walls0 = state.players[0].wallsLeft;
    const walls1 = state.players[1].wallsLeft;
    score += (walls1 - walls0) * 40; 
    
    // 5. Бонус за продвижение бота (8 - текущая_строка).
    const botRow = state.players[1].pos.r;
    score += (8 - botRow) * 10; 

    // 6. Стратегический штраф: если бот сильно впереди по дистанции, он должен финишировать, а не ставить стены.
    if (d1 < d0 && walls1 > 0) {
        // Если бот на 3 хода ближе (или больше), штрафуем за стены
        if (d0 - d1 >= 3) score -= walls1 * 5; 
    }

    // 7. Центровой бонус для лучшего маневрирования.
    const botCol = state.players[1].pos.c;
    const centerBonus = 5 - Math.abs(4 - botCol); 
    score += centerBonus * 8; 

    // 8. Бонус за баланс (Стены vs Дистанция).
    if (d1 > 0) {
        score -= walls1 * (10 / d1) * 2;
    }
    return score;
  },

  /**
   * Генерирует "умные" ходы стеной с приоритетами.
   * Стена должна увеличивать кратчайший путь противника минимум на 1.
   */
  generateSmartWallMoves(state, forPlayer) {
    const moves = [];
    const oppPlayer = 1 - forPlayer;
    const myPos = state.players[forPlayer].pos;
    const oppPos = state.players[oppPlayer].pos;

    // 1. Расширенный набор кандидатов
    const candidates = new Set();
    // Области вокруг игроков
    for (let r = -2; r <= 1; r++) {
        for (let c = -2; c <= 1; c++) {
            candidates.add(`${myPos.r + r},${myPos.c + c}`);
            candidates.add(`${oppPos.r + r},${oppPos.c + c}`);
        }
    }
    // Центр доски
    candidates.add('3,3'); candidates.add('3,4'); candidates.add('4,3'); candidates.add('4,4');

    const oldOppDist = this.shortestPathDistance(state, oppPlayer);

    for (const posStr of candidates) {
        const [rStr, cStr] = posStr.split(',');
        const r = parseInt(rStr), c = parseInt(cStr);

        if (r < 0 || r >= 8 || c < 0 || c >= 8) continue;

        const checkAndAddWall = (r, c, vertical) => {
            if (Game.checkWallPlacementWithState(state, r, c, vertical)) {
                const temp = this.cloneState(state);
                if (vertical) temp.vWalls[r][c] = true;
                else temp.hWalls[r][c] = true;

                if (Game.isValidWallPlacementWithState(temp)) {
                    const newOppDist = this.shortestPathDistance(temp, oppPlayer);
                    
                    // УСЛОВИЕ: Стена должна увеличить путь минимум на 1
                    if (newOppDist >= oldOppDist + 1) {
                        const move = { type: 'wall', r, c, vertical };

                        // ПРИОРИТЕТ: Супер-приоритет, если путь увеличивается на 2 и более
                        if (newOppDist >= oldOppDist + 2) {
                            move.priority = 1000; 
                        } else {
                            move.priority = 50; 
                        }
                        moves.push(move);
                    }
                }
            }
        };

        checkAndAddWall(r, c, false); // Горизонтальная
        checkAndAddWall(r, c, true);  // Вертикальная
    }
    return moves;
  },

  generateMoves(state, forPlayer) {
    const moves = [];
    const p = state.players[forPlayer];
    const { r, c } = p.pos;

    // Ходы пешкой (с высоким приоритетом)
    for (const { dr, dc } of Game.directions) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 &&
            !Game.hasPawnAtWithState(state, nr, nc) &&
            !Game.isWallBetweenWithState(state, r, c, nr, nc)) {
            moves.push({ type: 'pawn', r: nr, c: nc, priority: 100 }); 
        }
        // Прыжки
        const jr = r + dr * 2, jc = c + dc * 2;
        if (jr >= 0 && jr < 9 && jc >= 0 && jc < 9 &&
            Game.hasPawnAtWithState(state, r + dr, c + dc) &&
            Game.getPlayerAtWithState(state, r + dr, c + dc) !== forPlayer &&
            !Game.hasPawnAtWithState(state, jr, jc) &&
            !Game.isWallBetweenWithState(state, r + dr, c + dc, jr, jc)) {
            moves.push({ type: 'pawn', r: jr, c: jc, priority: 150 }); 
        }
    }

    // Стены — только умные (приоритет задан в generateSmartWallMoves)
    if (p.wallsLeft > 0) {
        const wallMoves = this.generateSmartWallMoves(state, forPlayer);
        moves.push(...wallMoves);
    }

    // Сортируем по приоритету (Супер-стены > Прыжки > Обычный ход > Базовые стены)
    moves.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return moves;
  },

  makeMove(difficulty = 'medium') {
    const botPlayer = 1;
    
    let depth;
    switch (difficulty) {
        case 'easy':
            depth = 2;
            break;
        case 'medium':
            depth = 3;
            break;
        case 'hard':
            depth = 5; 
            break;
        case 'impossible':
            depth = 6; 
            break;
        default:
            depth = 3;
    }

    const moves = this.generateMoves(Game.state, botPlayer);
    if (moves.length === 0) { Game.nextTurn(); return; }

    let bestMove = moves[0];
    let bestScore = -Infinity;
    const startTime = Date.now();
    const moveScores = []; 

    if (difficulty === 'easy' && Math.random() < 0.3) {
        const pawnMoves = moves.filter(m => m.type === 'pawn');
        if (pawnMoves.length > 0) bestMove = pawnMoves[Math.floor(Math.random() * pawnMoves.length)];
    } else {
        for (const move of moves) {
            if (Date.now() - startTime > 2500) break;

            const test = this.cloneState(Game.state);
            this.applyMove(test, move, botPlayer);
            
            let score = this.minimax(test, depth - 1, -Infinity, Infinity, false);
            
            // БОНУС: Поощрение движения пешкой
            if (move.type === 'pawn') {
                score += 150; 
                // Дополнительный бонус за сокращение дистанции
                const newDist = this.shortestPathDistance(test, botPlayer);
                const oldDist = this.shortestPathDistance(Game.state, botPlayer);
                if (newDist < oldDist) {
                    score += (oldDist - newDist) * 50; 
                }
            }

            // АНТИЦИКЛИЧНОСТЬ: Добавляем случайный фактор (±20 очков)
            const randomFactor = Math.random() * 40 - 20;
            score += randomFactor;

            moveScores.push({
                move: this.describeMoveForLog(move),
                score: score.toFixed(1),
                distanceAfter: this.shortestPathDistance(test, botPlayer)
            });

            if (score > bestScore) {
                bestScore = score;
                bestMove = move;
            } else if (score === bestScore && Math.random() < 0.5) { 
                // Если счет равен, с 50% шансом выбираем новый ход
                bestMove = move; 
            }
        }

        // Сортируем и выводим топ-3
        moveScores.sort((a, b) => parseFloat(b.score) - parseFloat(a.score));
        console.log('🤖 ИИ анализирует ходы:');
        console.log(`📍 Текущая позиция: r${Game.state.players[botPlayer].pos.r} c${Game.state.players[botPlayer].pos.c}`);
        moveScores.slice(0, 3).forEach((item, i) => {
            const medal = ['🥇', '🥈', '🥉'][i] || '▪️';
            console.log(`${medal} ${item.move} → Оценка: ${item.score}, Дистанция: ${item.distanceAfter}`);
        });
        console.log(`✅ Выбран: ${this.describeMoveForLog(bestMove)} (${bestScore.toFixed(1)} очков)\n`);
    }

    this.applyMove(Game.state, bestMove, botPlayer);
    Game.draw();
    if (Game.checkVictory()) return;
    Game.nextTurn();
  },

  describeMoveForLog(move) {
    if (move.type === 'pawn') {
      return `Ход на r${move.r} c${move.c}`;
    } else {
      const orient = move.vertical ? 'вертикальная' : 'горизонтальная';
      return `Стена ${orient} r${move.r} c${move.c}`;
    }
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