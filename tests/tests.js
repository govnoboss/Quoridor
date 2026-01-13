const Shared = require('../src/core/shared.js');
const assert = require('assert');

// Colors for console output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

function runTest(name, testFn) {
    try {
        testFn();
        console.log(`${GREEN}✔ ${name}${RESET}`);
        passed++;
    } catch (e) {
        console.error(`${RED}✘ ${name} FAILED${RESET}`);
        console.error(e.message);
        failed++;
    }
}

// Helper to create a clean state
function createTestState() {
    return {
        hWalls: Array.from({ length: 8 }, () => Array(8).fill(false)),
        vWalls: Array.from({ length: 8 }, () => Array(8).fill(false)),
        players: [
            { color: 'white', pos: { r: 8, c: 4 }, wallsLeft: 10 },
            { color: 'black', pos: { r: 0, c: 4 }, wallsLeft: 10 }
        ],
        currentPlayer: 0,
        playerSockets: [null, null],
        playerTokens: ['token-p0', 'token-p1'],
        timers: [600, 600],
        increment: 0,
        lastMoveTimestamp: Date.now(),
        history: []
    };
}


console.log('🚀 Starting Quoridor Setup Tests...\n');

// ============================================================================
// 1. PAWN MOVEMENT TESTS
// ============================================================================

runTest('Pawn Movement - Simple Step', () => {
    const state = createTestState();
    // Default P0 at (8,4). Move Up to (7,4)
    assert.strictEqual(Shared.canMovePawn(state, 8, 4, 7, 4), true, 'Should be able to move up');
    // Move Right to (8,5)
    assert.strictEqual(Shared.canMovePawn(state, 8, 4, 8, 5), true, 'Should be able to move right');
    // Invalid move (diagonal)
    assert.strictEqual(Shared.canMovePawn(state, 8, 4, 7, 5), false, 'Should NOT move diagonally directly');
    // Invalid move (far away)
    assert.strictEqual(Shared.canMovePawn(state, 8, 4, 5, 5), false, 'Should NOT move far');
});

runTest('Pawn Movement - Blocked by Wall', () => {
    const state = createTestState();
    // Place horizontal wall above P0 (8,4) -> Wall at (7,4) blocks path (8,4)->(7,4)
    // Wall coordinates refer to the top-left corner of the intersection.
    // Horizontal wall at (7,4) blocks movement between Row 7 and Row 8, Cols 4-5.
    // Actually, based on logic: hWalls[r][c] blocks movement between (r, c) and (r+1, c) AND (r, c+1) and (r+1, c+1) ??
    // Wait, let's re-verify shared.js isWallBetween logic.
    // isWallBetween(fr, fc, tr, tc):
    // if dr=1 (down): checks hWalls[fr][fc] and hWalls[fr][fc-1]
    // if dr=-1 (up): checks hWalls[fr-1][fc] and hWalls[fr-1][fc-1]

    // We want to block (8,4) -> (7,4) (Up). fr=8, tr=7. dr=-1.
    // Checks hWalls[7][4] (right) or hWalls[7][3] (left).

    state.hWalls[7][4] = true;
    assert.strictEqual(Shared.canMovePawn(state, 8, 4, 7, 4), false, 'Should be blocked by hWall');

    // But moving sideways should be fine
    assert.strictEqual(Shared.canMovePawn(state, 8, 4, 8, 5), true, 'Should still move sideways');
});

runTest('Pawn Movement - Jump Over Opponent (Straight)', () => {
    const state = createTestState();
    // Setup: P0 at (8,4), P1 at (7,4)
    state.players[0].pos = { r: 8, c: 4 };
    state.players[1].pos = { r: 7, c: 4 };

    // P0 should be able to jump to (6,4)
    assert.strictEqual(Shared.canMovePawn(state, 8, 4, 6, 4), true, 'Should jump over opponent');
    // P0 should NOT be able to land ON opponent (7,4)
    assert.strictEqual(Shared.canMovePawn(state, 8, 4, 7, 4), false, 'Cannot land on opponent');
});

runTest('Pawn Movement - Jump Over Opponent (Diagonal)', () => {
    const state = createTestState();
    // Setup: P0 at (8,4), P1 at (7,4). Wall behind P1 at (6,4) blocking straight jump.
    // Or simpler: P1 at edge.
    // Let's use wall. Wall between (7,4) and (6,4). Same logic as before: Up from 7 to 6. Wall at 6,4.
    state.players[0].pos = { r: 8, c: 4 };
    state.players[1].pos = { r: 7, c: 4 };
    state.hWalls[6][4] = true; // Block jump to (6,4)

    // Should NOT allow straight jump
    assert.strictEqual(Shared.canMovePawn(state, 8, 4, 6, 4), false, 'Straight jump blocked');

    // Should allow diagonal jumps to (7,3) and (7,5)
    // Note: Jump mechanics usually imply landing next to opponent.
    // Logic: if straight jump blocked, check diagonals from opponent's pos (7,4) -> (7,3), (7,5)
    assert.strictEqual(Shared.canMovePawn(state, 8, 4, 7, 3), true, 'Diagonal jump Left');
    assert.strictEqual(Shared.canMovePawn(state, 8, 4, 7, 5), true, 'Diagonal jump Right');
});

