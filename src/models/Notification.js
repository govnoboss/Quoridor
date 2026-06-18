const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    type: {
        type: String,
        enum: [
            'friend_request',
            'friend_request_accepted',
            'game_invite',
            'rematch_request',
            'admin_message',
            'bug_report_update'
        ],
        required: true
    },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    data: {
        requesterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        requesterUsername: { type: String },
        requesterAvatar: { type: String },
        gameId: { type: String },
        reportId: { type: mongoose.Schema.Types.ObjectId, ref: 'Report' },
        status: { type: String },
        message: { type: String }
    },
    read: { type: Boolean, default: false, index: true },
    createdAt: { type: Date, default: Date.now }
});

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, read: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
