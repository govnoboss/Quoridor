const mongoose = require('mongoose');

const gameResultSchema = new mongoose.Schema({
    gameType: {
        type: String, // 'bullet', 'blitz', 'rapid', 'friend', 'bot'
        required: true
    },
    playerWhite: {
        id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        username: String,
        isGuest: { type: Boolean, default: false },
        ratingChange: { type: Number, default: 0 }
    },
    playerBlack: {
        id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        username: String,
        isGuest: { type: Boolean, default: false },
        ratingChange: { type: Number, default: 0 }
    },
    isRanked: {
        type: Boolean,
        default: false
    },
    winner: {
        type: Number, // 0 for white, 1 for black, -1 for draw
        required: true
    },
    reason: {
        type: String // 'goal', 'timeout', 'surrender', 'disconnect'
    },
    turns: {
        type: Number,
        default: 0
    },
    history: {
        type: Array, // Optional: store move history
        default: []
    },
    date: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('GameResult', gameResultSchema);
