/**
 * Скрипт очистки бот-аккаунтов из MongoDB.
 * Запуск: node scripts/cleanup_bots.js
 * Удаляет всех пользователей isBot:true, созданных BotManager.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');

async function cleanupBots() {
    const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/quoridor';
    await mongoose.connect(uri);
    console.log('[CLEANUP] Connected to MongoDB');

    const result = await User.deleteMany({ isBot: true });
    console.log(`[CLEANUP] Deleted ${result.deletedCount} bot accounts`);

    await mongoose.disconnect();
    console.log('[CLEANUP] Done');
}

cleanupBots().catch(err => {
    console.error('[CLEANUP] Error:', err);
    process.exit(1);
});
