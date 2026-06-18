const mongoose = require('mongoose');

const dailyPuzzleSchema = new mongoose.Schema({
    date: {
        type: String,
        unique: true,
        required: true
    },
    difficulty: {
        type: Number,
        min: 1,
        max: 5,
        required: true
    },
    boardState: {
        hWalls: { type: [[Boolean]], required: true },
        vWalls: { type: [[Boolean]], required: true },
        players: [{
            color: { type: String, enum: ['white', 'black'] },
            pos: {
                r: { type: Number, min: 0, max: 8 },
                c: { type: Number, min: 0, max: 8 }
            },
            wallsLeft: { type: Number, min: 0, max: 10 }
        }],
        currentPlayer: { type: Number, min: 0, max: 1 }
    },
    solution: {
        moves: [{
            type: { type: String, enum: ['pawn', 'wall'] },
            r: Number,
            c: Number,
            isVertical: Boolean,
            description: String
        }]
    },
    hint: { type: String, default: '' },
    puzzleType: {
        type: String,
        enum: ['breakthrough', 'blocking_wall', 'positional_wall', 'fork', 'positional'],
        default: 'positional'
    },
    sourceGame: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'GameResult',
        default: null
    },
    sourceMoveIndex: { type: Number, default: -1 },
    author: { type: String, default: 'auto' },
    timesSolved: { type: Number, default: 0 },
    timesAttempted: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

dailyPuzzleSchema.index({ isActive: 1, date: -1 });

module.exports = mongoose.model('DailyPuzzle', dailyPuzzleSchema);
