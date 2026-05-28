/**
 * Redis Wrapper Module для Quoridor
 *
 * При недоступности Redis автоматически переключается на in-memory хранилище
 * для локальной разработки без внешних зависимостей.
 */

const redis = require('redis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const TTL = {
    GAME: 2 * 60 * 60,
    TOKEN_MAPPING: 2 * 60 * 60,
    ROOM: 30 * 60,
    REMATCH: 5 * 60,
};

const KEYS = {
    GAME: (lobbyId) => `game:${lobbyId}`,
    TOKEN: (token) => `token:${token}`,
    ROOM: (code) => `room:${code}`,
        QUEUE: (base, inc, isRanked) => `queue:${isRanked ? 'ranked' : 'casual'}:${base}:${inc}`,
        LOBBY_COUNTER: 'global:lobby_id',
        ACTIVE_GAMES: 'global:active_games',
        DISCONNECT_TIMERS: 'timers:disconnect',
        TURN_TIMEOUTS: 'timers:turn',
        TOKEN_USER_MAP: 'token:user:',
        REMATCH: (lobbyId) => `rematch:${lobbyId}`,
    };

// ============================================================
// IN-MEMORY STORE (fallback when Redis is unavailable)
// ============================================================

class MemoryStore {
    constructor() {
        this.games = new Map();
        this.activeGames = new Set();
        this.locks = new Map();
        this.tokenMappings = new Map();
        this.rooms = new Map();
        this.queues = new Map();
        this.disconnectTimers = new Map();
        this.turnTimeouts = new Map();
        this.tokenUserMapping = new Map();
        this.rematchContexts = new Map();
        this.lobbyCounter = 0;
        this.connected = false;
    }

    connect() {
        this.connected = true;
    }

    disconnect() {
        this.connected = false;
    }

    isReady() {
        return this.connected;
    }

    saveGame(lobbyId, state) {
        const cleanState = { ...state, disconnectTimer: null };
        this.games.set(lobbyId, cleanState);
    }

    getGame(lobbyId) {
        const data = this.games.get(lobbyId);
        if (!data) return null;
        return { ...data, disconnectTimer: null };
    }

    deleteGame(lobbyId) {
        this.games.delete(lobbyId);
    }

    getAllGameIds() {
        return Array.from(this.games.keys());
    }

    addActiveGame(lobbyId) {
        this.activeGames.add(lobbyId);
    }

    removeActiveGame(lobbyId) {
        this.activeGames.delete(lobbyId);
    }

    getActiveGameIds() {
        return Array.from(this.activeGames);
    }

    acquireLock(lobbyId, ttlMs = 2000) {
        const lockKey = `lock:${lobbyId}`;
        if (this.locks.has(lockKey)) {
            const expiry = this.locks.get(lockKey);
            if (Date.now() < expiry) return false;
        }
        this.locks.set(lockKey, Date.now() + ttlMs);
        return true;
    }

    releaseLock(lobbyId) {
        this.locks.delete(`lock:${lobbyId}`);
    }

    setTokenMapping(token, lobbyId) {
        this.tokenMappings.set(token, lobbyId);
    }

    getLobbyByToken(token) {
        return this.tokenMappings.get(token) || null;
    }

    deleteTokenMapping(token) {
        this.tokenMappings.delete(token);
    }

    incrementLobbyCounter() {
        this.lobbyCounter++;
        return this.lobbyCounter;
    }

    getLobbyCounter() {
        return this.lobbyCounter;
    }

    createRoom(code, roomData) {
        this.rooms.set(code, { ...roomData, createdAt: Date.now() });
    }

    getRoom(code) {
        return this.rooms.get(code) || null;
    }

    updateRoom(code, roomData) {
        this.rooms.set(code, { ...roomData, createdAt: this.rooms.get(code)?.createdAt || Date.now() });
    }

    deleteRoom(code) {
        this.rooms.delete(code);
    }

    addToQueue(base, inc, playerData, isRanked = false) {
        const key = KEYS.QUEUE(base, inc, isRanked);
        if (!this.queues.has(key)) this.queues.set(key, []);
        this.queues.get(key).push(JSON.stringify(playerData));
    }

