/**
 * Redis Wrapper Module для Quoridor
 * 
 * Этот модуль инкапсулирует всю работу с Redis:
 * - Подключение и обработка ошибок
 * - Методы для работы с играми, комнатами, очередями
 * - Автоматический TTL для данных
 */

const redis = require('redis');

// ============================================================
// КОНФИГУРАЦИЯ
// ============================================================

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// TTL (Time To Live) в секундах
const TTL = {
    GAME: 2 * 60 * 60,       // 2 часа для активных игр
    TOKEN_MAPPING: 2 * 60 * 60, // 2 часа для маппинга токен -> lobbyId
    ROOM: 30 * 60,           // 30 минут для приватных комнат
};

// Ключи Redis
const KEYS = {
    GAME: (lobbyId) => `game:${lobbyId}`,
    TOKEN: (token) => `token:${token}`,
    ROOM: (code) => `room:${code}`,
    QUEUE: (base, inc) => `queue:${base}:${inc}`,
    LOBBY_COUNTER: 'global:lobby_id',
    ACTIVE_GAMES: 'global:active_games',
    // Timers (Sorted Sets)
    DISCONNECT_TIMERS: 'timers:disconnect',
    TURN_TIMEOUTS: 'timers:turn',
    TOKEN_USER_MAP: 'token:user:', // Map token -> userId
};

// ============================================================
// КЛИЕНТ REDIS
// ============================================================

let client = null;
let isConnected = false;

/**
 * Подключение к Redis.
 * Вызывается один раз при старте сервера.
 */
async function connect() {
    if (client && isConnected) {
        return client;
    }

    client = redis.createClient({ url: REDIS_URL });

    // Обработка событий
    client.on('error', (err) => {
        console.error('[REDIS] Connection error:', err.message);
        isConnected = false;
    });

    client.on('connect', () => {
        console.log('[REDIS] Connected to Redis server');
        isConnected = true;
    });

    client.on('reconnecting', () => {
        console.log('[REDIS] Reconnecting...');
    });

    client.on('end', () => {
        console.log('[REDIS] Connection closed');
        isConnected = false;
    });

    await client.connect();
    return client;
}

/**
 * Отключение от Redis (для graceful shutdown).
 */
async function disconnect() {
    if (client) {
        await client.quit();
        client = null;
        isConnected = false;
    }
}

/**
 * Проверка, подключён ли клиент.
 */
function isReady() {
    return isConnected && client !== null;
}

// ============================================================
// МЕТОДЫ ДЛЯ РАБОТЫ С ИГРАМИ
// ============================================================

/**
 * Сохраняет состояние игры в Redis.
 * @param {string} lobbyId - ID лобби (например, "lobby-1")
 * @param {object} state - Состояние игры
 */
async function saveGame(lobbyId, state) {
    if (!isReady()) {
        throw new Error('[REDIS] Not connected');
    }

    // Убираем несериализуемые данные (таймеры, сокеты)
    const cleanState = {
        ...state,
        disconnectTimer: null, // setTimeout нельзя сериализовать
    };

    const key = KEYS.GAME(lobbyId);
    await client.setEx(key, TTL.GAME, JSON.stringify(cleanState));
}

/**
 * Получает состояние игры из Redis.
 * @param {string} lobbyId - ID лобби
 * @returns {object|null} - Состояние игры или null, если не найдено
 */
async function getGame(lobbyId) {
    if (!isReady()) {
        throw new Error('[REDIS] Not connected');
    }

    const key = KEYS.GAME(lobbyId);
    const data = await client.get(key);

    if (!data) return null;

    const state = JSON.parse(data);
    // disconnectTimer будет null — его нужно восстановить в server.js при необходимости
    state.disconnectTimer = null;
    return state;
}

/**
 * Удаляет игру из Redis.
 * @param {string} lobbyId - ID лобби
 */
