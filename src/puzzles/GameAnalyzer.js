const GameResult = require('../models/GameResult');
const PuzzleEngine = require('./PuzzleEngine');

const DIFFICULTY_THRESHOLDS = {
    easy: { minGap: 80000, maxGap: Infinity, level: 1 },
    medium: { minGap: 30000, maxGap: 80000, level: 3 },
    hard: { minGap: 5000, maxGap: 30000, level: 5 }
};

function classifyDifficulty(gap) {
    for (const t of Object.values(DIFFICULTY_THRESHOLDS)) {
        if (gap >= t.minGap && gap < t.maxGap) return t.level;
    }
    return 3;
}

function classifyDifficultyLabel(gap) {
    for (const [label, t] of Object.entries(DIFFICULTY_THRESHOLDS)) {
        if (gap >= t.minGap && gap < t.maxGap) return label;
    }
    return 'medium';
}

function movesEqual(a, b) {
    if (!a || !b) return false;
    if (a.type !== b.type) return false;
    if (a.type === 'pawn') return a.r === b.r && a.c === b.c;
    return a.r === b.r && a.c === b.c && a.isVertical === b.isVertical;
}

const GameAnalyzer = {
    async findBestCandidate(options = {}) {
        const {
            gameCount = 30,
            positionsPerGame = 5,
            depth = 4,
            timeLimitPerMove = 3000,
            minTurns = 12,
            maxTurns = 80,
            minGap = 5000
        } = options;

        console.log('[PUZZLE] Searching for puzzle candidates...');

        const games = await GameResult.find({
            history: { $exists: true, $not: { $size: 0 } },
            turns: { $gte: minTurns, $lte: maxTurns }
        })
            .sort({ date: -1 })
            .limit(gameCount)
            .lean();

        if (games.length === 0) {
            console.log('[PUZZLE] No game history found in database');
            return null;
        }

        console.log(`[PUZZLE] Analyzing ${games.length} games...`);

        let bestCandidate = null;
        let bestScore = 0;

        for (const game of games) {
            const history = game.history;
            if (!history || history.length < minTurns) continue;

            const totalMoves = history.length;
            const lo = Math.max(6, Math.floor(totalMoves * 0.15));
            const hi = Math.min(totalMoves - 3, Math.floor(totalMoves * 0.70));

            const step = Math.max(1, Math.floor((hi - lo) / positionsPerGame));

            for (let i = lo; i <= hi && i < totalMoves - 1; i += step) {
                try {
                    const state = PuzzleEngine.reconstructState(history, i - 1);

                    const playerIdx = state.currentPlayer;
                    const nextEntry = history[i];
                    if (!nextEntry || !nextEntry.move) continue;

                    const actualMove = nextEntry.move;

                    const results = PuzzleEngine.evaluateAllMoves(state, playerIdx, depth, timeLimitPerMove);

                    if (results.length < 2) continue;

                    const best = results[0];
                    const second = results[1];
                    const gap = best.score - second.score;

                    if (gap < minGap) continue;

                    const isCorrect = movesEqual(best.move, actualMove);

                    let qualityScore = gap * (isCorrect ? 1.5 : 0.8);
                    if (isCorrect && best.score > 100000) qualityScore *= 0.6;

                    if (qualityScore > bestScore) {
                        const difficulty = classifyDifficulty(gap);
                        const puzzleType = PuzzleEngine.classifyPuzzleType(best.move, state);
                        const hint = PuzzleEngine.generateHint(best.move, state);

                        bestCandidate = {
                            difficulty,
                            puzzleType,
                            hint,
                            boardState: {
                                hWalls: state.hWalls,
                                vWalls: state.vWalls,
                                players: state.players.map(p => ({
                                    color: p.color,
                                    pos: { r: p.pos.r, c: p.pos.c },
                                    wallsLeft: p.wallsLeft
                                })),
                                currentPlayer: state.currentPlayer
                            },
                            solution: {
                                moves: [{
                                    type: best.move.type,
                                    r: best.move.r,
                                    c: best.move.c,
                                    isVertical: best.move.isVertical || false,
                                    description: classifyDifficultyLabel(gap) === 'easy'
                                        ? 'The best move is clear here.'
                                        : classifyDifficultyLabel(gap) === 'hard'
                                            ? 'A subtle move that gives you the advantage.'
                                            : 'Find the strongest continuation.'
                                }]
                            },
                            sourceGame: game._id,
                            sourceMoveIndex: i,
                            gap,
                            qualityScore
                        };
                        bestScore = qualityScore;

                        console.log(`[PUZZLE] New best candidate: gap=${gap.toFixed(0)}, score=${qualityScore.toFixed(0)}, difficulty=${difficulty}, type=${puzzleType}, game=${game._id}, move=${i}`);
                    }
                } catch (err) {
                    if (err === 'timeout') continue;
                    console.error(`[PUZZLE] Error analyzing game ${game._id} at move ${i}:`, err.message);
                }
            }
        }

        if (bestCandidate) {
            console.log(`[PUZZLE] Best candidate found: gap=${bestCandidate.gap.toFixed(0)}, difficulty=${bestCandidate.difficulty}, type=${bestCandidate.puzzleType}`);
        } else {
            console.log('[PUZZLE] No suitable puzzle candidate found');
        }

        return bestCandidate;
    }
};

module.exports = GameAnalyzer;
