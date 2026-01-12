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
    ratings: {
        bullet: { type: Number, default: 1200 },
        blitz: { type: Number, default: 1200 },
        rapid: { type: Number, default: 1200 }
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('User', userSchema);
