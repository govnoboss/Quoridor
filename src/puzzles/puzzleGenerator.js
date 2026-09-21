// Генератор дневных головоломок (Daily Puzzle).
// Используется cron-скриптом scripts/generate_daily_puzzle.js и как fallback в API.
const Shared = require('../core/shared.js');
const AICore = require('../core/ai-core');
const DailyPuzzle = require('../models/DailyPuzzle');
const GameResult = require('../models/GameResult');

AICore.init(Shared);

function utcDateKey(d = new Date()) {
    return d.toISOString().slice(0, 10);
}

function yesterdayDateKey() {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return utcDateKey(d);
}

function replayHistory(history) {
    // Повторяет массив записей { playerIdx, move } через gameReducer.
    let state = Shared.createInitialState({ base: 600 });
    for (const record of history || []) {
        if (!record || !record.move) return { state, ok: false };
        const m = record.move;
        try {
            state = Shared.gameReducer(state, {
                type: m.type,
                r: m.r,
                c: m.c,
                isVertical: m.isVertical || false,
                playerIdx: typeof m.playerIdx === 'number' ? m.playerIdx : record.playerIdx
            });
        } catch (e) {
            return { state, ok: false };
        }
    }
    return { state, ok: true };
}

function checkGoalWinner(state) {
    if (state.players[0].pos.r === 0) return 0;
    if (state.players[1].pos.r === 8) return 1;
    return -1;
}

function difficultyFor(winner, state) {
    const dist = winner === 0 ? state.players[0].pos.r : 8 - state.players[1].pos.r;
    if (dist >= 4) return 'easy';
    if (dist >= 2) return 'medium';
    return 'hard';
}

// Ищет позицию в заархивированной партии, где победа достигается одним ходом.
function findPuzzleInGame(game) {
    const history = game.history || [];
    if (history.length < 6) return null;

    // Идём с конца: последний ход победителя — достижение цели; режем перед ним.
    for (let cut = history.length - 1; cut >= 1; cut--) {
        const last = history[cut];
        if (!last || !last.move) continue;
        if (last.move.type !== 'pawn') continue;

        const before = replayHistory(history.slice(0, cut));
        if (!before.ok) continue;
        if (checkGoalWinner(before.state) !== -1) continue; // уже выиграно ранее
        if (before.state.currentPlayer !== game.winner) continue; // должен ходить победитель

        const after = replayHistory(history.slice(0, cut + 1));
        if (!after.ok) continue;
        if (checkGoalWinner(after.state) !== game.winner) continue; // ход не приводит к цели

        return {
            moves: history.slice(0, cut),
            solution: last.move,
            winner: game.winner,
            sourceGameId: game._id || null,
            state: before.state
        };
    }
    return null;
}

// Гарантированный запасной вариант: белый у (1,4), его ход, цель — шаг на (0,4).
const FALLBACK_HISTORY = [
    { playerIdx: 0, move: { type: 'pawn', r: 7, c: 4, isVertical: false, playerIdx: 0 } },
    { playerIdx: 1, move: { type: 'pawn', r: 1, c: 4, isVertical: false, playerIdx: 1 } },
    { playerIdx: 0, move: { type: 'pawn', r: 6, c: 4, isVertical: false, playerIdx: 0 } },
    { playerIdx: 1, move: { type: 'pawn', r: 2, c: 4, isVertical: false, playerIdx: 1 } },
    { playerIdx: 0, move: { type: 'pawn', r: 5, c: 4, isVertical: false, playerIdx: 0 } },
    { playerIdx: 1, move: { type: 'pawn', r: 3, c: 4, isVertical: false, playerIdx: 1 } },
    { playerIdx: 0, move: { type: 'pawn', r: 4, c: 4, isVertical: false, playerIdx: 0 } },
    { playerIdx: 1, move: { type: 'pawn', r: 3, c: 5, isVertical: false, playerIdx: 1 } },
    { playerIdx: 0, move: { type: 'pawn', r: 3, c: 4, isVertical: false, playerIdx: 0 } },
    { playerIdx: 1, move: { type: 'pawn', r: 4, c: 5, isVertical: false, playerIdx: 1 } },
    { playerIdx: 0, move: { type: 'pawn', r: 2, c: 4, isVertical: false, playerIdx: 0 } },
    { playerIdx: 1, move: { type: 'pawn', r: 5, c: 5, isVertical: false, playerIdx: 1 } },
    { playerIdx: 0, move: { type: 'pawn', r: 1, c: 4, isVertical: false, playerIdx: 0 } },
    { playerIdx: 1, move: { type: 'pawn', r: 5, c: 4, isVertical: false, playerIdx: 1 } }
];

function fallbackPuzzle() {
    const before = replayHistory(FALLBACK_HISTORY);
    return {
        moves: FALLBACK_HISTORY.slice(),
        solution: { type: 'pawn', r: 0, c: 4 },
        winner: 0,
        sourceGameId: null,
        state: before.state
    };
}

async function createTodayPuzzle(now) {
    const date = utcDateKey(now);
    const existing = await DailyPuzzle.findOne({ date });
    if (existing) return existing;

    const candidates = await GameResult.find({
        winner: { $in: [0, 1] },
        reason: 'goal',
        turns: { $gte: 7 },
        'history.0': { $exists: true }
    })
        .select('winner reason turns history date')
        .sort({ date: -1 })
        .limit(40)
        .lean();

    // Случайный порядок, чтобы каждый день попадалась разная партия.
    for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    let found = null;
    for (const game of candidates) {
        found = findPuzzleInGame(game);
        if (found) break;
    }
    if (!found) found = fallbackPuzzle();

    const difficulty = difficultyFor(found.winner, found.state);

    return DailyPuzzle.create({
        date,
        moves: found.moves,
        result: 'goal',
        winner: found.winner,
        sourceGameId: found.sourceGameId,
        difficulty,
        solutionLength: 1
    });
}

// Возвращает готовую головоломку на сегодня (создаёт при отсутствии).
async function getTodayPuzzle(now = new Date()) {
    try {
        return await createTodayPuzzle(now);
    } catch (e) {
        // Гонка: головоломка уже создана другим процессом (duplicate key).
        if (e && e.code === 11000) {
            const existing = await DailyPuzzle.findOne({ date: utcDateKey(now) });
            if (existing) return existing;
        }
        throw e;
    }
}

// Применить ход игрока к позиции головоломки.
// Возвращает { state, error } — error при нелегальном ходе.
function applyPuzzleMove(puzzle, move) {
    const { state, ok } = replayHistory(puzzle.moves);
    if (!ok) return { state: null, error: 'Invalid puzzle data' };
    let next = Shared.cloneState(state);
    try {
        next = Shared.gameReducer(next, {
            type: move.type,
            r: move.r,
            c: move.c,
            isVertical: !!move.isVertical,
            playerIdx: puzzle.winner
        });
    } catch (e) {
        return { state: null, error: 'Invalid pawn move' };
    }
    return { state: next, error: null };
}

module.exports = {
    utcDateKey,
    yesterdayDateKey,
    replayHistory,
    checkGoalWinner,
    getTodayPuzzle,
    applyPuzzleMove,
    FALLBACK_HISTORY
};