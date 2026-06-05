class BotActivitySchedule {
    constructor(botIds) {
        this.bots = new Map();
        this.gamesToday = new Map();
        this.lastDateCheck = Date.now();

        for (const id of botIds) {
            this.bots.set(id, {
                isOnline: Math.random() < 0.6,
                nextFlipAt: this._randomFutureTime(30, 90),
                cooldownUntil: 0,
            });
        }
    }

    _randomFutureTime(minMinutes, maxMinutes) {
        return Date.now() + (minMinutes + Math.random() * (maxMinutes - minMinutes)) * 60 * 1000;
    }

    _resetDailyIfNeeded() {
        const now = Date.now();
        const today = new Date().toDateString();
        const lastDay = new Date(this.lastDateCheck).toDateString();
        if (today !== lastDay) {
            this.gamesToday.clear();
            this.lastDateCheck = now;
        }
    }

    update() {
        this._resetDailyIfNeeded();
        const now = Date.now();

        for (const [, state] of this.bots) {
            if (now >= state.nextFlipAt) {
                state.isOnline = Math.random() < 0.6;
                state.nextFlipAt = this._randomFutureTime(30, 90);
            }
        }
    }

    isOnline(botId) {
        const state = this.bots.get(botId);
        if (!state) return false;
        if (!state.isOnline) return false;
        if (Date.now() < state.cooldownUntil) return false;
        if (this.getGamesPlayedToday(botId) >= 10) return false;
        return true;
    }

    markJustPlayed(botId) {
        const state = this.bots.get(botId);
        if (!state) return;
        const cooldownMin = 10 + Math.random() * 20;
        state.cooldownUntil = Date.now() + cooldownMin * 60 * 1000;
        const today = new Date().toDateString();
        const key = `${botId}:${today}`;
        this.gamesToday.set(key, (this.gamesToday.get(key) || 0) + 1);
    }

    getGamesPlayedToday(botId) {
        const today = new Date().toDateString();
        const key = `${botId}:${today}`;
        return this.gamesToday.get(key) || 0;
    }

    getOnlineBotIds() {
        this.update();
        const online = [];
        for (const [id, state] of this.bots) {
            if (state.isOnline) online.push(id);
        }
        return online;
    }

    getAvailableBotIds() {
        this.update();
        const available = [];
        for (const [id] of this.bots) {
            if (this.isOnline(id)) available.push(id);
        }
        return available;
    }

    getStats() {
        this.update();
        let online = 0;
        let inCooldown = 0;
        let atLimit = 0;
        const now = Date.now();
        for (const [id, state] of this.bots) {
            if (state.isOnline) online++;
            if (now < state.cooldownUntil) inCooldown++;
            if (this.getGamesPlayedToday(id) >= 10) atLimit++;
        }
        return {
            totalBots: this.bots.size,
            online,
            inCooldown,
            atDailyLimit: atLimit,
        };
    }
}

module.exports = BotActivitySchedule;
