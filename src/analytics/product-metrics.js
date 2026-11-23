'use strict';

const DAY = 86400000;
const OFFSET = 5 * 3600000; // Asia/Yekaterinburg: UTC+05, no seasonal clock changes.
const MAX_EVENTS = 200000;
const mongoose = require('mongoose');
const dayOf = value => Math.floor((new Date(value).getTime() + OFFSET) / DAY);
const dateOf = day => new Date(day * DAY).toISOString().slice(0, 10);
const modeOf = mode => mode === 'normal' ? 'online' : (['bot', 'local', 'online', 'friend', 'ranked'].includes(mode) ? mode : 'unknown');
const actorOf = event => event.deviceId ? 'd:' + event.deviceId : (event.userId ? 'u:' + String(event.userId) : null);
const ratio = (returned, eligible) => ({ returned, eligible, percent: eligible ? Math.round(returned / eligible * 1000) / 10 : null });
const list = value => String(value || '').split(',').map(v => v.trim()).filter(Boolean);

function bounds(now, days) {
    const endDay = dayOf(now);
    return { endDay, startDay: endDay - days, start: new Date((endDay - days * 2) * DAY - OFFSET), end: new Date(endDay * DAY - OFFSET) };
}

function buildProductMetrics(events, firstGames, options = {}) {
    const now = options.now || new Date();
    const days = options.days || 28;
    const { endDay, startDay } = bounds(now, days);
    const excludedUsers = new Set((options.excludedUserIds || []).map(String));
    const excludedDevices = new Set(options.excludedDeviceIds || []);
    // A shared admin/test device is conservatively excluded in its entirety.
    events.forEach(e => { if (excludedUsers.has(String(e.userId)) && e.deviceId) excludedDevices.add(e.deviceId); });
    const excluded = e => excludedUsers.has(String(e.userId)) || excludedDevices.has(e.deviceId);
    const quality = { missingIdentityEvents: 0, excludedEvents: 0, legacyGameEvents: 0, duplicateGameStarts: 0, orphanSearchOutcomes: 0 };
    const valid = events.filter(e => {
        if (excluded(e)) { quality.excludedEvents++; return false; }
        if (!actorOf(e)) { quality.missingIdentityEvents++; return false; }
        return Number.isFinite(dayOf(e.timestamp)) && dayOf(e.timestamp) < endDay;
    }).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const starts = new Map();
    for (const first of firstGames) {
        if (!first._id || !Number.isFinite(dayOf(first.first))) continue;
        if (first._id.startsWith('d:') && excludedDevices.has(first._id.slice(2))) continue;
        if (first._id.startsWith('u:') && excludedUsers.has(first._id.slice(2))) continue;
        starts.set(first._id, { timestamp: new Date(first.first).getTime(), day: dayOf(first.first) });
    }
    const games = new Map();
    const searches = new Map();
    const playDays = new Map();
    for (const e of valid) {
        const actor = actorOf(e), props = e.props || {}, time = new Date(e.timestamp).getTime();
        if (e.name === 'game-started') {
            if (!playDays.has(actor)) playDays.set(actor, new Set());
            playDays.get(actor).add(dayOf(time));
        }
        if (['game-started', 'game-finished', 'game-abandoned'].includes(e.name)) {
            if (props.measurementVersion !== 2 || typeof props.gameId !== 'string' || !props.gameId) { quality.legacyGameEvents++; continue; }
            const key = actor + '\0' + props.gameId;
            if (!games.has(key)) games.set(key, { actor, id: props.gameId, platform: e.platform === 'android' ? 'android' : 'web', mode: modeOf(props.mode) });
            const game = games.get(key);
            if (e.name === 'game-started') {
                if (game.start !== undefined) quality.duplicateGameStarts++;
                else { game.start = time; game.mode = modeOf(props.mode); }
            } else if (e.name === 'game-finished') game.finish = game.finish === undefined ? time : Math.min(game.finish, time);
            else game.abandoned = time;
        }
        if (['search-started', 'search-matched', 'search-timeout', 'search-cancelled'].includes(e.name)) {
            if (!props.searchId) { if (e.name !== 'search-started') quality.orphanSearchOutcomes++; continue; }
            const key = actor + '\0' + props.searchId;
            if (!searches.has(key)) searches.set(key, {});
            const search = searches.get(key);
            if (e.name === 'search-started' && search.start === undefined) search.start = time;
            else if (e.name !== 'search-started' && !search.outcome) { search.outcome = e.name; search.finish = time; }
        }
    }
    function period(from, to) {
        const rows = valid.filter(e => dayOf(e.timestamp) >= from && dayOf(e.timestamp) < to);
        const active = new Set(rows.map(actorOf));
        const players = new Set(rows.filter(e => e.name === 'game-started').map(actorOf));
        const cohortActors = [...starts].filter(([, first]) => first.day >= from && first.day < to);
        const retention = offset => {
            const mature = cohortActors.filter(([, first]) => first.day + offset < endDay);
            return ratio(mature.filter(([actor, first]) => playDays.get(actor)?.has(first.day + offset)).length, mature.length);
        };
        const week = cohortActors.filter(([, first]) => first.day + 7 < endDay);
        const cohorts = [];
        for (let day = from; day < to; day++) {
            const members = cohortActors.filter(([, first]) => first.day === day);
            const rate = n => day + n < endDay ? ratio(members.filter(([actor]) => playDays.get(actor)?.has(day + n)).length, members.length) : null;
            cohorts.push({ date: dateOf(day), players: members.length, d1: rate(1), d7: rate(7), week1: day + 7 < endDay ? ratio(members.filter(([actor]) => [...(playDays.get(actor) || [])].some(d => d > day && d <= day + 7)).length, members.length) : null });
        }
        const tracked = [...games.values()].filter(g => g.start !== undefined && dayOf(g.start) >= from && dayOf(g.start) < to);
        const finished = g => g.finish !== undefined && g.finish >= g.start;
        const completed = tracked.filter(finished);
        const cohortSet = new Set(cohortActors.map(([actor]) => actor));
        const firstTracked = new Map();
        tracked.forEach(g => { if (cohortSet.has(g.actor) && (!firstTracked.has(g.actor) || g.start < firstTracked.get(g.actor).start)) firstTracked.set(g.actor, g); });
        const eligibleNew = new Set([...firstTracked].filter(([actor, g]) => g.start === starts.get(actor).timestamp).map(([actor]) => actor));
        const finishedPlayers = new Set([...firstTracked].filter(([actor, g]) => eligibleNew.has(actor) && finished(g)).map(([actor]) => actor));
        const gamesPerNew = new Map();
        tracked.forEach(g => { if (cohortSet.has(g.actor)) gamesPerNew.set(g.actor, (gamesPerNew.get(g.actor) || 0) + 1); });
        const attempts = [...searches.values()].filter(s => s.start !== undefined && dayOf(s.start) >= from && dayOf(s.start) < to);
        const matched = attempts.filter(s => s.outcome === 'search-matched' && s.finish >= s.start);
        const waits = matched.map(s => s.finish - s.start).sort((a, b) => a - b);
        const percentile = p => waits.length ? waits[Math.ceil(waits.length * p) - 1] : null;
        const breakdown = field => [...new Set(tracked.map(g => g[field]))].sort().map(value => {
            const subset = tracked.filter(g => g[field] === value);
            return { value, players: new Set(subset.map(g => g.actor)).size, starts: subset.length, finished: subset.filter(finished).length };
        });
        return {
            from: dateOf(from), through: dateOf(to - 1), activeIdentities: active.size, players: players.size,
            activation: ratio(players.size, active.size), newPlayers: cohortActors.length,
            firstCompletion: ratio(finishedPlayers.size, eligibleNew.size),
            secondGame: ratio([...gamesPerNew].filter(([actor, n]) => eligibleNew.has(actor) && n >= 2).length, eligibleNew.size),
            d1: retention(1), d7: retention(7), week1: ratio(week.filter(([actor, first]) => [...(playDays.get(actor) || [])].some(d => d > first.day && d <= first.day + 7)).length, week.length),
            games: { tracked: tracked.length, finished: completed.length, completion: ratio(completed.length, tracked.length),
                abandoned: tracked.filter(g => !finished(g) && g.abandoned !== undefined).length,
                open: tracked.filter(g => !finished(g) && g.abandoned === undefined).length },
            searches: { tracked: attempts.length, matched: matched.length, matchRate: ratio(matched.length, attempts.length),
                cancelled: attempts.filter(s => s.outcome === 'search-cancelled').length,
                timedOut: attempts.filter(s => s.outcome === 'search-timeout').length, p50Ms: percentile(0.5), p95Ms: percentile(0.95) },
            modes: breakdown('mode'), platforms: breakdown('platform'), cohorts,
            eventCounts: Object.fromEntries([...new Set(rows.map(e => e.name))].sort().map(name => [name, rows.filter(e => e.name === name).length]))
        };
    }
    return { version: 2, timezone: 'Asia/Yekaterinburg', days, generatedAt: new Date(now).toISOString(),
        identity: 'device-first; account fallback when device is missing; no cross-device merging',
        cohortDefinition: 'first recorded game-started across available history; history may be incomplete',
        current: period(startDay, endDay), previous: period(startDay - days, startDay), quality };
}