// ============================================================================
// 2. WALL PLACEMENT TESTS
// ============================================================================

runTest('Wall Placement - Basic Availability', () => {
    const state = createTestState();
    // Place vertical wall at 4,4
    assert.strictEqual(Shared.checkWallPlacement(state, 4, 4, true), true, 'Empty slot valid');
});

runTest('Wall Placement - Collision/Overlap', () => {
    const state = createTestState();
    state.vWalls[4][4] = true;

    // Try place same wall
    assert.strictEqual(Shared.checkWallPlacement(state, 4, 4, true), false, 'Cannot place same vWall');

    // Try place crossing hWall
    assert.strictEqual(Shared.checkWallPlacement(state, 4, 4, false), false, 'Cannot cross vWall with hWall');

    // Try place overlapping vWall above/below (Quoridor walls are 2 cells long)
    // vWalls[4][4] spans rows 4 and 5.
    // vWalls[5][4] would span rows 5 and 6. They overlap at row 5.
    // Check Shared.js checkWallPlacement logic:
    // if (vertical) ... if (r > 0 && state.vWalls[r-1][c]) return false;
    // So if placing at 5,4. r-1 is 4. vWalls[4][4] is true.
    assert.strictEqual(Shared.checkWallPlacement(state, 5, 4, true), false, 'Cannot overlap vWall below');
    assert.strictEqual(Shared.checkWallPlacement(state, 3, 4, true), false, 'Cannot overlap vWall above');
});

runTest('Wall Placement - Blocking Path (isValidWallPlacement)', () => {
    const state = createTestState();
    // Trap P1 (0,4) with walls.
    // Goal for P1 is Row 8.
    // We surround (0,4).

    // Place walls around 0,4
    // vWall at 0,3 (left)
    // vWall at 0,4 (right)
    // hWall at 0,4 (below)
    state.vWalls[0][3] = true;
    state.vWalls[0][4] = true;

    // Now try to place last wall to seal them in: hWalls[0][4]
    // But we must simulate the placement first because isValidWallPlacement checks CURRENT state
    state.hWalls[0][4] = true;

    // P1 is at 0,4. Wants to go to Row 8.
    // Locked in cell 0,4?
    // Walls: Left (v0,3 spans 0-1), Right (v0,4 spans 0-1), Bottom (h0,4 spans 4-5).
    // What about Top? It's edge.
    // So P1 is trapped.

    assert.strictEqual(Shared.isValidWallPlacement(state), false, 'Should be invalid to trap player');
});

// ============================================================================
// 3. UTILITY AND STATE
// ============================================================================

runTest('Get Jump Targets - Returns Array', () => {
    const state = createTestState();
    const targets = Shared.getJumpTargets(state, 8, 4);
    assert.ok(Array.isArray(targets), 'Should return array');
    assert.ok(targets.length > 0, 'Should have moves');
});

// ============================================================================
// 4. INPUT VALIDATION TESTS (New)
// ============================================================================

runTest('Validation - isValidLobbyId', () => {
    assert.strictEqual(Shared.isValidLobbyId('lobby-123'), true, 'Valid lobby ID');
    assert.strictEqual(Shared.isValidLobbyId('lobby-abc'), false, 'Invalid lobby ID (letters)');
    assert.strictEqual(Shared.isValidLobbyId('lobby-'), false, 'Invalid lobby ID (empty number)');
    assert.strictEqual(Shared.isValidLobbyId(123), false, 'Invalid lobby ID (not a string)');
});

runTest('Validation - isValidPawnMove', () => {
    assert.strictEqual(Shared.isValidPawnMove({ type: 'pawn', r: 5, c: 5 }), true, 'Valid pawn move');
    assert.strictEqual(Shared.isValidPawnMove({ type: 'pawn', r: 9, c: 5 }), false, 'Row out of bounds');
    assert.strictEqual(Shared.isValidPawnMove({ type: 'wall', r: 5, c: 5 }), false, 'Wrong type');
    assert.strictEqual(Shared.isValidPawnMove({ type: 'pawn', r: 5, c: '5' }), false, 'Not an integer');
});

