'use strict';
/**
 * Move enumeration on top of any rules implementation.
 *
 * Kept separate from the rules so the same enumerator can drive the canonical rules, the reference
 * implementation, perft and the arena referee. `applyInPlace`/`undoInPlace` mutate the board without
 * cloning, which is what makes perft feasible; never call them on a live game state.
 */

const PLAYER_TARGET_ROW = [0, 8];

/** All legal moves for the side to move. Order: pawns first (DIRECTIONS order), then walls r,c,H,V. */
function generateMoves(rules, state, opts = {}) {
    const pawnsOnly = !!opts.pawnsOnly;
    const wallsOnly = !!opts.wallsOnly;
    const moves = [];
    const me = state.currentPlayer;
    const pos = state.players[me].pos;

    if (!wallsOnly) {
        for (const t of rules.getJumpTargets(state, pos.r, pos.c)) {
            moves.push({ type: 'pawn', r: t.r, c: t.c });
        }
    }

    if (!pawnsOnly && state.players[me].wallsLeft > 0) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                for (const isVertical of [false, true]) {
                    if (!rules.checkWallPlacement(state, r, c, isVertical)) continue;
                    const grid = isVertical ? state.vWalls : state.hWalls;
                    grid[r][c] = true;
                    const ok = rules.isValidWallPlacement(state);
                    grid[r][c] = false;
                    if (ok) moves.push({ type: 'wall', r, c, isVertical });
                }
            }
        }
    }

    return moves;
}

/** Mutating apply. Returns false (and leaves the state untouched) when the move is illegal. */
function applyInPlace(rules, state, move) {
    const me = state.currentPlayer;
    const p = state.players[me];

    if (move.type === 'pawn') {
        if (!rules.canMovePawn(state, p.pos.r, p.pos.c, move.r, move.c)) return false;
        p.pos = { r: move.r, c: move.c };
    } else if (move.type === 'wall') {
        if (p.wallsLeft <= 0) return false;
        if (!rules.checkWallPlacement(state, move.r, move.c, move.isVertical)) return false;
        const grid = move.isVertical ? state.vWalls : state.hWalls;
        grid[move.r][move.c] = true;
        if (!rules.isValidWallPlacement(state)) {
            grid[move.r][move.c] = false;
            return false;
        }
        p.wallsLeft--;
    } else {
        return false;
    }

    state.currentPlayer = 1 - me;
    return true;
}

function undoInPlace(rules, state, move, prevPos) {
    const me = 1 - state.currentPlayer; // the player who just moved
    if (move.type === 'pawn') {
        state.players[me].pos = { r: prevPos.r, c: prevPos.c };
    } else {
        const grid = move.isVertical ? state.vWalls : state.hWalls;
        grid[move.r][move.c] = false;
        state.players[me].wallsLeft++;
    }
    state.currentPlayer = me;
}

function isFinished(rules, state) {
    return rules.isGameOver(state).over;
}

module.exports = { generateMoves, applyInPlace, undoInPlace, isFinished, PLAYER_TARGET_ROW };
