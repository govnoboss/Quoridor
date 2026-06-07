require('dotenv').config();

const connectDB = require('../src/storage/db');
const User = require('../src/models/User');
const { syncRankedBots } = require('../src/simulation/PopulationManager');

async function main() {
    await connectDB();

    const password = process.argv.find(a => a.startsWith('--password='))?.split('=')[1];
    const result = await syncRankedBots(User, password);

    const total = await User.countDocuments({ isBot: true });
    console.log(`[POPULATE] Created ${result.created}, updated ${result.updated} ranked bots`);
    console.log(`[POPULATE] Total bot accounts in DB: ${total}`);

    process.exit(0);
}

main().catch(err => {
    console.error('[POPULATE] Error:', err);
    process.exit(1);
});
