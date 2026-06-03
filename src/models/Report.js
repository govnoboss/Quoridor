const mongoose = require('mongoose');

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
    contact: {
        type: String,
        trim: true,
        maxlength: 200,
        default: ''
    },
    status: {
        type: String,
        enum: ['new', 'in_progress', 'closed'],
        default: 'new'
    },
    ip: {
        type: String,
        default: ''
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Report', reportSchema);
