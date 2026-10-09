const crypto = require('crypto');
const { createEngineV3, VARIETY_DEFAULT, DIFFICULTY_VARIETY } = require('../../quoridor-engine/engines/v3');
const { personality } = require('../../quoridor-engine/engines/personality');
const { botIdentity, styleOf, chooseBot } = require('./matchmaking');
const { difficultyToMaxDepth } = require('../core/ai-v1-bundle');
const { GUEST_BOTS } = require('./defaultBots');

function readBool(value, fallback = false) {
    if (value === undefined) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function readInt(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * A fresh engine for one game.
 *
 * One instance per game, never one per process: the transposition table is a Map that outlives a game
 * and its key does not contain the player index, so a shared instance lets one side read the other's
 * entries and score them as if they were its own. The engine also accumulates every position the game
 * visited (the hard ban on moving back into one), and a second game on the same instance would inherit
 * the first game's positions and reject legal moves. `require()` caches the module in Node, so a fresh
 * instance cannot be had by re-requiring it — hence the factory. finalizeGame() drops the instance on
 * every game end, so the map never survives into a rematch.
 *
 * The tiers differ only by search depth, keyed by the difficulty label (DIFFICULTY_DEPTH in
 * src/core/ai-v1-bundle.js). Every tier runs the same full eval, so nothing about the eval is overridden
 * here and the site gets exactly what the arena measures.
 *
 * The engine is fully deterministic, so two games from the start position with the same settings would
 * be the same line. That is fixed on two levels, both required: (1) a fresh random seed per game, so the
 * seeded rng used by the opening-variety test differs every game; (2) personality(botId), a small
 * deterministic weight shift so different bot accounts have recognisably different styles even before
 * the seed. Drop either one and the openings collapse (see engines/v3 VARIETY_DEFAULT).
 */
function createBotEngine(difficulty, botId) {
    const seed = crypto.randomInt(1, 0x7fffffff);
    const { weights, archetypes } = personality(botId || `tier-${difficulty}`);
    return createEngineV3({
        seed,
        maxDepth: difficultyToMaxDepth(difficulty),
        difficulty,
        weights,
        variety: DIFFICULTY_VARIETY[difficulty] || VARIETY_DEFAULT,
        archetype: { names: archetypes },
    });
}

/**
 * Guest bot candidates: the fixed template list, one normalized candidate per template. Each gets a
 * fresh token (a guest is re-created every match) but a STABLE identity from the template name, so the
 * matchmaker can recognise it across games and personality() gives it a consistent style.
 */
function guestBotCandidates() {
    return GUEST_BOTS.map((template) => {
        const identity = botIdentity({ kind: 'guest', name: template.name });
        return {
            token: `bot-${crypto.randomUUID()}`,
            isAccount: false,
            difficulty: template.difficulty,
            identity,
            style: styleOf(identity, template.difficulty),
            profile: {
                name: template.name,
                avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(template.name)}&background=random`,
            },
        };
    });
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

        this.botEngines = new Map();

        this.config = this.readConfig();
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
        this.botEngines.delete(lobbyId);
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

            const bot = await this.selectBot(isRanked, playerData);
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
                this.botEngines.set(lobbyId, createBotEngine(bot.difficulty, bot.identity || bot.token));

                await this.recordBotMatch(playerData.token);
                await this.recordBotOpponent(playerData.token, bot);
                return true;
            }
        } catch (err) {
            console.error('[BOT] Failed to start fallback match:', err);
        }
        return false;
    }

    async selectBot(isRanked, playerData) {
        const recent = playerData?.token ? await this.Redis.getBotOpponents(playerData.token) : [];
        const accounts = await this.accountBotCandidates();

        if (isRanked) {
            return chooseBot(accounts, recent);
        }

        // Unranked keeps the existing mix (mostly account bots, sometimes a fresh guest identity); the
        // matchmaker then spreads the choice within whichever class was drawn.
        if (accounts.length > 0 && Math.random() < 0.45) {
            const accountBot = chooseBot(accounts, recent);
            if (accountBot) return accountBot;
        }

        const guest = chooseBot(guestBotCandidates(), recent);
        if (guest) return guest;
        return chooseBot(accounts, recent);
    }

    async accountBotCandidates() {
        try {
            const bots = await this.User.find({ isBot: true });
            if (!bots || bots.length === 0) return [];

            return bots.map((user) => {
                const difficulty = this.difficultyForRating(user.rating || 1200);
                const identity = botIdentity({ kind: 'account', userId: user._id });
                return {
                    token: `bot-${crypto.randomUUID()}`,
                    isAccount: true,
                    userId: user._id,
                    difficulty,
                    identity,
                    style: styleOf(identity, difficulty),
                    profile: {
                        name: user.username,
                        avatar: user.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}&background=random`,
                        rating: user.rating || 1200,
                    },
                };
            });
        } catch (err) {
            console.error('[BOT] Failed to load account bots:', err);
            return [];
        }
    }

    /** Remember which bot (and style) the player just faced, for the next matchmaking call. */
    async recordBotOpponent(token, bot) {
        if (!token || !bot || !bot.identity) return;
        try {
            await this.Redis.recordBotOpponent(token, {
                id: bot.identity,
                difficulty: bot.difficulty,
                style: bot.style,
                at: Date.now(),
            }, this.config.recentWindowMs);
        } catch (err) {
            console.error('[BOT] Failed to record opponent:', err);
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
            const maxDepth = difficultyToMaxDepth(difficulty);

            // `startBotGame` registers the engine right after the lobby exists, but the first move is
            // scheduled with a human-like delay, so this lazily-built fallback is what actually covers
            // any path that reaches makeMove without one (restored lobby, hot reload, test stub).
            let engine = this.botEngines.get(lobbyId);
            if (!engine) {
                engine = createBotEngine(difficulty, game.botIdentity || game.playerTokens[botIdx]);
                this.botEngines.set(lobbyId, engine);
            }

            const result = engine.think(game, {
                player: botIdx,
                maxDepth,
            });

            const move = result && result.move;
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
