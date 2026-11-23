const BotManager = require('../src/bots/BotManager');
const Shared = require('../quoridor-engine/rules');
const Clock = require('../frontend/js/game-clock');

function manager(difficulty = 'hard') {
    const game = Clock.start(Shared.createInitialState({ base: 60, inc: 0 }), Date.now());
    Object.assign(game, { hasBot: true, botPlayerIdx: 0, botDifficulty: difficulty, botIdentity: 'clock-test-bot', playerTokens: ['bot-clock-test', 'human'] });
    const apply = jest.fn(async () => true);
    const instance = new BotManager({ Shared, Redis: { getGame: async () => JSON.parse(JSON.stringify(game)) }, applyBotMove: apply });
    return { game, apply, instance };
}

test('server AI calculates in a worker without stopping the event loop', async () => {
    const { game, apply, instance } = manager();
    let ticks = 0;
    const heartbeat = setInterval(() => { ticks++; }, 10);
    try {
        expect(await instance.makeMove('ABCDE')).toBe(true);
        expect(ticks).toBeGreaterThan(1);
        expect(apply).toHaveBeenCalledTimes(1);
        const move = apply.mock.calls[0][2];
        expect(() => Shared.gameReducer(game, { ...move, playerIdx: 0 })).not.toThrow();
    } finally { clearInterval(heartbeat); instance.cancelGame('ABCDE'); }
}, 15000);

test('cancelled server AI cannot apply its late result', async () => {
    const { game, apply, instance } = manager();
    const pending = instance.makeMove('ABCDE');
    await new Promise(resolve => setTimeout(resolve, 10));
    game.finished = true;
    instance.cancelGame('ABCDE');
    expect(await pending).toBe(false);
    expect(apply).not.toHaveBeenCalled();
}, 15000);
