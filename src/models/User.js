const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        minlength: 3,
        maxlength: 20
    },
    isBot: {
        type: Boolean,
        default: false
    },
    passwordHash: {
        type: String,
        required: true
    },
    avatarUrl: {
        type: String,
        default: 'https://ui-avatars.com/api/?name=User&background=333&color=fff'
    },
    status: {
        type: String,
        default: '',
        maxlength: 100
    },
    rating: {
        type: Number,
        default: 1200
    },
    bio: {
        type: String,
        maxlength: 300,
        default: ''
    },
    country: {
        type: String,
        default: 'XX' // 'XX' = Unknown/International
    },
    achievements: [{
        type: String // Achievement IDs
    }],
    stats: {
        totalGames: { type: Number, default: 0 },
        wins: { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
        playTimeSeconds: { type: Number, default: 0 }
    },
    preferences: {
        boardTheme: { type: String, default: 'default' },
        pieceSet: { type: String, default: 'default' }
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('User', userSchema);
