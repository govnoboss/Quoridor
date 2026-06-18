const DailyPuzzle = require('../models/DailyPuzzle');
const Shared = require('../core/shared');

const SEED_PUZZLES = [
    {
        description: 'Easy: White to move — advance your pawn',
        boardState: (() => {
            const state = Shared.createInitialState();
            state.hWalls[4][0] = true;
            state.hWalls[4][1] = true;
            state.hWalls[4][2] = true;
            state.hWalls[4][3] = true;
            state.hWalls[4][4] = true;
            state.hWalls[4][5] = true;
            state.hWalls[4][6] = true;
            state.hWalls[4][7] = true;
            state.vWalls[0][4] = true;
            state.vWalls[1][4] = true;
            state.vWalls[2][4] = true;
            state.vWalls[3][4] = true;
            state.players[0].pos = { r: 6, c: 4 };
            state.players[0].wallsLeft = 3;
            state.players[1].pos = { r: 2, c: 4 };
            state.players[1].wallsLeft = 3;
            delete state.playerSockets;
            delete state.playerTokens;
            delete state.playerProfiles;
            delete state.disconnectTimer;
            delete state.timers;
            delete state.increment;
            delete state.lastMoveTimestamp;
            delete state.history;
            delete state.isRanked;
            return state;
        })(),
        solution: {
            moves: [{
                type: 'pawn', r: 5, c: 4,
                description: 'Advance your pawn toward the goal. You are one step ahead of your opponent.'
            }]
        },
        hint: 'You are closer to your goal than your opponent. Keep pushing forward.',
        difficulty: 1,
        puzzleType: 'breakthrough'
    },
    {
        description: 'Medium: White to move — block black\'s advance',
        boardState: (() => {
            const state = Shared.createInitialState();
            state.hWalls[2][2] = true;
            state.hWalls[2][3] = true;
            state.hWalls[2][4] = true;
            state.hWalls[2][5] = true;
            state.hWalls[2][6] = true;
            state.vWalls[4][2] = true;
            state.vWalls[4][3] = true;
            state.vWalls[4][4] = true;
            state.vWalls[4][5] = true;
            state.vWalls[4][6] = true;
            state.players[0].pos = { r: 5, c: 4 };
            state.players[0].wallsLeft = 5;
            state.players[1].pos = { r: 3, c: 4 };
            state.players[1].wallsLeft = 5;
            state.currentPlayer = 0;
            delete state.playerSockets; delete state.playerTokens;
            delete state.playerProfiles; delete state.disconnectTimer;
            delete state.timers; delete state.increment;
            delete state.lastMoveTimestamp; delete state.history; delete state.isRanked;
            return state;
        })(),
        solution: {
            moves: [{
                type: 'wall', r: 3, c: 3, isVertical: true,
                description: 'Place a vertical wall to block black\'s direct path to the goal. Force them to go around.'
            }]
        },
        hint: 'Your opponent has a clear path to their goal. How can you disrupt it?',
        difficulty: 3,
        puzzleType: 'blocking_wall'
    },
    {
        description: 'Hard: Black to move — find the fork',
        boardState: (() => {
            const state = Shared.createInitialState();
            state.hWalls[3][1] = true; state.hWalls[3][2] = true;
            state.hWalls[3][3] = true; state.hWalls[3][4] = true;
            state.hWalls[3][5] = true;
            state.hWalls[5][1] = true; state.hWalls[5][2] = true;
            state.hWalls[5][3] = true; state.hWalls[5][4] = true;
            state.hWalls[5][5] = true;
            state.vWalls[0][4] = true; state.vWalls[1][4] = true;
            state.vWalls[2][4] = true;
            state.players[0].pos = { r: 4, c: 0 };
            state.players[0].wallsLeft = 2;
            state.players[1].pos = { r: 4, c: 8 };
            state.players[1].wallsLeft = 3;
            state.currentPlayer = 1;
            delete state.playerSockets; delete state.playerTokens;
            delete state.playerProfiles; delete state.disconnectTimer;
            delete state.timers; delete state.increment;
            delete state.lastMoveTimestamp; delete state.history; delete state.isRanked;
            return state;
        })(),
        solution: {
            moves: [{
                type: 'pawn', r: 4, c: 7,
                description: 'Advance forward while staying in position to block white\'s eastern path.'
            }]
        },
        hint: 'Look for a move that both advances your position and limits your opponent\'s options.',
        difficulty: 5,
        puzzleType: 'fork'
    }
];

const seedPuzzles = {
    async getForDate(date) {
        const existing = await DailyPuzzle.findOne({ date, isActive: true });
        if (existing) return existing;

        const dayOfYear = Math.floor((new Date(date) - new Date(date.slice(0, 4), 0, 0)) / 86400000);
        const seedIndex = dayOfYear % SEED_PUZZLES.length;
        const seed = SEED_PUZZLES[seedIndex];

        try {
            const puzzle = await DailyPuzzle.create({
                date,
                difficulty: seed.difficulty,
                boardState: seed.boardState,
                solution: seed.solution,
                hint: seed.hint,
                puzzleType: seed.puzzleType,
                author: 'seed',
                isActive: true
            });
            return puzzle;
        } catch (err) {
            if (err.code === 11000) {
                return await DailyPuzzle.findOne({ date, isActive: true });
            }
            throw err;
        }
    }
};

module.exports = seedPuzzles;
