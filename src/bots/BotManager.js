const crypto = require('crypto');
const AICore = require('../core/ai-core');
const { GUEST_BOTS } = require('./defaultBots');

function readBool(value, fallback = false) {
    if (value === undefined) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function readInt(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function pickRandom(items) {
    if (!items.length) return null;
    return items[Math.floor(Math.random() * items.length)];
}

class BotManager {
    constructor({ Shared, Redis, User, io, startBotGame, applyBotMove } = {}) {
        this.Shared = Shared;
        this.Redis = Redis;
        this.User = User;
        this.io = io;
        this.startBotGame = startBotGame;
        this.applyBotMove = applyBotMove;

        this.fallbackTimers = new Map();
        this.moveTimers = new Map();
        this.botTokens = new Set();
        this.activeBotGames = new Set();
        this.runtimeConfig = null;

        this.config = this.readConfig();
        if (Shared) AICore.init(Shared);
    }

    envConfig() {
        const minWait = readInt(process.env.BOT_FALLBACK_MIN_WAIT_MS, 15000);
        const maxWait = readInt(process.env.BOT_FALLBACK_MAX_WAIT_MS, 25000);
        return {
            enabled: readBool(process.env.BOTS_ENABLED, false),
            rankedEnabled: readBool(process.env.BOT_RANKED_ENABLED, false),
            minWaitMs: Math.max(0, minWait),
            maxWaitMs: Math.max(minWait, maxWait),
            maxActiveGames: Math.max(0, readInt(process.env.BOT_MAX_ACTIVE_GAMES, 15)),
            minMoveDelayMs: Math.max(0, readInt(process.env.BOT_MOVE_MIN_DELAY_MS, 800)),
            maxMoveDelayMs: Math.max(0, readInt(process.env.BOT_MOVE_MAX_DELAY_MS, 2500)),
            maxRecentBotMatches: Math.max(0, readInt(process.env.BOT_MAX_RECENT_MATCHES, 3)),
            recentWindowMs: Math.max(60000, readInt(process.env.BOT_RECENT_WINDOW_MS, 60 * 60 * 1000)),
        };
    }

    readConfig() {
        return this.normalizeConfig({
            ...this.envConfig(),
            ...(this.runtimeConfig || {}),
        });
    }

    setRuntimeConfig(settings = null) {
        this.runtimeConfig = settings ? this.normalizeConfig(settings) : null;
        this.config = this.readConfig();
        return this.config;
    }

    getRuntimeStats() {
        return {
            activeBotGames: this.activeBotGames.size,
            activeBotGameIds: Array.from(this.activeBotGames),
            pendingFallbacks: this.fallbackTimers.size,
        };
    }

    normalizeConfig(settings) {
        const minWait = Math.max(0, readInt(settings.minWaitMs ?? settings.fallbackMinWaitMs, 15000));
        const maxWait = Math.max(minWait, readInt(settings.maxWaitMs ?? settings.fallbackMaxWaitMs, 25000));
        const minMoveDelay = Math.max(0, readInt(settings.minMoveDelayMs ?? settings.moveMinDelayMs, 800));
        const maxMoveDelay = Math.max(minMoveDelay, readInt(settings.maxMoveDelayMs ?? settings.moveMaxDelayMs, 2500));
        return {
            enabled: Boolean(settings.enabled),
            rankedEnabled: Boolean(settings.rankedEnabled),
            minWaitMs: minWait,
            maxWaitMs: maxWait,
            maxActiveGames: Math.max(0, readInt(settings.maxActiveGames, 15)),
            minMoveDelayMs: minMoveDelay,
            maxMoveDelayMs: maxMoveDelay,
            maxRecentBotMatches: Math.max(0, readInt(settings.maxRecentBotMatches ?? settings.maxRecentMatches, 3)),
            recentWindowMs: Math.max(60000, readInt(settings.recentWindowMs, 60 * 60 * 1000)),
        };
    }

    isEnabled() {
        this.config = this.readConfig();
        return this.config.enabled && this.config.maxActiveGames > 0;
    }

    scheduleFallback(socket, playerData, isRanked = false) {
        if (!this.isEnabled()) return false;
        if (isRanked && !this.config.rankedEnabled) return false;

        this.cancelFallback(playerData.token);

        const delay = this.randomDelay(this.config.minWaitMs, this.config.maxWaitMs);
        const timer = setTimeout(async () => {
            this.fallbackTimers.delete(playerData.token);
            await this.tryStartFallback(socket.id, playerData, isRanked);
        }, delay);

        this.fallbackTimers.set(playerData.token, timer);
        return true;
    }

    cancelFallback(token) {
        const timer = this.fallbackTimers.get(token);
        if (timer) clearTimeout(timer);
        this.fallbackTimers.delete(token);
    }

    cancelGame(lobbyId) {
        const timer = this.moveTimers.get(lobbyId);
        if (timer) clearTimeout(timer);
        this.moveTimers.delete(lobbyId);
        this.activeBotGames.delete(lobbyId);
    }

    isBotToken(token) {
        return this.botTokens.has(token) || (typeof token === 'string' && token.startsWith('bot-'));
    }

    isBotSlot(game, playerIdx) {
        return Boolean(game?.hasBot && game.botPlayerIdx === playerIdx);
    }

    async tryStartFallback(socketId, playerData, isRanked) {
        try {
            if (!this.isEnabled()) return false;
            if (isRanked && !this.config.rankedEnabled) return false;
            if (this.activeBotGames.size >= this.config.maxActiveGames) return false;

            const socket = this.io.sockets.sockets.get(socketId);
            if (!socket || socket.disconnected) return false;
            if (socket.searchToken !== playerData.token) return false;

            const removed = await this.Redis.removeFromQueue(
                playerData.timeControl.base,
                playerData.timeControl.inc,
                playerData.token,
                isRanked
            );
            if (!removed) return false;

            if (await this.isBotFarmLimited(playerData.token)) {
                await this.Redis.addToQueue(
                    playerData.timeControl.base,
                    playerData.timeControl.inc,
                    playerData,
                    isRanked
                );
                return false;
            }

            const bot = await this.selectBot(isRanked);
            if (!bot) {
                await this.Redis.addToQueue(
                    playerData.timeControl.base,
                    playerData.timeControl.inc,
                    playerData,
                    isRanked
                );
                return false;
            }

            const lobbyId = await this.startBotGame(socket, playerData, bot, isRanked);
            if (lobbyId) {
                this.activeBotGames.add(lobbyId);
                this.botTokens.add(bot.token);
                await this.recordBotMatch(playerData.token);
                return true;
            }
        } catch (err) {
            console.error('[BOT] Failed to start fallback match:', err);
        }
        return false;
    }

    async selectBot(isRanked) {
        if (isRanked) {
            const accountBot = await this.selectAccountBot();
            if (!accountBot) return null;
            return accountBot;
        }

        if (Math.random() < 0.45) {
            const accountBot = await this.selectAccountBot();
            if (accountBot) return accountBot;
        }

        const template = pickRandom(GUEST_BOTS);
        const token = `bot-${crypto.randomUUID()}`;
        return {
            token,
            isAccount: false,
            difficulty: template.difficulty,
            profile: {
                name: template.name,
                avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(template.name)}&background=random`,
                rating: template.rating,
            },
        };
    }

    async selectAccountBot() {
        try {
            const bots = await this.User.find({ isBot: true });
            if (!bots || bots.length === 0) return null;

            const user = pickRandom(bots);
            const difficulty = this.difficultyForRating(user.rating || 1200);
            return {
                token: `bot-${crypto.randomUUID()}`,
                isAccount: true,
                userId: user._id,
                difficulty,
                profile: {
                    name: user.username,
                    avatar: user.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}&background=random`,
                    rating: user.rating || 1200,
                },
            };
        } catch (err) {
            console.error('[BOT] Failed to load account bot:', err);
            return null;
        }
    }

    scheduleMoveIfNeeded(lobbyId, game) {
        if (!this.isEnabled() || !game?.hasBot) return false;
        if (!this.isBotSlot(game, game.currentPlayer)) return false;
        if (this.moveTimers.has(lobbyId)) return false;

        const delay = this.randomDelay(this.config.minMoveDelayMs, this.config.maxMoveDelayMs);
        const timer = setTimeout(async () => {
            this.moveTimers.delete(lobbyId);
            await this.makeMove(lobbyId);
        }, delay);

        this.moveTimers.set(lobbyId, timer);
        return true;
    }

    async makeMove(lobbyId) {
        try {
            const game = await this.Redis.getGame(lobbyId);
            if (!game || !game.hasBot || !this.isBotSlot(game, game.currentPlayer)) {
                return false;
            }

            const botIdx = game.botPlayerIdx;
            const difficulty = game.botDifficulty || 'medium';
            const move = AICore.think(game, botIdx, difficulty);
            if (!move) return false;

            return await this.applyBotMove(lobbyId, game.playerTokens[botIdx], move);
        } catch (err) {
            console.error(`[BOT] Move failed for ${lobbyId}:`, err);
            return false;
        }
    }

    randomDelay(min, max) {
        if (max <= min) return min;
        return min + Math.floor(Math.random() * (max - min + 1));
    }

    difficultyForRating(rating) {
        if (rating < 1100) return 'easy';
        if (rating >= 1450) return 'hard';
        return 'medium';
    }

    async isBotFarmLimited(token) {
        if (!this.config.maxRecentBotMatches) return false;
        const count = await this.Redis.getBotRecentMatchCount(token);
        return count >= this.config.maxRecentBotMatches;
    }

    async recordBotMatch(token) {
        if (!this.config.maxRecentBotMatches) return;
        await this.Redis.incrementBotRecentMatchCount(token, this.config.recentWindowMs);
    }
}

module.exports = BotManager;
