const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/quoridor', {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 5000,
        });
        console.log(`[MONGODB] Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`[MONGODB] ${error.message} — running without database`);
    }
};

module.exports = connectDB;
