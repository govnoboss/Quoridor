const { fork } = require('child_process');
const path = require('path');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

class BotManager {
    constructor() {
        this.activeBots = new Map(); // botId -> { process, user }
    }

    async spawnBot(difficulty = 'medium', isRanked = false) {
        try {
            // 1. Create Bot User in DB
            const botName = `Bot_${difficulty}_${Math.floor(Math.random() * 10000)}`;
            const user = new User({
                username: botName,
                passwordHash: 'BOT_SECURE_HASH', // No real login possible
                isBot: true,
                rating: 1200, // Or adjusted based on difficulty?
                country: 'AI'
            });
            await user.save();

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
                    SERVER_URL: `http://localhost:${process.env.PORT || 3000}`,
                    PLAYER_TOKEN: token,
                    BOT_DIFFICULTY: difficulty,
                    IS_RANKED: String(isRanked)
                }
            });

            const botId = user._id.toString();

            this.activeBots.set(botId, {
                process: child,
                user: user,
                startedAt: Date.now()
            });

            console.log(`[BOT-MANAGER] Spawned bot ${botName} (ID: ${botId})`);

            child.on('exit', (code) => {
                console.log(`[BOT-MANAGER] Bot ${botName} exited with code ${code}`);
                this.activeBots.delete(botId);
                // Cleanup user? Or keep history? Currently keeping.
            });

            return { success: true, botId, username: botName };

        } catch (err) {
            console.error('[BOT-MANAGER] Failed to spawn bot:', err);
            return { success: false, error: err.message };
        }
    }

    killBot(botId) {
        const bot = this.activeBots.get(botId);
        if (bot && bot.process) {
            bot.process.kill();
            this.activeBots.delete(botId);
            return true;
        }
        return false;
    }

    getActiveBots() {
        return Array.from(this.activeBots.entries()).map(([id, data]) => ({
            id,
            username: data.user.username,
            startedAt: data.startedAt
        }));
    }
}

module.exports = new BotManager();