    async removeFromQueue(base, inc, token, isRanked = false) {
        const key = KEYS.QUEUE(base, inc, isRanked);
        const queue = this.queues.get(key);
        if (!queue) return false;
        for (let i = queue.length - 1; i >= 0; i--) {
            const data = JSON.parse(queue[i]);
            if (data.token === token) {
                queue.splice(i, 1);
                return true;
            }
        }
        return false;
    }

    async popTwoFromQueue(base, inc, isRanked = false) {
        const key = KEYS.QUEUE(base, inc, isRanked);
        const queue = this.queues.get(key);
        if (!queue || queue.length < 2) return null;
        const p1Data = queue.shift();
        const p2Data = queue.shift();
        return [JSON.parse(p1Data), JSON.parse(p2Data)];
    }

    getAllQueueKeys() {
        return Array.from(this.queues.keys()).filter(k => k.startsWith('queue:'));
    }

    async removeFromAllQueues(token) {
        for (const [key, queue] of this.queues.entries()) {
            if (!key.startsWith('queue:')) continue;
            for (let i = queue.length - 1; i >= 0; i--) {
                const data = JSON.parse(queue[i]);
                if (data.token === token) {
                    queue.splice(i, 1);
                }
            }
        }
    }

    setDisconnectTimer(lobbyId, delayMs) {
        this.disconnectTimers.set(lobbyId, Date.now() + delayMs);
    }

    clearDisconnectTimer(lobbyId) {
        this.disconnectTimers.delete(lobbyId);
    }

    getExpiredDisconnectTimers() {
        const now = Date.now();
        const expired = [];
        for (const [lobbyId, time] of this.disconnectTimers.entries()) {
            if (time <= now) expired.push(lobbyId);
        }
        return expired;
    }

    hasDisconnectTimer(lobbyId) {
        return this.disconnectTimers.has(lobbyId);
    }

    setTurnTimeout(lobbyId, timeoutAt) {
        this.turnTimeouts.set(lobbyId, timeoutAt);
    }

    clearTurnTimeout(lobbyId) {
        this.turnTimeouts.delete(lobbyId);
    }

    getExpiredTurnTimeouts() {
        const now = Date.now();
        const expired = [];
        for (const [lobbyId, time] of this.turnTimeouts.entries()) {
            if (time <= now) expired.push(lobbyId);
        }
        return expired;
    }

    saveRematchContext(lobbyId, context) {
        this.rematchContexts.set(lobbyId, { ...context, createdAt: Date.now() });
    }

    getRematchContext(lobbyId) {
        const ctx = this.rematchContexts.get(lobbyId);
        if (!ctx) return null;
        if (Date.now() - ctx.createdAt > TTL.REMATCH * 1000) {
            this.rematchContexts.delete(lobbyId);
            return null;
        }
        return ctx;
    }

    deleteRematchContext(lobbyId) {
        this.rematchContexts.delete(lobbyId);
    }

    setTokenUserMapping(token, userId) {
        this.tokenUserMapping.set(token, userId.toString());
    }

    getUserIdByToken(token) {
        return this.tokenUserMapping.get(token) || null;
    }

    deleteTokenUserMapping(token) {
        this.tokenUserMapping.delete(token);
    }
}

// ============================================================
// REDIS CLIENT
// ============================================================

let client = null;
let isConnected = false;
let memoryStore = null;

