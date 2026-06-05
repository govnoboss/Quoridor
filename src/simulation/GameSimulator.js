const { GUEST_BOTS, randomGuestBot } = require('../bots/defaultBots');

class GameSimulator {
    constructor({ Shared, AICore, User, GameResult, BotActivitySchedule, PresenceSimulator, logger } = {}) {
        this.Shared = Shared;
        this.AICore = AICore;
        this.User = User;
        this.GameResult = GameResult;
        this.schedule = BotActivitySchedule;
        this.presence = PresenceSimulator;
        this.logger = logger || console;

        this.rankedBotIds = [];
        this.guestBotIds = [];
        this.botNameMap = {};

        this.activeGames = new Map();
        this._createInterval = null;
        this._tickInterval = null;

        this.GAMES_PER_BOT_PER_DAY = 10;
        this.MAX_CONCURRENT_GAMES = 15;
        this.MIN_GAMES = 5;
        this.TICK_INTERVAL_MS = 2000;
        this.CREATE_INTERVAL_MS = 15000;
    }

    start(rankedBotDocs) {
        this.rankedBotIds = rankedBotDocs.map(b => b._id.toString());
        this.guestBotIds = GUEST_BOTS.map((_, i) => `guest-${i}`);
        for (const bot of rankedBotDocs) {
            this.botNameMap[bot._id.toString()] = bot.username;
        }

        if (this.Shared) this.AICore.init(this.Shared);

        this._tickInterval = setInterval(() => this._tickActiveGames(), this.TICK_INTERVAL_MS);
        this._createInterval = setInterval(() => this._tryCreateGame(), this.CREATE_INTERVAL_MS);
    }

    stop() {
        if (this._tickInterval) clearInterval(this._tickInterval);
        if (this._createInterval) clearInterval(this._createInterval);
        this.activeGames.clear();
    }

