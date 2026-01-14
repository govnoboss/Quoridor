const mongoose = require('mongoose');

const friendshipSchema = new mongoose.Schema({
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'declined', 'blocked'],
        default: 'pending'
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Ensure unique friendship between two users
friendshipSchema.index({ requester: 1, recipient: 1 }, { unique: true });

module.exports = mongoose.model('Friendship', friendshipSchema);
