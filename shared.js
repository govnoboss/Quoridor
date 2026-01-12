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
     * Создает глубокую копию состояния игры для истории (snapshots).
     * @param {object} state - Состояние для клонирования.
     * @returns {object} Глубокая копия состояния.
     */
    exports.cloneState = function (state) {
        // Простой и надежный способ глубокого клонирования для POJO
        return JSON.parse(JSON.stringify(state));
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

}(typeof exports === 'undefined' ? this.Shared = {} : exports));