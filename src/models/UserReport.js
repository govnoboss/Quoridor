const mongoose = require('mongoose');

const userReportSchema = new mongoose.Schema({
    reporter: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    target: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    reason: {
        type: String,
        enum: [
            'inappropriate_avatar',
            'inappropriate_username',
            'inappropriate_bio',
            'inappropriate_status',
            'cheating',
            'harassment',
            'impersonation',
            'other'
        ],
        required: true
    },
    description: {
        type: String,
        trim: true,
        maxlength: 2000,
        default: ''
    },
    status: {
        type: String,
        enum: ['new', 'in_progress', 'resolved', 'dismissed'],
        default: 'new',
        index: true
    },
    adminNote: {
        type: String,
        default: ''
    },
    resolvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    resolvedAt: {
        type: Date,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

userReportSchema.index({ target: 1, status: 1 });
userReportSchema.index({ reporter: 1, createdAt: -1 });

module.exports = mongoose.model('UserReport', userReportSchema);