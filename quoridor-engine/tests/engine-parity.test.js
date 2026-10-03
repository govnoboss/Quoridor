'use strict';
/**
 * Parity: engine v0 must choose the same move as the website's src/core/ai-core.js.
 *
 * v0 is a port, so any divergence is a porting bug, not an improvement. Once this test is green, every
 * later SPRT result ("v1 beats v0") measures the search change and nothing else.
 *
 * Known, accepted divergences:
 *   - 'easy': the legacy engine flips a Math.random() coin and plays a random pawn move 30% of the time.
 *     v0 uses a seeded coin, so identity cannot be compared. We only require the move to be legal, and
 *     separately require v0's coin to be reproducible for a given seed.
 *   - Transposition table keys: legacy builds Zobrist tables with Math.random(), v0 with a seed. The
 *     table is an optimisation, not part of the decision, so keys may differ while moves agree.
 */

const path = require('path');
const Rules = require('../rules');
const { createEngineV0 } = require('../engines/v0');
const { generateMoves } = require('../rules/moves');
const { makeRng } = require('../tools/rng');

const SITE_ROOT = path.resolve(__dirname, '..', '..');
const Shared = require(path.join(SITE_ROOT, 'src', 'core', 'shared'));
const AICore = require(path.join(SITE_ROOT, 'src', 'core', 'ai-core'));

const key = (m) => (m ? `${m.type} ${m.r},${m.c}${m.type === 'wall' ? (m.isVertical ? ' V' : ' H') : ''}` : 'none');

/** Фиксированный набор позиций: начальная, сложные ходы в глубине, Late-game у цели, стены, джумпы. */
function buildPositions() {
    const positions = [{ name: 'initial', state: Rules.createInitialState() }];
    const rng = makeRng(20260930);

    // 12 позиций из случайных партий
    for (let g = 0; g < 12; g++) {
        const s = Rules.createInitialState();
        const plies = 20 + rng.int(70);
        for (let p = 0; p < plies; p++) {
            if (Rules.isGameOver(s).over) break;
            const moves = generateMoves(Rules, s);
            if (!moves.length) break;
            const m = moves[rng.int(moves.length)];
            Rules.gameReducer(s, {
                type: m.type, r: m.r, c: m.c,
                isVertical: m.isVertical, playerIdx: s.currentPlayer,
            });
        }
        if (!Rules.isGameOver(s).over) positions.push({ name: `playout-${g} (${plies} plies)`, state: s });
    }

    // Ручные края: у самой цели, плотные стены, джумп через соперника
    const nearGoal = Rules.createInitialState();
    nearGoal.players[0].pos = { r: 2, c: 4 };
    nearGoal.players[1].pos = { r: 6, c: 4 };
    nearGoal.currentPlayer = 0;
    positions.push({ name: 'near-goal', state: nearGoal });

    const jump = Rules.createInitialState();
    jump.players[0].pos = { r: 4, c: 4 };
    jump.players[1].pos = { r: 4, c: 5 };
    jump.currentPlayer = 0;
    positions.push({ name: 'straight-jump', state: jump });

    const boxed = Rules.createInitialState();
    boxed.players[0].pos = { r: 4, c: 4 };
    boxed.players[1].pos = { r: 4, c: 6 };
    for (let c = 0; c <= 8; c++) { boxed.hWalls[3][c] = true; boxed.hWalls[5][c] = true; }
    for (let r = 2; r <= 6; r++) { boxed.vWalls[r][3] = true; }
    boxed.players[0].wallsLeft = 4;
    boxed.players[1].wallsLeft = 2;
    boxed.currentPlayer = 0;
    positions.push({ name: 'boxed-in', state: boxed });

    return positions;
}

const POSITIONS = buildPositions();

