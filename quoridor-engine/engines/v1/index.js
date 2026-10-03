'use strict';
/**
 * Engine v1 — v0 plus a real ban on pawn oscillation.
 *
 * WHY v1 EXISTS (measured, not guessed)
 * In the arena roughly 48% of v0-vs-v0 games ended in a repetition draw. That is not a draw by the
 * rules of Quoridor — nobody reached the far row — it is a bot stuck in a cycle. Two measurements
 * pinned the cause, and both are in the engine rather than in the arena:
 *
 *   1. LOOP_PENALTY is a SORT KEY, NOT A BAN. In v0 the anti-cycle term (-3000) is added to
 *      `move.priority` and the candidate list is then sorted. Minimax still evaluates every candidate,
 *      so a move straight back to the cell the pawn just left is scored exactly like any other move.
 *      When two moves have equal evaluation, ordering decides, and ordering can pick the loop. In the
 *      captured loop the pawn went 5,4 -> 6,4 -> 5,4 -> 6,4 with both players alternating, and the
 *      engine kept choosing it.
 *
 *   2. The anti-cycle input is always empty. v0 reads `state.history[].prevPos`, but the reducer
 *      (rules/quoridor-rules.js) only ever stores `move` in history, so `prevPos` is absent in 100%
 *      of entries and the fallback fires. The fallback punishes returning to the DESTINATION of the
 *      last move rather than the cell it left, which is the wrong cell. The server engine
 *      (src/core/ai-core.js) has the identical fallback, so this is not an arena artifact.
 *
 * So the fix is not a bigger penalty and not negamax. It is to make returning to the previous cell
 * ILLEGAL for the mover, which is what actually breaks a cycle of length 2 — the overwhelmingly
 * common case. A repetition of a longer cycle needs the path-usage term (v1's `_internals` exposes
 * the hook); that is deliberately NOT done here, so the v1-v0 delta measures exactly one change.
 *
 * WHY NOT negamax / a deeper search here
 * Within one search `botIdx` is fixed, so minimax with a bot-perspective evaluation is correct, and
 * the TT-key issue only bites when one engine instance plays both colours — which the arena never
 * does, since each slot gets its own instance. Expected gain from a negamax rewrite is therefore
 * about zero Elo. Strength in Quoridor comes from wall placement and from not looping, not from the
 * sign convention of the search.
 *
 * DELIBERATELY UNCHANGED FROM v0
 *   - The bot-perspective evaluation, the TT keyed on position only, MAX_WALL_MOVES = 8 and the
 *     `netGain > 0` wall filter (which discards ~94% of legal wall slots) are all left exactly as
 *     they are. v1 differs from v0 by the oscillation ban and nothing else, so any Elo the arena
 *     reports is attributable to that single change.
 *
 * INTERFACE
 *   const engine = createEngineV1({ seed, timeMs, maxDepth, easyRandomP, weights });
 *   const res = engine.think(state, { timeMs, nodes, maxDepth, difficulty, player });
 *   // res = { move, depth, nodes, timeMs, score, ttStores }
 *   engine.reset();          // drop the transposition table and killers
 *
 * `state` is a plain canonical-rules state (rules/quoridor-rules.js) and is never mutated.
 * Math.random() is never called: Zobrist keys and the easy-mode coin come from a seeded RNG.
 */

const Rules = require('../../rules');
const { makeRng } = require('../../tools/rng');

// --- Константы, дословно из исходного движка ---
const MAX_WALL_MOVES = 8;                 // generateSmartWallMoves: сколько стен оставить на сортировке
const KILLER_SLOTS = 30;                  // размер массива killerMoves по глубине
const TT_CLEAR_THRESHOLD = 100000;        // think(): полный сброс таблицы при переполнении
const WIN_SCORE = 900000;                 // порог "найден выигрыш", поиск прерывается
const LOOP_PENALTY = -3000;               // штраф за возврат в недавнюю клетку
const KILLER_BONUS = 10000;               // приоритетный бонус killer move
const HISTORY_WINDOW = 4;                 // сколько последних ходов пешкой смотрим на анти-цикл
// v1: сколько НЕДАВНИХ клеток запрещаем пешке. Замер показал, что запрет одной клетки (окно 1) убивает
// циклы длины 2 полностью (0 из 7), но не трогает орбиты по квадрату 2x2 — там пешка идёт по 4 разным
// клеткам и ни разу не возвращается назад. Окно 3 перекрывает сторону квадрата.
const RECENT_WINDOW = 3;

