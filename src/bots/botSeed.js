async function findAccountBot(User, bot) {
    let existing = await User.findOne({ username: bot.username });
    if (!existing && bot.seedId) {
        existing = await User.findOne({ seedId: bot.seedId });
    }
    return existing;
}

async function upsertAccountBot(User, bot, passwordHash) {
    const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(bot.username)}&background=random`;
    const existing = await findAccountBot(User, bot);

    if (existing) {
        existing.username = bot.username;
        existing.isBot = true;
        existing.rating = bot.rating;
        existing.country = bot.country;
        existing.seedId = bot.seedId;
        existing.avatarUrl = existing.avatarUrl || avatarUrl;
        await existing.save();
        return 'updated';
    }

    await new User({
        username: bot.username,
        seedId: bot.seedId,
        passwordHash,
        isBot: true,
        rating: bot.rating,
        country: bot.country,
        avatarUrl,
        bio: '',
        status: '',
    }).save();
    return 'created';
}

module.exports = { upsertAccountBot };