runTest('Validation - isValidWallMove', () => {
    assert.strictEqual(Shared.isValidWallMove({ type: 'wall', r: 0, c: 0, isVertical: true }), true, 'Valid wall move');
    assert.strictEqual(Shared.isValidWallMove({ type: 'wall', r: 7, c: 7, isVertical: false }), true, 'Valid corner wall move');
    assert.strictEqual(Shared.isValidWallMove({ type: 'wall', r: 8, c: 0, isVertical: true }), false, 'Row 8 out of bounds for wall');
    assert.strictEqual(Shared.isValidWallMove({ type: 'wall', r: 0, c: 0 }), false, 'Missing isVertical');
});

// ============================================================================
// 5. LOCALIZATION CONSISTENCY
// ============================================================================

runTest('Localization - Key Match (RU vs EN from ui.js)', () => {
    const fs = require('fs');
    const path = require('path');
    const uiContent = fs.readFileSync(path.join(__dirname, '../frontend/js/ui.js'), 'utf8');

    const extractKeys = (lang) => {
        const regex = new RegExp(`${lang}: \\{([\\s\\S]*?)\\},`, 'g');
        const match = regex.exec(uiContent);
        if (!match) return [];
        const block = match[1];
        const keys = [];
        const keyRegex = /^\s*([a-z0-9_]+):/gm;
        let keyMatch;
        while ((keyMatch = keyRegex.exec(block)) !== null) {
            keys.push(keyMatch[1]);
        }
        return keys;
    };

    const ruKeys = extractKeys('ru');
    const enKeys = extractKeys('en');

    assert.ok(ruKeys.length > 0, 'Should find RU keys');
    assert.ok(enKeys.length > 0, 'Should find EN keys');

    const missingInEn = ruKeys.filter(k => !enKeys.includes(k));
    const missingInRu = enKeys.filter(k => !ruKeys.includes(k));

    assert.strictEqual(missingInEn.length, 0, `Missing EN keys: ${missingInEn.join(', ')}`);
    assert.strictEqual(missingInRu.length, 0, `Missing RU keys: ${missingInRu.join(', ')}`);
});


// ============================================================================
// 6. REDUCER TESTS (New Architecture)
// ============================================================================

runTest('Reducer - Basic Pawn Move', () => {
    const state = createTestState();
    state.history = [];
    state.timers = [600, 600];

    const action = { type: 'pawn', r: 7, c: 4, playerIdx: 0 };
    const nextState = Shared.gameReducer(state, action);

    assert.strictEqual(nextState.players[0].pos.r, 7, 'P0 Row should be 7');
    assert.strictEqual(nextState.currentPlayer, 1, 'Current player should switch to 1');
    assert.strictEqual(nextState.history.length, 1, 'History should have 1 entry');
    assert.strictEqual(state.players[0].pos.r, 8, 'Original state must remain unchanged (Immutability)');
});

runTest('Reducer - Wall Placement', () => {
    const state = createTestState();
    state.history = [];

    const action = { type: 'wall', r: 7, c: 4, isVertical: false, playerIdx: 0 };
    const nextState = Shared.gameReducer(state, action);

    assert.strictEqual(nextState.hWalls[7][4], true, 'hWall[7][4] should be true');
    assert.strictEqual(nextState.players[0].wallsLeft, 9, 'P0 wallsLeft should be 9');
    assert.strictEqual(nextState.currentPlayer, 1, 'Current player should switch');
});

runTest('Reducer - Turn Sequence Violation', () => {
    const state = createTestState();

    // Attempt move by P1 when it is P0's turn
    const action = { type: 'pawn', r: 1, c: 4, playerIdx: 1 };

    assert.throws(() => {
        Shared.gameReducer(state, action);
    }, /Not your turn/, 'Should throw error if moving out of turn');
});

runTest('Reducer - Trapping Violation', () => {
    const s = createTestState();
    // P1 is at (0,4). Goal is Row 8.
    // Block all exits from Row 0 to Row 1 for columns 0-7:
    s.hWalls[0][0] = true; // 0, 1
    s.hWalls[0][2] = true; // 2, 3
    s.hWalls[0][4] = true; // 4, 5
    s.hWalls[0][6] = true; // 6, 7
    // Column 8 is the only exit to Row 1. 
    // Now block column 7|8 transition with a vertical wall.
    const finalAction = { type: 'vwall_at_the_end', r: 0, c: 7, isVertical: true, playerIdx: 0 };
    // Wait, the action must be a valid wall action.
    const action = { type: 'wall', r: 0, c: 7, isVertical: true, playerIdx: 0 };

    assert.throws(() => {
        Shared.gameReducer(s, action);
    }, /Wall blocks the only path to goal/);
});





console.log(`\n\nTest Summary: ${GREEN}${passed} Passed${RESET}, ${failed > 0 ? RED : GREEN}${failed} Failed${RESET}`);

if (failed > 0) process.exit(1);
