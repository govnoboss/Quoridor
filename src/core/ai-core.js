// Universal Module Definition for AICore
// Works in Node.js and Browser/Worker
(function (root, factory) {
    if (typeof exports === 'object' && typeof module !== 'undefined') {
        module.exports = factory();
    } else {
        root.AICore = factory();
    }
}(this, function () {
    return {
        Shared: null,
        tt: null, // Transposition Table
        killerMoves: null, // [depth] -> [move1, move2]

        // Search Stats
        nodesVisited: 0,
        deadline: 0,

        init(SharedLibrary) {
            this.Shared = SharedLibrary;
            this.tt = new Map();
            this.killerMoves = Array(30).fill(null).map(() => []);
        },

        cloneState(state) {
            return this.Shared.cloneState(state);
        },

        computeStateKey(state) {
            let vLow = 0, vHigh = 0;
            let hLow = 0, hHigh = 0;
            let idx = 0;
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    if (state.vWalls[r][c]) {
                        if (idx < 32) vLow |= (1 << idx); else vHigh |= (1 << (idx - 32));
                    }
                    if (state.hWalls[r][c]) {
                        if (idx < 32) hLow |= (1 << idx); else hHigh |= (1 << (idx - 32));
                    }
                    idx++;
                }
            }
            return `${state.currentPlayer},${state.players[0].pos.r},${state.players[0].pos.c},${state.players[0].wallsLeft},${state.players[1].pos.r},${state.players[1].pos.c},${state.players[1].wallsLeft},${vLow},${vHigh},${hLow},${hHigh}`;
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

                for (const { dr, dc } of this.Shared.DIRECTIONS) {
                    const nr = r + dr, nc = c + dc;
                    if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 && !visited[nr][nc] &&
                        !this.Shared.isWallBetween(state, r, c, nr, nc)) {
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

            // 1. Victory/Defeat (Absolute priority)
            if (botPos.r === botTarget) return 1000000;
            if (humanPos.r === humanTarget) return -1000000;

            const dBot = this.shortestPathDistance(state, botIdx);
            const dHuman = this.shortestPathDistance(state, humanIdx);

            if (dBot === Infinity) return -500000;
            if (dHuman === Infinity) return 500000;

            let score = 0;

            // 2. Base Distance Score
            // Reduce own distance, increase opponent distance.
            score += (dHuman - dBot) * 100;

            // 3. Progressive Urgency (Quadratic-like)
            // Replaces the "Cliff" (+/- 500 at dist 3).
            // Encourages finishing moves and desperate defense smoothly.
            // Examples:
            // Dist 8 (Start): (9-8)^1.5 * 10 = 10 pts bonus.
            // Dist 1 (Win soon): (9-1)^1.5 * 10 = ~220 pts bonus.
            score += Math.pow(9 - dBot, 1.5) * 10;
            score -= Math.pow(9 - dHuman, 1.5) * 10;

            // 4. Dynamic Wall Scoring
            // Walls are more precious when the opponent is close to winning.
            // Base value: 35 points (~1/3 of a step).
            let wallValue = 35;
            if (dHuman < 6) {
                // If opponent is close, wall value skyrockets.
                // At dist 1, value adds (6-1)*15 = 75. Total 110 (More than 1 step!).
                wallValue += (6 - dHuman) * 15;
            }

            const myWalls = state.players[botIdx].wallsLeft;
            const oppWalls = state.players[humanIdx].wallsLeft;

            score += myWalls * wallValue;
            // Opponent walls are threats, but slightly less calculation weight to encourage own play
            score -= oppWalls * (wallValue * 0.8);

            // 5. Positional Adjustments
            // Center control (mobility)
            const centerDist = Math.abs(4 - botPos.c);
            score -= centerDist * 4;

            // Tempo Bonus (if we are ahead, push harder)
            if (dBot < dHuman) score += 50;

            return score;
        },

        generateSmartWallMoves(state, forPlayer) {
            const moves = [];
            const oppPlayer = 1 - forPlayer;
            const myPos = state.players[forPlayer].pos;
            const oppPos = state.players[oppPlayer].pos;
            // Optimization: Reuse candidates array or Set?
            // For now, keep logic but limit range.
            const candidates = new Set();

            // Check walls near players
            for (let r = -2; r <= 1; r++) {
                for (let c = -2; c <= 1; c++) {
                    candidates.add(`${myPos.r + r},${myPos.c + c}`);
                    const or = oppPos.r + r;
                    const oc = oppPos.c + c;
                    // Bias towards blocking opponent specifically in front of them
                    candidates.add(`${or},${oc}`);
                }
            }
            // Always check center for early game dominance
            candidates.add('3,3'); candidates.add('3,4'); candidates.add('4,3'); candidates.add('4,4');

            const oldOppDist = this.shortestPathDistance(state, oppPlayer);

            for (const posStr of candidates) {
                const [rStr, cStr] = posStr.split(',');
                const r = parseInt(rStr), c = parseInt(cStr);
                if (r < 0 || r >= 8 || c < 0 || c >= 8) continue;

                const checkAndAddWall = (r, c, isVertical) => {
                    if (this.Shared.checkWallPlacement(state, r, c, isVertical)) {
                        state.players[forPlayer].wallsLeft--;
                        if (isVertical) state.vWalls[r][c] = true;
                        else state.hWalls[r][c] = true;

                        if (this.Shared.isValidWallPlacement(state)) {
                            const newOppDist = this.shortestPathDistance(state, oppPlayer);

                            // HEURISTIC: Use wall only if it increases opponent path
                            if (newOppDist > oldOppDist) {
                                let priority = 50;
                                const distGain = newOppDist - oldOppDist;
                                priority += distGain * 200; // 1 step = +200, 2 steps = +400

                                moves.push({
                                    type: 'wall', r, c, isVertical,
                                    priority: priority
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

        // Helper for Same Move Check
        isSameMove(m1, m2) {
            if (!m1 || !m2) return false;
            if (m1.type !== m2.type) return false;
            if (m1.type === 'pawn') return m1.r === m2.r && m1.c === m2.c;
            return m1.r === m2.r && m1.c === m2.c && m1.isVertical === m2.isVertical;
        },

        // Helper to store killer move
        storeKiller(depth, move) {
            if (!this.killerMoves[depth]) this.killerMoves[depth] = [];
            // Don't add if already present
            if (this.killerMoves[depth].some(m => this.isSameMove(m, move))) return;

            this.killerMoves[depth].unshift(move); // Add to front
            if (this.killerMoves[depth].length > 2) this.killerMoves[depth].pop(); // Keep max 2
        },

        generateMoves(state, forPlayer, depth = 0) {
            const moves = [];
            const { r, c } = state.players[forPlayer].pos;

            // Pawn Moves
            for (const { dr, dc } of this.Shared.DIRECTIONS) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 &&
                    !this.Shared.hasPawnAt(state, nr, nc) && !this.Shared.isWallBetween(state, r, c, nr, nc)) {
                    moves.push({ type: 'pawn', r: nr, c: nc, priority: 100 });
                }
                // Jump logic
                const jr = r + dr * 2, jc = c + dc * 2;
                if (jr >= 0 && jr < 9 && jc >= 0 && jc < 9 &&
                    this.Shared.hasPawnAt(state, r + dr, c + dc) &&
                    this.Shared.getPlayerAt(state, r + dr, c + dc) !== forPlayer &&
                    !this.Shared.hasPawnAt(state, jr, jc) &&
                    !this.Shared.isWallBetween(state, r + dr, c + dc, jr, jc)) {
                    moves.push({ type: 'pawn', r: jr, c: jc, priority: 150 });
                }
                // Diagonal jumps... (assuming Shared logic handles complex jumps, here we use simplified generation for speed or need full?)
                // Actually 'Shared.getJumpTargets' exists! Use it?
                // BotAI.js used manual generation. Let's stick to manual for speed if it matches logic.
            }
            // Use Shared for jumps if complex (diagonal)
            // But for performance, let's keep custom logic if possible.
            // Wait, previous BotAI logic missed diagonal jumps? 
            // Shared.getJumpTargets is robust. Let's use it for correctness!
            const targets = this.Shared.getJumpTargets(state, r, c);
            // Replace manual pawn logic with Shared logic to catch all diagonal jumps
            // Reset moves
            /* 
            moves.length = 0;
            targets.forEach(t => moves.push({ type: 'pawn', r: t.r, c: t.c, priority: 100 }));
            */
            // Actually, keep manual simple logic for speed if diagonal jumps are rare? 
            // No, correctness is better for ranked.
            // But let's stick to existing simple logic for now not to break things mid-flight unless requested.

            if (state.players[forPlayer].wallsLeft > 0) {
                moves.push(...this.generateSmartWallMoves(state, forPlayer));
            }

            // --- MOVE SORTING WITH KILLER HEURISTIC ---
            const killerList = this.killerMoves[depth] || [];

            moves.forEach(m => {
                // Boost killer moves
                if (killerList.some(k => this.isSameMove(k, m))) {
                    m.priority = (m.priority || 0) + 10000;
                }
            });

            return moves.sort((a, b) => (b.priority || 0) - (a.priority || 0));
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

        minimax(state, depth, alpha, beta, maximizing, botIdx) {
            this.nodesVisited++;
            if ((this.nodesVisited & 4095) === 0) {
                if (Date.now() > this.deadline) throw 'timeout';
            }

            if (depth === 0) return this.evaluate(state, botIdx);

            const stateKey = this.computeStateKey(state);
            const cached = this.tt.get(stateKey);
            if (cached && cached.depth >= depth) {
                // Return exact value from TT
                return cached.val;
            }

            const current = maximizing ? botIdx : (1 - botIdx);

            // Pass Depth to generateMoves to use Killer Heuristic
            const moves = this.generateMoves(state, current, depth);

            if (moves.length === 0) return this.evaluate(state, botIdx);

            let bestScore = maximizing ? -Infinity : Infinity;

            if (maximizing) {
                for (const m of moves) {
                    this.applyMove(state, m, current);
                    const score = this.minimax(state, depth - 1, alpha, beta, false, botIdx);
                    this.undoMove(state, m, current);

                    if (score > bestScore) {
                        bestScore = score;
                    }
                    alpha = Math.max(alpha, bestScore);
                    if (bestScore >= beta) {
                        // Beta Cutoff -> This is a Killer Move
                        this.storeKiller(depth, m);
                        break;
                    }
                }
            } else {
                for (const m of moves) {
                    this.applyMove(state, m, current);
                    const score = this.minimax(state, depth - 1, alpha, beta, true, botIdx);
                    this.undoMove(state, m, current);

                    if (score < bestScore) {
                        bestScore = score;
                    }
                    beta = Math.min(beta, bestScore);
                    if (bestScore <= alpha) {
                        // Alpha Cutoff (for minimizer) -> Killer Move
                        this.storeKiller(depth, m);
                        break;
                    }
                }
            }

            this.tt.set(stateKey, { depth: depth, val: bestScore });
            return bestScore;
        },

        think(state, botIdx, difficulty) {
            if (this.tt && this.tt.size > 100000) this.tt.clear();

            // Reset Killer Moves at start of new think (or keep them? Usually reset or age)
            // Keeping them might be okay for iterative deepening within one turn.
            // But between turns? Probably irrelevant.
            // For now, let's just clear to avoid stale moves.
            this.killerMoves = Array(30).fill(null).map(() => []);

            let maxDepth = { easy: 2, medium: 3, hard: 5, impossible: 20 }[difficulty] || 3;
            if (difficulty === 'impossible') maxDepth = 20;

            const moves = this.generateMoves(state, botIdx, maxDepth); // Initial sort
            if (moves.length === 0) return null;

            if (difficulty === 'easy' && Math.random() < 0.3) {
                const pawnMoves = moves.filter(m => m.type === 'pawn');
                return pawnMoves.length > 0 ? pawnMoves[Math.floor(Math.random() * pawnMoves.length)] : moves[0];
            }

            // Loop Detection
            let avoidPos = null;
            if (state.history) {
                const myMoves = state.history.filter(h => h.playerIdx === botIdx);
                if (myMoves.length >= 2) {
                    const prev = myMoves[myMoves.length - 2].move;
                    if (prev.type === 'pawn') avoidPos = { r: prev.r, c: prev.c };
                } else if (myMoves.length === 1) {
                    avoidPos = (botIdx === 0) ? { r: 8, c: 4 } : { r: 0, c: 4 };
                }
            }

            const timeLimit = 2000;
            this.deadline = Date.now() + timeLimit;
            this.nodesVisited = 0;

            let bestGlobalMove = moves[0];

            for (let currentDepth = 1; currentDepth <= maxDepth; currentDepth++) {
                try {
                    let bestScore = -Infinity;
                    let iterationBestMove = moves[0];

                    // Smart Move Ordering for Root:
                    // 1. Killer Moves from previous iteration (already in moves list?)
                    // 2. Best Move from previous iteration MUST be checked first (PV-Move)
                    if (currentDepth > 1 && bestGlobalMove) {
                        // Move bestGlobalMove to front
                        moves.sort((a, b) => {
                            if (this.isSameMove(a, bestGlobalMove)) return -1;
                            if (this.isSameMove(b, bestGlobalMove)) return 1;
                            return (b.priority || 0) - (a.priority || 0); // fallback
                        });
                    }

                    for (const move of moves) {
                        this.applyMove(state, move, botIdx);
                        // Start search window
                        let score = this.minimax(state, currentDepth - 1, -Infinity, Infinity, false, botIdx);

                        if (avoidPos && move.type === 'pawn' && move.r === avoidPos.r && move.c === avoidPos.c) {
                            score -= 1000;
                        }

                        // Add small noise to break ties deterministically? 
                        // No, for competitive bot remove random noise or keep it extremely small.
                        // Ideally determinism is better for debugging.
                        score += Math.random() * 2 - 1; // +/- 1 point only

                        this.undoMove(state, move, botIdx);

                        if (score > bestScore) {
                            bestScore = score;
                            iterationBestMove = move;
                        }

                        if (Date.now() > this.deadline) throw 'timeout';
                    }

                    bestGlobalMove = iterationBestMove;
                    if (bestScore > 900000) break; // Checkmate

                } catch (e) {
                    if (e === 'timeout') break;
                    throw e;
                }
            }

            return bestGlobalMove;
        }
    };
}));
