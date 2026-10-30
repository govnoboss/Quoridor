'use strict';

/**
 * Общая логика лидерборда (ТЗ tz-03, разделы 4.1–4.4).
 *
 * - Одинаковый фильтр пользователей для /api/leaderboard и /api/leaderboard/me
 *   (как раньше: без админов; боты — как есть).
 * - delta7 — сумма ratingChange за ранговые партии за последние 7 суток (UTC),
 *   считается ОДНОЙ агрегацией по GameResult для всех игроков и кэшируется
 *   5 минут (Redis-ключ lb:delta7, in-memory запасной вариант).
 * - В публичных ответах никогда нет email; для username в формате email
 *   displayName формируется по разделу 4.4.
 */

const GameResult = require('../models/GameResult');
const User = require('../models/User');

const MIN_GAMES_WINRATE = 10;
const DELTA7_TTL_MS = 5 * 60 * 1000;
const DELTA7_KEY = 'lb:delta7';
const SORTS = ['rating', 'winrate', 'week'];

// ---------- Redis (опционально) ----------

let redisClient = null;

function setRedisClient(client) {
    redisClient = client;
}

function redisReady() {
    return !!(redisClient && redisClient.isReady);
}

// ---------- delta7 ----------

let delta7Memory = { value: null, expiresAt: 0 };

/**
 * Одно соглашение: delta7 для игрока без ранговых партий за 7 дней = null,
 * а не 0 (0 отдаётся, если партии есть, но суммарное изменение нулевое).
 */
async function computeDelta7Map() {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await GameResult.aggregate([
        { $match: { isRanked: true, date: { $gte: since } } },
        { $addFields: {
            participants: [
                { id: '$playerWhite.id', change: '$playerWhite.ratingChange' },
                { id: '$playerBlack.id', change: '$playerBlack.ratingChange' }
            ]
        } },
        { $unwind: '$participants' },
        { $match: { 'participants.id': { $ne: null } } },
        { $group: { _id: '$participants.id', delta: { $sum: '$participants.change' } } }
    ]);
    const map = new Map();
    for (const row of rows) {
        map.set(String(row._id), row.delta || 0);
    }
    return map;
}

/**
 * Мапа id -> delta7 с кэшем на 5 минут.
 */
async function getDelta7Map() {
    // Redis
    if (redisReady()) {
        try {
            const raw = await redisClient.get(DELTA7_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && Array.isArray(parsed.entries)) {
                    return new Map(parsed.entries);
                }
            }
            const computed = await computeDelta7Map();
            await redisClient.set(DELTA7_KEY, JSON.stringify({ entries: Array.from(computed.entries()) }), { EX: Math.floor(DELTA7_TTL_MS / 1000) });
            return computed;
        } catch (err) {
            console.warn('[LEADERBOARD] Redis delta7 cache failed, falling back to memory:', err.message);
        }
    }
    // In-memory запасной вариант
    if (delta7Memory.value && Date.now() < delta7Memory.expiresAt) {
        return delta7Memory.value;
    }
    const computed = await computeDelta7Map();
    delta7Memory = { value: computed, expiresAt: Date.now() + DELTA7_TTL_MS };
    return computed;
}

// ---------- Игроки ----------

/**
 * Фильтр тот же, что и раньше (без админов; боты — как сейчас).
 * Email в выборку не попадает никогда (раздел 4.4).
 */
async function loadUsers() {
    return User.find({ isAdmin: { $ne: true } })
        .select('username rating avatarUrl country stats')
        .exec();
}

function winrateOf(user) {
    const totalGames = (user.stats && user.stats.totalGames) || 0;
    const wins = (user.stats && user.stats.wins) || 0;
    return totalGames > 0 ? wins / totalGames : 0;
}

