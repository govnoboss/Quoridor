class BotPresenceManager {
    constructor(botDocs) {
        this.bots = botDocs.map(bot => ({
            _id: bot._id.toString(),
            username: bot.username,
            profile: this._assignProfile(),
            online: false,
            sessionEnd: 0,
            nextOnlineAt: 0,
        }));
        this._tickInterval = null;
        this._initRandomStart();
    }

    _assignProfile() {
        const r = Math.random();
        if (r < 0.20) return 'heavy';
        if (r < 0.60) return 'regular';
        if (r < 0.90) return 'casual';
        return 'sporadic';
    }

    _initRandomStart() {
        const now = Date.now();
        for (const bot of this.bots) {
            const maxDelay = this._profileMaxOffline(bot.profile);
            bot.nextOnlineAt = now + Math.random() * Math.min(maxDelay, 7200000);
        }
    }

    _profileMaxOffline(profile) {
        switch (profile) {
            case 'heavy': return 4 * 3600000;
            case 'regular': return 48 * 3600000;
            case 'casual': return 14 * 24 * 3600000;
            case 'sporadic': return 28 * 24 * 3600000;
            default: return 3600000;
        }
    }

    _sessionLength(profile) {
        switch (profile) {
            case 'heavy': return 900000 + Math.random() * 4500000;
            case 'regular': return 1200000 + Math.random() * 2400000;
            case 'casual': return 1800000 + Math.random() * 5400000;
            case 'sporadic': return 900000 + Math.random() * 1800000;
            default: return 600000;
        }
    }

    _offlineDuration(profile) {
        switch (profile) {
            case 'heavy': return 1800000 + Math.random() * 14400000;
            case 'regular': return 7200000 + Math.random() * 172800000;
            case 'casual': return 259200000 + Math.random() * 1209600000;
            case 'sporadic': return 604800000 + Math.random() * 2419200000;
            default: return 3600000;
        }
    }

    _profileOnlineChance(profile) {
        switch (profile) {
            case 'heavy': return 0.85;
            case 'regular': return 0.50;
            case 'casual': return 0.20;
            case 'sporadic': return 0.05;
            default: return 0.5;
        }
    }

    start() {
        this._tick();
        this._tickInterval = setInterval(() => this._tick(), 60000);
    }

    stop() {
        if (this._tickInterval) {
            clearInterval(this._tickInterval);
            this._tickInterval = null;
        }
    }

    _tick() {
        const now = Date.now();
        for (const bot of this.bots) {
            if (bot.online) {
                if (now >= bot.sessionEnd) {
                    bot.online = false;
                    const offline = this._offlineDuration(bot.profile);
                    const jitter = offline * (0.5 + Math.random());
                    bot.nextOnlineAt = now + jitter;
                }
            } else {
                if (now >= bot.nextOnlineAt) {
                    const chance = this._profileOnlineChance(bot.profile);
                    if (Math.random() < chance) {
                        bot.online = true;
                        bot.sessionEnd = now + this._sessionLength(bot.profile);
                    } else {
                        bot.nextOnlineAt = now + this._offlineDuration(bot.profile) * 0.3;
                    }
                }
            }
        }
    }

    getOnlineBots() {
        return this.bots.filter(b => b.online).map(b => ({
            name: b.username,
            _id: b._id,
        }));
    }

    getOnlineCount() {
        return this.bots.filter(b => b.online).length;
    }

    getStats() {
        const counts = { heavy: 0, regular: 0, casual: 0, sporadic: 0 };
        for (const b of this.bots) counts[b.profile]++;
        return {
            totalBots: this.bots.length,
            online: this.getOnlineCount(),
            profiles: counts,
        };
    }
}

module.exports = BotPresenceManager;
