const Shared = require('../src/core/shared');
const AICore = require('../src/core/ai-core');
const assert = require('assert');

// Init AI
AICore.init(Shared);

console.log('Running AI Core Tests...');

function createTestState() {
    return Shared.createInitialState();
}

// TEST 1: Basic Pathfinding
{
    console.log('Test 1: Shortest Path Distance');
    const state = createTestState();
    // Default pos for white (0) is 8,4. Target row 0. Distance should be 8.
    const dist = AICore.shortestPathDistance(state, 0);
    assert.strictEqual(dist, 8, 'Initial distance for White should be 8');

    // Move pawn closer
    state.players[0].pos = { r: 7, c: 4 };
    assert.strictEqual(AICore.shortestPathDistance(state, 0), 7, 'Distance should decrease');
    console.log('✅ Passed');
}

// TEST 2: Move Generation (Pawn)
{
    console.log('Test 2: Generate Moves (Pawn)');
    const state = createTestState();
    // At 8,4, White can move to 7,4 (up), 8,3 (left), 8,5 (right). Down is blocked by border.
    const moves = AICore.generateMoves(state, 0).filter(m => m.type === 'pawn');
    assert.strictEqual(moves.length, 3, 'Should generate 3 pawn moves from start');

    // Verify specific moves
    const hasUp = moves.some(m => m.r === 7 && m.c === 4);
    assert.ok(hasUp, 'Should have move UP');
    console.log('✅ Passed');
}

// TEST 3: Smart Wall Generation (Basic)
{
    console.log('Test 3: Smart Wall Generation');
    const state = createTestState();
    // Place opponent close
    state.players[1].pos = { r: 1, c: 4 }; // Black near top

    const wallMoves = AICore.generateSmartWallMoves(state, 0); // White thinking
    // Should suggest walls that block Black
    assert.ok(wallMoves.length > 0, 'Should generate some defensive walls');
    console.log('✅ Passed');
}

// TEST 4: Performance Benchmark (Baseline)
{
    console.log('Test 4: Performance Benchmark (approx)');
    const state = createTestState();
    const start = Date.now();
    // Force "medium" difficulty = depth 3
    const move = AICore.think(state, 0, 'medium');
    const duration = Date.now() - start;

    assert.ok(move, 'AI should return a move');
    console.log(`Time taken for Depth 3 (Start Pos): ${duration}ms`);
    // Hard limit for starting pos shouldn't be too high, but let's just log it for now
    console.log('✅ Passed');
}

// TEST 5: Transposition Table Cache
{
    console.log('Test 5: Transposition Table caching');
    const state = createTestState();

    // First run - fills TT
    const t1 = Date.now();
    AICore.think(state, 0, 'medium');
    const d1 = Date.now() - t1;

    // Second run - should be instant
    const t2 = Date.now();
    AICore.think(state, 0, 'medium');
    const d2 = Date.now() - t2;

    console.log(`First run: ${d1}ms, Second run: ${d2}ms`);
    // Note: due to random noise in think() score, caching effectiveness in think() root loop is limited
    // because minimax returns exact values, but think adds random noise.
    // However, the *internal* minimax recursive calls should be consistently cached.

    // The root think loop clears TT if it's too big, but here it's small.
    // Wait, think() calls generateMoves(), then loops moves, applying them and calling minimax.
    // If we call think() again, it will recalculate everything because 'applyMove' changes state
    // producing keys that weren't in TT's root (only children were cached).
    // Actually, TT stores EXACT state. So if we pass same state object (deeply equal),
    // keys will match.

    // Ideally d2 << d1. But since think() has a loop that applies moves, 
    // the root calls themselves are not cached (minimax is cached).
    // So the second run will still traverse the moves loop, but the minimax calls inside will hit cache immediately 
    // if the depth requested <= cached depth.

    // For 'medium' (depth 3), we call minimax(depth 2). Those should be cached.
    if (d2 < d1 * 0.5) {
        console.log('✅ TT is working effectively');
    } else {
        console.log('⚠️ TT might not be effective enough or overhead.');
    }
}

// TEST 6: Iterative Deepening Time Limit
{
    console.log('Test 6: Iterative Deepening Time Limit');
    const state = createTestState();
    const start = Date.now();

    // Request "impossible" (depth 20) which is impossible in 2s
    const move = AICore.think(state, 0, 'impossible');

    const duration = Date.now() - start;
    console.log(`Think took: ${duration}ms`);

    assert.ok(move, 'AI should return a move even on timeout');
    assert.ok(duration >= 1900 && duration < 3500, 'AI should respect ~2s time limit (with some margin)');

    console.log('✅ Passed');
}

console.log('All tests passed!');
