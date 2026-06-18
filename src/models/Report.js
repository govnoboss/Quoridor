const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    role: {
        type: String,
        enum: ['user', 'admin'],
        required: true
    },
    text: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, { _id: false });

const reportSchema = new mongoose.Schema({
    subject: {
        type: String,
        required: true,
        trim: true,
        minlength: 3,
        maxlength: 200
    },
    description: {
        type: String,
        required: true,
        trim: true,
        minlength: 10,
        maxlength: 5000
    },
    status: {
        type: String,
        enum: ['new', 'in_progress', 'closed'],
        default: 'new'
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    ip: {
        type: String,
        default: ''
    },
    messages: [messageSchema],
    deviceInfo: {
        userAgent: { type: String, default: '' },
        platform: { type: String, default: '' },
        screenSize: { type: String, default: '' },
        language: { type: String, default: '' }
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: false });

module.exports = mongoose.model('Report', reportSchema);