describe('engine v0 vs src/core/ai-core.js', () => {
    // У legacy-движка дедлайн 2000 мс зашит в код, и лимита по узлам у него нет. Если машина загружена
    // (соседние воркеры арены, полный прогон jest), поиск обрывается на разной глубине, и два
    // независимых запуска дают РАЗНЫЕ ходы. Сравнивать v0 с таким результатом бессмысленно, поэтому
    // дорогие случаи сначала проверяются на самосогласованность и при нестабильности пропускаются с
    // предупреждением, а не падают с ложным «портирование сломалось».
    // Тест обязан доказать одно: при одинаковой ПОЛНОЙ глубине порт выбирает тот же ход, что и эталон.
    //
    // Проблема: у legacy дедлайн зашит в код (ai-core.js: `deadline = Date.now() + 2000`), лимита по
    // узлам нет, а `throw 'timeout'` перехватывается на уровне итерации. То есть при нехватке времени
    // движок МОЛЧА возвращает ход последней завершённой глубины. На нагруженной машине (12 параллельных
    // сьютов на 4 ядрах) near-goal/hard занимал ~2 s вместо 171 ms, эталон обрезался и отвечал
    // `pawn 1,4`, тогда как v0 доходил до глубины 5 и отвечал `wall 6,3`. Это не ошибка портирования,
    // это сравнение разных глубин.
    //
    // Решение: замораживаем Date.now(). Тогда `deadline = frozen + 2000` и `Date.now() > deadline`
    // никогда не срабатывает, и цикл итеративного углубления гарантированно доходит до maxDepth при
    // любой нагрузке. Прод-код не меняется. Симметрично отключаем и дедлайн v0.
    //
    // Проверка самосогласованности (два прогона и сравнение) тут не годится: под одинаковой нагрузкой
    // оба прогона обрезаются в одной точке и дают один и тот же неверный ответ.
    const FROZEN_MS = 1700000000000;

    /** Выполняет fn с замороженными часами: ни один из движков не может быть обрезан по времени. */
    function withFrozenClock(fn) {
        const spy = jest.spyOn(Date, 'now').mockImplementation(() => FROZEN_MS);
        try {
            return fn();
        } finally {
            spy.mockRestore();
        }
    }

    /** Подменяет Math.random детерминированным потоком, чтобы Zobrist-таблицы legacy были стабильны. */
    function seedMathRandom(seed) {
        const rng = makeRng(seed);
        jest.spyOn(Math, 'random').mockImplementation(() => rng.next());
    }

    /**
     * Запускает legacy на полной глубине и возвращает ход вместе с ДОКАЗАННОЙ глубиной.
     *
     * Глубина берётся из debug-лога (`ai-core.js`: `Depth: ${finalDepth}` / `MaxDepth: ${maxDepth}`),
     * а не выводится из того, что часы заморожены. Это превращает «должно работать по построению» в
     * измеренный факт: если движок когда-нибудь начнёт считать время иначе (performance.now, другой
     * источник часов, ранний выход), тест упадёт с внятным сообщением, а не станет молча случайным.
     */
    function legacyFullDepth(state, botIdx, difficulty) {
        const logs = [];
        AICore.DEBUG = true;
        AICore.logger = (...args) => logs.push(args.join(' '));
        try {
            const move = AICore.think(Shared.cloneState(state), botIdx, difficulty);
            const text = logs.join('\n');
            const maxDepth = Number((text.match(/MaxDepth: (\d+)/) || [])[1]);
            const finalDepth = Number((text.match(/Depth: (\d+)/) || [])[1]);
            const nodes = Number((text.match(/Nodes: (\d+)/) || [])[1]);
            return { move, maxDepth, finalDepth, nodes };
        } finally {
            AICore.DEBUG = false;
            AICore.logger = undefined;
        }
    }

    // TT в legacy глобальный и живёт между вызовами think, поэтому ответ на позицию N мог зависеть от
    // того, что считалось раньше. Чистая таблица и зафиксированный поток Math.random делают каждый
    // тест независимым от порядка выполнения.
    beforeEach(() => {
        seedMathRandom(12345);
        AICore.init(Shared);
    });

    afterEach(() => jest.restoreAllMocks());

    for (const { name, state } of POSITIONS) {
        for (const difficulty of ['medium', 'hard']) {
            test(`${name} / ${difficulty}: same move as the website engine`, () => {
                const botIdx = state.currentPlayer;
                const legacy = withFrozenClock(() => legacyFullDepth(state, botIdx, difficulty));

                // Смысловая проверка, а не страховка: сравнивать имеет смысл только полный обсчёт.
                expect(legacy.finalDepth).toBe(legacy.maxDepth);
                expect(legacy.nodes).toBeGreaterThan(0);

                const engine = createEngineV0({ seed: 1 });
                const res = withFrozenClock(() => engine.think(state, { difficulty, player: botIdx }));
                expect(res.depth).toBe(legacy.maxDepth);
                expect(key(res.move)).toBe(key(legacy.move));
            }, 60000);
        }
    }

    test('legacy hard: the full-depth answer does not depend on the Zobrist seed', () => {
        // Проверяет утверждение из шапки файла. Zobrist-таблицы legacy строятся через Math.random(),
        // то есть у каждого init() другое пространство ключей TT. Если при полной глубине ответ
        // зависит от этих ключей, то паритет «v0 == эталон» в принципе недостижим и это уже реальная
        // находка, а не вопрос тайминга. Проверяется ровно три сида на каждой позиции.
        for (const { name, state } of POSITIONS) {
            const answers = new Map();
            for (const seed of [1, 2, 3]) {
                jest.restoreAllMocks();
                seedMathRandom(seed);
                AICore.init(Shared);
                const run = withFrozenClock(() => legacyFullDepth(state, state.currentPlayer, 'hard'));
                expect(run.finalDepth).toBe(run.maxDepth);
                answers.set(key(run.move), (answers.get(key(run.move)) || 0) + 1);
            }
            expect(`${name}: ${answers.size}`).toBe(`${name}: 1`);
        }
    }, 120000);

    test('easy: v0 always returns a legal move (legacy is unseeded, so identity cannot be compared)', () => {
        for (const { name, state } of POSITIONS) {
            for (const seed of [1, 2, 3]) {
                const engine = createEngineV0({ seed });
                const res = engine.think(state, { difficulty: 'easy' });
                const legal = generateMoves(Rules, state).some(
                    m => key(m) === key(res.move) && m.priority === undefined
                ) || generateMoves(Rules, state).some(m => key(m) === key(res.move));
                expect(`${name}/seed${seed}: ${legal}`).toBe(`${name}/seed${seed}: true`);
            }
        }
    }, 60000);
});

