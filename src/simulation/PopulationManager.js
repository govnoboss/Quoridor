const bcrypt = require('bcryptjs');
const { RANKED_BOTS } = require('../bots/defaultBots');

async function syncRankedBots(User, passwordOverride) {
    const password = passwordOverride || process.env.BOT_ACCOUNT_PASSWORD || `bot-sim-${Date.now()}`;
    const passwordHash = await bcrypt.hash(password, 10);

    const results = { created: 0, updated: 0 };

    for (const bot of RANKED_BOTS) {
        const existing = await User.findOne({ seedId: bot.seedId });
        const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(bot.username)}&background=random`;

        if (existing) {
            existing.isBot = true;
            existing.seedId = bot.seedId;
            if (!existing.avatarUrl) existing.avatarUrl = avatarUrl;
            if (!existing.bio) existing.bio = '';
            if (!existing.status) existing.status = '';
            if (!existing.stats) existing.stats = { totalGames: 0, wins: 0, losses: 0, playTimeSeconds: 0 };
            await existing.save();
            results.updated++;
        } else {
            await new User({
                username: bot.username,
                email: `bot-${bot.username}@quoridor.local`,
                seedId: bot.seedId,
                passwordHash,
                isBot: true,
                rating: bot.rating,
                country: bot.country,
                avatarUrl,
                bio: '',
                status: '',
                stats: { totalGames: 0, wins: 0, losses: 0, playTimeSeconds: 0 },
            }).save();
            results.created++;
        }
    }

    return results;
}

module.exports = { syncRankedBots };
