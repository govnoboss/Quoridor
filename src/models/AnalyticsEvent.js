const mongoose = require('mongoose');

const analyticsEventSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        index: true
    },
    sessionId: {
        type: String,
        default: ''
    },
    deviceId: {
        type: String,
        default: '',
        index: true
    },
    platform: {
        type: String,
        enum: ['web', 'android'],
        default: 'web'
    },
    props: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    }
});

module.exports = mongoose.model('AnalyticsEvent', analyticsEventSchema);