const Shared = require('../src/core/shared.js');

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

describe('Pawn Movement', () => {
    it('Simple Step', () => {
        const state = createTestState();
        expect(Shared.canMovePawn(state, 8, 4, 7, 4)).toBe(true);
        expect(Shared.canMovePawn(state, 8, 4, 8, 5)).toBe(true);
        expect(Shared.canMovePawn(state, 8, 4, 7, 5)).toBe(false);
        expect(Shared.canMovePawn(state, 8, 4, 5, 5)).toBe(false);
    });

    it('Blocked by Wall', () => {
        const state = createTestState();
        state.hWalls[7][4] = true;
        expect(Shared.canMovePawn(state, 8, 4, 7, 4)).toBe(false);
        expect(Shared.canMovePawn(state, 8, 4, 8, 5)).toBe(true);
    });

    it('Jump Over Opponent (Straight)', () => {
        const state = createTestState();
        state.players[0].pos = { r: 8, c: 4 };
        state.players[1].pos = { r: 7, c: 4 };
        expect(Shared.canMovePawn(state, 8, 4, 6, 4)).toBe(true);
        expect(Shared.canMovePawn(state, 8, 4, 7, 4)).toBe(false);
    });

    it('Jump Over Opponent (Diagonal)', () => {
        const state = createTestState();
        state.players[0].pos = { r: 8, c: 4 };
        state.players[1].pos = { r: 7, c: 4 };
        state.hWalls[6][4] = true;
        expect(Shared.canMovePawn(state, 8, 4, 6, 4)).toBe(false);
        expect(Shared.canMovePawn(state, 8, 4, 7, 3)).toBe(true);
        expect(Shared.canMovePawn(state, 8, 4, 7, 5)).toBe(true);
    });
});

describe('Wall Placement', () => {
    it('Basic Availability', () => {
        const state = createTestState();
        expect(Shared.checkWallPlacement(state, 4, 4, true)).toBe(true);
    });

    it('Collision/Overlap', () => {
        const state = createTestState();
        state.vWalls[4][4] = true;
        expect(Shared.checkWallPlacement(state, 4, 4, true)).toBe(false);
        expect(Shared.checkWallPlacement(state, 4, 4, false)).toBe(false);
        expect(Shared.checkWallPlacement(state, 5, 4, true)).toBe(false);
        expect(Shared.checkWallPlacement(state, 3, 4, true)).toBe(false);
    });

    it('Blocking Path (isValidWallPlacement)', () => {
        const state = createTestState();
        state.vWalls[0][3] = true;
        state.vWalls[0][4] = true;
        state.hWalls[0][4] = true;
        expect(Shared.isValidWallPlacement(state)).toBe(false);
    });
});

describe('Utility and State', () => {
    it('Get Jump Targets - Returns Array', () => {
        const state = createTestState();
        const targets = Shared.getJumpTargets(state, 8, 4);
        expect(Array.isArray(targets)).toBe(true);
        expect(targets.length).toBeGreaterThan(0);
    });
});

describe('Input Validation', () => {
    it('isValidLobbyId', () => {
        expect(Shared.isValidLobbyId('lobby-123')).toBe(true);
        expect(Shared.isValidLobbyId('lobby-abc')).toBe(false);
        expect(Shared.isValidLobbyId('lobby-')).toBe(false);
        expect(Shared.isValidLobbyId(123)).toBe(false);
    });

    it('isValidPawnMove', () => {
        expect(Shared.isValidPawnMove({ type: 'pawn', r: 5, c: 5 })).toBe(true);
        expect(Shared.isValidPawnMove({ type: 'pawn', r: 9, c: 5 })).toBe(false);
        expect(Shared.isValidPawnMove({ type: 'wall', r: 5, c: 5 })).toBe(false);
        expect(Shared.isValidPawnMove({ type: 'pawn', r: 5, c: '5' })).toBe(false);
    });

    it('isValidWallMove', () => {
        expect(Shared.isValidWallMove({ type: 'wall', r: 0, c: 0, isVertical: true })).toBe(true);
        expect(Shared.isValidWallMove({ type: 'wall', r: 7, c: 7, isVertical: false })).toBe(true);
        expect(Shared.isValidWallMove({ type: 'wall', r: 8, c: 0, isVertical: true })).toBe(false);
        expect(Shared.isValidWallMove({ type: 'wall', r: 0, c: 0 })).toBe(false);
    });
});

describe('Localization Consistency', () => {
    it('Key Match (RU vs EN from ui.js)', () => {
        const fs = require('fs');
        const path = require('path');
        const uiContent = fs.readFileSync(path.join(__dirname, '../frontend/js/ui.js'), 'utf8');

        const extractKeys = (lang) => {
            const regex = new RegExp(`${lang}: \\{([\\s\\S]*?)\\},`, 'g');
            const match = regex.exec(uiContent);
            if (!match) return [];
            const keyRegex = /^\s*([a-z0-9_]+):/gm;
            const keys = [];
            let keyMatch;
            while ((keyMatch = keyRegex.exec(match[1])) !== null) {
                keys.push(keyMatch[1]);
            }
            return keys;
        };

        const ruKeys = extractKeys('ru');
        const enKeys = extractKeys('en');
        expect(ruKeys.length).toBeGreaterThan(0);
        expect(enKeys.length).toBeGreaterThan(0);

        const missingInEn = ruKeys.filter(k => !enKeys.includes(k));
        const missingInRu = enKeys.filter(k => !ruKeys.includes(k));
        expect(missingInEn.length).toBe(0);
        expect(missingInRu.length).toBe(0);
    });
});

describe('Reducer', () => {
    it('Basic Pawn Move', () => {
        const state = createTestState();
        state.history = [];
        state.timers = [600, 600];

        const action = { type: 'pawn', r: 7, c: 4, playerIdx: 0 };
        const nextState = Shared.gameReducer(state, action);

        expect(nextState.players[0].pos.r).toBe(7);
        expect(nextState.currentPlayer).toBe(1);
        expect(nextState.history.length).toBe(1);
        expect(state.players[0].pos.r).toBe(8);
    });

    it('Wall Placement', () => {
        const state = createTestState();
        state.history = [];

        const action = { type: 'wall', r: 7, c: 4, isVertical: false, playerIdx: 0 };
        const nextState = Shared.gameReducer(state, action);

        expect(nextState.hWalls[7][4]).toBe(true);
        expect(nextState.players[0].wallsLeft).toBe(9);
        expect(nextState.currentPlayer).toBe(1);
    });

    it('Turn Sequence Violation', () => {
        const state = createTestState();
        const action = { type: 'pawn', r: 1, c: 4, playerIdx: 1 };
        expect(() => Shared.gameReducer(state, action)).toThrow('Not your turn');
    });

    it('Trapping Violation', () => {
        const s = createTestState();
        s.hWalls[0][0] = true;
        s.hWalls[0][2] = true;
        s.hWalls[0][4] = true;
        s.hWalls[0][6] = true;
        const action = { type: 'wall', r: 0, c: 7, isVertical: true, playerIdx: 0 };
        expect(() => Shared.gameReducer(s, action)).toThrow('Wall blocks the only path to goal');
    });
});
