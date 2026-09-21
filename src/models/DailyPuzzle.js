const mongoose = require('mongoose');

const dailyPuzzleSchema = new mongoose.Schema({
    date: {
        type: String, // 'YYYY-MM-DD' (UTC) — уникальный ключ дневной головоломки
        required: true,
        unique: true,
        index: true
    },
    moves: {
        type: Array, // История ходов из заархивированной партии: ['e2','f2',...]
        required: true
    },
    result: {
        type: String, // 'goal' — классическая цель; 'capture' — взятие стены
        default: 'goal'
    },
    winner: {
        type: Number, // 0 — белые, 1 — чёрные (за кого решает игрок)
        default: 0
    },
    sourceGameId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'GameResult'
    },
    difficulty: {
        type: String,
        enum: ['easy', 'medium', 'hard'],
        default: 'medium'
    },
    solutionLength: {
        type: Number,
        default: 0
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('DailyPuzzle', dailyPuzzleSchema);