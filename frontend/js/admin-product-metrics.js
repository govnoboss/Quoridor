(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory;
    else root.ProductMetrics = factory({ document: root.document, fetch: function (url) { return root.AdminAPI.fetch(url); } });
})(typeof window !== 'undefined' ? window : this, function (deps) {
    'use strict';
    var document = deps.document;
    var request = 0;
    function node(tag, text) {
        var result = document.createElement(tag);
        if (text !== undefined) result.textContent = String(text);
        return result;
    }
    function rate(value) {
        if (!value || value.percent === null) return 'Not available';
        return value.percent + '% (' + value.returned + '/' + value.eligible + ')';
    }
    function table(parent, headers, rows) {
        var result = node('table'), head = node('thead'), body = node('tbody'), header = node('tr');
        headers.forEach(function (label) { var cell = node('th', label); cell.scope = 'col'; header.appendChild(cell); });
        head.appendChild(header); result.appendChild(head);
        rows.forEach(function (values) { var row = node('tr'); values.forEach(function (value) { row.appendChild(node('td', value)); }); body.appendChild(row); });
        result.appendChild(body); parent.appendChild(result);
    }
    function render(data) {
        var target = document.getElementById('productReport');
        target.textContent = '';
        var current = data.current, previous = data.previous;
        target.appendChild(node('p', 'Full days · ' + data.timezone + ' · ' + current.from + ' – ' + current.through + '. Previous: ' + previous.from + ' – ' + previous.through + '.'));
        target.appendChild(node('p', 'Players are device identities (account fallback), not verified people. Cohorts start at the first recorded game; older history may be incomplete. Returns require a new game-started on the exact day.'));
        table(target, ['Metric', 'Current', 'Previous'], [
            ['Active identities', current.activeIdentities, previous.activeIdentities],
            ['Players who started a game', current.players, previous.players],
            ['Activation among active identities', rate(current.activation), rate(previous.activation)],
            ['First observed players', current.newPlayers, previous.newPlayers],
            ['D1 · mature cohorts only', rate(current.d1), rate(previous.d1)],
            ['D7 · mature cohorts only', rate(current.d7), rate(previous.d7)],
            ['Return on any day 1–7', rate(current.week1), rate(previous.week1)],
            ['First tracked game completed · linked new players only', rate(current.firstCompletion), rate(previous.firstCompletion)],
            ['Second tracked game · linked new players only', rate(current.secondGame), rate(previous.secondGame)],
            ['Tracked player-game starts', current.games.tracked, previous.games.tracked],
            ['Tracked games completed', current.games.finished, previous.games.finished],
            ['Completion by report cutoff', rate(current.games.completion), rate(previous.games.completion)],
            ['Abandon signalled, no later finish', current.games.abandoned, previous.games.abandoned],
            ['No finish or abandon received', current.games.open, previous.games.open],
            ['Linked searches', current.searches.tracked, previous.searches.tracked],
            ['Searches matched', rate(current.searches.matchRate), rate(previous.searches.matchRate)],
            ['Searches cancelled / failed', current.searches.cancelled + ' / ' + current.searches.timedOut, previous.searches.cancelled + ' / ' + previous.searches.timedOut],
            ['Matched wait p50 / p95 (ms)', (current.searches.p50Ms ?? '—') + ' / ' + (current.searches.p95Ms ?? '—'), (previous.searches.p50Ms ?? '—') + ' / ' + (previous.searches.p95Ms ?? '—')]
        ]);
        target.appendChild(node('h3', 'First-game cohorts'));
        target.appendChild(node('p', 'Not mature = the complete target day has not ended. Not available = no eligible players.'));
        table(target, ['First game date', 'Players', 'D1', 'D7', 'Any day 1–7'], current.cohorts.map(function (row) {
            return [row.date, row.players, row.d1 === null ? 'Not mature' : rate(row.d1), row.d7 === null ? 'Not mature' : rate(row.d7), row.week1 === null ? 'Not mature' : rate(row.week1)];
        }));
        target.appendChild(node('h3', 'Linked games by mode / platform'));
        table(target, ['Segment', 'Players', 'Starts', 'Completed'], current.modes.concat(current.platforms).map(function (row) { return [row.value, row.players, row.starts, row.finished]; }));
        target.appendChild(node('h3', 'Data quality · both periods'));
        table(target, ['Check', 'Events'], Object.entries(data.quality));
        target.appendChild(node('p', 'Admin/bot accounts and their known devices are excluded, plus configured test IDs. Legacy game events are excluded from linked completion rates. A player-game is one device’s participation, not a unique online match. Client events may be lost or spoofed.'));
    }
    async function load(days) {
        var generation = ++request;
        var target = document.getElementById('productReport');
        target.textContent = 'Loading product report…';
        try {
            var response = await deps.fetch('/api/admin/product-metrics?days=' + encodeURIComponent(days));
            if (!response.ok) throw new Error('HTTP ' + response.status);
            var data = await response.json();
            if (generation === request) render(data);
        } catch (error) {
            if (generation === request) target.textContent = 'Product report unavailable: ' + error.message;
        }
    }
    return { load: load, render: render, rate: rate };
});
