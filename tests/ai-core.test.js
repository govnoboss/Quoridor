const Shared = require('../src/core/shared');
const AICore = require('../src/core/ai-core');

beforeAll(() => {
    AICore.init(Shared);
});

function createInitialState() {
    return Shared.createInitialState();
}

describe('AI Core', () => {
    it('Test 1: Shortest Path Distance', () => {
        const state = createInitialState();
        const dist = AICore.shortestPathDistance(state, 0);
        expect(dist).toBe(8);

        state.players[0].pos = { r: 7, c: 4 };
        expect(AICore.shortestPathDistance(state, 0)).toBe(7);
    });

    it('Test 2: Generate Moves (Pawn)', () => {
        const state = createInitialState();
        const moves = AICore.generateMoves(state, 0).filter(m => m.type === 'pawn');
        expect(moves.length).toBe(3);

        const hasUp = moves.some(m => m.r === 7 && m.c === 4);
        expect(hasUp).toBe(true);
    });

    it('Test 3: Smart Wall Generation', () => {
        const state = createInitialState();
        state.players[0].pos = { r: 4, c: 4 };
        state.players[1].pos = { r: 5, c: 4 };
        state.players[0].wallsLeft = 5;
        state.players[1].wallsLeft = 5;
        state.currentPlayer = 0;

        const wallMoves = AICore.generateSmartWallMoves(state, 0);
        expect(wallMoves.length).toBeGreaterThan(0);
    });

    it('Test 4: Performance Benchmark', () => {
        const state = createInitialState();
        const start = Date.now();
        const move = AICore.think(state, 0, 'medium');
        const duration = Date.now() - start;

        expect(move).toBeTruthy();
        expect(duration).toBeLessThan(10000);
    });

    it('Test 5: Transposition Table caching', () => {
        const state = createInitialState();
        AICore.tt.clear();

        const t1 = Date.now();
        AICore.think(state, 0, 'medium');
        const d1 = Date.now() - t1;

        const t2 = Date.now();
        AICore.think(state, 0, 'medium');
        const d2 = Date.now() - t2;

        expect(d2).toBeLessThan(d1 + 50);
    });

    it('Test 6: Iterative Deepening Time Limit', () => {
        const state = createInitialState();
        const start = Date.now();

        const move = AICore.think(state, 0, 'impossible');

        const duration = Date.now() - start;

        expect(move).toBeTruthy();
        expect(duration).toBeLessThan(3500);
    });
});
