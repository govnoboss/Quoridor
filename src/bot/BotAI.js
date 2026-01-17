const Shared = require('../core/shared');
const AICore = require('../core/ai-core');

// Initialize the AI Core with the shared game logic
AICore.init(Shared);

/**
 * Quoridor Bot AI logic
 * Now delegates all logic to the universal AICore module.
 */
module.exports = AICore;
