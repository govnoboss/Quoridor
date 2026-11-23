function invalid(message) {
    const error = new Error(message);
    error.status = 400;
    throw error;
}

function normalizeBotSettings(input, defaults) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Settings must be an object');
    const result = Object.fromEntries(['enabled', 'rankedEnabled', 'fallbackMinWaitMs',
        'fallbackMaxWaitMs', 'maxActiveGames', 'moveMinDelayMs', 'moveMaxDelayMs',
        'maxRecentMatches', 'recentWindowMs'].map(key => [key, defaults[key]]));
    result.key = 'global';
    for (const key of ['enabled', 'rankedEnabled']) {
        if (input[key] === undefined) continue;
        if (typeof input[key] !== 'boolean') invalid(`${key} must be a boolean`);
        result[key] = input[key];
    }
    for (const key of ['fallbackMinWaitMs', 'fallbackMaxWaitMs', 'maxActiveGames',
        'moveMinDelayMs', 'moveMaxDelayMs', 'maxRecentMatches', 'recentWindowMs']) {
        if (input[key] === undefined) continue;
        if (!Number.isSafeInteger(input[key]) || input[key] > 2147483647) invalid(`${key} must be an integer no greater than 2147483647`);
        result[key] = Math.max(0, input[key]);
    }
    result.fallbackMaxWaitMs = Math.max(result.fallbackMinWaitMs, result.fallbackMaxWaitMs);
    result.moveMaxDelayMs = Math.max(result.moveMinDelayMs, result.moveMaxDelayMs);
    result.recentWindowMs = Math.max(60000, result.recentWindowMs);
    // Return only configuration fields, never document metadata or client-supplied IDs.
    return Object.fromEntries(['key', 'enabled', 'rankedEnabled', 'fallbackMinWaitMs',
        'fallbackMaxWaitMs', 'maxActiveGames', 'moveMinDelayMs', 'moveMaxDelayMs',
        'maxRecentMatches', 'recentWindowMs'].map(key => [key, result[key]]));
}

function complaintTransition(current, body, actor, now = new Date()) {
    if (!['in_progress', 'resolved', 'dismissed'].includes(body.status)) invalid('Invalid status');
    if (body.adminNote !== undefined && (typeof body.adminNote !== 'string' || body.adminNote.length > 1000)) {
        invalid('Admin note must be a string of at most 1000 characters');
    }
    const adminNote = body.adminNote === undefined ? (current.adminNote || '') : body.adminNote.trim();
    const terminal = body.status !== 'in_progress';
    const sameStatus = current.status === body.status;
    const metadataValid = terminal ? Boolean(current.resolvedAt && current.resolvedBy) :
        current.resolvedAt == null && current.resolvedBy == null;
    const update = { status: body.status, adminNote,
        resolvedBy: terminal ? (sameStatus && current.resolvedBy || actor) : null,
        resolvedAt: terminal ? (sameStatus && current.resolvedAt || now) : null };
    return {
        update,
        unchanged: sameStatus && (current.adminNote || '') === adminNote && metadataValid,
        action: sameStatus && (current.adminNote || '') !== adminNote ? 'user_report_note_updated' :
            { in_progress: 'user_report_in_progress', resolved: 'user_report_resolved', dismissed: 'user_report_dismissed' }[body.status]
    };
}

module.exports = { normalizeBotSettings, complaintTransition };