async function deleteGame(lobbyId) {
    if (!isReady()) {
        throw new Error('[REDIS] Not connected');
    }

    const key = KEYS.GAME(lobbyId);
    await client.del(key);
}

/**
 * Получает список всех активных игр.
 * @returns {string[]} - Массив lobbyId
 */
async function getAllGameIds() {
    if (!isReady()) {
        throw new Error('[REDIS] Not connected');
    }

    const keys = await client.keys('game:*');
    return keys.map(key => key.replace('game:', ''));
}

/**
 * Добавляет лобби в список активных игр.
 */
async function addActiveGame(lobbyId) {
    if (!isReady()) throw new Error('[REDIS] Not connected');
    await client.sAdd(KEYS.ACTIVE_GAMES, lobbyId);
}

/**
 * Удаляет лобби из списка активных игр.
 */
async function removeActiveGame(lobbyId) {
    if (!isReady()) throw new Error('[REDIS] Not connected');
    await client.sRem(KEYS.ACTIVE_GAMES, lobbyId);
}

/**
 * Получает список всех активных игр из SET (быстрее чем KEYS).
 */
async function getActiveGameIds() {
    if (!isReady()) throw new Error('[REDIS] Not connected');
    return await client.sMembers(KEYS.ACTIVE_GAMES);
}

// ============================================================
// МЕТОДЫ ДЛЯ МАППИНГА ТОКЕН -> USER ID
// ============================================================

/**
 * Сохраняет маппинг токена к userId.
 * @param {string} token - Токен игрока
 * @param {string} userId - ID пользователя
 */
async function setTokenUserMapping(token, userId) {
    if (!isReady()) throw new Error('[REDIS] Not connected');
    await client.set(`${KEYS.TOKEN_USER_MAP}${token}`, userId.toString(), {
        EX: 86400 * 7 // 7 дней
    });
}

/**
 * Получает userId по токену.
 * @param {string} token - Токен игрока
 * @returns {string|null} - userId или null, если не найдено
 */
async function getUserIdByToken(token) {
    if (!isReady()) throw new Error('[REDIS] Not connected');
    return await client.get(`${KEYS.TOKEN_USER_MAP}${token}`);
}

/**
 * Удаляет маппинг токена к userId.
 * @param {string} token - Токен игрока
 */
async function deleteTokenUserMapping(token) {
    if (!isReady()) throw new Error('[REDIS] Not connected');
    await client.del(`${KEYS.TOKEN_USER_MAP}${token}`);
}

// ============================================================
// МЕТОДЫ ДЛЯ МАППИНГА ТОКЕНОВ (REJOIN)
// ============================================================

/**
 * Сохраняет маппинг токена игрока к lobbyId.
 * Используется для восстановления игры при переподключении.
 */
async function setTokenMapping(token, lobbyId) {
    if (!isReady()) {
        throw new Error('[REDIS] Not connected');
    }

    const key = KEYS.TOKEN(token);
    await client.setEx(key, TTL.TOKEN_MAPPING, lobbyId);
}

/**
 * Получает lobbyId по токену игрока.
 */
async function getLobbyByToken(token) {
    if (!isReady()) {
        throw new Error('[REDIS] Not connected');
    }

    const key = KEYS.TOKEN(token);
    return await client.get(key);
}

/**
 * Удаляет маппинг токена.
 */
async function deleteTokenMapping(token) {
    if (!isReady()) {
        throw new Error('[REDIS] Not connected');
    }

    const key = KEYS.TOKEN(token);
    await client.del(key);
}

// ============================================================
// МЕТОДЫ ДЛЯ СЧЁТЧИКА ЛОББИ
// ============================================================

/**
 * Инкрементирует и возвращает следующий ID лобби.
 * Атомарная операция — безопасна для нескольких серверов.
 */
async function incrementLobbyCounter() {
    if (!isReady()) {
        throw new Error('[REDIS] Not connected');
    }

    return await client.incr(KEYS.LOBBY_COUNTER);
}

