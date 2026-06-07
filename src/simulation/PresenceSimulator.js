class PresenceSimulator {
    constructor({ onlineMin = 100, onlineMax = 200, stepIntervalMs = 45000 } = {}) {
        this.onlineMin = onlineMin;
        this.onlineMax = onlineMax;
        this.stepIntervalMs = stepIntervalMs;

        this.simulatedOnlineCount = Math.floor((onlineMin + onlineMax) / 2);
        this.currentBots = [];
        this.currentGames = [];

        this._interval = null;
    }

    start() {
        this._step();
        this._interval = setInterval(() => this._step(), this.stepIntervalMs);
    }

    stop() {
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
    }

    _step() {
        const delta = Math.floor(Math.random() * 11) - 5;
        this.simulatedOnlineCount = Math.max(this.onlineMin, Math.min(this.onlineMax, this.simulatedOnlineCount + delta));
    }

    setBotPresence(bots, games) {
        this.currentBots = bots;
        this.currentGames = games;
    }

    getPresence(realHumansCount) {
        const online = Math.max(this.simulatedOnlineCount, realHumansCount);
        return {
            online,
            playing: this.currentGames.length * 2,
            bots: this.currentBots,
            liveGames: this.currentGames,
        };
    }

    getStats() {
        return {
            simulatedOnline: this.simulatedOnlineCount,
            botPresenceCount: this.currentBots.length,
            activeSimGames: this.currentGames.length,
        };
    }
}

module.exports = PresenceSimulator;
