const mongoose = require('mongoose');

const adminLogSchema = new mongoose.Schema({
    admin: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    action: {
        type: String,
        enum: [
            'user_banned',
            'user_unbanned',
            'user_avatar_reset',
            'user_role_changed',
            'user_rating_changed',
            'user_deleted',
            'user_report_resolved',
            'user_report_dismissed',
            'bot_settings_updated',
            'bot_seeded',
            'bot_renamed',
            'report_status_changed'
        ],
        required: true
    },
    target: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    targetUsername: { type: String, default: '' },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now }
});

adminLogSchema.index({ createdAt: -1 });
adminLogSchema.index({ target: 1, createdAt: -1 });

module.exports = mongoose.model('AdminLog', adminLogSchema);