/**
 * Quoridor AI Worker - uses shared AICore
 */
importScripts('/shared.js');
importScripts('/js/ai-core.js');

// Initialize AI Core with Shared logic (loaded globally via importScripts)
if (typeof AICore !== 'undefined' && typeof Shared !== 'undefined') {
    AICore.init(Shared);
} else {
    console.error('[AI-WORKER] Failed to load dependencies', { AICore: !!AICore, Shared: !!Shared });
}

onmessage = function (e) {
    try {
        const { state, botIdx, difficulty } = e.data;
        if (!AICore) throw new Error('AICore not loaded');

        const startThink = Date.now();
        const bestMove = AICore.think(state, botIdx, difficulty);

        postMessage(bestMove);

    } catch (err) {
        console.error('[AI-WORKER] Error in think:', err);
        postMessage(null); // Fallback
    }
};
