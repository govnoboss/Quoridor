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
    getBotIndex() {
        return Game.myPlayerIndex === 0 ? 1 : 0;
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

            for (const { dr, dc } of Shared.DIRECTIONS) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 && !visited[nr][nc] &&
                    !Shared.isWallBetween(state, r, c, nr, nc)) {
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
        const botIdx = this.getBotIndex();
        const humanIdx = 1 - botIdx;

        const botPos = state.players[botIdx].pos;
        const humanPos = state.players[humanIdx].pos;

        const botTarget = botIdx === 0 ? 0 : 8;
        const humanTarget = humanIdx === 0 ? 0 : 8;

        // 0. Мгновенная победа или поражение
        if (botPos.r === botTarget) return 1000000;
        if (humanPos.r === humanTarget) return -1000000;

        // 1. Расчет реальных путей (BFS)
        const dBot = this.shortestPathDistance(state, botIdx);
        const dHuman = this.shortestPathDistance(state, humanIdx);

        // Если пути перекрыты (хотя генератор ходов должен это отсекать)
        if (dBot === Infinity) return -500000;
        // Если мы перекрыли путь врагу (в рамках правил это запрещено, но для оценки — это круто)
        // Но так как checkVictory проверяется раньше, здесь ставим высокий балл
        if (dHuman === Infinity) return 500000;

        let score = 0;

        // 2. БАЗОВАЯ ОЦЕНКА: Мы хотим, чтобы dBot был 0, а dHuman был большим.
        // Чем ближе мы к финишу, тем ценнее каждый шаг.
        score += (dHuman - dBot) * 100;

        // 3. АГРЕССИВНОСТЬ В КОНЦЕ (Endgame)
        // Если бот близок к финишу (<= 3 ходов), приоритет бега максимальный.
        if (dBot <= 3) {
            score += 500;
        }

        // 4. ОПАСНОСТЬ (Defense)
        // Если враг близок к финишу, ценность его замедления взлетает до небес.
        if (dHuman <= 3) {
            score -= 500; // Паника! Нужно срочно что-то делать (ставить стены)
        }

        // 5. ОЦЕНКА СТЕН (Resources)
        // Стена стоит очков, но меньше, чем шаг (шаг ~100).
        // Одна стена ~ 15 очков. Это поощряет экономию, но позволяет тратить их ради выгоды.
        const wallsDiff = state.players[botIdx].wallsLeft - state.players[humanIdx].wallsLeft;
        score += wallsDiff * 15;

        // 6. ЦЕНТР ДОСКИ (Positional)
        // Исправлен баг: теперь берем правильную колонку бота (state.players[botIdx])
        // Быть в центре (c=4) лучше, чем с краю, так как больше вариантов движения.
        const centerDist = Math.abs(4 - state.players[botIdx].pos.c);
        score -= centerDist * 5; // Небольшой штраф за удаление от центра

        // 7. СТРАТЕГИЧЕСКАЯ КОРРЕКЦИЯ
        // Если у бота путь намного короче, не нужно рисковать (лишние стены могут навредить самому себе).
        if (dBot < dHuman - 2) {
            score += 50; // Бонус за уверенное лидерство
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
                if (Shared.checkWallPlacement(state, r, c, vertical)) {
                    const temp = this.cloneState(state);
                    if (vertical) temp.vWalls[r][c] = true;
                    else temp.hWalls[r][c] = true;

                    if (Shared.isValidWallPlacement(temp)) {
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
        for (const { dr, dc } of Shared.DIRECTIONS) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 &&
                !Shared.hasPawnAt(state, nr, nc) &&
                !Shared.isWallBetween(state, r, c, nr, nc)) {
                moves.push({ type: 'pawn', r: nr, c: nc, priority: 100 });
            }
            // Прыжки
            const jr = r + dr * 2, jc = c + dc * 2;
            if (jr >= 0 && jr < 9 && jc >= 0 && jc < 9 &&
                Shared.hasPawnAt(state, r + dr, c + dc) &&
                Shared.getPlayerAt(state, r + dr, c + dc) !== forPlayer &&
                !Shared.hasPawnAt(state, jr, jc) &&
                !Shared.isWallBetween(state, r + dr, c + dc, jr, jc)) {
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
        const botPlayer = this.getBotIndex();

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

                // Дополнительный бонус за сокращение дистанции
                const newDist = this.shortestPathDistance(test, botPlayer);
                const oldDist = this.shortestPathDistance(Game.state, botPlayer);
                if (newDist < oldDist) {
                    score += (oldDist - newDist) * 50;
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

        const botPlayer = this.getBotIndex();
        const current = maximizing ? botPlayer : (1 - botPlayer);

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