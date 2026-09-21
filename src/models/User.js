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
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    isBot: {
        type: Boolean,
        default: false
    },
    seedId: {
        type: String,
        unique: true,
        sparse: true,
    },
    isAdmin: {
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
    puzzleStreak: { type: Number, default: 0 },
    lastPuzzleDate: { type: String, default: '' }, // 'YYYY-MM-DD' (UTC)
    puzzlesSolved: { type: Number, default: 0 },
    lastSeen: { type: Date, default: Date.now },
    online: { type: Boolean, default: false },
    friendCount: { type: Number, default: 0 },
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
    },
    unreadNotifications: { type: Number, default: 0 },
    resetPasswordToken: {
        type: String,
        index: true
    },
    resetPasswordExpires: {
        type: Date
    },
    resetPasswordRequestedAt: {
        type: Date
    },
    banned: {
        type: Boolean,
        default: false
    },
    banReason: {
        type: String,
        default: '',
        maxlength: 500
    },
    banExpires: {
        type: Date,
        default: null
    },
    bannedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    bannedAt: {
        type: Date,
        default: null
    }
});

module.exports = mongoose.model('User', userSchema);
