const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Shared = require('../quoridor-engine/rules');

function client() {
    const handlers = {}, globalHandlers = {};
    const canvas = {
        style: {},
        // Deliberately scaled and offset: phone and desktop must use logical coordinates.
        getBoundingClientRect: () => ({ left: 20, top: 40, width: 360, height: 360 }),
        addEventListener: (name, fn) => { handlers[name] = fn; }
    };
    const context = {
        Shared, navigator: { maxTouchPoints: 0 }, console,
        document: { getElementById: id => id === 'board' ? canvas : null, addEventListener() {} },
        window: { addEventListener: (name, fn) => { globalHandlers[name] = fn; } },
        UI: { AudioManager: { play: jest.fn() }, renderHistory: jest.fn() },
        Net: { isOnline: false, myColor: 'white', sendMove: jest.fn() },
        performance: { now: () => 0 }, setTimeout: jest.fn(),
        localStorage: { getItem: () => null }, EVAL_DEPTH_DEFAULT: 6
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/js/game.js'), 'utf8') + '\nthis.game = Game;', context);
    const game = context.game;
    for (const name of ['draw', 'initBotControls', 'updateTurnDisplay', 'startTimer', 'saveLocalSession', 'refreshBotControls', 'requestEval']) game[name] = jest.fn();
    game.animatePawn = jest.fn(); game.drawMoveHint = jest.fn();
    game.state.botDifficulty = 'none'; game.isGameLive = true;
    game.initEvents();
    function event(r, c, pointerType = 'mouse', dx = 0, dy = 0) {
        return { clientX: 20 + (c + 0.5 + dx) * 40, clientY: 40 + (game.transformRow(r) + 0.5 + dy) * 40,
            pointerType, button: 0, preventDefault() {}, stopImmediatePropagation() {} };
    }
    function tap(r, c, type = 'mouse', dx = 0, dy = 0) {
        const e = event(r, c, type, dx, dy);
        handlers.pointerdown(e); globalHandlers.pointerup(e); handlers.click(e);
    }
    return { game, context, handlers, globalHandlers, canvas, tap, event };
}

describe('pawn movement without selecting the pawn', () => {
    test('shows legal destinations immediately and updates them after a local turn', () => {
        const { game, tap } = client();
        game.drawPossibleMoves();
        expect(game.drawMoveHint.mock.calls.map(args => args.slice(0, 2))).toEqual(expect.arrayContaining([[7, 4], [8, 3], [8, 5]]));
        expect(game.drawMoveHint).toHaveBeenCalledTimes(3);
        tap(7, 4);
        game.drawMoveHint.mockClear(); game.drawPossibleMoves();
        expect(game.drawMoveHint.mock.calls.map(args => args.slice(0, 2))).toEqual(expect.arrayContaining([[1, 4], [0, 3], [0, 5]]));
    });

    test.each(['mouse', 'touch'])('a %s tap moves once, records history and changes turn', type => {
        const { game, tap } = client(); tap(7, 4, type);
        expect(game.state.players[0].pos).toEqual({ r: 7, c: 4 });
        expect(game.state.currentPlayer).toBe(1);
        expect(game.state.history).toHaveLength(1);
        expect(game.state.history[0].move).toEqual({ type: 'pawn', r: 7, c: 4 });
        expect(game.animatePawn).toHaveBeenCalledTimes(1);
    });

    test('an online tap sends a move without changing the authoritative board', () => {
        const { game, context, tap } = client(); context.Net.isOnline = true;
        tap(7, 4);
        expect(context.Net.sendMove).toHaveBeenCalledWith({ type: 'pawn', r: 7, c: 4 });
        expect(context.Net.sendMove).toHaveBeenCalledTimes(1);
        expect(game.state.players[0].pos).toEqual({ r: 8, c: 4 });
        expect(game.state.history).toHaveLength(0);
    });

    test('black can tap destinations on the flipped board', () => {
        const { game, context, tap } = client();
        context.Net.isOnline = true; context.Net.myColor = 'black';
        game.myPlayerIndex = 1; game.state.currentPlayer = 1;
        tap(1, 4, 'touch');
        expect(context.Net.sendMove).toHaveBeenCalledWith({ type: 'pawn', r: 1, c: 4 });
    });

    test.each(['blocked', 'opponent', 'bot', 'history', 'replay', 'finished', 'inactive'])('%s state has no actionable hints or moves', mode => {
        const { game, context, handlers, event } = client();
        if (mode === 'blocked') game.isInputBlocked = true;
        if (mode === 'opponent') { context.Net.isOnline = true; context.Net.myColor = 'black'; }
        if (mode === 'bot') { game.state.botDifficulty = 'easy'; game.myPlayerIndex = 1; }
        if (mode === 'history') game.viewHistoryIndex = 0;
        if (mode === 'replay') game.isReplayMode = true;
        if (mode === 'finished') game.isGameOver = true;
        if (mode === 'inactive') game.isGameLive = false;
        game.drawPossibleMoves(); handlers.click(event(7, 4));
        expect(game.drawMoveHint).not.toHaveBeenCalled();
        expect(game.state.players[0].pos).toEqual({ r: 8, c: 4 });
        expect(context.Net.sendMove).not.toHaveBeenCalled();
    });

    test('blocked cells do nothing; legal jumps and diagonal jumps use the shared rules', () => {
        const { game, tap } = client();
        game.state.hWalls[7][4] = true; tap(7, 4);
        expect(game.state.history).toHaveLength(0);
        game.state.hWalls[7][4] = false;
        game.state.players[1].pos = { r: 7, c: 4 };
        tap(7, 4); expect(game.state.history).toHaveLength(0);
        tap(6, 4); expect(game.state.players[0].pos).toEqual({ r: 6, c: 4 });
        game.state.currentPlayer = 0; game.state.players[0].pos = { r: 8, c: 4 };
        game.state.hWalls[6][4] = true;
        tap(7, 3); expect(game.state.players[0].pos).toEqual({ r: 7, c: 3 });
    });

    test('a hint takes priority over a stale wall preview and gets a pointer cursor', () => {
        const { game, canvas, tap } = client();
        game.state.hoverWall = { r: 6, c: 3, isVertical: false, isValid: true };
        game.updateHoverWall(4.5 * 120, 7.5 * 120);
        expect(canvas.style.cursor).toBe('pointer');
        expect(game.state.hoverWall).toBeNull();
        tap(7, 4); expect(game.state.players[0].pos).toEqual({ r: 7, c: 4 });
        expect(game.state.players[0].wallsLeft).toBe(10);
    });

    test('wall placement at the edge of a highlighted cell still works', () => {
        const { game, tap } = client(); game.animateWall = jest.fn();
        game.updateHoverWall(4.98 * 120, 7.5 * 120);
        expect(game.state.hoverWall?.isValid).toBe(true);
        tap(7, 4, 'mouse', 0.48);
        expect(game.state.history[0].move.type).toBe('wall');
        expect(game.state.players[0].wallsLeft).toBe(9);
        expect(game.state.players[0].pos).toEqual({ r: 8, c: 4 });
    });

    test('legacy pawn drag followed by browser click cannot move twice', () => {
        const { game, handlers, globalHandlers, event } = client();
        handlers.pointerdown(event(8, 4));
        globalHandlers.pointermove(event(7, 4)); globalHandlers.pointerup(event(7, 4));
        handlers.click(event(7, 4));
        expect(game.state.players[0].pos).toEqual({ r: 7, c: 4 });
        expect(game.state.history).toHaveLength(1);
    });

    test('a winning tap ends the game without changing turn', () => {
        const { game, tap } = client();
        game.state.players[0].pos = { r: 1, c: 3 };
        game.handleGameOver = jest.fn(); tap(0, 3);
        expect(game.handleGameOver).toHaveBeenCalledWith(0, 'Goal reached');
        expect(game.state.currentPlayer).toBe(0);
    });
});
