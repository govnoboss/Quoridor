const AICore = require('../core/ai-core');
const Shared = require('../core/shared');

AICore.init(Shared);

const PuzzleEngine = {
    initialized: true,

    getShared() { return Shared; },
    getAICore() { return AICore; },

    evaluateAllMoves(state, playerIdx, depth = 4, timeLimitMs = 10000) {
        const deadline = Date.now() + timeLimitMs;
        const rawMoves = AICore.generateMoves(state, playerIdx);
        const results = [];

        for (const move of rawMoves) {
            if (Date.now() > deadline) break;

            const clone = AICore.cloneState(state);
            if (clone.hashHigh === undefined) {
                const h = AICore.computeZobristHash(clone);
                clone.hashHigh = h.hashHigh;
                clone.hashLow = h.hashLow;
            }

            AICore.applyMove(clone, move, playerIdx);

            try {
                const score = AICore.minimax(
                    clone, depth, -Infinity, Infinity,
                    false,
                    playerIdx
                );
                results.push({ move, score });
            } catch (e) {
                if (e === 'timeout') break;
                throw e;
            }
        }

        return results.sort((a, b) => b.score - a.score);
    },

    reconstructState(historyEntries, upToIndex) {
        const state = Shared.createInitialState();
        for (let i = 0; i <= upToIndex; i++) {
            const entry = historyEntries[i];
            if (!entry || !entry.move) continue;
            const action = { ...entry.move, playerIdx: entry.playerIdx };
            Shared.gameReducer(state, action);
        }
        return state;
    },

    classifyPuzzleType(bestMove, state) {
        const playerIdx = state.currentPlayer;
        if (bestMove.type === 'wall') {
            const oppIdx = 1 - playerIdx;
            const oppDist = AICore.shortestPathDistance(state, oppIdx);
            if (oppDist <= 3) return 'blocking_wall';
            return 'positional_wall';
        }
        if (bestMove.type === 'pawn') {
            const dist = AICore.shortestPathDistance(state, playerIdx);
            if (dist <= 3) return 'breakthrough';
            return 'fork';
        }
        return 'positional';
    },

    generateHint(bestMove, state) {
        const type = PuzzleEngine.classifyPuzzleType(bestMove, state);
        const hints = {
            breakthrough: [
                'Your pawn is close to the goal. Find the quickest path!',
                'Look for a jump or direct move that gets you one step closer to winning.'
            ],
            blocking_wall: [
                'Your opponent is close to reaching their goal. Place a wall to block them!',
                'Think about which wall placement would slow down your opponent the most.'
            ],
            positional_wall: [
                'Consider where a wall could disrupt your opponent\'s path.',
                'Look for a wall that creates a longer detour for your opponent.'
            ],
            fork: [
                'Find a move that advances your position while also creating problems for your opponent.',
                'Look for a pawn move that also threatens to reach the goal soon.'
            ],
            positional: [
                'Look for the move that gives you the best positional advantage.',
                'Consider both pawn movement and wall placement options.'
            ]
        };
        const pool = hints[type] || hints.positional;
        return pool[Math.floor(Math.random() * pool.length)];
    }
};

module.exports = PuzzleEngine;