/**
 * Получает текущее значение счётчика (для отладки).
 */
async function getLobbyCounter() {
    if (!isReady()) {
        throw new Error('[REDIS] Not connected');
    }

    const value = await client.get(KEYS.LOBBY_COUNTER);
    return value ? parseInt(value, 10) : 0;
}

// ============================================================
// МЕТОДЫ ДЛЯ ПРИВАТНЫХ КОМНАТ
// ============================================================

/**
 * Создаёт приватную комнату.
 */
async function createRoom(code, roomData) {
    if (!isReady()) {
        throw new Error('[REDIS] Not connected');
    }

    const key = KEYS.ROOM(code);
    const data = {
        ...roomData,
        createdAt: Date.now(),
    };
    await client.setEx(key, TTL.ROOM, JSON.stringify(data));
}

/**
 * Получает данные комнаты.
 */
async function getRoom(code) {
    if (!isReady()) {
        throw new Error('[REDIS] Not connected');
    }

    const key = KEYS.ROOM(code);
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
}

/**
 * Обновляет данные комнаты (например, добавление второго игрока).
 */
async function updateRoom(code, roomData) {
    if (!isReady()) {
        throw new Error('[REDIS] Not connected');
    }

    const key = KEYS.ROOM(code);
    // Обновляем TTL при каждом обновлении
    await client.setEx(key, TTL.ROOM, JSON.stringify(roomData));
}

/**
 * Удаляет комнату.
 */
async function deleteRoom(code) {
    if (!isReady()) {
        throw new Error('[REDIS] Not connected');
    }

    const key = KEYS.ROOM(code);
    await client.del(key);
}

// ============================================================
// МЕТОДЫ ДЛЯ ОЧЕРЕДЕЙ ПОИСКА
// ============================================================

/**
 * Добавляет игрока в очередь поиска.
 */
async function addToQueue(base, inc, playerData) {
    if (!isReady()) {
        throw new Error('[REDIS] Not connected');
    }

    const key = KEYS.QUEUE(base, inc);
    await client.rPush(key, JSON.stringify(playerData));
}

/**
 * Удаляет игрока из очереди по токену.
 */
async function removeFromQueue(base, inc, token) {
    if (!isReady()) {
        throw new Error('[REDIS] Not connected');
    }

    const key = KEYS.QUEUE(base, inc);
    const items = await client.lRange(key, 0, -1);

    for (const item of items) {
        const data = JSON.parse(item);
        if (data.token === token) {
            await client.lRem(key, 1, item);
            return true;
        }
    }
    return false;
}

/**
 * Получает и удаляет двух игроков из очереди (для матчмейкинга).
 * @returns {[object, object]|null} - Пара игроков или null
 */
async function popTwoFromQueue(base, inc) {
    if (!isReady()) {
        throw new Error('[REDIS] Not connected');
    }

    const key = KEYS.QUEUE(base, inc);

    // Проверяем длину очереди
    const length = await client.lLen(key);
    if (length < 2) return null;

    // Атомарно извлекаем двух игроков
    const p1Data = await client.lPop(key);
    const p2Data = await client.lPop(key);

    if (!p1Data || !p2Data) {
        // Если что-то пошло не так, возвращаем обратно
        if (p1Data) await client.lPush(key, p1Data);
        return null;
    }

    return [JSON.parse(p1Data), JSON.parse(p2Data)];
}

/**
 * Получает все ключи очередей.
 */
async function getAllQueueKeys() {
    if (!isReady()) {
        throw new Error('[REDIS] Not connected');
    }

    return await client.keys('queue:*');
}

/**
 * Удаляет игрока из ВСЕХ очередей по токену.
 */
async function removeFromAllQueues(token) {
    if (!isReady()) {
        throw new Error('[REDIS] Not connected');
    }

    const queueKeys = await getAllQueueKeys();

    for (const key of queueKeys) {
        const items = await client.lRange(key, 0, -1);
        for (const item of items) {
            const data = JSON.parse(item);
            if (data.token === token) {
                await client.lRem(key, 1, item);
            }
        }
    }
}

