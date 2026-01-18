const assert = require('assert');
const AICore = require('../src/core/ai-core.js');
const Shared = require('../src/core/shared.js');

// Mock shared library if needed, but we can use real one since Zobrist doesn't depend heavily on logic except move validation
// We'll use real Shared and AICore.

AICore.init(Shared);

describe('Zobrist Hashing', function () {

    it('should initialize zobrist tables', function () {
        assert.ok(AICore.zobristTable.pawn, 'Pawn table exists');
        assert.ok(AICore.zobristTable.vWalls, 'vWalls table exists');
        assert.ok(AICore.zobristTable.hWalls, 'hWalls table exists');
        assert.ok(AICore.zobristTable.turn, 'Turn table exists');

        // Check random values are not invalid
        const z = AICore.zobristTable.turn[0];
        assert.ok(typeof z.high === 'number');
        assert.ok(typeof z.low === 'number');
    });

    it('should calculate consistent hash from scratch', function () {
        const state = Shared.createInitialState();
        const hash1 = AICore.computeZobristHash(state);
        const hash2 = AICore.computeZobristHash(state);

        assert.strictEqual(hash1.high, hash2.high);
        assert.strictEqual(hash1.low, hash2.low);
    });

    it('should update hash incrementally correctly (applyMove)', function () {
        const state = Shared.createInitialState();
        // Initialize hash in state
        const initialHash = AICore.computeZobristHash(state);
        state.hashHigh = initialHash.hashHigh;
        state.hashLow = initialHash.hashLow;

        // Move white pawn (4,8) -> (4,7) ... wait, initial is (4,8) for white?
        // White starts at row 8, col 4? 
        // Shared.js: { pos: { r: 8, c: 4 } } (Index 0)

        const move = { type: 'pawn', r: 7, c: 4 }; // Move forward

        // Apply move
        AICore.applyMove(state, move, 0);

        // Incremental Hash
        const incHigh = state.hashHigh;
        const incLow = state.hashLow;

        // Scratch Hash
        const scratchHash = AICore.computeZobristHash(state);

        assert.strictEqual(incHigh, scratchHash.hashHigh, 'High hash mismatch after move');
        assert.strictEqual(incLow, scratchHash.hashLow, 'Low hash mismatch after move');
    });

    it('should restore hash correctly after undoMove', function () {
        const state = Shared.createInitialState();
        const initialHash = AICore.computeZobristHash(state);
        state.hashHigh = initialHash.hashHigh;
        state.hashLow = initialHash.hashLow;

        const move = { type: 'pawn', r: 7, c: 4 };

        AICore.applyMove(state, move, 0);
        AICore.undoMove(state, move, 0);

        assert.strictEqual(state.hashHigh, initialHash.hashHigh, 'High hash mismatch after UNDO');
        assert.strictEqual(state.hashLow, initialHash.hashLow, 'Low hash mismatch after UNDO');
    });

    it('should handle wall placement hashing', function () {
        const state = Shared.createInitialState();
        const initialHash = AICore.computeZobristHash(state);
        state.hashHigh = initialHash.hashHigh;
        state.hashLow = initialHash.hashLow;

        const move = { type: 'wall', r: 0, c: 0, isVertical: true };

        AICore.applyMove(state, move, 0);

        const scratchHash = AICore.computeZobristHash(state);

        assert.strictEqual(state.hashHigh, scratchHash.hashHigh, 'High hash mismatch after WALL move');
        assert.strictEqual(state.hashLow, scratchHash.hashLow, 'Low hash mismatch after WALL move');

        AICore.undoMove(state, move, 0);

        assert.strictEqual(state.hashHigh, initialHash.hashHigh, 'High hash mismatch after WALL UNDO');
        assert.strictEqual(state.hashLow, initialHash.hashLow, 'Low hash mismatch after WALL UNDO');
    });

});