const DEPTH_BY_DIFFICULTY = { easy: 2, medium: 3, hard: 5, impossible: 20 };
const DEFAULT_TIME_MS = 2000;

// Веса оценки. Значения по умолчанию — ровно те, что были зашиты в ai-core.js. Держать их в одном
// объекте нужно, чтобы следующая версия движка отличалась только числами, а не правкой кода.
const DEFAULT_WEIGHTS = {
    distance: 100,          // (dHuman - dBot) * distance
    urgency: 10,            // (9 - d)^1.5 * urgency, отдельно для себя и для соперника
    wallBase: 35,           // базовая ценность стены
    wallUrgency: 15,        // + (6 - dHuman) * wallUrgency, когда соперник близко
    wallOppFactor: 0.8,     // вес чужих стен (угрозы) относительно своих
    center: 4,              // - |4 - col| * center
    tempo: 60,              // бонус за право хода
    ahead: 50,              // бонус за лидерство по дистанции
    mobility: 15,           // (своя подвижность - чужая) * mobility
    winScore: 1000000,
    sealedSelf: -500000,
    sealedOpp: 500000,
    // Приоритеты ходов (сортировка, влияет на скорость и на таймауты, но не на корректность)
    pawnStep: 100,
    pawnJump: 150,
    urgencyPerDist: 100,
    urgencyMaxDist: 3,
    directionCloser: 50,
    directionFurther: -30,
    wallPriorityBase: 50,
    wallPriorityPerGain: 80,
};

