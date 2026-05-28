require('dotenv').config();

const bcrypt = require('bcryptjs');
const connectDB = require('../src/storage/db');
const User = require('../src/models/User');
const { ACCOUNT_BOTS } = require('../src/bots/defaultBots');
const { upsertAccountBot } = require('../src/bots/botSeed');

async function seedBots() {
    await connectDB();

    const passwordHash = await bcrypt.hash(
        process.env.BOT_ACCOUNT_PASSWORD || `bot-${Date.now()}-${Math.random()}`,
        10
    );

    for (const bot of ACCOUNT_BOTS) {
        const action = await upsertAccountBot(User, bot, passwordHash);
        console.log(`[BOTS] ${action === 'created' ? 'Created' : 'Updated'} ${bot.username}`);
    }
}

seedBots()
    .then(() => {
        console.log('[BOTS] Seed complete');
        process.exit(0);
    })
    .catch((err) => {
        console.error('[BOTS] Seed failed:', err);
        process.exit(1);
    });
