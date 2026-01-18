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
            if (dBot < dHuman) score += 50;

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
            const MAX_WALL_MOVES = 8; // Limit wall moves to reduce BFS calls

            for (const posStr of candidates) {
                if (moves.length >= MAX_WALL_MOVES) break; // Early exit when enough found

                const [rStr, cStr] = posStr.split(',');
                const r = parseInt(rStr), c = parseInt(cStr);
                if (r < 0 || r >= 8 || c < 0 || c >= 8) continue;

                const checkAndAddWall = (r, c, isVertical) => {
                    if (moves.length >= MAX_WALL_MOVES) return; // Early exit

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
                                priority += distGain * 80;

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

            // Pawn Moves - use Shared.getJumpTargets for full correctness
            // This handles simple moves, straight jumps, AND diagonal jumps
            const pawnTargets = this.Shared.getJumpTargets(state, r, c);

            // Urgency bonus: if bot is close to winning, strongly prefer pawn moves
            const dBot = this.shortestPathDistance(state, forPlayer);
            const urgencyBonus = dBot <= 3 ? (4 - dBot) * 100 : 0; // dist 1 → +300, dist 2 → +200, dist 3 → +100

            for (const target of pawnTargets) {
                // Higher priority for straight-line jumps (moving towards goal)
                const isJump = Math.abs(target.r - r) === 2 || Math.abs(target.c - c) === 2 ||
                    (Math.abs(target.r - r) === 1 && Math.abs(target.c - c) === 1);
                const basePriority = isJump ? 150 : 100;

                // Direction-aware priority: forward moves first, backward moves last
                const goalRow = forPlayer === 0 ? 0 : 8;
                const currentDist = Math.abs(r - goalRow);
                const newDist = Math.abs(target.r - goalRow);
                const directionBonus = currentDist > newDist ? 50 : (currentDist < newDist ? -30 : 0);

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

            // XOR in next turn
            // Note: currentPlayer updates in shared reducer not here, but search uses local apply.
            // Wait, applyMove here does NOT update currentPlayer?
            // Shared.gameReducer does. But AI uses applyMove for internal simulation.
            // AI loop: applyMove -> recurse(..., maximizing=!maximizing) -> undoMove.
            // ai-core.js applyMove does NOT flip currentPlayer.
            // So we just XOR the turn value we just removed? No.
            // If minimax recursion conceptually changes "simulation perspective", the state hash should reflect "Turn changed".
            // But state.currentPlayer is NOT changed in this.applyMove (line 276 original).
            // So state.hash should reflect current player?
            // The computeStateKey uses state.currentPlayer.
            // Since this.applyMove doesn't change state.currentPlayer, we should NOT change the hash part related to currentPlayer?
            // BUT Minimax alternates.
            // Actually, Zobrist hash includes "Side to move".
            // If we don't change state.currentPlayer, we shouldn't change that part of hash.
            // BUT, `minimax` logic implies turn change.
            // Let's look at `minimax`. It calculates `stateKey` at start.
            // Then it calls `applyMove`...
            // It passes `!maximizing` to recursive call.
            // The state object itself remains "Player X made move M".
            // If we don't update currentPlayer in state, the hash should match the state.
            // So we should NOT XOR turn if we don't change state.currentPlayer.
            // Correct.
            // Revert Turn XOR lines?
            // "XOR out current turn" -> If I flip it back at end?
            // No, wait.
            // If I change hash component "Turn", then `computeStateKey` will return a hash for "Next Player Turn",
            // but `state.currentPlayer` still says "This Player".
            // Conflict.
            // `computeStateKey` relies on `state.hash`.
            // If `state` is logically "After Move", it really should be "Next Player's turn".
            // BUT `ai-core.js` `applyMove` is minimal. It doesn't switch turns.
            // So I should removed Turn XORing from applyMove/undoMove unless I also switch `state.currentPlayer`.
            // For now, I will REMOVE Turn XORing from applyMove/undoMove because applyMove does not change turn.
            // The turn is handled by the search logic `maximizing` param.
            // WAIT. Transposition Table `key` MUST include side-to-move.
            // If I arrive at same board position with same walls, but different side to move... (impossible in Quoridor? No, odd/even steps).
            // Actually, number of moves is implicit in wall count/position? No.
            // Zobrist usually includes side to move.
            // Since `applyMove` doesn't change `currentPlayer`, the hash component for `currentPlayer` remains static?
            // That's wrong.
            // If needed, I should update `currentPlayer` in `applyMove`.
            // But `minimax` uses strict `maximizing` flag.
            // Let's stick to: Hash represents EXACTLY what's in `state`.
            // If `state` has `currentPlayer=0`, hash has `turn[0]`.
            // `applyMove` keeps `currentPlayer=0`. Hash keeps `turn[0]`.
            // Minimax calls `key = computeStateKey`. It uses `turn[0]`.
            // But wait, Zobrist for TT needs to distinguish positions effectively.
            // If we do not change turn, is it okay?
            // Yes, because inside `minimax`, we pass `depth` and `botIdx`.
            // But TT lookup happens BEFORE we know if it's safe?
            // `TT.get(stateKey)`.
            // If I effectively simulated a move, I really *should* be in next player's turn context.
            // But I'm not updating `state.currentPlayer`.
            // I'll stick to updating ONLY what changes in `state`.
            // Walls, Pawns, WallsLeft.
            // Turn is static in `ai-core` simulation step (it simulates "what if I did this", but it doesn't run full game turn logic).
            // OK, I'll remove Turn XOR from apply/undo.

            // Wait, I saw "XOR out current turn" in my draft code above.
            // I will REMOVE it in the actual tool call to stay consistent with `state.currentPlayer` not changing.

            // XOR in/out Pawns & Walls logic remains.

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

            // Loop Detection: track last 4 positions
            const avoidPositions = new Set();
            if (state.history) {
                const myMoves = state.history
                    .filter(h => h.playerIdx === botIdx && h.move.type === 'pawn')
                    .slice(-4);
                for (const m of myMoves) {
                    avoidPositions.add(`${m.move.r},${m.move.c}`);
                }
                if (myMoves.length === 0) {
                    avoidPositions.add(botIdx === 0 ? '8,4' : '0,4');
                }
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

                        // Penalize loop moves
                        if (move.type === 'pawn' && avoidPositions.has(`${move.r},${move.c}`)) {
                            score -= 500;
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

            return bestGlobalMove;
        }
    };
}));
