const Shared = require('./src/core/shared');
const AICore = require('./src/core/ai-core');

// Mock console.log to keep output clean, but allow errors
// console.log = () => {};

AICore.init(Shared);
AICore.DEBUG = true; // Enable debug to see what's happening

// Create initial state
const state = Shared.createInitialState({ base: 300 });

// Verify initial state hash logic if needed, but we care about mutation
console.log('Original Player Pos:', state.players[0].pos);

// Force AI to time out
// We can do this by setting a very short deadline or mocking Date.now
// Ideally, we just want to see if AICore.think mutates `state`.

const botIdx = 0;
const difficulty = 'impossible'; // Force deep search

console.log('--- STARTING THINK ---');
try {
    // We want to force a timeout. 
    // We can inject a predefined deadline into AICore if we look at the code, 
    // but the code sets `deadline = Date.now() + timeLimit`.
    // We can mock Date.now to jump forward.

    const originalDateNow = Date.now;
    let calls = 0;
    Date.now = () => {
        calls++;
        if (calls > 1000) return originalDateNow() + 50000; // time travel
        return originalDateNow();
    };

    AICore.think(state, botIdx, difficulty);

    Date.now = originalDateNow; // Restore
} catch (e) {
    console.log('Think finished (or failed):', e);
}

console.log('--- THINK ENDED ---');
console.log('Original Player Pos:', state.players[0].pos);

// Check if state was mutated
// In the original code, the bot is at 8,4. 
// If search was interrupted mid-move-application, it might be different.
// Or if the search applied a move and didn't undo it correctly upon timeout.

if (state.players[0].pos.r !== 8 || state.players[0].pos.c !== 4) {
    console.error('FAIL: State was mutated!');
    process.exit(1);
} else {
    console.log('SUCCESS: State preserved.');
}
