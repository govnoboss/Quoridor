(function(exports) {

    // Константы, чтобы они были одинаковые везде
    exports.CONFIG = { gridCount: 9 };
    exports.DIRECTIONS = [{dr:-1,dc:0},{dr:1,dc:0},{dr:0,dc:-1},{dr:0,dc:1}];

    // --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

    exports.hasPawnAt = function(state, r, c) {
        return state.players.some(p => p.pos.r === r && p.pos.c === c);
    };

    exports.isWallBetween = function(state, fr, fc, tr, tc) {
        const dr = tr - fr, dc = tc - fc;
        if (Math.abs(dr) + Math.abs(dc) !== 1) return true;

        if (dc === 1) { // Вправо
            let b = false;
            if (fr > 0) b = b || state.vWalls[fr-1][fc];
            if (fr < 8) b = b || state.vWalls[fr][fc];
            return b;
        }
        if (dc === -1 && fc > 0) { // Влево
            let b = false;
            if (fr > 0) b = b || state.vWalls[fr-1][fc-1];
            if (fr < 8) b = b || state.vWalls[fr][fc-1];
            return b;
        }
        if (dr === 1) { // Вниз
            let b = false;
            if (fc > 0) b = b || state.hWalls[fr][fc-1];
            b = b || state.hWalls[fr][fc];
            return b;
        }
        if (dr === -1 && fr > 0) { // Вверх
            let b = false;
            if (fc > 0) b = b || state.hWalls[fr-1][fc-1];
            b = b || state.hWalls[fr-1][fc];
            return b;
        }
        return false;
    };

    // --- ЛОГИКА ДВИЖЕНИЯ ПЕШКИ ---

    exports.getJumpTargets = function(state, fr, fc) {
        const targets = [];
        for (const {dr, dc} of exports.DIRECTIONS) {
            const nr = fr + dr, nc = fc + dc;
            if (nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;

            if (!exports.hasPawnAt(state, nr, nc) && !exports.isWallBetween(state, fr, fc, nr, nc)) {
                targets.push({r: nr, c: nc});
            } else if (exports.hasPawnAt(state, nr, nc)) {
                const midR = nr, midC = nc;
                const jumpR = nr + dr, jumpC = nc + dc;

                if (jumpR >= 0 && jumpR < 9 && jumpC >= 0 && jumpC < 9 &&
                    !exports.hasPawnAt(state, jumpR, jumpC) &&
                    !exports.isWallBetween(state, fr, fc, midR, midC) &&
                    !exports.isWallBetween(state, midR, midC, jumpR, jumpC)) {
                    targets.push({r: jumpR, c: jumpC});
                } else {
                    if (dr !== 0) {
                        for (const dcDiag of [-1, 1]) {
                            const diagR = midR, diagC = midC + dcDiag;
                            if (diagC >= 0 && diagC < 9 &&
                                !exports.hasPawnAt(state, diagR, diagC) &&
                                !exports.isWallBetween(state, midR, midC, diagR, diagC)) {
                                targets.push({r: diagR, c: diagC});
                            }
                        }
                    }
                    if (dc !== 0) {
                        for (const drDiag of [-1, 1]) {
                            const diagR = midR + drDiag, diagC = midC;
                            if (diagR >= 0 && diagR < 9 &&
                                !exports.hasPawnAt(state, diagR, diagC) &&
                                !exports.isWallBetween(state, midR, midC, diagR, diagC)) {
                                targets.push({r: diagR, c: diagC});
                            }
                        }
                    }
                }
            }
        }
        return targets;
    };

    exports.canMovePawn = function(state, fr, fc, tr, tc) {
        const moves = exports.getJumpTargets(state, fr, fc);
        return moves.some(m => m.r === tr && m.c === tc);
    };

    // --- ЛОГИКА СТЕН ---

    exports.checkWallPlacement = function(state, r, c, vertical) {
        // Проверка границ и занятости
        if (r < 0 || r > 7 || c < 0 || c > 7) return false;
        if (vertical) {
            if (state.vWalls[r][c]) return false;
            if (r > 0 && state.vWalls[r-1][c]) return false;
            if (r < 7 && state.vWalls[r+1][c]) return false;
            if (state.hWalls[r][c]) return false;
        } else {
            if (state.hWalls[r][c]) return false;
            if (c > 0 && state.hWalls[r][c-1]) return false;
            if (c < 7 && state.hWalls[r][c+1]) return false;
            if (state.vWalls[r][c]) return false;
        }
        return true;
    };

    // Проверка пути (BFS)
    exports.hasPathToGoal = function(state, playerIdx) {
        const targetRow = playerIdx === 0 ? 0 : 8;
        const start = state.players[playerIdx].pos;
        const visited = Array(9).fill().map(() => Array(9).fill(false));
        const queue = [{r: start.r, c: start.c}];
        visited[start.r][start.c] = true;

        while (queue.length) {
            const {r, c} = queue.shift();
            if (r === targetRow) return true;
            
            for (const {dr, dc} of exports.DIRECTIONS) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 && !visited[nr][nc] && 
                    !exports.isWallBetween(state, r, c, nr, nc)) {
                    visited[nr][nc] = true;
                    queue.push({r: nr, c: nc});
                }
            }
        }
        return false;
    };

    exports.isValidWallPlacement = function(state) {
        return exports.hasPathToGoal(state, 0) && exports.hasPathToGoal(state, 1);
    };

}(typeof exports === 'undefined' ? this.Shared = {} : exports));