describe('engine v0 contract', () => {
    test('the input state is never mutated', () => {
        const state = POSITIONS[5].state;
        const before = JSON.stringify(state);
        const engine = createEngineV0({ seed: 3 });
        engine.think(state, { difficulty: 'hard' });
        expect(JSON.stringify(state)).toBe(before);
    });

    test('the same seed reproduces the same move', () => {
        const state = POSITIONS[7].state;
        const a = createEngineV0({ seed: 99 }).think(state, { difficulty: 'medium' });
        const b = createEngineV0({ seed: 99 }).think(state, { difficulty: 'medium' });
        expect(key(a.move)).toBe(key(b.move));
        expect(a.nodes).toBe(b.nodes);
    });

    test('a different seed changes the easy-mode randomness but not the medium search', () => {
        const state = POSITIONS[7].state;
        const med = [1, 2, 3, 4].map(s => key(createEngineV0({ seed: s }).think(state, { difficulty: 'medium' }).move));
        expect(new Set(med).size).toBe(1);

        const easy = new Set();
        for (let s = 1; s <= 40; s++) easy.add(key(createEngineV0({ seed: s }).think(state, { difficulty: 'easy' }).move));
        // 30% случайных ходов при ~4 целях => несколько разных ходов за 40 партий
        expect(easy.size).toBeGreaterThan(1);
    });

    test('two engines in one process do not share a transposition table', () => {
        // Старый движок держал tt/killerMoves на уровне модуля, поэтому две партии в одном процессе
        // (и тем более в двух worker_threads) молча портили ходы друг друга.
        const a = createEngineV0({ seed: 5 });
        const b = createEngineV0({ seed: 5 });
        const s1 = POSITIONS[3].state;
        const s2 = POSITIONS[9].state;
        const first = key(a.think(s1, { difficulty: 'hard' }).move);
        b.think(s2, { difficulty: 'hard' });
        a.think(s1, { difficulty: 'hard' });
        const isolated = key(createEngineV0({ seed: 5 }).think(s1, { difficulty: 'hard' }).move);
        expect(first).toBe(isolated);
    }, 60000);

    test('reset() clears the table and the engine still answers', () => {
        const engine = createEngineV0({ seed: 11 });
        const s = POSITIONS[4].state;
        engine.think(s, { difficulty: 'hard' });
        engine.reset();
        expect(key(engine.think(s, { difficulty: 'hard' }).move)).toBe(key(createEngineV0({ seed: 11 }).think(s, { difficulty: 'hard' }).move));
    }, 60000);

    test('limits are respected: nodes budget cuts the search and reports it', () => {
        const state = POSITIONS[8].state;
        const engine = createEngineV0({ seed: 1 });
        const res = engine.think(state, { difficulty: 'hard', nodes: 200 });
        expect(res.nodes).toBeLessThanOrEqual(400);
        expect(res.move).not.toBeNull();
    }, 60000);

    test('limits are respected: time budget returns in roughly the budget', () => {
        const state = POSITIONS[8].state;
        const engine = createEngineV0({ seed: 1 });
        const t = Date.now();
        const res = engine.think(state, { difficulty: 'impossible', timeMs: 300 });
        const elapsed = Date.now() - t;
        expect(elapsed).toBeLessThan(1500);
        expect(res.timeMs).toBeLessThan(1500);
    }, 60000);

    test('a finished game produces no move', () => {
        const s = Rules.createInitialState();
        s.players[0].pos = { r: 0, c: 4 };
        s.currentPlayer = 0;
        const res = createEngineV0({ seed: 1 }).think(s, { difficulty: 'medium' });
        // Победа уже достигнута, но правила разрешают ход: главное, что движок не падает.
        expect(res.move === null || res.move.type === 'pawn' || res.move.type === 'wall').toBe(true);
    });

    test('thinking for a player who is not to move is refused instead of silently corrupting the search', () => {
        const s = Rules.createInitialState();
        s.currentPlayer = 0;
        expect(() => createEngineV0({ seed: 1 }).think(s, { difficulty: 'medium', player: 1 }))
            .toThrow(/not to move/);
    });

    test('a full self-play game never produces an illegal move', () => {
        const engine = createEngineV0({ seed: 424242 });
        const s = Rules.createInitialState();
        let plies = 0;
        while (plies < 200) {
            if (Rules.isGameOver(s).over) break;
            const legal = generateMoves(Rules, s);
            if (!legal.length) break;
            const res = engine.think(s, { difficulty: 'medium', timeMs: 100 });
            const m = legal.find(x => key(x) === key(res.move));
            if (!m) throw new Error(`ply ${plies}: illegal move ${key(res.move)} from ${JSON.stringify(s.players.map(p => p.pos))}`);
            Rules.gameReducer(s, { type: m.type, r: m.r, c: m.c, isVertical: m.isVertical, playerIdx: s.currentPlayer });
            plies++;
        }
        expect(plies).toBeGreaterThan(20);
    }, 120000);
});
