const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const DATA_DIR = path.join(__dirname, '../../data');
const STATE_FILE = path.join(DATA_DIR, 'active_bots.json');

class BotManager {
    constructor() {
        this.activeBots = new Map(); // botId -> { process, user }
        this.ensureDataDir();
    }

    ensureDataDir() {
        if (!fs.existsSync(DATA_DIR)) {
            try {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            } catch (err) {
                console.error('[BOT-MANAGER] Failed to create data dir:', err);
            }
        }
    }

    // --- Persistence Methods ---

    loadState() {
        try {
            if (!fs.existsSync(STATE_FILE)) return [];
            const data = fs.readFileSync(STATE_FILE, 'utf8');
            return JSON.parse(data);
        } catch (err) {
            console.error('[BOT-MANAGER] Failed to load state:', err);
            return [];
        }
    }

    saveState() {
        try {
            const botsToSave = Array.from(this.activeBots.values()).map(b => ({
                id: b.user._id.toString(),
                username: b.user.username,
                difficulty: b.difficulty,
                isRanked: b.isRanked,
                isPaused: b.isPaused
            }));
            fs.writeFileSync(STATE_FILE, JSON.stringify(botsToSave, null, 2));
        } catch (err) {
            console.error('[BOT-MANAGER] Failed to save state:', err);
        }
    }

    // --- Core Methods ---

    async restoreBots() {
        const savedBots = this.loadState();
        if (savedBots.length === 0) return;

        console.log(`[BOT-MANAGER] Restoring ${savedBots.length} bots...`);
        for (const botData of savedBots) {
            await this.spawnBot(botData.difficulty, botData.isRanked, botData.id, botData.isPaused);
        }
    }

    async spawnBot(difficulty = 'medium', isRanked = false, existingBotId = null, isPaused = false) {
        try {
            let user;

            if (existingBotId) {
                // Reuse existing user
                user = await User.findById(existingBotId);
                if (!user) {
                    console.warn(`[BOT-MANAGER] Saved bot ${existingBotId} not found in DB. Creating new.`);
                }
            }

            if (!user) {
                // Create New Bot User
                const botName = `Bot_${difficulty}_${Math.floor(Math.random() * 10000)}`;
                user = new User({
                    username: botName,
                    passwordHash: 'BOT_SECURE_HASH',
                    isBot: true,
                    rating: 1200, // could vary by difficulty or saved history
                    country: 'AI'
                });
                await user.save();
            }

            // 2. Generate Token
            const token = jwt.sign(
                { id: user._id, username: user.username },
                process.env.SESSION_SECRET || 'super_secret_quoridor_key_change_me',
                { expiresIn: '24h' }
            );

            // 3. Spawn Process
            const scriptPath = path.join(__dirname, '../bot/botRunner.js');
            const child = fork(scriptPath, [], {
                env: {
                    ...process.env,
                    SERVER_URL: `http://127.0.0.1:${process.env.PORT || 3000}`,
                    PLAYER_TOKEN: token,
                    BOT_DIFFICULTY: difficulty,
                    IS_RANKED: String(isRanked),
                    IS_PAUSED: String(isPaused)
                }
            });

            const botId = user._id.toString();

            this.activeBots.set(botId, {
                process: child,
                user: user,
                difficulty,
                isRanked,
                isPaused,
                startedAt: Date.now()
            });

            // Save state *after* successful spawn
            this.saveState();

            console.log(`[BOT-MANAGER] Spawned bot ${user.username} (ID: ${botId}) ${isPaused ? '[PAUSED]' : ''}`);

            child.on('exit', (code) => {
                console.log(`[BOT-MANAGER] Bot ${user.username} exited with code ${code}`);
                // Only remove from memory, check if intentional kill handled elsewhere
                if (this.activeBots.has(botId)) {
                    this.activeBots.delete(botId);
                    this.saveState(); // Update persistence if it crashed unexpectedly
                }
            });

            return { success: true, botId, username: user.username, isPaused };

        } catch (err) {
            console.error('[BOT-MANAGER] Failed to spawn bot:', err);
            return { success: false, error: err.message };
        }
    }

    toggleBot(botId) {
        const bot = this.activeBots.get(botId);
        if (!bot) return { success: false, error: 'Bot not found' };

        bot.isPaused = !bot.isPaused;
        this.saveState();
        return { success: true, isPaused: bot.isPaused };
    }

    killBot(botId) {
        const bot = this.activeBots.get(botId);
        if (bot && bot.process) {
            bot.process.kill();
            this.activeBots.delete(botId);
            this.saveState(); // Update persistence
            return true;
        }
        return false;
    }

    getActiveBots() {
        return Array.from(this.activeBots.entries()).map(([id, data]) => ({
            id,
            username: data.user.username,
            startedAt: data.startedAt,
            isPaused: data.isPaused
        }));
    }
}

module.exports = new BotManager();
