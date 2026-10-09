// Quoridor rules — CANONICAL source of truth for move generation, walls and path queries.
//
// This file is the single implementation of the game rules for the whole project:
//   * the website (src/core/shared.js re-exports it, server.js serves it to the browser as /shared.js)
//   * the engines (quoridor-engine/engines/*)
//   * the arena referee (quoridor-engine/arena/adapters/quoridor.js)
//
// It is UMD on purpose: the same bytes run under Node (require) and inside a Web Worker (importScripts).
// It must stay dependency-free and free of any Mongo / Redis / Socket.IO knowledge.
//
// Rule semantics must NOT change here without a perft + parity test update (see tools/perft.js,
// test/rules.test.js). Only performance-neutral rewrites are allowed.
(function (exports) {

    // Константы, чтобы они были одинаковые везде
    exports.CONFIG = { gridCount: 9 };

    // Целевой ряд для каждого игрока. Игрок 0 (белые) стартует на 8 и идёт в 0, игрок 1 — наоборот.
    // Держим это здесь, чтобы никто не перепутал стартовый ряд с целевым (см. GOAL_ROW в адаптере арены).
    exports.GOAL_ROW = [0, 8];
    exports.START_ROW = [8, 0];
    exports.START_COL = 4;
    exports.INITIAL_WALLS = 10;

    exports.DIRECTIONS = [{ dr: -1, dc: 0 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: 0, dc: 1 }];

    // --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

    exports.hasPawnAt = function (state, r, c) {
        // Развёрнуто вручную вместо players.some(p => ...): closure создавался на каждый вызов,
        // а hasPawnAt дёргается ~10 раз за один getJumpTargets. Семантика идентична.
        const a = state.players[0].pos;
        if (a.r === r && a.c === c) return true;
        const b = state.players[1].pos;
        return b.r === r && b.c === c;
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
        if (state.hasBot !== undefined) cloned.hasBot = state.hasBot;
        if (state.botPlayerIdx !== undefined) cloned.botPlayerIdx = state.botPlayerIdx;
        if (state.botDifficulty !== undefined) cloned.botDifficulty = state.botDifficulty;
        if (state.botIdentity !== undefined) cloned.botIdentity = state.botIdentity;
        if (state.botStyle !== undefined) cloned.botStyle = state.botStyle;

        return cloned;
    };

    /**
     * Основной редусер логики игры.
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
            // Разделяющие стены лежат в строке fr - 1 (между (fr,c) и (fr-1,c)).
            // Раньше здесь стояло hWalls[fr][fc - 1]: при fr === 8 это выход за границу hWalls
            // (длина 8) -> TypeError, из-за чего падал ЛЮБОЙ BFS, а с ним весь think().
            let b = false;
            if (fc > 0) b = b || state.hWalls[fr - 1][fc - 1];
            b = b || state.hWalls[fr - 1][fc];
            return b;
        }
        return false;
    };

    // --- ЛОГИКА ДВИЖЕНИЯ ПЕШКИ ---

    // Плоский список направлений для горячего цикла: обход индексированным циклом без деструктуризации
    // и без итератора. Порядок совпадает с exports.DIRECTIONS и определяет порядок целей.
    const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    // Переиспользуемые буферы BFS на уровне модуля: hasPathToGoal вызывается до 256 раз на позицию,
    // и аллокация 10 массивов + объектов на каждый вызов доминировала в профиле.
    // Безопасность: hasPathToGoal не вызывает себя рекурсивно и не отдаёт буферы наружу, а
    // isValidWallPlacement вызывает его для игроков 0 и 1 последовательно, не вложенно.
    const BFS_VISITED = new Uint8Array(81);
    const BFS_QUEUE = new Int32Array(81);

    exports.getJumpTargets = function (state, fr, fc) {
        const targets = [];
        // Локальные ссылки: разыменование exports.* в горячем цикле заметно дороже прямого вызова,
        // особенно когда файл грузится в vm-контексте (jest, тесты арены).
        const isWallBetween = exports.isWallBetween;
        const hasPawnAt = exports.hasPawnAt;

        for (let d = 0; d < 4; d++) {
            const dir = DIRS[d];
            const dr = dir[0], dc = dir[1];
            const nr = fr + dr, nc = fc + dc;
            if (nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;

            if (!hasPawnAt(state, nr, nc) && !isWallBetween(state, fr, fc, nr, nc)) {
                targets.push({ r: nr, c: nc });
            } else if (hasPawnAt(state, nr, nc)) {
                const midR = nr, midC = nc;
                const jumpR = nr + dr, jumpC = nc + dc;

                if (jumpR >= 0 && jumpR < 9 && jumpC >= 0 && jumpC < 9 &&
                    !hasPawnAt(state, jumpR, jumpC) &&
                    !isWallBetween(state, fr, fc, midR, midC) &&
                    !isWallBetween(state, midR, midC, jumpR, jumpC)) {
                    targets.push({ r: jumpR, c: jumpC });
                } else {
                    if (dr !== 0) {
                        for (let i = 0; i < 2; i++) {
                            const diagR = midR, diagC = midC + (i === 0 ? -1 : 1);
                            if (diagC >= 0 && diagC < 9 &&
                                !hasPawnAt(state, diagR, diagC) &&
                                !isWallBetween(state, fr, fc, midR, midC) &&
                                !isWallBetween(state, midR, midC, diagR, diagC)) {
                                targets.push({ r: diagR, c: diagC });
                            }
                        }
                    }
                    if (dc !== 0) {
                        for (let i = 0; i < 2; i++) {
                            const diagR = midR + (i === 0 ? -1 : 1), diagC = midC;
                            if (diagR >= 0 && diagR < 9 &&
                                !hasPawnAt(state, diagR, diagC) &&
                                !isWallBetween(state, fr, fc, midR, midC) &&
                                !isWallBetween(state, midR, midC, diagR, diagC)) {
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
        const isWallBetween = exports.isWallBetween;

        // Плоские структуры вместо Array(9).fill().map(...) + объект на каждый узел.
        // Здесь это главный горячий путь всего проекта: isValidWallPlacement зовёт hasPathToGoal дважды,
        // а генерация ходов проверяет до 128 слотов стен, то есть до 256 BFS на позицию.
        // Раньше на каждый вызов приходилось 10 массивов visited/queue и до 81 объекта {r,c}.
        const visited = BFS_VISITED; // переиспользуемый буфер, обнуляется только использованная часть
        const queue = BFS_QUEUE;

        const startIdx = start.r * 9 + start.c;
        visited.fill(0);
        queue[0] = startIdx;
        let head = 0;
        let tail = 1;
        visited[startIdx] = 1;

        while (head < tail) {
            const cur = queue[head++];
            const r = (cur / 9) | 0;
            if (r === targetRow) return true;
            const c = cur - r * 9;

            for (let d = 0; d < 4; d++) {
                const dir = DIRS[d];
                const nr = r + dir[0], nc = c + dir[1];
                if (nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;
                const nIdx = nr * 9 + nc;
                if (visited[nIdx]) continue;
                if (isWallBetween(state, r, c, nr, nc)) continue;
                visited[nIdx] = 1;
                queue[tail++] = nIdx;
            }
        }
        return false;
    };

    exports.isValidWallPlacement = function (state) {
        return exports.hasPathToGoal(state, 0) && exports.hasPathToGoal(state, 1);
    };

    // --- VALIDATION HELPERS (for server and client) ---

    exports.isValidLobbyId = function (lobbyId) {
        return typeof lobbyId === 'string' && /^[A-Z0-9]{5}$/.test(lobbyId);
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

    exports.isGameOver = function (state) {
        const grid = exports.CONFIG.gridCount;
        for (let i = 0; i < 2; i++) {
            const pos = state.players[i].pos;
            if ((i === 0 && pos.r === 0) || (i === 1 && pos.r === grid - 1)) {
                return { over: true, winner: i, reason: 'goal' };
            }
        }
        return { over: false, winner: -1, reason: null };
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