function sortKey(sort, users, delta7Map) {
    const list = users.slice();
    if (sort === 'rating') {
        list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (sort === 'winrate') {
        // только игроки от 10 партий (раздел 4.1)
        list.sort((a, b) => {
            const wa = winrateOf(a);
            const wb = winrateOf(b);
            if (wb !== wa) return wb - wa;
            const winsA = (a.stats && a.stats.wins) || 0;
            const winsB = (b.stats && b.stats.wins) || 0;
            if (winsB !== winsA) return winsB - winsA;
            return (b.rating || 0) - (a.rating || 0);
        });
    } else if (sort === 'week') {
        // только игроки с ненулевым delta7 (раздел 4.1)
        list.sort((a, b) => {
            const da = delta7Map.get(String(a._id));
            const db = delta7Map.get(String(b._id));
            if (db !== da) return (db == null ? 0 : db) - (da == null ? 0 : da);
            return (b.rating || 0) - (a.rating || 0);
        });
    }
    return list;
}

/**
 * displayName по разделу 4.4: email-подобные username не «протекают» в UI.
 * username без '@' показывается как есть.
 */
function deriveDisplayName(username) {
    if (typeof username !== 'string' || !username.includes('@')) {
        return username;
    }
    const head = username.split('@')[0];
    return head.substring(0, 12);
}

/**
 * При коллизии displayName добавляем '…' + последние 2 символа id.
 */
// При коллизии производного имени помечаем ВСЕ столкнувшиеся записи
// ('…' + последние 2 символа id) — детерминированно, независимо от порядка.
function displayNameCollisionFix(rows) {
    const counts = new Map();
    for (const row of rows) {
        const key = row.displayName;
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const row of rows) {
        if (row.displayName !== row.username && counts.get(row.displayName) > 1) {
            row.displayName += '…' + String(row._id).slice(-2);
        }
    }
}

function toPublicRow(user, rank, delta7Map) {
    const delta = delta7Map.get(String(user._id));
    return {
        rank,
        // id используется заполнителем коллизий и вырезается перед ответом
        _id: user._id,
        username: user.username,
        displayName: deriveDisplayName(user.username),
        rating: user.rating,
        avatarUrl: user.avatarUrl || null,
        country: user.country || null,
        stats: {
            totalGames: (user.stats && user.stats.totalGames) || 0,
            wins: (user.stats && user.stats.wins) || 0,
            losses: (user.stats && user.stats.losses) || 0
        },
        delta7: delta == null ? null : delta,
        _strip: true
    };
}

/**
 * Список лидерборда. rank считается на сервере по текущей сортировке (1..N).
 */
async function computeLeaderboard(sortName, limit) {
    const sort = SORTS.includes(sortName) ? sortName : 'rating';
    const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 100));

    const [users, delta7Map] = await Promise.all([loadUsers(), getDelta7Map()]);

    let candidates = users;
    if (sort === 'winrate') {
        candidates = candidates.filter((u) => ((u.stats && u.stats.totalGames) || 0) >= MIN_GAMES_WINRATE);
    } else if (sort === 'week') {
        candidates = candidates.filter((u) => {
            const d = delta7Map.get(String(u._id));
            return d != null && d !== 0;
        });
    }

    const sorted = sortKey(sort, candidates, delta7Map);
    const slice = sorted.slice(0, lim);
    const rows = slice.map((user, i) => toPublicRow(user, i + 1, delta7Map));
    displayNameCollisionFix(rows);
    for (const row of rows) {
        delete row._id;
        delete row._strip;
    }
    return rows;
}

/**
 * Данные «You» (раздел 4.3): ранг в текущей сортировке, статистика, delta7.
 * Если игрок не подходит под порог вкладки — rank: null.
 */
async function computeMyLeaderboard(user, sortName) {
    const sort = SORTS.includes(sortName) ? sortName : 'rating';
    const [users, delta7Map] = await Promise.all([loadUsers(), getDelta7Map()]);

    const total = users.length;
    const myDelta = delta7Map.get(String(user._id));
    const delta7 = myDelta == null ? null : myDelta;

    const result = {
        username: user.username,
        rating: user.rating,
        total,
        stats: {
            totalGames: (user.stats && user.stats.totalGames) || 0,
            wins: (user.stats && user.stats.wins) || 0,
            losses: (user.stats && user.stats.losses) || 0
        },
        delta7
    };

    let ranked = users;
    if (sort === 'winrate') {
        if (((user.stats && user.stats.totalGames) || 0) < MIN_GAMES_WINRATE) {
            result.rank = null;
            return result;
        }
        ranked = users.filter((u) => ((u.stats && u.stats.totalGames) || 0) >= MIN_GAMES_WINRATE);
    } else if (sort === 'week') {
        if (delta7 == null || delta7 === 0) {
            result.rank = null;
            return result;
        }
        ranked = users.filter((u) => {
            const d = delta7Map.get(String(u._id));
            return d != null && d !== 0;
        });
    }

    const sorted = sortKey(sort, ranked, delta7Map);
    const idx = sorted.findIndex((u) => String(u._id) === String(user._id));
    result.rank = idx >= 0 ? idx + 1 : null;
    return result;
}

module.exports = {
    MIN_GAMES_WINRATE,
    SORTS,
    setRedisClient,
    computeLeaderboard,
    computeMyLeaderboard,
    // только для тестов: сбросить in-memory кэш delta7
    __resetDelta7Cache: () => { delta7Memory = { value: null, expiresAt: 0 }; }
};