    _tryCreateGame() {
        if (this.activeGames.size >= this.MAX_CONCURRENT_GAMES) return;
        if (this.activeGames.size >= this.MIN_GAMES && Math.random() > 0.4) return;

        const useRanked = Math.random() < 0.65;
        const pool = useRanked ? this.rankedBotIds : this.guestBotIds;

        if (pool.length < 2) return;

        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        let botA = null;
        let botB = null;

        for (const id of shuffled) {
            if (this._isBotBusy(id)) continue;
            if (!this.schedule.isOnline(id)) continue;
            if (useRanked && this.schedule.getGamesPlayedToday(id) >= this.GAMES_PER_BOT_PER_DAY) continue;
            if (botA === null) botA = id;
            else if (botB === null) { botB = id; break; }
        }

        if (botA === null || botB === null) return;

        const gameId = `sim-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        this.activeGames.set(gameId, {
            id: gameId,
            botAId: botA,
            botBId: botB,
            isRanked: useRanked,
            state: null,
            aiReady: false,
            currentMoveIdx: 0,
            difficultyA: this._difficultyForBot(botA),
            difficultyB: this._difficultyForBot(botB),
            finished: false,
            createdAt: Date.now(),
        });

        this.schedule.markJustPlayed(botA);
        this.schedule.markJustPlayed(botB);

        this._initGame(gameId);
    }

    async _initGame(gameId) {
        const game = this.activeGames.get(gameId);
        if (!game) return;

        try {
            const state = this.Shared.createInitialState({ base: 600, inc: 2 }, game.isRanked);
            state.hasBot = true;

            if (game.isRanked) {
                const userA = await this.User.findById(game.botAId);
                const userB = await this.User.findById(game.botBId);
                const aTemplate = userA || { username: 'BotA', rating: 1200 };
                const bTemplate = userB || { username: 'BotB', rating: 1200 };
                state.playerProfiles = [
                    { name: aTemplate.username, rating: aTemplate.rating, isBot: true },
                    { name: bTemplate.username, rating: bTemplate.rating, isBot: true },
                ];
            } else {
                const guestA = GUEST_BOTS[parseInt(game.botAId.replace('guest-', ''))] || randomGuestBot();
                const guestB = GUEST_BOTS[parseInt(game.botBId.replace('guest-', ''))] || randomGuestBot();
                state.playerProfiles = [
                    { name: guestA.name, rating: guestA.rating, isBot: true },
                    { name: guestB.name, rating: guestB.rating, isBot: true },
                ];
            }

            game.state = state;
            game.aiReady = true;
        } catch (err) {
            this.logger.error('[SIM] Failed to init game:', err);
            this.activeGames.delete(gameId);
        }
    }

    async _tickActiveGames() {
        for (const [gameId, game] of this.activeGames) {
            if (!game.aiReady || game.finished) continue;

            const state = game.state;
            const over = this.Shared.isGameOver(state);

            if (over.over) {
                await this._finalizeGame(gameId, over);
                continue;
            }

            const botIdx = state.currentPlayer;
            const difficulty = botIdx === 0 ? game.difficultyA : game.difficultyB;

            try {
                const move = this.AICore.think(state, botIdx, difficulty);
                if (!move) {
                    this.logger.warn(`[SIM] AI returned null move for ${gameId}`);
                    continue;
                }

                const newState = this.Shared.gameReducer(state, { ...move, playerIdx: botIdx });
                game.state = newState;
                game.currentMoveIdx++;

                if (this.Shared.isGameOver(newState).over) {
                    await this._finalizeGame(gameId, this.Shared.isGameOver(newState));
                }
            } catch (err) {
                this.logger.error(`[SIM] Move error ${gameId}:`, err);
                this.activeGames.delete(gameId);
            }
        }

        this._updatePresence();
    }

    async _finalizeGame(gameId, over) {
        const game = this.activeGames.get(gameId);
        if (!game || game.finished) return;
        game.finished = true;

        try {
            const winnerIdx = over.winner;
            const reason = over.reason || 'goal';

            if (game.isRanked) {
                await this._archiveRankedGame(game, winnerIdx, reason);
            } else {
                await this._archiveGuestGame(game, winnerIdx, reason);
            }
        } catch (err) {
            this.logger.error(`[SIM] Finalize error ${gameId}:`, err);
        }

        this.activeGames.delete(gameId);
    }

    async _archiveRankedGame(game, winnerIdx, reason) {
        const userA = await this.User.findById(game.botAId);
        const userB = await this.User.findById(game.botBId);
        if (!userA || !userB) return;

        userA.stats = userA.stats || { totalGames: 0, wins: 0, losses: 0 };
        userB.stats = userB.stats || { totalGames: 0, wins: 0, losses: 0 };
        userA.stats.totalGames++;
        userB.stats.totalGames++;

        if (winnerIdx === 0) { userA.stats.wins++; userB.stats.losses++; }
        else if (winnerIdx === 1) { userB.stats.wins++; userA.stats.losses++; }

        const s0 = winnerIdx === 0 ? 1 : winnerIdx === 1 ? 0 : 0.5;
        const changeA = this._calculateElo(userA.rating, userB.rating, s0);
        const changeB = this._calculateElo(userB.rating, userA.rating, 1 - s0);
        userA.rating += changeA;
        userB.rating += changeB;

        await userA.save();
        await userB.save();

        await new this.GameResult({
            gameType: 'bot',
            isRanked: true,
            playerWhite: { id: userA._id, username: userA.username, ratingChange: changeA },
            playerBlack: { id: userB._id, username: userB.username, ratingChange: changeB },
            winner: winnerIdx,
            reason,
            turns: Math.ceil((game.state.history?.length || 0) / 2),
            history: game.state.history || [],
        }).save();
    }

    async _archiveGuestGame(game, winnerIdx, reason) {
        await new this.GameResult({
            gameType: 'bot',
            isRanked: false,
            playerWhite: { id: null, username: game.state.playerProfiles[0]?.name || 'Guest', isGuest: true, ratingChange: 0 },
            playerBlack: { id: null, username: game.state.playerProfiles[1]?.name || 'Guest', isGuest: true, ratingChange: 0 },
            winner: winnerIdx,
            reason,
            turns: Math.ceil((game.state.history?.length || 0) / 2),
            history: [],
        }).save();
    }

    _calculateElo(ratingA, ratingB, scoreA) {
        const K = 40;
        const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
        return Math.round(K * (scoreA - expectedA));
    }

    _difficultyForBot(botId) {
        if (typeof botId === 'string' && botId.startsWith('guest-')) return 'easy';
        return 'medium';
    }

    _isBotBusy(botId) {
        for (const [, game] of this.activeGames) {
            if (!game.finished && (game.botAId === botId || game.botBId === botId)) return true;
        }
        return false;
    }

    _updatePresence() {
        const bots = [];
        const games = [];

        for (const [gameId, game] of this.activeGames) {
            if (!game.aiReady || game.finished) continue;
            const profiles = game.state?.playerProfiles;
            if (!profiles) continue;
            games.push({
                lobbyId: gameId,
                players: [
                    { name: profiles[0]?.name || '?', isBot: true },
                    { name: profiles[1]?.name || '?', isBot: true },
                ],
            });
        }

        const onlineBotIds = this.schedule.getOnlineBotIds();
        const inGameIds = new Set();
        for (const [, game] of this.activeGames) {
            if (!game.finished) {
                inGameIds.add(game.botAId);
                inGameIds.add(game.botBId);
            }
        }

        for (const id of onlineBotIds) {
            if (typeof id === 'string' && id.startsWith('guest-')) {
                const idx = parseInt(id.replace('guest-', ''));
                const guest = GUEST_BOTS[idx] || randomGuestBot();
                bots.push({ name: guest.name, isBot: true, inQueue: Math.random() < 0.3 });
            } else {
                const isPlaying = inGameIds.has(id);
                const name = this.botNameMap[id] || id;
                bots.push({ name, isBot: true, inQueue: !isPlaying && Math.random() < 0.3 });
            }
        }

        if (this.presence) {
            this.presence.setBotPresence(bots, games);
        }
    }

    async refreshBotNames() {
        const docs = await this.User.find({ isBot: true, seedId: { $regex: /^qbot-/ } });
        for (const bot of docs) {
            this.botNameMap[bot._id.toString()] = bot.username;
        }
    }

    getStats() {
        return {
            activeGames: this.activeGames.size,
            maxConcurrent: this.MAX_CONCURRENT_GAMES,
        };
    }
}

module.exports = GameSimulator;
