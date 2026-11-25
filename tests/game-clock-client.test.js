const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Shared = require('../quoridor-engine/rules');
const Clock = require('../frontend/js/game-clock');
function client() {
    let now = 0;
    let navType = 'reload';
    const elements = new Map(), listeners = {}, storage = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, { style: {}, textContent: '', classList: { add() {}, remove() {}, toggle() {} } });
        return elements.get(id);
    };
    const UI = new Proxy({ AudioManager: { play() {} } }, { get: (t,k) => t[k] || (() => {}) });
    const ctx = { Shared, GameClock: Clock, UI, navigator: { maxTouchPoints: 0 },
        document: { hidden: false, getElementById: element, addEventListener: (k,f) => { listeners[k] = f; } },
        window: { addEventListener: (k,f) => { listeners[k] = f; } }, location: { pathname: '/', search: '' },
        performance: { now: () => now, getEntriesByType: () => [{ type: navType }] }, Net: { isOnline: false, recoverGame: jest.fn() },
        AI: { cancelSearch: jest.fn(), makeMove: jest.fn(), newGame() {} },
        localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
        sessionStorage: { removeItem() {} }, trackEvent: jest.fn(), console,
        EVAL_DEPTH_DEFAULT: 6, setInterval: jest.fn(() => 1), clearInterval() {}, setTimeout() {} };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/js/game.js'),'utf8')+'\nthis.g = Game;',ctx);
    const g = ctx.g;
    for (const k of ['draw','restoreGameUI','exitBotMode','updateTurnDisplay','refreshBotControls','requestEval','enterBotMode']) g[k] = () => {};
    return { g,ctx,elements,listeners,storage,time: t => { now=t; }, navType: t => { navType=t; } };
}
describe('client clock/session recovery', () => {
    test('analytics local IDs survive restore, while a new game gets a fresh ID', () => {
        const c = client(); c.g.startPvP(); const firstId = c.g.analyticsGameId;
        expect(c.ctx.trackEvent).toHaveBeenCalledWith('game-started', expect.objectContaining({ gameId: firstId }));
        c.g.analyticsGameId = null; c.ctx.trackEvent.mockClear();
        expect(c.g.restoreLocalSession()).toBe(true); expect(c.g.analyticsGameId).toBe(firstId);
        expect(c.ctx.trackEvent).not.toHaveBeenCalled();
        c.g.startPvP(); expect(c.g.analyticsGameId).not.toBe(firstId);
    });
    test('online recovery restores the analytics lobby ID without a second start', () => {
        const c = client(); const state = Clock.start(Shared.createInitialState({ base: 60 }), 10000);
        c.g.applyNetworkSnapshot({ state, lobbyId: 'ABCDE', ...Clock.payload(state, 10000) });
        expect(c.g.analyticsGameId).toBe('online_ABCDE');
        expect(c.ctx.trackEvent).not.toHaveBeenCalled();
    });
    test('bot Restart closes the old analytics attempt and starts a distinct attempt', () => {
        const c = client(); c.g.state.gameMode = 'bot'; c.g.state.botDifficulty = 'easy'; c.g.myPlayerIndex = 0;
        c.g.isGameLive = true; c.g.analyticsGameId = 'old'; c.g.restartBotGame();
        expect(c.ctx.trackEvent).toHaveBeenCalledWith('game-abandoned', expect.objectContaining({ gameId: 'old', reason: 'restart' }));
        expect(c.ctx.trackEvent).toHaveBeenCalledWith('game-started', expect.objectContaining({ gameId: c.g.analyticsGameId }));
        expect(c.g.analyticsGameId).not.toBe('old');
    });
    test('local PvP has no ticking clock and survives arbitrary wall time', () => {
        const c=client(); c.g.startPvP(); c.time(1e12); c.g.tickTimer();
        expect(c.ctx.setInterval).not.toHaveBeenCalled();
        expect(c.g.isGameLive).toBe(true); expect(c.g.isGameOver).toBe(false);
        expect(c.elements.get('bottomPlayerTimer').style.display).toBe('none');
    });
    test('a full resume replaces the stale clock anchor and active side', () => {
        const c=client(); c.ctx.Net.isOnline=true;
        c.g.setTimerBase([60,60],0); c.time(10000);
        const state=Shared.createInitialState({ base:60 }); state.currentPlayer=1;
        Clock.start(state, 50000); state.clock.remainingMs=[58000,45000]; state.revision=5;
        c.g.applyNetworkSnapshot({ state, ...Clock.payload(state,50000) });
        expect(c.g.timers).toEqual([58,45]); expect(c.g.timerBase.active).toBe(1);
        c.time(11000); c.g.tickTimer(); expect(c.g.timers).toEqual([58,44]);
    });
    test('older snapshots and time-only updates cannot roll back the board', () => {
        const c=client(),state=Clock.start(Shared.createInitialState({base:60}), 10000); state.revision=5;
        c.g.applyNetworkSnapshot({ state,...Clock.payload(state,11000) });
        const old={...Clock.payload(state,10000),revision:4,state:{...state,currentPlayer:1}};
        expect(c.g.applyNetworkSnapshot(old)).toBe(false); expect(c.g.state.currentPlayer).toBe(0);
        c.g.syncTimers({...Clock.payload(state,12000),revision:6});
        expect(c.ctx.Net.recoverGame).toHaveBeenCalledTimes(1);
    });
    test('hidden local bot is cancelled; visible resumes only the active bot turn', () => {
        const c=client(); c.g.state.gameMode='bot'; c.g.state.botDifficulty='easy'; c.g.myPlayerIndex=0;
        c.g.state.currentPlayer=1; c.g.isGameLive=true;
        c.g.initTimerVisibilityHandlers();
        c.ctx.document.hidden=true; c.listeners.visibilitychange();
        expect(c.ctx.AI.cancelSearch).toHaveBeenCalledTimes(1);
        expect(c.storage.has('quoridor_local_session_v2')).toBe(true);
        c.ctx.document.hidden=false; c.listeners.visibilitychange();
        expect(c.ctx.AI.makeMove).toHaveBeenCalledTimes(1);
    });
    test('local session restore keeps the board/turn and disables clocks', () => {
        const c=client(); c.g.startPvP(); c.g.state.players[0].pos.r=6; c.g.state.currentPlayer=1; c.g.saveLocalSession();
        c.g.state=Shared.createInitialState();
        expect(c.g.restoreLocalSession()).toBe(true);
        expect(c.g.state.players[0].pos.r).toBe(6); expect(c.g.state.currentPlayer).toBe(1);
        expect(c.g._clock.enabled).toBe(false);
    });
    test('a fresh visit or app launch opens the menu instead of the saved local game', () => {
        const c=client(); c.g.startPvP(); c.g.state.players[0].pos.r=6; c.g.saveLocalSession();
        c.g.state=Shared.createInitialState(); c.navType('navigate');
        expect(c.g.restoreLocalSession()).toBe(false);
        expect(c.storage.has('quoridor_local_session_v2')).toBe(false);
        expect(c.g.state.players[0].pos.r).toBe(8);
    });
    test('leaving the game for the menu discards the saved local session', () => {
        const c=client(); c.g.startPvP();
        expect(c.storage.has('quoridor_local_session_v2')).toBe(true);
        expect(c.g.leaveActiveGame()).toBe(true);
        expect(c.storage.has('quoridor_local_session_v2')).toBe(false);
    });
    test('native app launch always opens the menu', () => {
        const c=client(); c.g.startPvP(); c.g.saveLocalSession();
        c.ctx.Capacitor = { isNativePlatform: () => true };
        expect(c.g.restoreLocalSession()).toBe(false);
        expect(c.storage.has('quoridor_local_session_v2')).toBe(false);
    });
    test('late AI application cannot mutate a finished board', () => {
        const c=client(); c.g.state.gameMode='bot'; c.g.isGameOver=true; c.g.isGameLive=false;
        const before=JSON.stringify(c.g.state); c.g.applyBotMove({type:'pawn',r:7,c:4});
        expect(JSON.stringify(c.g.state)).toBe(before);
    });
    test('restarting a local bot game immediately replaces the saved position', () => {
        const c=client(); c.g.state.gameMode='bot'; c.g.state.botDifficulty='easy'; c.g.myPlayerIndex=0;
        c.g.isGameLive=true; c.g.state.players[0].pos.r=6; c.g.saveLocalSession();
        c.g.restartBotGame();
        const saved=JSON.parse(c.storage.get('quoridor_local_session_v2'));
        expect(saved.state.players[0].pos.r).toBe(8);
        expect(saved.state.history).toHaveLength(0);
        expect(c.g._clock.enabled).toBe(false);
    });
    test('a final clock prevents static replay reconstruction from using future move times', () => {
        const c=client(); c.g._replayGameData={timeControl:{mode:'timed',base:120},finalClock:{enabled:true}};
        c.g._replayHistory=[{clock:{enabled:true,remainingMs:[112000,120000]}},{clock:{enabled:true,remainingMs:[112000,115000]}}];
        c.g.reconstructReplayTimers(2); expect(c.g.timers).toEqual([112,115]);
        c.g._replayHistory=[{timestamp:1000},{timestamp:50000}];c.g.reconstructReplayTimers(2);
        expect(c.g.timers).toBeNull();
    });
});