async function connect() {
    if (client && isConnected) {
        return client;
    }

    // Always create memory store first as fallback
    memoryStore = new MemoryStore();
    memoryStore.connect();

    // Try Redis — on success the memory store will be unused
    if (!process.env.REDIS_DISABLE_MEMORY_FALLBACK) {
        try {
            const c = redis.createClient({
                url: REDIS_URL,
                socket: {
                    connectTimeout: 3000,
                    reconnectStrategy: () => false,
                }
            });

            c.on('error', () => {});
            c.on('connect', () => {
                console.log('[REDIS] Connected to Redis server');
                isConnected = true;
            });

            // Quick connection test
            await Promise.race([
                c.connect(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
            ]);

            // Verify connection works
            await c.ping();
            client = c;
            return client;
        } catch (err) {
            console.warn('[REDIS] Redis unavailable (' + err.message + ') — using in-memory storage');
            if (client) { client = null; }
            isConnected = false;
        }
    } else {
        console.log('[REDIS] Using in-memory storage (data will not persist after restart)');
    }

    return null;
}

function disconnect() {
    if (memoryStore) {
        memoryStore.disconnect();
        memoryStore = null;
    }
    if (client) {
        client.quit();
        client = null;
        isConnected = false;
    }
}

function isReady() {
    return isConnected || (memoryStore && memoryStore.isReady());
}

function getStore() {
    if (client && isConnected) return client;
    if (memoryStore && memoryStore.isReady()) return memoryStore;
    return null;
}

function isMemoryMode() {
    return (!client || !isConnected) && memoryStore !== null && memoryStore.isReady();
}

// ============================================================
// WRAPPER METHODS
// ============================================================

async function saveGame(lobbyId, state) {
    const store = getStore();
    if (!store) return;
    if (isMemoryMode()) return store.saveGame(lobbyId, state);
    const cleanState = { ...state, disconnectTimer: null };
    await store.setEx(KEYS.GAME(lobbyId), TTL.GAME, JSON.stringify(cleanState));
}

async function getGame(lobbyId) {
    const store = getStore();
    if (!store) return null;
    if (isMemoryMode()) return store.getGame(lobbyId);
    const data = await store.get(KEYS.GAME(lobbyId));
    if (!data) return null;
    const state = JSON.parse(data);
    state.disconnectTimer = null;
    return state;
}

async function deleteGame(lobbyId) {
    const store = getStore();
    if (!store) return;
    if (isMemoryMode()) return store.deleteGame(lobbyId);
    await store.del(KEYS.GAME(lobbyId));
}

async function getAllGameIds() {
    const store = getStore();
    if (!store) return [];
    if (isMemoryMode()) return store.getAllGameIds();
    const keys = await store.keys('game:*');
    return keys.map(key => key.replace('game:', ''));
}

async function addActiveGame(lobbyId) {
    const store = getStore();
    if (!store) return;
    if (isMemoryMode()) return store.addActiveGame(lobbyId);
    await store.sAdd(KEYS.ACTIVE_GAMES, lobbyId);
}

async function removeActiveGame(lobbyId) {
    const store = getStore();
    if (!store) return;
    if (isMemoryMode()) return store.removeActiveGame(lobbyId);
    await store.sRem(KEYS.ACTIVE_GAMES, lobbyId);
}

async function getActiveGameIds() {
    const store = getStore();
    if (!store) return [];
    if (isMemoryMode()) return store.getActiveGameIds();
    return await store.sMembers(KEYS.ACTIVE_GAMES);
}

async function acquireLock(lobbyId, ttlMs = 2000) {
    const store = getStore();
    if (!store) return false;
    if (isMemoryMode()) return store.acquireLock(lobbyId, ttlMs);
    const lockKey = `lock:${lobbyId}`;
    const result = await store.set(lockKey, 'locked', { NX: true, PX: ttlMs });
    return result === 'OK';
}

async function releaseLock(lobbyId) {
    const store = getStore();
    if (!store) return;
    if (isMemoryMode()) return store.releaseLock(lobbyId);
    await store.del(`lock:${lobbyId}`);
}

async function setTokenMapping(token, lobbyId) {
    const store = getStore();
    if (!store) return;
    if (isMemoryMode()) return store.setTokenMapping(token, lobbyId);
    await store.setEx(KEYS.TOKEN(token), TTL.TOKEN_MAPPING, lobbyId);
}

async function getLobbyByToken(token) {
    const store = getStore();
    if (!store) return null;
    if (isMemoryMode()) return store.getLobbyByToken(token);
    return await store.get(KEYS.TOKEN(token));
}

async function deleteTokenMapping(token) {
    const store = getStore();
    if (!store) return;
    if (isMemoryMode()) return store.deleteTokenMapping(token);
    await store.del(KEYS.TOKEN(token));
}

async function incrementLobbyCounter() {
    const store = getStore();
    if (!store) return 0;
    if (isMemoryMode()) return store.incrementLobbyCounter();
    return await store.incr(KEYS.LOBBY_COUNTER);
}

async function getLobbyCounter() {
    const store = getStore();
    if (!store) return 0;
    if (isMemoryMode()) return store.getLobbyCounter();
    const value = await store.get(KEYS.LOBBY_COUNTER);
    return value ? parseInt(value, 10) : 0;
}

async function createRoom(code, roomData) {
    const store = getStore();
    if (!store) return;
    if (isMemoryMode()) return store.createRoom(code, roomData);
    const data = { ...roomData, createdAt: Date.now() };
    await store.setEx(KEYS.ROOM(code), TTL.ROOM, JSON.stringify(data));
}

async function getRoom(code) {
    const store = getStore();
    if (!store) return null;
    if (isMemoryMode()) return store.getRoom(code);
    const data = await store.get(KEYS.ROOM(code));
    return data ? JSON.parse(data) : null;
}

async function updateRoom(code, roomData) {
    const store = getStore();
    if (!store) return;
    if (isMemoryMode()) return store.updateRoom(code, roomData);
    await store.setEx(KEYS.ROOM(code), TTL.ROOM, JSON.stringify(roomData));
}

async function deleteRoom(code) {
    const store = getStore();
    if (!store) return;
    if (isMemoryMode()) return store.deleteRoom(code);
    await store.del(KEYS.ROOM(code));
}

async function addToQueue(base, inc, playerData, isRanked = false) {
    const store = getStore();
    if (!store) return;
    if (isMemoryMode()) return store.addToQueue(base, inc, playerData, isRanked);
    await store.rPush(KEYS.QUEUE(base, inc, isRanked), JSON.stringify(playerData));
}

async function removeFromQueue(base, inc, token, isRanked = false) {
    const store = getStore();
    if (!store) return false;
    if (isMemoryMode()) return store.removeFromQueue(base, inc, token, isRanked);
    const key = KEYS.QUEUE(base, inc, isRanked);
    const items = await store.lRange(key, 0, -1);
    for (const item of items) {
        const data = JSON.parse(item);
        if (data.token === token) {
            await store.lRem(key, 1, item);
            return true;
        }
    }
    return false;
}

async function popTwoFromQueue(base, inc, isRanked = false) {
    const store = getStore();
    if (!store) return null;
    if (isMemoryMode()) return store.popTwoFromQueue(base, inc, isRanked);
    const key = KEYS.QUEUE(base, inc, isRanked);
    const length = await store.lLen(key);
    if (length < 2) return null;
    const p1Data = await store.lPop(key);
    const p2Data = await store.lPop(key);
    if (!p1Data || !p2Data) {
        if (p1Data) await store.lPush(key, p1Data);
        return null;
    }
    return [JSON.parse(p1Data), JSON.parse(p2Data)];
}

async function getAllQueueKeys() {
    const store = getStore();
    if (!store) return [];
    if (isMemoryMode()) return store.getAllQueueKeys();
    return await store.keys('queue:*');
}

async function removeFromAllQueues(token) {
    const store = getStore();
    if (!store) return;
    if (isMemoryMode()) return store.removeFromAllQueues(token);
    const queueKeys = await getAllQueueKeys();
    for (const key of queueKeys) {
        const items = await store.lRange(key, 0, -1);
        for (const item of items) {
            const data = JSON.parse(item);
            if (data.token === token) {
                await store.lRem(key, 1, item);
            }
        }
    }
}

async function setDisconnectTimer(lobbyId, delayMs) {
    const store = getStore();
    if (!store) return;
    if (isMemoryMode()) return store.setDisconnectTimer(lobbyId, delayMs);
    const score = Date.now() + delayMs;
    await store.zAdd(KEYS.DISCONNECT_TIMERS, [{ score, value: lobbyId }]);
}

async function clearDisconnectTimer(lobbyId) {
    const store = getStore();
    if (!store) return;
    if (isMemoryMode()) return store.clearDisconnectTimer(lobbyId);
    await store.zRem(KEYS.DISCONNECT_TIMERS, lobbyId);
}

async function getExpiredDisconnectTimers() {
    const store = getStore();
    if (!store) return [];
    if (isMemoryMode()) return store.getExpiredDisconnectTimers();
    const now = Date.now();
    return await store.zRangeByScore(KEYS.DISCONNECT_TIMERS, 0, now);
}

async function hasDisconnectTimer(lobbyId) {
    const store = getStore();
    if (!store) return false;
    if (isMemoryMode()) return store.hasDisconnectTimer(lobbyId);
    const score = await store.zScore(KEYS.DISCONNECT_TIMERS, lobbyId);
    return score !== null;
}

async function setTurnTimeout(lobbyId, timeoutAt) {
    const store = getStore();
    if (!store) return;
    if (isMemoryMode()) return store.setTurnTimeout(lobbyId, timeoutAt);
    await store.zAdd(KEYS.TURN_TIMEOUTS, [{ score: timeoutAt, value: lobbyId }]);
}

async function clearTurnTimeout(lobbyId) {
    const store = getStore();
    if (!store) return;
    if (isMemoryMode()) return store.clearTurnTimeout(lobbyId);
    await store.zRem(KEYS.TURN_TIMEOUTS, lobbyId);
}

async function getExpiredTurnTimeouts() {
    const store = getStore();
    if (!store) return [];
    if (isMemoryMode()) return store.getExpiredTurnTimeouts();
    const now = Date.now();
    return await store.zRangeByScore(KEYS.TURN_TIMEOUTS, 0, now);
}

async function saveRematchContext(lobbyId, context) {
    const store = getStore();
    if (!store) return;
    if (isMemoryMode()) return store.saveRematchContext(lobbyId, context);
    const data = { ...context, createdAt: Date.now() };
    await store.setEx(KEYS.REMATCH(lobbyId), TTL.REMATCH, JSON.stringify(data));
}

async function getRematchContext(lobbyId) {
    const store = getStore();
    if (!store) return null;
    if (isMemoryMode()) return store.getRematchContext(lobbyId);
    const data = await store.get(KEYS.REMATCH(lobbyId));
    if (!data) return null;
    const ctx = JSON.parse(data);
    if (Date.now() - ctx.createdAt > TTL.REMATCH * 1000) {
        await store.del(KEYS.REMATCH(lobbyId));
        return null;
    }
    return ctx;
}

async function deleteRematchContext(lobbyId) {
    const store = getStore();
    if (!store) return;
    if (isMemoryMode()) return store.deleteRematchContext(lobbyId);
    await store.del(KEYS.REMATCH(lobbyId));
}

async function setTokenUserMapping(token, userId) {
    const store = getStore();
    if (!store) return;
    if (isMemoryMode()) return store.setTokenUserMapping(token, userId);
    await store.set(`${KEYS.TOKEN_USER_MAP}${token}`, userId.toString(), { EX: 86400 * 7 });
}

async function getUserIdByToken(token) {
    const store = getStore();
    if (!store) return null;
    if (isMemoryMode()) return store.getUserIdByToken(token);
    return await store.get(`${KEYS.TOKEN_USER_MAP}${token}`);
}

async function deleteTokenUserMapping(token) {
    const store = getStore();
    if (!store) return;
    if (isMemoryMode()) return store.deleteTokenUserMapping(token);
    await store.del(`${KEYS.TOKEN_USER_MAP}${token}`);
}

// ============================================================
// ЭКСПОРТ
// ============================================================

module.exports = {
    connect,
    disconnect,
    isReady,

    saveGame,
    getGame,
    deleteGame,
    getAllGameIds,
    addActiveGame,
    removeActiveGame,
    getActiveGameIds,
    acquireLock,
    releaseLock,

    setTokenMapping,
    getLobbyByToken,
    deleteTokenMapping,

    incrementLobbyCounter,
    getLobbyCounter,

    createRoom,
    getRoom,
    updateRoom,
    deleteRoom,

    addToQueue,
    removeFromQueue,
    popTwoFromQueue,
    removeFromAllQueues,

    setDisconnectTimer,
    clearDisconnectTimer,
    getExpiredDisconnectTimers,
    hasDisconnectTimer,
    setTurnTimeout,
    clearTurnTimeout,
    getExpiredTurnTimeouts,

    setTokenUserMapping,
    getUserIdByToken,
    deleteTokenUserMapping,

    saveRematchContext,
    getRematchContext,
    deleteRematchContext,

    TTL,
    KEYS,
};
