const Shared = require('../core/shared');

/**
 * Quoridor Bot AI logic (Ported from frontend/ai-worker.js)
 */
const BotAI = {
    cloneState(state) {
        return Shared.cloneState(state);
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

    evaluate(state, botIdx) {
        const humanIdx = 1 - botIdx;
        const botPos = state.players[botIdx].pos;
        const humanPos = state.players[humanIdx].pos;
        const botTarget = botIdx === 0 ? 0 : 8;
        const humanTarget = humanIdx === 0 ? 0 : 8;

        if (botPos.r === botTarget) return 1000000;
        if (humanPos.r === humanTarget) return -1000000;

        const dBot = this.shortestPathDistance(state, botIdx);
        const dHuman = this.shortestPathDistance(state, humanIdx);

        if (dBot === Infinity) return -500000;
        if (dHuman === Infinity) return 500000;

        let score = (dHuman - dBot) * 100;
        if (dBot <= 3) score += 500;
        if (dHuman <= 3) score -= 500;

        const wallsDiff = state.players[botIdx].wallsLeft - state.players[humanIdx].wallsLeft;
        score += wallsDiff * 15;

        const centerDist = Math.abs(4 - state.players[botIdx].pos.c);
        score -= centerDist * 5;

        if (dBot < dHuman - 2) score += 50;

        return score;
    },

    generateSmartWallMoves(state, forPlayer) {
        const moves = [];
        const oppPlayer = 1 - forPlayer;
        const myPos = state.players[forPlayer].pos;
        const oppPos = state.players[oppPlayer].pos;
        const candidates = new Set();

        for (let r = -2; r <= 1; r++) {
            for (let c = -2; c <= 1; c++) {
                candidates.add(`${myPos.r + r},${myPos.c + c}`);
                candidates.add(`${oppPos.r + r},${oppPos.c + c}`);
            }
        }
        candidates.add('3,3'); candidates.add('3,4'); candidates.add('4,3'); candidates.add('4,4');

        const oldOppDist = this.shortestPathDistance(state, oppPlayer);

        for (const posStr of candidates) {
            const [rStr, cStr] = posStr.split(',');
            const r = parseInt(rStr), c = parseInt(cStr);
            if (r < 0 || r >= 8 || c < 0 || c >= 8) continue;

            const checkAndAddWall = (r, c, isVertical) => {
                if (Shared.checkWallPlacement(state, r, c, isVertical)) {
                    state.players[forPlayer].wallsLeft--;
                    if (isVertical) state.vWalls[r][c] = true;
                    else state.hWalls[r][c] = true;

                    if (Shared.isValidWallPlacement(state)) {
                        const newOppDist = this.shortestPathDistance(state, oppPlayer);
                        if (newOppDist >= oldOppDist + 1) {
                            moves.push({
                                type: 'wall', r, c, isVertical,
                                priority: (newOppDist >= oldOppDist + 2) ? 1000 : 50
                            });
                        }
                    }
                    if (isVertical) state.vWalls[r][c] = false;
                    else state.hWalls[r][c] = false;
                    state.players[forPlayer].wallsLeft++;
                }
            };
            checkAndAddWall(r, c, false);
            checkAndAddWall(r, c, true);
        }
        return moves;
    },

    generateMoves(state, forPlayer) {
        const moves = [];
        const { r, c } = state.players[forPlayer].pos;
        for (const { dr, dc } of Shared.DIRECTIONS) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 &&
                !Shared.hasPawnAt(state, nr, nc) && !Shared.isWallBetween(state, r, c, nr, nc)) {
                moves.push({ type: 'pawn', r: nr, c: nc, priority: 100 });
            }
            const jr = r + dr * 2, jc = c + dc * 2;
            if (jr >= 0 && jr < 9 && jc >= 0 && jc < 9 &&
                Shared.hasPawnAt(state, r + dr, c + dc) &&
                Shared.getPlayerAt(state, r + dr, c + dc) !== forPlayer &&
                !Shared.hasPawnAt(state, jr, jc) &&
                !Shared.isWallBetween(state, r + dr, c + dc, jr, jc)) {
                moves.push({ type: 'pawn', r: jr, c: jc, priority: 150 });
            }
        }
        if (state.players[forPlayer].wallsLeft > 0) {
            moves.push(...this.generateSmartWallMoves(state, forPlayer));
        }
        return moves.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    },

    minimax(state, depth, alpha, beta, maximizing, botIdx) {
        if (depth === 0) return this.evaluate(state, botIdx);
        const current = maximizing ? botIdx : (1 - botIdx);
        const moves = this.generateMoves(state, current);

        if (maximizing) {
            let max = -Infinity;
            for (const m of moves) {
                this.applyMove(state, m, current);
                const score = this.minimax(state, depth - 1, alpha, beta, false, botIdx);
                this.undoMove(state, m, current);
                max = Math.max(max, score);
                alpha = Math.max(alpha, max);
                if (max >= beta) break;
            }
            return max;
        } else {
            let min = Infinity;
            for (const m of moves) {
                this.applyMove(state, m, current);
                const score = this.minimax(state, depth - 1, alpha, beta, true, botIdx);
                this.undoMove(state, m, current);
                min = Math.min(min, score);
                beta = Math.min(beta, min);
                if (min <= alpha) break;
            }
            return min;
        }
    },

    applyMove(state, move, playerIdx) {
        if (move.type === 'pawn') {
            move.prevPos = { ...state.players[playerIdx].pos };
            state.players[playerIdx].pos = { r: move.r, c: move.c };
        } else {
            if (move.isVertical) state.vWalls[move.r][move.c] = true;
            else state.hWalls[move.r][move.c] = true;
            state.players[playerIdx].wallsLeft--;
        }
    },

    undoMove(state, move, playerIdx) {
        if (move.type === 'pawn') {
            state.players[playerIdx].pos = move.prevPos;
        } else {
            if (move.isVertical) state.vWalls[move.r][move.c] = false;
            else state.hWalls[move.r][move.c] = false;
            state.players[playerIdx].wallsLeft++;
        }
    },

    think(state, botIdx, difficulty) {
        let depth = { easy: 2, medium: 3, hard: 4, impossible: 5 }[difficulty] || 3;
        // Reduced max depth slighty for NodeJS safety (single threaded blockage)
        const moves = this.generateMoves(state, botIdx);
        if (moves.length === 0) return null;

        if (difficulty === 'easy' && Math.random() < 0.3) {
            const pawnMoves = moves.filter(m => m.type === 'pawn');
            return pawnMoves.length > 0 ? pawnMoves[Math.floor(Math.random() * pawnMoves.length)] : moves[0];
        }

        let bestMove = moves[0];
        let bestScore = -Infinity;
        const startTime = Date.now();
        const initialBotDist = this.shortestPathDistance(state, botIdx);

        // --- Loop Detection ---
        let avoidPos = null;
        if (state.history) {
            const myMoves = state.history.filter(h => h.playerIdx === botIdx);
            if (myMoves.length > 0) {
                if (myMoves.length === 1) {
                    avoidPos = (botIdx === 0) ? { r: 8, c: 4 } : { r: 0, c: 4 };
                } else {
                    const prev = myMoves[myMoves.length - 2].move;
                    if (prev.type === 'pawn') avoidPos = { r: prev.r, c: prev.c };
                }
            }
        }

        console.log(`[BOT-AI] Loop Check: HistoryLen=${state.history?.length}, AvoidPos=${JSON.stringify(avoidPos)}`);

        for (const move of moves) {
            if (Date.now() - startTime > 3000) break; // 3 sec timeout
            this.applyMove(state, move, botIdx);
            let score = this.minimax(state, depth - 1, -Infinity, Infinity, false, botIdx);

            const newDist = this.shortestPathDistance(state, botIdx);
            if (newDist < initialBotDist) {
                score += (initialBotDist - newDist) * 50;
            }

            // Penalty for repetition
            if (avoidPos && move.type === 'pawn' && move.r === avoidPos.r && move.c === avoidPos.c) {
                console.log(`[BOT-AI] Penalizing Repetition: ${move.r},${move.c} (-1000)`);
                score -= 1000; // Increased penalty to be sure
            }

            // Debug top moves
            if (score > -500000 && difficulty === 'medium') {
                // console.log(`[BOT-AI] Move ${move.type} ${move.r},${move.c} Score: ${score}`);
            }

            score += Math.random() * 40 - 20;

            if (score > bestScore) {
                bestScore = score;
                bestMove = move;
            }
            this.undoMove(state, move, botIdx);
        }
        return bestMove;
    }
};

module.exports = BotAI;
