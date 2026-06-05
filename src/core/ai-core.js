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

        // Debug mode for detailed logging
        DEBUG: false,
        logger: null, // Custom logger function

        // Helper: log only if DEBUG is enabled
        debugLog(...args) {
            if (this.DEBUG) {
                if (this.logger) {
                    this.logger(...args);
                } else {
                    console.log('[AI-DEBUG]', ...args);
                }
            }
        },

        // Helper: format move for logging
        formatMove(m) {
            if (!m) return 'none';
            if (m.type === 'pawn') return `pawn(${m.r},${m.c})`;
            return `wall(${m.r},${m.c},${m.isVertical ? 'V' : 'H'})`;
        },

        // Search Stats
        nodesVisited: 0,
        deadline: 0,

        // Zobrist Hashing Tables
        zobristTable: {
            pawn: null, // [playerIdx][r][c] -> {high, low}
            vWalls: null, // [r][c] -> {high, low}
            hWalls: null, // [r][c] -> {high, low}
            turn: null, // [playerIdx] -> {high, low}
            wallsLeft: null // [playerIdx][count] -> {high, low}
        },

        init(SharedLibrary) {
            this.Shared = SharedLibrary;
            this.tt = new Map();
            this.killerMoves = Array(30).fill(null).map(() => []);
            this.initZobrist();
        },

        // Initialize Zobrist tables with random 64-bit values (split into high/low 32-bit)
        initZobrist() {
            const rand32 = () => (Math.random() * 0xFFFFFFFF) | 0;
            const rand64 = () => ({ high: rand32(), low: rand32() });

            this.zobristTable.pawn = Array.from({ length: 2 }, () =>
                Array.from({ length: 9 }, () =>
                    Array.from({ length: 9 }, () => rand64())
                )
            );

            this.zobristTable.vWalls = Array.from({ length: 8 }, () =>
                Array.from({ length: 8 }, () => rand64())
            );

            this.zobristTable.hWalls = Array.from({ length: 8 }, () =>
                Array.from({ length: 8 }, () => rand64())
            );

            this.zobristTable.turn = [rand64(), rand64()];

            this.zobristTable.wallsLeft = Array.from({ length: 2 }, () =>
                Array.from({ length: 11 }, () => rand64()) // 0 to 10 walls
            );
        },

        // Compute full hash from scratch (for initial state)
        computeZobristHash(state) {
            let h = 0, l = 0;

            // Turn
            const zTurn = this.zobristTable.turn[state.currentPlayer];
            h ^= zTurn.high; l ^= zTurn.low;

            // Pawns & Walls Left
            for (let i = 0; i < 2; i++) {
                const p = state.players[i];
                const zPawn = this.zobristTable.pawn[i][p.pos.r][p.pos.c];
                h ^= zPawn.high; l ^= zPawn.low;

                const zWalls = this.zobristTable.wallsLeft[i][p.wallsLeft];
                h ^= zWalls.high; l ^= zWalls.low;
            }

            // Walls
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    if (state.vWalls[r][c]) {
                        const z = this.zobristTable.vWalls[r][c];
                        h ^= z.high; l ^= z.low;
                    }
                    if (state.hWalls[r][c]) {
                        const z = this.zobristTable.hWalls[r][c];
                        h ^= z.high; l ^= z.low;
                    }
                }
            }

            return { hashHigh: h, hashLow: l }; // Integers
        },

        cloneState(state) {
            const cloned = this.Shared.cloneState(state);
            // Manually copy hash since Shared doesn't know about it
            if (state.hashHigh !== undefined) {
                cloned.hashHigh = state.hashHigh;
                cloned.hashLow = state.hashLow;
            }
            return cloned;
        },

        // O(1) Key generation using calculated hash
        computeStateKey(state) {
            // Convert signed 32-bit ints to unsigned hex strings for consistency
            const h = (state.hashHigh >>> 0).toString(16);
            const l = (state.hashLow >>> 0).toString(16);
            return h + "-" + l;
        },

        shortestPathDistance(state, playerIdx) {
            const targetRow = playerIdx === 0 ? 0 : 8;
            const start = state.players[playerIdx].pos;
            const visited = Array(9).fill().map(() => Array(9).fill(false));
            const queue = [{ r: start.r, c: start.c, dist: 0 }];
            let head = 0; // Index-based dequeue: O(1) instead of shift()'s O(n)
            visited[start.r][start.c] = true;

            while (head < queue.length) {
                const { r, c, dist } = queue[head++]; // O(1) dequeue
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

        // Multi-source BFS from all goal-row cells.
        // Returns a 9x9 grid where map[r][c] = real path distance to goal for playerIdx.
        // Unlike shortestPathDistance (single value), this map covers every cell,
        // so generateMoves can compare any target cell without extra BFS calls.
        pathDistanceMap(state, playerIdx) {
            const targetRow = playerIdx === 0 ? 0 : 8;
            const dist = Array.from({ length: 9 }, () => Array(9).fill(Infinity));
            const queue = [];
            let head = 0;

            // Seed from every cell on the goal row simultaneously
            for (let c = 0; c < 9; c++) {
                dist[targetRow][c] = 0;
                queue.push({ r: targetRow, c });
            }

            while (head < queue.length) {
                const { r, c } = queue[head++];
                for (const { dr, dc } of this.Shared.DIRECTIONS) {
                    const nr = r + dr, nc = c + dc;
                    if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 &&
                        dist[nr][nc] === Infinity &&
                        !this.Shared.isWallBetween(state, r, c, nr, nc)) {
                        dist[nr][nc] = dist[r][c] + 1;
                        queue.push({ r: nr, c: nc });
                    }
                }
            }
            return dist;
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
            score += (dHuman - dBot) * 120;

            // Extra penalty when bot is behind opponent (discourages retreating)
            if (dBot > dHuman) score -= (dBot - dHuman) * 30;

            // 3. Progressive Urgency (Quadratic-like)
            // Replaces the "Cliff" (+/- 500 at dist 3).
            // Encourages finishing moves and desperate defense smoothly.
            // Examples:
            // Dist 8 (Start): (9-8)^1.5 * 10 = 10 pts bonus.
            // Dist 1 (Win soon): (9-1)^1.5 * 10 = ~220 pts bonus.
            score += Math.pow(Math.max(0, 9 - dBot), 1.5) * 10;
            score -= Math.pow(Math.max(0, 9 - dHuman), 1.5) * 10;

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

            // Tempo Bonus (Turn Advantage)
            // Being to move is worth ~0.6 step. Stabilizes even/odd depth oscillation.
            if (state.currentPlayer === botIdx) score += 60;
            else score -= 60;

            // Ahead Bonus (Push harder if winning)
            if (dBot < dHuman) score += 80;

            // 6. Mobility Score — penalize being cornered or in a narrow corridor.
            // Count reachable moves from current position; fewer options = worse position.
            const botMobility  = this.Shared.getJumpTargets(state, botPos.r,   botPos.c).length;
            const humanMobility = this.Shared.getJumpTargets(state, humanPos.r, humanPos.c).length;
            score += (botMobility - humanMobility) * 15;

            return score;
        },

        generateSmartWallMoves(state, forPlayer) {
            const moves = [];
            const oppPlayer = 1 - forPlayer;
            const myPos = state.players[forPlayer].pos;
            const oppPos = state.players[oppPlayer].pos;
            const candidates = new Set();

            // Reduced range: -1 to 1 instead of -2 to 1 (cuts candidates by ~40%)
            for (let r = -1; r <= 1; r++) {
                for (let c = -1; c <= 1; c++) {
                    candidates.add(`${myPos.r + r},${myPos.c + c}`);
                    candidates.add(`${oppPos.r + r},${oppPos.c + c}`);
                }
            }
            // Center walls for early game
            candidates.add('3,4'); candidates.add('4,4');

            const oldOppDist = this.shortestPathDistance(state, oppPlayer);
            const oldMyDist = this.shortestPathDistance(state, forPlayer); // FIX 1: measure own path before wall
            const MAX_WALL_MOVES = 8; // Limit wall moves to reduce BFS calls

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
                            const newMyDist = this.shortestPathDistance(state, forPlayer); // FIX 1: measure own path after wall

                            // FIX 1: Use wall only if NET gain is positive (helps opponent more than hurts self)
                            const oppGain = newOppDist - oldOppDist;
                            const selfCost = newMyDist - oldMyDist;
                            const netGain = oppGain - selfCost;

                            if (netGain > 0) {
                                let priority = 50;
                                priority += netGain * 80; // FIX 1: priority based on net gain, not raw opp gain

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

            // FIX 4: Sort all candidates by priority, then take top MAX_WALL_MOVES
            // (previously early-exit by count caused best walls to be missed)
            moves.sort((a, b) => (b.priority || 0) - (a.priority || 0));
            return moves.slice(0, MAX_WALL_MOVES);
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

            // Pawn Moves - use Shared.getJumpTargets for full correctness
            // This handles simple moves, straight jumps, AND diagonal jumps
            const pawnTargets = this.Shared.getJumpTargets(state, r, c);

            // Urgency bonus: if bot is close to winning, strongly prefer pawn moves
            const dBot = this.shortestPathDistance(state, forPlayer);
            const urgencyBonus = dBot <= 3 ? (4 - dBot) * 100 : 0; // dist 1 → +300, dist 2 → +200, dist 3 → +100

            // Build a real path-distance map for the entire board (one BFS, wall-aware).
            // Used for directionBonus so that a "backward" row move that is the only maze
            // exit gets a positive bonus instead of a Manhattan penalty.
            const distMap = this.pathDistanceMap(state, forPlayer);
            const currentPathDist = distMap[r][c];

            for (const target of pawnTargets) {
                // Higher priority for straight-line jumps (moving towards goal)
                const isJump = Math.abs(target.r - r) === 2 || Math.abs(target.c - c) === 2 ||
                    (Math.abs(target.r - r) === 1 && Math.abs(target.c - c) === 1);
                const basePriority = isJump ? 150 : 100;

                // Direction-aware priority based on REAL path distance, not Manhattan row distance.
                // This ensures moves that navigate through a maze exit are not penalised.
                const newPathDist = distMap[target.r][target.c];
                const directionBonus = newPathDist < currentPathDist ? 50
                                     : newPathDist > currentPathDist ? -30
                                     : 0;

                moves.push({ type: 'pawn', r: target.r, c: target.c, priority: basePriority + urgencyBonus + directionBonus });
            }

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

                // XOR out old pawn pos
                const zOld = this.zobristTable.pawn[playerIdx][move.prevPos.r][move.prevPos.c];
                state.hashHigh ^= zOld.high;
                state.hashLow ^= zOld.low;

                state.players[playerIdx].pos = { r: move.r, c: move.c };

                // XOR in new pawn pos
                const zNew = this.zobristTable.pawn[playerIdx][move.r][move.c];
                state.hashHigh ^= zNew.high;
                state.hashLow ^= zNew.low;

            } else {
                if (move.isVertical) {
                    state.vWalls[move.r][move.c] = true;
                    // XOR in Wall
                    const zWall = this.zobristTable.vWalls[move.r][move.c];
                    state.hashHigh ^= zWall.high;
                    state.hashLow ^= zWall.low;
                } else {
                    state.hWalls[move.r][move.c] = true;
                    // XOR in Wall
                    const zWall = this.zobristTable.hWalls[move.r][move.c];
                    state.hashHigh ^= zWall.high;
                    state.hashLow ^= zWall.low;
                }

                // Update Walls Left count (Remove old count, add new count)
                const wallsLeft = state.players[playerIdx].wallsLeft;
                const zWallsOld = this.zobristTable.wallsLeft[playerIdx][wallsLeft];
                state.hashHigh ^= zWallsOld.high;
                state.hashLow ^= zWallsOld.low;

                state.players[playerIdx].wallsLeft--;

                const zWallsNew = this.zobristTable.wallsLeft[playerIdx][state.players[playerIdx].wallsLeft];
                state.hashHigh ^= zWallsNew.high;
                state.hashLow ^= zWallsNew.low;
            }

                     // FIX 3: XOR side-to-move so TT distinguishes same board position by different active player
            state.hashHigh ^= this.zobristTable.turn[playerIdx].high ^ this.zobristTable.turn[1 - playerIdx].high;
            state.hashLow  ^= this.zobristTable.turn[playerIdx].low  ^ this.zobristTable.turn[1 - playerIdx].low;
            state.currentPlayer = 1 - state.currentPlayer;
        },

        undoMove(state, move, playerIdx) {
            // Revert changes. XOR is its own inverse, so logic is identical to applyMove (order doesn't matter for XOR)

            if (move.type === 'pawn') {
                // XOR out new pawn pos (remove it)
                const zNew = this.zobristTable.pawn[playerIdx][move.r][move.c];
                state.hashHigh ^= zNew.high;
                state.hashLow ^= zNew.low;

                state.players[playerIdx].pos = move.prevPos;

                // XOR in old pawn pos (restore it)
                const zOld = this.zobristTable.pawn[playerIdx][move.prevPos.r][move.prevPos.c];
                state.hashHigh ^= zOld.high;
                state.hashLow ^= zOld.low;

            } else {
                if (move.isVertical) {
                    state.vWalls[move.r][move.c] = false;
                    const zWall = this.zobristTable.vWalls[move.r][move.c];
                    state.hashHigh ^= zWall.high;
                    state.hashLow ^= zWall.low;
                } else {
                    state.hWalls[move.r][move.c] = false;
                    const zWall = this.zobristTable.hWalls[move.r][move.c];
                    state.hashHigh ^= zWall.high;
                    state.hashLow ^= zWall.low;
                }

                // Update Walls Left
                const wallsLeftNew = state.players[playerIdx].wallsLeft; // This is the 'decremented' value
                const zWallsNew = this.zobristTable.wallsLeft[playerIdx][wallsLeftNew];
                state.hashHigh ^= zWallsNew.high;
                state.hashLow ^= zWallsNew.low;

                state.players[playerIdx].wallsLeft++;

                const wallsLeftOld = state.players[playerIdx].wallsLeft;
                const zWallsOld = this.zobristTable.wallsLeft[playerIdx][wallsLeftOld];
                state.hashHigh ^= zWallsOld.high;
                state.hashLow ^= zWallsOld.low;
            }

            // FIX 3: Undo side-to-move XOR (XOR is its own inverse, same operation)
            state.hashHigh ^= this.zobristTable.turn[playerIdx].high ^ this.zobristTable.turn[1 - playerIdx].high;
            state.hashLow  ^= this.zobristTable.turn[playerIdx].low  ^ this.zobristTable.turn[1 - playerIdx].low;
            state.currentPlayer = 1 - state.currentPlayer;
        },

        minimax(state, depth, alpha, beta, maximizing, botIdx) {
            this.nodesVisited++;
            if ((this.nodesVisited & 4095) === 0) {
                if (Date.now() > this.deadline) throw 'timeout';
            }

            if (depth === 0) return this.evaluate(state, botIdx);

            const stateKey = this.computeStateKey(state);
            const cached = this.tt.get(stateKey);

            // TT lookup with proper bounds handling
            if (cached && cached.depth >= depth) {
                if (cached.flag === 'EXACT') {
                    return cached.val;
                } else if (cached.flag === 'LOWER' && cached.val >= beta) {
                    return cached.val; // Fail-high: cached lower bound beats beta
                } else if (cached.flag === 'UPPER' && cached.val <= alpha) {
                    return cached.val; // Fail-low: cached upper bound below alpha
                }
            }

            const current = maximizing ? botIdx : (1 - botIdx);

            // Pass Depth to generateMoves to use Killer Heuristic
            const moves = this.generateMoves(state, current, depth);

            if (moves.length === 0) return this.evaluate(state, botIdx);

            const origAlpha = alpha;
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

            // Store with proper flag for bounds
            let flag = 'EXACT';
            if (bestScore <= origAlpha) {
                flag = 'UPPER'; // Failed low, this is an upper bound
            } else if (bestScore >= beta) {
                flag = 'LOWER'; // Failed high, this is a lower bound
            }

            this.tt.set(stateKey, { depth, val: bestScore, flag });
            return bestScore;
        },

        think(state, botIdx, difficulty) {
            // Clone the state so we don't mutate the live game state during search
            // (Crucial because timeouts might interrupt the search before undoMove cleans up)
            state = this.cloneState(state);

            const thinkStartTime = Date.now();

            if (this.tt && this.tt.size > 100000) this.tt.clear();

            // Initialize Zobrist hash if missing (e.g. first call from outside)
            if (state.hashHigh === undefined) {
                const h = this.computeZobristHash(state);
                state.hashHigh = h.hashHigh;
                state.hashLow = h.hashLow;
            }

            // Reset Killer Moves at start of new think
            this.killerMoves = Array(30).fill(null).map(() => []);

            let maxDepth = { easy: 2, medium: 3, hard: 5, impossible: 20 }[difficulty] || 3;
            if (difficulty === 'impossible') maxDepth = 20;

            const moves = this.generateMoves(state, botIdx, maxDepth);
            if (moves.length === 0) return null;

            const pos = state.players[botIdx].pos;
            this.debugLog('=== THINKING START ===');
            this.debugLog(`Position: (${pos.r},${pos.c}), Moves: ${moves.length}, MaxDepth: ${maxDepth}, Difficulty: ${difficulty}`);

            if (difficulty === 'easy' && Math.random() < 0.3) {
                const pawnMoves = moves.filter(m => m.type === 'pawn');
                const chosen = pawnMoves.length > 0 ? pawnMoves[Math.floor(Math.random() * pawnMoves.length)] : moves[0];
                this.debugLog(`Easy mode random: ${this.formatMove(chosen)}`);
                return chosen;
            }

            // FIX 2: Loop Detection — robust even when state.history is absent
            const avoidPositions = new Set();
            const historySource = state.history || [];
            const myMoves = historySource
                .filter(h => h.playerIdx === botIdx && h.move && h.move.type === 'pawn')
                .slice(-10); // track last 10 pawn moves to prevent cycling
            for (const m of myMoves) {
                avoidPositions.add(`${m.move.r},${m.move.c}`);
            }
            // Always add starting position as a fallback avoid-target
            if (myMoves.length === 0) {
                avoidPositions.add(botIdx === 0 ? '8,4' : '0,4');
            }

            const timeLimit = 2000;
            this.deadline = Date.now() + timeLimit;
            this.nodesVisited = 0;

            let bestGlobalMove = moves[0];
            let bestGlobalScore = -Infinity;
            let finalDepth = 1;

            for (let currentDepth = 1; currentDepth <= maxDepth; currentDepth++) {
                try {
                    let bestScore = -Infinity;
                    let iterationBestMove = moves[0];

                    this.debugLog(`--- Depth ${currentDepth} ---`);

                    // Move ordering: PV-move first
                    if (currentDepth > 1 && bestGlobalMove) {
                        moves.sort((a, b) => {
                            if (this.isSameMove(a, bestGlobalMove)) return -1;
                            if (this.isSameMove(b, bestGlobalMove)) return 1;
                            return (b.priority || 0) - (a.priority || 0);
                        });
                    }

                    for (const move of moves) {
                        const moveStart = Date.now();

                        this.applyMove(state, move, botIdx);
                        let score = this.minimax(state, currentDepth - 1, -Infinity, Infinity, false, botIdx);

                        // FIX 2: Penalize loop moves with stronger penalty (was 500, now 2000)
                        if (move.type === 'pawn' && avoidPositions.has(`${move.r},${move.c}`)) {
                            score -= 5000;
                        }

                        this.undoMove(state, move, botIdx);

                        const moveTime = Date.now() - moveStart;
                        this.debugLog(`  ${this.formatMove(move)}: score=${score.toFixed(0)}, time=${moveTime}ms`);

                        if (score > bestScore) {
                            const prevBest = iterationBestMove;
                            const prevScore = bestScore;
                            bestScore = score;
                            iterationBestMove = move;

                            if (prevScore > -Infinity) {
                                this.debugLog(`  ★ NEW BEST: ${this.formatMove(move)} score=${score.toFixed(0)} (prev: ${this.formatMove(prevBest)} score=${prevScore.toFixed(0)})`);
                            }
                        }

                        if (Date.now() > this.deadline) throw 'timeout';
                    }

                    bestGlobalMove = iterationBestMove;
                    bestGlobalScore = bestScore;
                    finalDepth = currentDepth;

                    if (bestScore > 900000) {
                        this.debugLog(`  WIN FOUND at depth ${currentDepth}!`);
                        break;
                    }

                } catch (e) {
                    if (e === 'timeout') {
                        this.debugLog(`  TIMEOUT at depth ${currentDepth}`);
                        break;
                    }
                    throw e;
                }
            }

            const totalTime = Date.now() - thinkStartTime;
            this.debugLog('=== DECISION ===');
            this.debugLog(`Chosen: ${this.formatMove(bestGlobalMove)}`);
            this.debugLog(`Score: ${bestGlobalScore.toFixed(0)}`);
            this.debugLog(`Depth: ${finalDepth}, Nodes: ${this.nodesVisited}, Time: ${totalTime}ms`);

            const epsilon = { easy: 0.4, medium: 0.12, hard: 0.03 }[difficulty] || 0;
            if (Math.random() < epsilon && moves.length > 1) {
                const subset = moves.slice(0, Math.min(3, moves.length));
                const pick = subset[Math.floor(Math.random() * subset.length)];
                this.debugLog(`Epsilon-greedy: picked ${this.formatMove(pick)} instead of ${this.formatMove(bestGlobalMove)}`);
                return pick;
            }

            return bestGlobalMove;
        }
    };
}));
