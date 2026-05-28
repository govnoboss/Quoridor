const mongoose = require('mongoose');

const botSettingsSchema = new mongoose.Schema({
    key: {
        type: String,
        default: 'global',
        unique: true,
    },
    enabled: {
        type: Boolean,
        default: false,
    },
    rankedEnabled: {
        type: Boolean,
        default: false,
    },
    fallbackMinWaitMs: {
        type: Number,
        default: 15000,
        min: 0,
    },
    fallbackMaxWaitMs: {
        type: Number,
        default: 25000,
        min: 0,
    },
    maxActiveGames: {
        type: Number,
        default: 15,
        min: 0,
    },
    moveMinDelayMs: {
        type: Number,
        default: 800,
        min: 0,
    },
    moveMaxDelayMs: {
        type: Number,
        default: 2500,
        min: 0,
    },
    maxRecentMatches: {
        type: Number,
        default: 3,
        min: 0,
    },
    recentWindowMs: {
        type: Number,
        default: 3600000,
        min: 60000,
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
}, {
    timestamps: true,
});

module.exports = mongoose.model('BotSettings', botSettingsSchema);