// ============================================================
// МЕТОДЫ ДЛЯ ТАЙМЕРОВ (SORTED SETS)
// ============================================================

/**
 * Устанавливает таймер дисконнекта для комнаты.
 * @param {string} lobbyId 
 * @param {number} delayMs - через сколько мс таймер сработает
 */
async function setDisconnectTimer(lobbyId, delayMs) {
    if (!isReady()) throw new Error('[REDIS] Not connected');
    const score = Date.now() + delayMs;
    await client.zAdd(KEYS.DISCONNECT_TIMERS, [{ score, value: lobbyId }]);
}

/**
 * Очищает таймер дисконнекта.
 */
async function clearDisconnectTimer(lobbyId) {
    if (!isReady()) throw new Error('[REDIS] Not connected');
    await client.zRem(KEYS.DISCONNECT_TIMERS, lobbyId);
}

/**
 * Получает список lobbyId, у которых истек срок дисконнекта.
 */
async function getExpiredDisconnectTimers() {
    if (!isReady()) throw new Error('[REDIS] Not connected');
    const now = Date.now();
    // Получаем всех, у кого score <= now
    const expired = await client.zRangeByScore(KEYS.DISCONNECT_TIMERS, 0, now);
    return expired;
}

/**
 * Проверяет, активен ли таймер дисконнекта для комнаты.
 */
async function hasDisconnectTimer(lobbyId) {
    if (!isReady()) throw new Error('[REDIS] Not connected');
    const score = await client.zScore(KEYS.DISCONNECT_TIMERS, lobbyId);
    return score !== null;
}

/**
 * Устанавливает дедлайн для хода (Turn Timeout).
 */
async function setTurnTimeout(lobbyId, timeoutAt) {
    if (!isReady()) throw new Error('[REDIS] Not connected');
    await client.zAdd(KEYS.TURN_TIMEOUTS, [{ score: timeoutAt, value: lobbyId }]);
}

/**
 * Очищает дедлайн для хода.
 */
async function clearTurnTimeout(lobbyId) {
    if (!isReady()) throw new Error('[REDIS] Not connected');
    await client.zRem(KEYS.TURN_TIMEOUTS, lobbyId);
}

/**
 * Получает список lobbyId с истекшим временем на ход.
 */
async function getExpiredTurnTimeouts() {
    if (!isReady()) throw new Error('[REDIS] Not connected');
    const now = Date.now();
    return await client.zRangeByScore(KEYS.TURN_TIMEOUTS, 0, now);
}

// ============================================================
// ЭКСПОРТ
// ============================================================

module.exports = {
    // Подключение
    connect,
    disconnect,
    isReady,

    // Игры
    saveGame,
    getGame,
    deleteGame,
    getAllGameIds,
    addActiveGame,
    removeActiveGame,
    getActiveGameIds,

    // Токены (Rejoin)
    setTokenMapping,
    getLobbyByToken,
    deleteTokenMapping,

    // Счётчик лобби
    incrementLobbyCounter,
    getLobbyCounter,

    // Приватные комнаты
    createRoom,
    getRoom,
    updateRoom,
    deleteRoom,

    // Очереди поиска
    addToQueue,
    removeFromQueue,
    popTwoFromQueue,
    removeFromAllQueues,

    // Таймеры
    setDisconnectTimer,
    clearDisconnectTimer,
    getExpiredDisconnectTimers,
    hasDisconnectTimer,
    setTurnTimeout,
    clearTurnTimeout,
    getExpiredTurnTimeouts,

    // Маппинг юзеров
    setTokenUserMapping,
    getUserIdByToken,
    deleteTokenUserMapping,

    // Константы (для внешнего использования)
    TTL,
    KEYS,
};
