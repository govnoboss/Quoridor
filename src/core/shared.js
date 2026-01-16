(function (exports) {

    // Константы, чтобы они были одинаковые везде
    exports.CONFIG = { gridCount: 9 };
    exports.DIRECTIONS = [{ dr: -1, dc: 0 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: 0, dc: 1 }];

    // --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

    exports.hasPawnAt = function (state, r, c) {
        return state.players.some(p => p.pos.r === r && p.pos.c === c);
    };

    exports.getPlayerAt = function (state, r, c) {
        if (state.players[0].pos.r === r && state.players[0].pos.c === c) return 0;
        if (state.players[1].pos.r === r && state.players[1].pos.c === c) return 1;
        return -1;
    };

    /**
     * Создает глубокую копию состояния игры.
     * Оптимизировано для Quoridor state structure.
     */
    exports.cloneState = function (state) {
        const cloned = {
            hWalls: state.hWalls.map(row => [...row]),
            vWalls: state.vWalls.map(row => [...row]),
            players: state.players.map(p => ({
                color: p.color,
                pos: { r: p.pos.r, c: p.pos.c },
                wallsLeft: p.wallsLeft
            })),
            currentPlayer: state.currentPlayer
        };

        if (state.playerSockets) cloned.playerSockets = [...state.playerSockets];
        if (state.playerTokens) cloned.playerTokens = [...state.playerTokens];
        if (state.playerProfiles) cloned.playerProfiles = state.playerProfiles.map(p => p ? { ...p } : null);
        if (state.timers) cloned.timers = [...state.timers];
        if (state.increment !== undefined) cloned.increment = state.increment;
        if (state.lastMoveTimestamp !== undefined) cloned.lastMoveTimestamp = state.lastMoveTimestamp;
        if (state.history) cloned.history = [...state.history];
        if (state.disconnectTimer !== undefined) cloned.disconnectTimer = state.disconnectTimer;
        if (state.isRanked !== undefined) cloned.isRanked = state.isRanked;

        return cloned;
    };

    /**
     * Основной редьюсер логики игры.
     * Принимает текущее состояние и действие, возвращает НОВОЕ состояние или бросает ошибку.
     * @param {object} state 
     * @param {object} action { type, r, c, isVertical, playerIdx }
     */
    exports.gameReducer = function (state, action) {
        const newState = exports.cloneState(state);
        const { type, r, c, isVertical, playerIdx } = action;

        // Валидация очередности хода
        if (playerIdx !== newState.currentPlayer) {
            throw new Error('Not your turn');
        }

        if (type === 'pawn') {
            const currentPos = newState.players[playerIdx].pos;
            if (!exports.canMovePawn(newState, currentPos.r, currentPos.c, r, c)) {
                throw new Error('Invalid pawn move');
            }
            newState.players[playerIdx].pos = { r, c };
        }
        else if (type === 'wall') {
            if (newState.players[playerIdx].wallsLeft <= 0) {
                throw new Error('No walls left');
            }
            if (!exports.checkWallPlacement(newState, r, c, isVertical)) {
                throw new Error('Invalid wall placement coordinate');
            }

            // Временно ставим стену
            if (isVertical) newState.vWalls[r][c] = true;
            else newState.hWalls[r][c] = true;

            if (!exports.isValidWallPlacement(newState)) {
                // Откат (хотя мы работаем с клоном, для ясности)
                if (isVertical) newState.vWalls[r][c] = false;
                else newState.hWalls[r][c] = false;
                throw new Error('Wall blocks the only path to goal');
            }
            newState.players[playerIdx].wallsLeft--;
        }

        // Запись в историю
        newState.history.push({
            playerIdx,
            move: action,
            timestamp: Date.now()
        });

        // Смена игрока
        newState.currentPlayer = 1 - newState.currentPlayer;

        return newState;
    };


    exports.isWallBetween = function (state, fr, fc, tr, tc) {
        const dr = tr - fr, dc = tc - fc;
        if (Math.abs(dr) + Math.abs(dc) !== 1) return true;

        if (dc === 1) { // Вправо
            let b = false;
            if (fr > 0) b = b || state.vWalls[fr - 1][fc];
            if (fr < 8) b = b || state.vWalls[fr][fc];
            return b;
        }
        if (dc === -1 && fc > 0) { // Влево
            let b = false;
            if (fr > 0) b = b || state.vWalls[fr - 1][fc - 1];
            if (fr < 8) b = b || state.vWalls[fr][fc - 1];
            return b;
        }
        if (dr === 1) { // Вниз
            let b = false;
            if (fc > 0) b = b || state.hWalls[fr][fc - 1];
            b = b || state.hWalls[fr][fc];
            return b;
        }
        if (dr === -1 && fr > 0) { // Вверх
            let b = false;
            if (fc > 0) b = b || state.hWalls[fr - 1][fc - 1];
            b = b || state.hWalls[fr - 1][fc];
            return b;
        }
        return false;
    };

    // --- ЛОГИКА ДВИЖЕНИЯ ПЕШКИ ---

    exports.getJumpTargets = function (state, fr, fc) {
        const targets = [];
        for (const { dr, dc } of exports.DIRECTIONS) {
            const nr = fr + dr, nc = fc + dc;
            if (nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;

            if (!exports.hasPawnAt(state, nr, nc) && !exports.isWallBetween(state, fr, fc, nr, nc)) {
                targets.push({ r: nr, c: nc });
            } else if (exports.hasPawnAt(state, nr, nc)) {
                const midR = nr, midC = nc;
                const jumpR = nr + dr, jumpC = nc + dc;

                if (jumpR >= 0 && jumpR < 9 && jumpC >= 0 && jumpC < 9 &&
                    !exports.hasPawnAt(state, jumpR, jumpC) &&
                    !exports.isWallBetween(state, fr, fc, midR, midC) &&
                    !exports.isWallBetween(state, midR, midC, jumpR, jumpC)) {
                    targets.push({ r: jumpR, c: jumpC });
                } else {
                    if (dr !== 0) {
                        for (const dcDiag of [-1, 1]) {
                            const diagR = midR, diagC = midC + dcDiag;
                            if (diagC >= 0 && diagC < 9 &&
                                !exports.hasPawnAt(state, diagR, diagC) &&
                                !exports.isWallBetween(state, midR, midC, diagR, diagC)) {
                                targets.push({ r: diagR, c: diagC });
                            }
                        }
                    }
                    if (dc !== 0) {
                        for (const drDiag of [-1, 1]) {
                            const diagR = midR + drDiag, diagC = midC;
                            if (diagR >= 0 && diagR < 9 &&
                                !exports.hasPawnAt(state, diagR, diagC) &&
                                !exports.isWallBetween(state, midR, midC, diagR, diagC)) {
                                targets.push({ r: diagR, c: diagC });
                            }
                        }
                    }
                }
            }
        }
        return targets;
    };

    exports.canMovePawn = function (state, fr, fc, tr, tc) {
        const moves = exports.getJumpTargets(state, fr, fc);
        return moves.some(m => m.r === tr && m.c === tc);
    };

    // --- ЛОГИКА СТЕН ---

    exports.checkWallPlacement = function (state, r, c, vertical) {
        // Проверка границ и занятости
        if (r < 0 || r > 7 || c < 0 || c > 7) return false;
        if (vertical) {
            if (state.vWalls[r][c]) return false;
            if (r > 0 && state.vWalls[r - 1][c]) return false;
            if (r < 7 && state.vWalls[r + 1][c]) return false;
            if (state.hWalls[r][c]) return false;
        } else {
            if (state.hWalls[r][c]) return false;
            if (c > 0 && state.hWalls[r][c - 1]) return false;
            if (c < 7 && state.hWalls[r][c + 1]) return false;
            if (state.vWalls[r][c]) return false;
        }
        return true;
    };

    // Проверка пути (BFS)
    exports.hasPathToGoal = function (state, playerIdx) {
        const targetRow = playerIdx === 0 ? 0 : 8;
        const start = state.players[playerIdx].pos;
        const visited = Array(9).fill().map(() => Array(9).fill(false));
        const queue = [{ r: start.r, c: start.c }];
        visited[start.r][start.c] = true;

        while (queue.length) {
            const { r, c } = queue.shift();
            if (r === targetRow) return true;

            for (const { dr, dc } of exports.DIRECTIONS) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 && !visited[nr][nc] &&
                    !exports.isWallBetween(state, r, c, nr, nc)) {
                    visited[nr][nc] = true;
                    queue.push({ r: nr, c: nc });
                }
            }
        }
        return false;
    };

    exports.isValidWallPlacement = function (state) {
        return exports.hasPathToGoal(state, 0) && exports.hasPathToGoal(state, 1);
    };

    // --- VALIDATION HELPERS (for server and client) ---

    exports.isValidLobbyId = function (lobbyId) {
        return typeof lobbyId === 'string' && /^lobby-\d+$/.test(lobbyId);
    };

    exports.isValidPawnMove = function (move) {
        return move &&
            move.type === 'pawn' &&
            Number.isInteger(move.r) &&
            Number.isInteger(move.c) &&
            move.r >= 0 && move.r <= 8 &&
            move.c >= 0 && move.c <= 8;
    };

    exports.isValidWallMove = function (move) {
        return move &&
            move.type === 'wall' &&
            Number.isInteger(move.r) &&
            Number.isInteger(move.c) &&
            move.r >= 0 && move.r <= 7 &&
            move.c >= 0 && move.c <= 7 &&
            typeof move.isVertical === 'boolean';
    };

    exports.isValidMove = function (move) {
        if (!move || typeof move !== 'object') return false;
        if (move.type === 'pawn') return exports.isValidPawnMove(move);
        if (move.type === 'wall') return exports.isValidWallMove(move);
        return false;
    };

    exports.createInitialState = function (timeControl, isRanked = false) {
        const base = timeControl?.base || 600;
        const inc = timeControl?.inc || 0;
        return {
            hWalls: Array.from({ length: 8 }, () => Array(8).fill(false)),
            vWalls: Array.from({ length: 8 }, () => Array(8).fill(false)),
            players: [
                { color: 'white', pos: { r: 8, c: 4 }, wallsLeft: 10 },
                { color: 'black', pos: { r: 0, c: 4 }, wallsLeft: 10 }
            ],
            currentPlayer: 0,
            playerSockets: [null, null],
            playerTokens: [null, null],
            playerProfiles: [null, null],
            disconnectTimer: null,
            timers: [base, base],
            increment: inc,
            lastMoveTimestamp: Date.now(),
            history: [],
            isRanked: isRanked
        };
    };

}(typeof exports === 'undefined' ? this.Shared = {} : exports));