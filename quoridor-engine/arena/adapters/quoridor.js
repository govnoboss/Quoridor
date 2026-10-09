'use strict';
/**
 * Quoridor adapter: bridges the arena to the canonical rules and the versioned engines.
 *
 * The arena is generic — it knows nothing about Quoridor. It calls this interface and nothing else:
 *   createInitialState(), cloneState(s), currentPlayer(s), winner(s) -> 0|1|null,
 *   positionKey(s) -> string, legalMoves(s) -> move[], applyMove(s, m) -> {state} | {error},
 *   makeBot(spec, name) -> { newGame(seed), think(state, playerIdx, limits) -> move }
 *
 * Three things this file exists to get right, each of which was broken in the original arena adapter:
 *
 * 1. GOAL_ROW. The original hardcoded [8, 0] — the START rows. Every position therefore "had a
 *    winner" from ply 0 and every game ended instantly. The goal row now comes from the rules.
 *
 * 2. The referee action. Rules.gameReducer(state, action) takes the acting player INSIDE the action and
 *    throws 'Not your turn' otherwise. The original called gameReducer(clone, move, s.currentPlayer) —
 *    the third argument was ignored, playerIdx was undefined, and every single move was rejected.
 *
 * 3. Bot isolation. The original made a bot by deleting the ai-core module from require.cache to get a
 *    private copy of its module-level transposition table. That is a global side effect and it breaks
 *    the moment two adapters live in one process. Here every game gets a brand new engine instance, so
 *    there is no shared TT, no shared killer table and no cross-game contamination to reason about.
 */

const Rules = require('../../rules');
const { generateMoves } = require('../../rules/moves');
const { createEngineV0 } = require('../../engines/v0');
const { createEngineV1 } = require('../../engines/v1');
const { createEngineV2 } = require('../../engines/v2');
const { createEngineV3 } = require('../../engines/v3');
const { deriveSeed } = require('../../tools/rng');

// --- Правила (судья) ---

function createInitialState() {
    return Rules.createInitialState();
}

const cloneState = (s) => Rules.cloneState(s);
const currentPlayer = (s) => s.currentPlayer;

/** null | 0 | 1. Строка цели берётся из правил, а не из константы адаптера. */
function winner(s) {
    const over = Rules.isGameOver(s);
    return over.over ? over.winner : null;
}

/** Ключ позиции для отлова повторов: пешки, стены, очереди хода и стены в запасе. */
function positionKey(s) {
    return JSON.stringify([
        s.players[0].pos, s.players[1].pos,
        s.players[0].wallsLeft, s.players[1].wallsLeft,
        s.currentPlayer, s.hWalls, s.vWalls,
    ]);
}

/**
 * Все легальные ходы. Используется только для случайных дебютов и тестов, но всё равно идёт через
 * общий генератор rules/moves: он покрыт parity-тестами против независимой реализации и на порядок
 * быстрее, чем перебор 128 слотов стен через клонирование состояния.
 */
function legalMoves(s) {
    return generateMoves(Rules, s).map(m => (
        m.type === 'wall' ? { type: 'wall', r: m.r, c: m.c, isVertical: m.isVertical } : { type: 'pawn', r: m.r, c: m.c }
    ));
}

/**
 * Судья. Любой ход, который проходит здесь, проходит и на сервере сайта: это буквально тот же
 * gameReducer из канонических правил. Возвращает {error} вместо исключения — арена трактует
 * нелегальный ход как поражение ходившего, и это правильное поведение рефери.
 */
function applyMove(s, move) {
    if (!move || (move.type !== 'pawn' && move.type !== 'wall')) return { error: 'unknown move type' };
    try {
        // playerIdx обязателен внутри action: gameReducer(state, action), а не gameReducer(state, action, idx)
        const next = Rules.gameReducer(s, {
            type: move.type,
            r: move.r,
            c: move.c,
            isVertical: move.isVertical,
            playerIdx: s.currentPlayer,
        });
        return { state: next };
    } catch (e) {
        return { error: (e && e.message) || String(e) };
    }
}

// --- Боты ---

const ENGINES = {
    v0: (opts) => createEngineV0(opts),
    v1: (opts) => createEngineV1(opts),
    v2: (opts) => createEngineV2(opts),
    v3: (opts) => createEngineV3(opts),
};

/**
 * spec (bots.json):
 *   { "engine": "v0", "difficulty": "hard" }
 *   { "engine": "v0", "difficulty": "easy", "easyRandomP": 1.0 }   -> случайный легальный ход
 *   { "engine": "v0", "params": { "timeMs": 250, "maxDepth": 6, "weights": { "mobility": 25 } } }
 *
 * limits приходят из CLI (--movetime / --depth / --nodes) и имеют приоритет над spec: иначе нельзя
 * было бы сравнить ботов на равном бюджете, не переписывая bots.json.
 */
function makeBot(spec, name) {
    const engineName = spec.engine || 'v0';
    const make = ENGINES[engineName];
    if (!make) throw new Error(`adapter: unknown engine "${engineName}" for bot ${name}`);

    let engine = null;
    let botName = name;

    return {
        /**
         * Новый движок на каждую партию. Не «сбросить таблицу», а создать заново: так у всех партий
         * матча одинаковое холодное стартовое состояние, иначе более поздние партии были бы сильнее
         * simply из-за накопленной TT, и это искажало бы SPRT.
         */
        newGame(seed) {
            engine = make({
                seed,
                timeMs: spec.timeMs,
                maxDepth: spec.maxDepth,
                nodes: spec.nodes,
                weights: spec.weights,
                difficulty: spec.difficulty,
                variety: spec.variety,
                archetype: spec.archetype,
                abortPolicy: spec.abortPolicy,
            });
        },
        think(state, playerIdx, limits = {}) {
            if (!engine) throw new Error(`adapter: bot ${botName} got think() before newGame()`);
            const res = engine.think(state, {
                timeMs: limits.timeMs,
                nodes: limits.nodes,
                // CLI отдаёт --depth, движок ждёт maxDepth
                maxDepth: limits.depth,
                difficulty: spec.difficulty || 'medium',
                player: playerIdx,
            });
            return res.move;
        },
    };
}

module.exports = {
    createInitialState, cloneState, currentPlayer, winner,
    positionKey, legalMoves, applyMove, makeBot,
};
