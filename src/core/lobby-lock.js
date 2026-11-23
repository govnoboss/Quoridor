const { AsyncLocalStorage } = require('node:async_hooks');

// Re-entrant within one transition (e.g. move -> finalize), serialized both
// locally and across Redis users. Never release somebody else's expired lease.
module.exports = function createLobbyLock(Redis) {
    const context = new AsyncLocalStorage();
    const queues = new Map();
    return async function withLobbyLock(id, action) {
        if (context.getStore()?.has(id)) return action();
        const previous = queues.get(id) || Promise.resolve();
        let done;
        const tail = new Promise(resolve => { done = resolve; });
        queues.set(id, tail);
        await previous;
        let token, renewal;
        try {
            for (let n = 0; n < 200; n++) {
                token = await Redis.acquireLock(id, 30000);
                if (token) break;
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            if (!token) throw new Error('Game busy; retry');
            let lost = false;
            renewal = setInterval(() => {
                Redis.renewLock(id, token, 30000).then(ok => { if (!ok) lost = true; }).catch(() => { lost = true; });
            }, 5000);
            renewal.unref?.();
            const result = await context.run(new Set([...(context.getStore() || []), id]), action);
            if (lost) throw new Error('Game lock lost; resynchronize');
            return result;
        } finally {
            clearInterval(renewal);
            try { if (token) await Redis.releaseLock(id, token); }
            finally { done(); if (queues.get(id) === tail) queues.delete(id); }
        }
    };
};