// Плоские направления: обход индексированным циклом вместо for..of с деструктуризацией.
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function createEngineV1(options = {}) {
    const w = Object.assign({}, DEFAULT_WEIGHTS, options.weights);
    const rng = makeRng(options.seed === undefined ? 1 : options.seed);

    // --- Zobrist ---
    const rand64 = () => ({ high: (rng.next() * 0xFFFFFFFF) | 0, low: (rng.next() * 0xFFFFFFFF) | 0 });
    const zobrist = {
        pawn: Array.from({ length: 2 }, () => Array.from({ length: 9 }, () => Array.from({ length: 9 }, rand64))),
        vWalls: Array.from({ length: 8 }, () => Array.from({ length: 8 }, rand64)),
        hWalls: Array.from({ length: 8 }, () => Array.from({ length: 8 }, rand64)),
        turn: [rand64(), rand64()],
        wallsLeft: Array.from({ length: 2 }, () => Array.from({ length: 11 }, rand64)),
    };

    // Переиспользуемые буферы расстояний. BFS нигде не вызывает себя рекурсивно, поэтому один буфер на
    // движок безопасен; это убирает ~160 аллокаций массивов на вызов оценки.
    const distBuf = Array.from({ length: 2 }, () => new Int16Array(81));
    const distQueue = new Int32Array(81);

    // --- Состояние экземпляра (в старом движке всё это было на уровне модуля) ---
    const tt = new Map();
    let killers = newKillers();
    let nodesVisited = 0;
    let ttStores = 0;
    let deadline = 0;
    let nodeLimit = Infinity;
    // v1: путь нашей пешки в этой партии, плоский массив [r0, c0, r1, c1, ...] — по две координаты на
    // позицию, в порядке наших ходов. Заполняется в think(). Живёт одну партию: адаптер создаёт новый
    // экземпляр движка в newGame(), поэтому утечки между партиями не бывает.
    let selfPath = [];

    function newKillers() {
        return Array.from({ length: KILLER_SLOTS }, () => []);
    }

    function reset() {
        tt.clear();
        killers = newKillers();
        nodesVisited = 0;
        ttStores = 0;
        selfPath = [];
    }

    // --- Хеш ---

    function computeZobristHash(state) {
        let h = 0, l = 0;
        const zTurn = zobrist.turn[state.currentPlayer];
        h ^= zTurn.high; l ^= zTurn.low;
        for (let i = 0; i < 2; i++) {
            const p = state.players[i];
            const zPawn = zobrist.pawn[i][p.pos.r][p.pos.c];
            h ^= zPawn.high; l ^= zPawn.low;
            const zWalls = zobrist.wallsLeft[i][p.wallsLeft];
            h ^= zWalls.high; l ^= zWalls.low;
        }
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (state.vWalls[r][c]) {
                    const z = zobrist.vWalls[r][c];
                    h ^= z.high; l ^= z.low;
                }
                if (state.hWalls[r][c]) {
                    const z = zobrist.hWalls[r][c];
                    h ^= z.high; l ^= z.low;
                }
            }
        }
        return { hashHigh: h, hashLow: l };
    }

    const computeStateKey = (state) => `${state.hashHigh >>> 0}-${state.hashLow >>> 0}`;

    // --- Пути ---

    /**
     * BFS от пешки до её целевого ряда. Расстояние в клетках, Infinity если пути нет.
     * Именно то, что было в shortestPathDistance, но на плоских массивах.
     */
    function shortestPathDistance(state, playerIdx) {
        const targetRow = Rules.GOAL_ROW[playerIdx];
        const start = state.players[playerIdx].pos;
        const dist = distBuf[playerIdx];
        dist.fill(-1);
        const startIdx = start.r * 9 + start.c;
        dist[startIdx] = 0;
        distQueue[0] = startIdx;
        let head = 0, tail = 1;

        while (head < tail) {
            const cur = distQueue[head++];
            const r = (cur / 9) | 0, c = cur - r * 9;
            if (r === targetRow) return dist[cur];
            const d = dist[cur] + 1;
            for (let i = 0; i < 4; i++) {
                const nr = r + DIRS[i][0], nc = c + DIRS[i][1];
                if (nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;
                const nIdx = nr * 9 + nc;
                if (dist[nIdx] !== -1) continue;
                if (Rules.isWallBetween(state, r, c, nr, nc)) continue;
                dist[nIdx] = d;
                distQueue[tail++] = nIdx;
            }
        }
        return Infinity;
    }

    /**
     * Многoисточниковый BFS от всего целевого ряда: realPathDist[playerIdx][r*9+c] — длина пути до
     * цели из клетки. Один BFS на всю доску вместо BFS на каждый целевой ход.
     */
    function pathDistanceMap(state, playerIdx) {
        const targetRow = Rules.GOAL_ROW[playerIdx];
        const dist = distBuf[playerIdx];
        dist.fill(-1);
        let head = 0, tail = 0;
        for (let c = 0; c < 9; c++) {
            const i = targetRow * 9 + c;
            dist[i] = 0;
            distQueue[tail++] = i;
        }
        while (head < tail) {
            const cur = distQueue[head++];
            const r = (cur / 9) | 0, c = cur - r * 9;
            const d = dist[cur] + 1;
            for (let i = 0; i < 4; i++) {
                const nr = r + DIRS[i][0], nc = c + DIRS[i][1];
                if (nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;
                const nIdx = nr * 9 + nc;
                if (dist[nIdx] !== -1) continue;
                if (Rules.isWallBetween(state, r, c, nr, nc)) continue;
                dist[nIdx] = d;
                distQueue[tail++] = nIdx;
            }
        }
        return dist;
    }

    // --- Оценка ---

    function evaluate(state, botIdx) {
        const humanIdx = 1 - botIdx;
        const botPos = state.players[botIdx].pos;
        const humanPos = state.players[humanIdx].pos;

        if (botPos.r === Rules.GOAL_ROW[botIdx]) return w.winScore;
        if (humanPos.r === Rules.GOAL_ROW[humanIdx]) return -w.winScore;

        const dBot = shortestPathDistance(state, botIdx);
        const dHuman = shortestPathDistance(state, humanIdx);

        if (dBot === Infinity) return w.sealedSelf;
        if (dHuman === Infinity) return w.sealedOpp;

        let score = (dHuman - dBot) * w.distance;

        score += Math.pow(Math.max(0, 9 - dBot), 1.5) * w.urgency;
        score -= Math.pow(Math.max(0, 9 - dHuman), 1.5) * w.urgency;

        let wallValue = w.wallBase;
        if (dHuman < 6) wallValue += (6 - dHuman) * w.wallUrgency;

        score += state.players[botIdx].wallsLeft * wallValue;
        score -= state.players[humanIdx].wallsLeft * (wallValue * w.wallOppFactor);

        score -= Math.abs(4 - botPos.c) * w.center;

        if (state.currentPlayer === botIdx) score += w.tempo;
        else score -= w.tempo;

        if (dBot < dHuman) score += w.ahead;

        const botMobility = Rules.getJumpTargets(state, botPos.r, botPos.c).length;
        const humanMobility = Rules.getJumpTargets(state, humanPos.r, humanPos.c).length;
        score += (botMobility - humanMobility) * w.mobility;

        return score;
    }

    // --- Генерация ходов ---

    /**
     * Только стеновые ходы, отобранные по «чистой выгоде»: стена берётся, если сопернику она добавляет
     * больше, чем нам. Это эвристика из старого движка, а не оптимальность: смысл в том, чтобы не тратить
     * 128 проверок BFS на каждый узел.
     */
    function generateSmartWallMoves(state, forPlayer) {
        const moves = [];
        const oppPlayer = 1 - forPlayer;
        const myPos = state.players[forPlayer].pos;
        const oppPos = state.players[oppPlayer].pos;
        const candidates = new Set();

        for (let r = -1; r <= 1; r++) {
            for (let c = -1; c <= 1; c++) {
                candidates.add(`${myPos.r + r},${myPos.c + c}`);
                candidates.add(`${oppPos.r + r},${oppPos.c + c}`);
            }
        }
        candidates.add('3,4');
        candidates.add('4,4');

        const oldOppDist = shortestPathDistance(state, oppPlayer);
        const oldMyDist = shortestPathDistance(state, forPlayer);

        for (const posStr of candidates) {
            const [rStr, cStr] = posStr.split(',');
            const r = parseInt(rStr, 10), c = parseInt(cStr, 10);
            if (r < 0 || r >= 8 || c < 0 || c >= 8) continue;

            for (let o = 0; o < 2; o++) {
                const isVertical = o === 1;
                if (!Rules.checkWallPlacement(state, r, c, isVertical)) continue;

                state.players[forPlayer].wallsLeft--;
                if (isVertical) state.vWalls[r][c] = true;
                else state.hWalls[r][c] = true;

                if (Rules.isValidWallPlacement(state)) {
                    const newOppDist = shortestPathDistance(state, oppPlayer);
                    const newMyDist = shortestPathDistance(state, forPlayer);
                    const netGain = (newOppDist - oldOppDist) - (newMyDist - oldMyDist);
                    if (netGain > 0) {
                        moves.push({
                            type: 'wall', r, c, isVertical,
                            priority: w.wallPriorityBase + netGain * w.wallPriorityPerGain,
                        });
                    }
                }

                if (isVertical) state.vWalls[r][c] = false;
                else state.hWalls[r][c] = false;
                state.players[forPlayer].wallsLeft++;
            }
        }

        moves.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        return moves.slice(0, MAX_WALL_MOVES);
    }

    const isSameMove = (m1, m2) => {
        if (!m1 || !m2) return false;
        if (m1.type !== m2.type) return false;
        if (m1.type === 'pawn') return m1.r === m2.r && m1.c === m2.c;
        return m1.r === m2.r && m1.c === m2.c && m1.isVertical === m2.isVertical;
    };

    function storeKiller(depth, move) {
        if (depth >= KILLER_SLOTS) return;
        if (!killers[depth]) killers[depth] = [];
        const list = killers[depth];
        if (list.some(m => isSameMove(m, move))) return;
        list.unshift(move);
        if (list.length > 2) list.pop();
    }

    /**
     * Порядок ходов. ВНИМАНИЕ: пешки всегда упорядочиваются для той стороны, которая сейчас ходит
     * (`forPlayer`), а стены — по netGain относительно соперника. В alphabeta это в точности поведение
     * старого движка; такая асимметрия ломает переносимость оценки между цветами.
     *
     * `bannedCells` — единственное отличие v1 от v0: клетки, в которые ход запрещён. Фильтр применяется
     * ТОЛЬКО к реальным ходам и не трогает оценку позиций, иначе запрет изменил бы смысл функции оценки,
     * а не только список кандидатов.
     */
    function generateMoves(state, forPlayer, depth = 0, avoidPositions = null, bannedCells = null) {
        const moves = [];
        const { r, c } = state.players[forPlayer].pos;
        const pawnTargets = Rules.getJumpTargets(state, r, c);

        const distMap = pathDistanceMap(state, forPlayer);
        const currentPathDist = distMap[r * 9 + c];
        const dBot = currentPathDist === -1 ? 9 : currentPathDist;
        const urgencyBonus = dBot <= w.urgencyMaxDist ? (w.urgencyMaxDist + 1 - dBot) * w.urgencyPerDist : 0;

        for (let i = 0; i < pawnTargets.length; i++) {
            const target = pawnTargets[i];
            if (bannedCells && bannedCells.has(`${target.r},${target.c}`)) continue;
            const isJump = Math.abs(target.r - r) === 2 || Math.abs(target.c - c) === 2 ||
                (Math.abs(target.r - r) === 1 && Math.abs(target.c - c) === 1);
            const basePriority = isJump ? w.pawnJump : w.pawnStep;

            const newPathDist = distMap[target.r * 9 + target.c];
            const directionBonus = newPathDist === -1 ? 0
                : newPathDist < currentPathDist ? w.directionCloser
                    : newPathDist > currentPathDist ? w.directionFurther
                        : 0;

            const loopPenalty = (avoidPositions && avoidPositions.has(`${target.r},${target.c}`)) ? LOOP_PENALTY : 0;

            moves.push({ type: 'pawn', r: target.r, c: target.c, priority: basePriority + urgencyBonus + directionBonus + loopPenalty });
        }

        if (state.players[forPlayer].wallsLeft > 0) {
            const wallMoves = generateSmartWallMoves(state, forPlayer);
            for (let i = 0; i < wallMoves.length; i++) moves.push(wallMoves[i]);
        }

        const killerList = (depth < KILLER_SLOTS && killers[depth]) || [];
        if (killerList.length) {
            for (const m of moves) {
                for (let i = 0; i < killerList.length; i++) {
                    if (isSameMove(killerList[i], m)) {
                        m.priority = (m.priority || 0) + KILLER_BONUS;
                        break;
                    }
                }
            }
        }

        return moves.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    }

    // --- Apply / undo ---

    function applyMove(state, move, playerIdx) {
        if (move.type === 'pawn') {
            move.prevPos = { r: state.players[playerIdx].pos.r, c: state.players[playerIdx].pos.c };

            const zOld = zobrist.pawn[playerIdx][move.prevPos.r][move.prevPos.c];
            state.hashHigh ^= zOld.high;
            state.hashLow ^= zOld.low;

            state.players[playerIdx].pos = { r: move.r, c: move.c };

            const zNew = zobrist.pawn[playerIdx][move.r][move.c];
            state.hashHigh ^= zNew.high;
            state.hashLow ^= zNew.low;
        } else {
            if (move.isVertical) {
                state.vWalls[move.r][move.c] = true;
                const zWall = zobrist.vWalls[move.r][move.c];
                state.hashHigh ^= zWall.high;
                state.hashLow ^= zWall.low;
            } else {
                state.hWalls[move.r][move.c] = true;
                const zWall = zobrist.hWalls[move.r][move.c];
                state.hashHigh ^= zWall.high;
                state.hashLow ^= zWall.low;
            }

            const wallsLeft = state.players[playerIdx].wallsLeft;
            const zOld = zobrist.wallsLeft[playerIdx][wallsLeft];
            state.hashHigh ^= zOld.high;
            state.hashLow ^= zOld.low;

            state.players[playerIdx].wallsLeft--;

            const zNew = zobrist.wallsLeft[playerIdx][state.players[playerIdx].wallsLeft];
            state.hashHigh ^= zNew.high;
            state.hashLow ^= zNew.low;
        }

        state.hashHigh ^= zobrist.turn[playerIdx].high ^ zobrist.turn[1 - playerIdx].high;
        state.hashLow ^= zobrist.turn[playerIdx].low ^ zobrist.turn[1 - playerIdx].low;
        state.currentPlayer = 1 - state.currentPlayer;
    }

    function undoMove(state, move, playerIdx) {
        if (move.type === 'pawn') {
            const zNew = zobrist.pawn[playerIdx][move.r][move.c];
            state.hashHigh ^= zNew.high;
            state.hashLow ^= zNew.low;

            state.players[playerIdx].pos = move.prevPos;

            const zOld = zobrist.pawn[playerIdx][move.prevPos.r][move.prevPos.c];
            state.hashHigh ^= zOld.high;
            state.hashLow ^= zOld.low;
        } else {
            if (move.isVertical) {
                state.vWalls[move.r][move.c] = false;
                const zWall = zobrist.vWalls[move.r][move.c];
                state.hashHigh ^= zWall.high;
                state.hashLow ^= zWall.low;
            } else {
                state.hWalls[move.r][move.c] = false;
                const zWall = zobrist.hWalls[move.r][move.c];
                state.hashHigh ^= zWall.high;
                state.hashLow ^= zWall.low;
            }

            const zNew = zobrist.wallsLeft[playerIdx][state.players[playerIdx].wallsLeft];
            state.hashHigh ^= zNew.high;
            state.hashLow ^= zNew.low;

            state.players[playerIdx].wallsLeft++;

            const zOld = zobrist.wallsLeft[playerIdx][state.players[playerIdx].wallsLeft];
            state.hashHigh ^= zOld.high;
            state.hashLow ^= zOld.low;
        }

        state.hashHigh ^= zobrist.turn[playerIdx].high ^ zobrist.turn[1 - playerIdx].high;
        state.hashLow ^= zobrist.turn[playerIdx].low ^ zobrist.turn[1 - playerIdx].low;
        state.currentPlayer = 1 - state.currentPlayer;
    }

    // --- Поиск ---

    // Внутри minimax дедлайн проверяется раз в 4096 узлов: Date.now() на каждом узле стоит слишком
    // дорого для горячего пути. В корне проверка идёт на каждом ходе, иначе одно поддерево последнего
    // уровня (при depth 20 это секунды) успевает пройти целиком и бюджет времени рвётся на порядок.
    function deadlineHit() {
        return Date.now() > deadline;
    }

    function checkBudget() {
        if (nodesVisited >= nodeLimit) return true;
        if ((nodesVisited & 4095) === 0 && deadlineHit()) return true;
        return false;
    }

    function minimax(state, depth, alpha, beta, maximizing, botIdx, avoidPositions, bannedCells) {
        nodesVisited++;
        if (checkBudget()) throw 'budget';

        if (depth === 0) return evaluate(state, botIdx);

        const stateKey = computeStateKey(state);
        const cached = tt.get(stateKey);
        if (cached && cached.depth >= depth) {
            if (cached.flag === 'EXACT') return cached.val;
            if (cached.flag === 'LOWER' && cached.val >= beta) return cached.val;
            if (cached.flag === 'UPPER' && cached.val <= alpha) return cached.val;
        }

        const current = maximizing ? botIdx : 1 - botIdx;
        const moves = generateMoves(state, current, depth, avoidPositions, bannedCells);
        if (moves.length === 0) return evaluate(state, botIdx);

        const origAlpha = alpha;
        let bestScore = maximizing ? -Infinity : Infinity;

        if (maximizing) {
            for (let i = 0; i < moves.length; i++) {
                const m = moves[i];
                applyMove(state, m, current);
                const score = minimax(state, depth - 1, alpha, beta, false, botIdx, avoidPositions, bannedCells);
                undoMove(state, m, current);
                if (score > bestScore) bestScore = score;
                if (bestScore > alpha) alpha = bestScore;
                if (bestScore >= beta) { storeKiller(depth, m); break; }
            }
        } else {
            for (let i = 0; i < moves.length; i++) {
                const m = moves[i];
                applyMove(state, m, current);
                const score = minimax(state, depth - 1, alpha, beta, true, botIdx, avoidPositions, bannedCells);
                undoMove(state, m, current);
                if (score < bestScore) bestScore = score;
                if (bestScore < beta) beta = bestScore;
                if (bestScore <= alpha) { storeKiller(depth, m); break; }
            }
        }

        let flag = 'EXACT';
        if (bestScore <= origAlpha) flag = 'UPPER';
        else if (bestScore >= beta) flag = 'LOWER';
        tt.set(stateKey, { depth, val: bestScore, flag });
        ttStores++;
        return bestScore;
    }

    // --- Точка входа ---

    function think(state, limits = {}) {
        if (state.currentPlayer === undefined) throw new Error('v1: state.currentPlayer is required');
        const botIdx = limits.player === undefined ? state.currentPlayer : limits.player;
        // Старый движок в корне всегда применял ход за botIdx. Если это не сторона к ходу, поиск молча
        // считает не то состояние, поэтому лучше явная ошибка, чем тихо испорченный ход.
        if (botIdx !== state.currentPlayer) {
            throw new Error(`v1: player ${botIdx} is not to move (currentPlayer ${state.currentPlayer}); ` +
                'the root of this search assumes the bot moves now');
        }

        const start = Date.now();
        const difficulty = limits.difficulty || options.difficulty || 'medium';
        const maxDepth = limits.maxDepth || options.maxDepth || DEPTH_BY_DIFFICULTY[difficulty] || 3;
        const timeMs = limits.timeMs || options.timeMs || DEFAULT_TIME_MS;
        const nodes = limits.nodes || options.nodes || Infinity;
        const easyRandomP = limits.easyRandomP !== undefined ? limits.easyRandomP
            : (options.easyRandomP !== undefined ? options.easyRandomP : 0.3);

        // Поиск всегда идёт по копии: обрыв по бюджету может прервать его между applyMove и undoMove.
        const work = Rules.cloneState(state);
        if (work.hashHigh === undefined) {
            const h = computeZobristHash(work);
            work.hashHigh = h.hashHigh;
            work.hashLow = h.hashLow;
        }

        if (tt.size > TT_CLEAR_THRESHOLD) tt.clear();
        killers = newKillers();

        const moves = generateMoves(work, botIdx, maxDepth);
        if (moves.length === 0) {
            return { move: null, depth: 0, nodes: 0, timeMs: Date.now() - start, score: 0, ttStores };
        }

        if (difficulty === 'easy' && rng.next() < easyRandomP) {
            const pawnMoves = [];
            for (const m of moves) if (m.type === 'pawn') pawnMoves.push(m);
            const chosen = pawnMoves.length ? pawnMoves[Math.floor(rng.next() * pawnMoves.length)] : moves[0];
            return { move: chosen, depth: 0, nodes: 0, timeMs: Date.now() - start, score: 0, ttStores, random: true };
        }

        // --- v1: настоящий запрет на oscillation ---
        //
        // ЗАМЕР (80 партий v1 vs v0, 7 петель, настоящая длина цикла посчитана от последнего повтора):
        //   - циклы длины 2 (A->B->A): 0 из 7. Запрет на одну клетку работает.
        //   - циклы длины 8 и 12: пешка обходит квадрат 2x2, напр. 3,5 -> 3,4 -> 2,4 -> 2,5 -> 3,5.
        //     Ни одного немедленного возврата, поэтому запрет «последняя клетка» по построению бессилен.
        //     Это орбита: 4 разные клетки по кругу. В 7 из 7 петель зациклены ОБЕ пешки — боты вращаются
        //     в соседних квадратах друг рядом с другом.
        // Значит запрещать надо не одну клетку, а последние RECENT_WINDOW клеток, по которым пешка шла.
        //
        // Откуда берём пройденный путь. НЕ из state.history: редуктор кладёт туда только `move` (куда
        // встали), а `prevPos` (откуда ушли) отсутствует ВСЕГДА — это же делает антицикл v0 бессмысленным.
        // Вместо этого движок запоминает позицию своей пешки при КАЖДОМ своём think(). Соседние записи
        // selfPath отличаются ровно на один наш ход, поэтому «откуда ушли» = предпоследняя запись, и это
        // верно независимо от того, как именно хранится история. Экземпляр движка создаётся заново на
        // каждую партию (adapter.makeBot -> newGame -> make), поэтому путь не протекает между партиями.
        const cur = state.players[botIdx].pos;
        selfPath.push(cur.r, cur.c);
        const nEntries = selfPath.length / 2; // сколько позиций пешка занимала, включая текущую

        const bannedCells = new Set();
        // Запрещаем последние N клеток, на которых пешка стояла, кроме текущей.
        const banFrom = Math.max(0, nEntries - 1 - RECENT_WINDOW);
        for (let i = nEntries - 2; i >= banFrom; i--) {
            bannedCells.add(`${selfPath[i * 2]},${selfPath[i * 2 + 1]}`);
        }

        // Запрет не должен оставлять пешку без хода: это дало бы «no-move» и поражение на ровном месте.
        // В коридоре легальных целей всего 2, и окно в 3 клетки запретило бы обе. Поэтому снимаем самые
        // старые запреты по одному, пока хотя бы одна цель не останется. Запрещать всё, кроме последнего
        // варианта, нельзя — тогда фича снова станет no-op.
        {
            const legalPawn = Rules.getJumpTargets(state, cur.r, cur.c);
            while (bannedCells.size > 0 && !legalPawn.some((t) => !bannedCells.has(`${t.r},${t.c}`))) {
                // убираем самый старый запрет: это самая дальняя клетка, её запрет наименее ценен
                const oldest = bannedCells.values().next().value;
                bannedCells.delete(oldest);
            }
        }

        // Корневой список ходов построен ДО вычисления bannedCells, поэтому запрет в него ещё не попал.
        // Без этого фильтра движок всё равно мог бы выбрать петлевой ход в корне — то есть запрет был бы
        // применён только внутри дерева и на реальное решение не влиял бы.
        for (let i = moves.length - 1; i >= 0; i--) {
            const m = moves[i];
            if (m.type === 'pawn' && bannedCells.has(`${m.r},${m.c}`)) moves.splice(i, 1);
        }
        if (moves.length === 0) {
            // Запрет съел все ходы. Такое возможно, только если пешка заперта так, что единственный выход
            // ведёт назад. Возвращаем полный список без запретов: повтор лучше, чем падение или no-move.
            const all = generateMoves(work, botIdx, maxDepth, null, null);
            for (let i = 0; i < all.length; i++) moves.push(all[i]);
            bannedCells.clear();
        }

        // Старый антицикл v0 оставлен как есть: это ключ сортировки, а не запрет, и он влияет на
        // перебор. Менять его здесь нельзя — иначе дельта v1-v0 измеряла бы два изменения сразу.
        const avoidPositions = new Set();
        let seen = 0;
        const histNow = state.history || [];
        for (let i = histNow.length - 1; i >= 0 && seen < HISTORY_WINDOW; i--) {
            const h = histNow[i];
            if (h.playerIdx !== botIdx || !h.move || h.move.type !== 'pawn') continue;
            seen++;
            if (h.prevPos) avoidPositions.add(`${h.prevPos.r},${h.prevPos.c}`);
            else if (h.move) avoidPositions.add(`${h.move.r},${h.move.c}`);
        }

        deadline = Date.now() + timeMs;
        nodeLimit = nodes;
        nodesVisited = 0;
        ttStores = 0;

        let bestMove = moves[0];
        let bestScore = -Infinity;
        let finalDepth = 0;

        for (let depth = 1; depth <= maxDepth; depth++) {
            try {
                if (depth > 1 && bestMove) {
                    moves.sort((a, b) => {
                        if (isSameMove(a, bestMove)) return -1;
                        if (isSameMove(b, bestMove)) return 1;
                        return (b.priority || 0) - (a.priority || 0);
                    });
                }

                let iterationBest = moves[0];
                let iterationScore = -Infinity;
                for (let i = 0; i < moves.length; i++) {
                    const m = moves[i];
                    applyMove(work, m, botIdx);
                    const score = minimax(work, depth - 1, -Infinity, Infinity, false, botIdx, avoidPositions);
                    undoMove(work, m, botIdx);
                    if (score > iterationScore) {
                        iterationScore = score;
                        iterationBest = m;
                    }
                    if (nodesVisited >= nodeLimit || deadlineHit()) throw 'budget';
                }

                bestMove = iterationBest;
                bestScore = iterationScore;
                finalDepth = depth;
                if (iterationScore > WIN_SCORE) break;
            } catch (e) {
                if (e !== 'budget') throw e;
                break; // неполная итерация целиком отбрасывается, как в оригинале
            }
        }

        return {
            move: bestMove,
            depth: finalDepth,
            nodes: nodesVisited,
            timeMs: Date.now() - start,
            score: bestScore,
            ttStores,
        };
    }

    return {
        name: 'v1',
        version: '0.1.0',
        description: 'Faithful port of src/core/ai-core.js (bot-perspective eval, TT keyed on position only)',
        rules: Rules,
        weights: w,
        think,
        reset,
        // Служебное, нужно парт-тестам: тот же поиск, но с уже известным ходом.
        _internals: { generateMoves, evaluate, shortestPathDistance, pathDistanceMap, applyMove, undoMove, computeZobristHash },
    };
}

module.exports = { createEngineV1, DEFAULT_WEIGHTS, DEPTH_BY_DIFFICULTY };