async function loadProductMetrics({ AnalyticsEvent, User, days = 28, now = new Date(), env = process.env }) {
    const range = bounds(now, days);
    const excludedUserIds = list(env.ANALYTICS_EXCLUDED_USER_IDS);
    const excludedDeviceIds = list(env.ANALYTICS_EXCLUDED_DEVICE_IDS);
    const users = await User.find({ $or: [{ isAdmin: true }, { isBot: true }] }).select('_id').lean();
    users.forEach(u => excludedUserIds.push(String(u._id)));
    // Mongoose casts find/distinct filters, but does not cast aggregation stages.
    const excludedDbUsers = excludedUserIds.map(id => mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : id);
    const linkedDevices = await AnalyticsEvent.distinct('deviceId', { userId: { $in: excludedUserIds }, deviceId: { $ne: '' } });
    excludedDeviceIds.push(...linkedDevices);
    const [events, firstGames] = await Promise.all([
        AnalyticsEvent.find({ timestamp: { $gte: range.start, $lt: range.end } }).select('name userId deviceId sessionId platform props timestamp').sort({ timestamp: 1 }).limit(MAX_EVENTS + 1).maxTimeMS(15000).lean(),
        AnalyticsEvent.aggregate([
            { $match: { name: 'game-started', timestamp: { $lt: range.end }, userId: { $nin: excludedDbUsers }, deviceId: { $nin: excludedDeviceIds } } },
            { $group: { _id: { $cond: [{ $ne: [{ $ifNull: ['$deviceId', ''] }, ''] }, { $concat: ['d:', '$deviceId'] },
                { $cond: [{ $ne: [{ $ifNull: ['$userId', null] }, null] }, { $concat: ['u:', { $toString: '$userId' }] }, null] }] }, first: { $min: '$timestamp' } } },
            { $limit: MAX_EVENTS + 1 }
        ]).allowDiskUse(true).option({ maxTimeMS: 15000 })
    ]);
    if (events.length > MAX_EVENTS || firstGames.length > MAX_EVENTS) {
        const error = new Error('Analytics volume exceeds report limit; use a smaller period or a materialized report.');
        error.status = 503; throw error;
    }
    return buildProductMetrics(events, firstGames, { now, days, excludedUserIds, excludedDeviceIds });
}

module.exports = { buildProductMetrics, loadProductMetrics, bounds, actorOf, dayOf };
