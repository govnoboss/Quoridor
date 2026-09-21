require('dotenv').config();

const connectDB = require('../src/storage/db');
const User = require('../src/models/User');
const AnalyticsEvent = require('../src/models/AnalyticsEvent');

function startOfDay(d) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function dateKey(d) {
    return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
    const r = new Date(d);
    r.setUTCDate(r.getUTCDate() + n);
    return r;
}

async function main() {
    await connectDB();

    const arg = parseInt(process.argv[2], 10);
    const days = arg >= 2 && arg <= 60 ? arg : 14;
    const today = startOfDay(new Date());
    const since = addDays(today, -days);

    console.log(`\n=== Retention report (last ${days} days) ===\n`);

    const registrations = await User.find({
        isBot: { $ne: true },
        createdAt: { $gte: since }
    }).select('_id createdAt').lean();

    const userIds = registrations.map((u) => u._id);
    const events = userIds.length
        ? await AnalyticsEvent.find({
            userId: { $in: userIds },
            timestamp: { $gte: since }
        }).select('userId timestamp').lean()
        : [];

    const eventsByUser = new Map();
    for (const e of events) {
        if (!e.userId) continue;
        if (!eventsByUser.has(String(e.userId))) eventsByUser.set(String(e.userId), new Set());
        eventsByUser.get(String(e.userId)).add(dateKey(e.timestamp));
    }

    const dayEvents = new Set(['session-start', 'game-started', 'game-finished', 'search-started', 'play-online-click', 'play-bot-click', 'puzzle-viewed', 'puzzle-solved']);

    const cohorts = {};
    for (const reg of registrations) {
        const created = startOfDay(reg.createdAt);
        // Порог ретеншна: пользователь вернулся в день N — это считается по «действиям» (не pageview-лайк события), см. dayEvents
        const ck = dateKey(created);
        if (!cohorts[ck]) cohorts[ck] = { cohort: ck, registered: 0, d1: 0, d3: 0, d7: 0 };
        cohorts[ck].registered++;
        if (created > addDays(today, -8)) continue; // когорта ещё не нагрета для D7

        const userEvents = eventsByUser.get(String(reg._id)) || new Set();
        for (const n of [1, 3, 7]) {
            cohorts[ck]['d' + n] += userEvents.has(dateKey(addDays(created, n))) ? 1 : 0;
        }
    }

    // Общий ретеншн по всем пользователям, зарегистрированным >= N дней назад (закрытые когорты)
    const eligible = registrations.filter((r) => startOfDay(r.createdAt) <= addDays(today, -7));
    const closed = { users: eligible.length, d1: 0, d3: 0, d7: 0 };
    for (const reg of eligible) {
        const created = startOfDay(reg.createdAt);
        const userEvents = eventsByUser.get(String(reg._id)) || new Set();
        for (const n of [1, 3, 7]) {
            closed['d' + n] += userEvents.has(dateKey(addDays(created, n))) ? 1 : 0;
        }
    }

    console.log('Cohorts (closed, hence D1..D7 only shown for mature cohorts):');
    console.log('┌────────────┬────────────┬──────────┬──────────┬──────────┐');
    console.log('│ Cohort     │ Registered │     D1 % │     D3 % │     D7 % │');
    console.log('├────────────┼────────────┼──────────┼──────────┼──────────┤');
    const cohortRows = Object.values(cohorts).sort((a, b) => a.cohort.localeCompare(b.cohort));
    for (const c of cohortRows) {
        const fmt = (v) => c.registered ? Math.round((v / c.registered) * 100) + '%' : '-';
        console.log('│ ' + pad(c.cohort, 10) + ' │ ' + pad(String(c.registered), 10) + ' │ ' + pad(fmt(c.d1), 8) + ' │ ' + pad(fmt(c.d3), 8) + ' │ ' + pad(fmt(c.d7), 8) + ' │');
    }
    console.log('└────────────┴────────────┴──────────┴──────────┴──────────┘');
    if (closed.users) {
        console.log(`\nClosed cohorts (D7 eligible, n=${closed.users}):`);
        console.log(`  D1  ${Math.round((closed.d1 / closed.users) * 100)}%`);
        console.log(`  D3  ${Math.round((closed.d3 / closed.users) * 100)}%`);
        console.log(`  D7  ${Math.round((closed.d7 / closed.users) * 100)}%`);
    }

    // Воронка: исследование → игра → завершение партии → головоломка
    const sinceMs = since.getTime();
    const countByName = await AnalyticsEvent.aggregate([
        { $match: { timestamp: { $gte: since } } },
        { $group: { _id: '$name', count: { $sum: 1 }, users: { $addToSet: '$userId' } } }
    ]);
    const get = (name) => {
        const row = countByName.find((r) => r._id === name);
        return row ? { count: row.count, users: (row.users || []).filter(Boolean).length } : { count: 0, users: 0 };
    };
    const funnel = {
        'play-online-click': get('play-online-click'),
        'game-started': get('game-started'),
        'game-finished': get('game-finished'),
        'puzzle-viewed': get('puzzle-viewed'),
        'puzzle-solved': get('puzzle-solved')
    };
    console.log('\nFunnel (last %d days, counts / unique users):', days);
    for (const [step, v] of Object.entries(funnel)) {
        console.log(`  ${pad(step, 20)} ${String(v.count).padStart(6)} events  /  ${String(v.users).padStart(5)} users`);
    }

    console.log('\nDone.');
    process.exit(0);
}

function pad(s, len) {
    s = String(s);
    return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

main().catch((err) => {
    console.error('[RETENTION] Failed:', err);
    process.exit(1);
});