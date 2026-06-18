const DailyPuzzle = require('../models/DailyPuzzle');
const GameAnalyzer = require('./GameAnalyzer');
const seedPuzzles = require('./seedPuzzles');

const PuzzleScheduler = {
    _timer: null,

    async ensureTodayPuzzle() {
        const today = new Date().toISOString().slice(0, 10);
        console.log(`[PUZZLE] Checking puzzle for ${today}...`);

        let puzzle = await DailyPuzzle.findOne({ date: today, isActive: true });
        if (puzzle) {
            console.log(`[PUZZLE] Already exists for ${today} (difficulty: ${puzzle.difficulty}, type: ${puzzle.puzzleType})`);
            return puzzle;
        }

        console.log(`[PUZZLE] No puzzle for ${today}, generating...`);

        const candidate = await GameAnalyzer.findBestCandidate({
            gameCount: 30,
            positionsPerGame: 5,
            depth: 4,
            timeLimitPerMove: 3000
        });

        if (candidate) {
            try {
                puzzle = await DailyPuzzle.create({
                    date: today,
                    difficulty: candidate.difficulty,
                    boardState: candidate.boardState,
                    solution: candidate.solution,
                    hint: candidate.hint,
                    puzzleType: candidate.puzzleType,
                    sourceGame: candidate.sourceGame,
                    sourceMoveIndex: candidate.sourceMoveIndex,
                    author: 'auto_' + today,
                    isActive: true
                });
                console.log(`[PUZZLE] Generated from game analysis: difficulty=${candidate.difficulty}, gap=${candidate.gap.toFixed(0)}`);
                return puzzle;
            } catch (err) {
                console.error('[PUZZLE] Failed to save generated puzzle:', err.message);
            }
        } else {
            console.log('[PUZZLE] Game analysis returned no candidates');
        }

        console.log('[PUZZLE] Falling back to seed puzzles...');
        puzzle = await seedPuzzles.getForDate(today);
        if (puzzle) {
            console.log(`[PUZZLE] Using seed puzzle for ${today}`);
            return puzzle;
        }

        console.error('[PUZZLE] No puzzle available!');
        return null;
    },

    async init() {
        await this.ensureTodayPuzzle();
        this.scheduleNext();
    },

    scheduleNext() {
        if (this._timer) clearTimeout(this._timer);

        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 5, 0, 0);
        let ms = tomorrow - now;
        if (ms < 0) ms = 60000;

        console.log(`[PUZZLE] Next generation scheduled in ${Math.round(ms / 60000)} minutes`);

        this._timer = setTimeout(() => {
            this.init();
        }, ms);
    },

    stop() {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
    }
};

module.exports = PuzzleScheduler;
