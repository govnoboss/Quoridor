'use strict';
/**
 * Independent reference implementation of the Quoridor rules.
 *
 * PURPOSE: cross-check the canonical rules (quoridor-rules.js). It is written from the rule text in a
 * deliberately different style so that a shared bug is unlikely:
 *
 *   canonical                      reference (here)
 *   -----------------------------  ---------------------------------------------------
 *   isWallBetween: 4 branches      blocked(): symmetric min/max formulation, no direction switch
 *   visited[9][9] + objects        flat Int8Array(81) + flat index stack
 *   getJumpTargets: nested ifs     candidate generation then filtering
 *
 * It is intentionally naive and slow. Do not use it in engines — only in tests, and later as the
 * definition the Rust port is validated against.
 *
 * Deviation from the official rules that is NOT implemented here (and not in the canonical file
 * either, so they stay consistent): placing a wall across the square a pawn stands on is allowed.
 * This is a known site rule bug, tracked separately. Do not "fix" one implementation without the
 * other, and re-run perft afterwards.
 */

const N = 9;
const GOAL_ROW = [0, 8];

const idx = (r, c) => r * N + c;

function pawnAt(state, r, c) {
    const p0 = state.players[0].pos;
    if (p0.r === r && p0.c === c) return true;
    const p1 = state.players[1].pos;
    return p1.r === r && p1.c === c;
}

/**
 * Is the straight step between two orthogonally adjacent cells blocked?
 * Symmetric formulation: a vertical wall slot at (row, col) sits between cells
 * (row, col)-(row, col+1) horizontally and (row, col)-(row+1, col) vertically... no:
 *   vertical wall vWalls[r][c] separates (r,c)|(r,c+1) and (r-1,c)|(r,c)
 *   horizontal wall hWalls[r][c] separates (r,c)|(r+1,c) and (r,c)|(r,c-1)
 */
function blocked(state, r1, c1, r2, c2) {
    if (r1 === r2) {
        // horizontal step: the separating wall column is the left one
        const wc = c1 < c2 ? c1 : c2;
        return !!(state.vWalls[r1 - 1] && state.vWalls[r1 - 1][wc]) ||
               !!(state.vWalls[r1] && state.vWalls[r1][wc]);
    }
    if (c1 === c2) {
        // vertical step: the separating wall row is the top one
        const wr = r1 < r2 ? r1 : r2;
        const left = c1 - 1;
        const hasLeft = left >= 0;
        return (hasLeft && !!state.hWalls[wr][left]) || !!state.hWalls[wr][c1];
    }
    throw new Error('blocked(): not an orthogonal step');
}

function onBoard(r, c) {
    return r >= 0 && r < N && c >= 0 && c < N;
}

/**
 * Destinations reachable by one pawn step from (r, c), following the official jump rules:
 *  - free adjacent cell           -> step
 *  - occupied adjacent cell, landing beyond it clear -> straight jump
 *  - otherwise                    -> diagonal jump to a cell next to the blocking pawn,
 *                                    reachable only if the step up to the pawn was not walled off
 * The order follows DIRECTIONS (N, S, W, E) to make comparison with the canonical file meaningful.
 */
function getJumpTargets(state, r, c) {
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const out = [];
    const seen = new Set();

    const add = (tr, tc) => {
        if (!onBoard(tr, tc)) return;
        const k = idx(tr, tc);
        if (seen.has(k)) return;
        seen.add(k);
        out.push({ r: tr, c: tc });
    };

    for (const [dr, dc] of dirs) {
        const br = r + dr, bc = c + dc;          // "beyond" cell
        if (!onBoard(br, bc)) continue;
        const mr = r + dr, mc = c + dc;          // the adjacent cell

        if (!pawnAt(state, mr, mc) && !blocked(state, r, c, mr, mc)) {
            add(mr, mc);
            continue;
        }
        if (!pawnAt(state, mr, mc)) continue;    // walled in: nothing in this direction

        // The blocking pawn is adjacent. Reaching it must not be walled off.
        if (blocked(state, r, c, mr, mc)) continue;

        const straightR = mr + dr, straightC = mc + dc;
        const straightOk = onBoard(straightR, straightC) &&
            !pawnAt(state, straightR, straightC) &&
            !blocked(state, mr, mc, straightR, straightC);

        if (straightOk) {
            add(straightR, straightC);
            continue;
        }

        // Diagonals: only the ones perpendicular to the step direction are candidates.
        if (dr !== 0) {
            for (const s of [-1, 1]) {
                const dr2 = mr, dc2 = mc + s;
                if (onBoard(dr2, dc2) && !pawnAt(state, dr2, dc2) && !blocked(state, mr, mc, dr2, dc2)) {
                    add(dr2, dc2);
                }
            }
        } else {
            for (const s of [-1, 1]) {
                const dr2 = mr + s, dc2 = mc;
                if (onBoard(dr2, dc2) && !pawnAt(state, dr2, dc2) && !blocked(state, mr, mc, dr2, dc2)) {
                    add(dr2, dc2);
                }
            }
        }
    }
    return out;
}

function canMovePawn(state, fr, fc, tr, tc) {
    return getJumpTargets(state, fr, fc).some(m => m.r === tr && m.c === tc);
}

/** Same adjacency rules as the canonical file: no touching parallel walls, no crossing. */
function checkWallPlacement(state, r, c, vertical) {
    if (r < 0 || r > 7 || c < 0 || c > 7) return false;
    const v = state.vWalls, h = state.hWalls;
    if (vertical) {
        if (v[r][c]) return false;
        if (r >= 1 && v[r - 1][c]) return false;
        if (r <= 6 && v[r + 1][c]) return false;
        if (h[r][c]) return false;
    } else {
        if (h[r][c]) return false;
        if (c >= 1 && h[r][c - 1]) return false;
        if (c <= 6 && h[r][c + 1]) return false;
        if (v[r][c]) return false;
    }
    return true;
}

/** Flat-array BFS instead of a 9x9 matrix of booleans. */
function hasPathToGoal(state, playerIdx) {
    const goal = GOAL_ROW[playerIdx];
    const start = state.players[playerIdx].pos;
    const seen = new Int8Array(N * N);
    const stack = [idx(start.r, start.c)];
    seen[stack[0]] = 1;

    for (let head = 0; head < stack.length; head++) {
        const cur = stack[head];
        const r = (cur / N) | 0, c = cur % N;
        if (r === goal) return true;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nr = r + dr, nc = c + dc;
            if (!onBoard(nr, nc)) continue;
            const nIdx = idx(nr, nc);
            if (seen[nIdx]) continue;
            if (blocked(state, r, c, nr, nc)) continue;
            seen[nIdx] = 1;
            stack.push(nIdx);
        }
    }
    return false;
}

function isValidWallPlacement(state) {
    return hasPathToGoal(state, 0) && hasPathToGoal(state, 1);
}

function isGameOver(state) {
    for (let i = 0; i < 2; i++) {
        if (state.players[i].pos.r === GOAL_ROW[i]) return { over: true, winner: i, reason: 'goal' };
    }
    return { over: false, winner: -1, reason: null };
}

function createInitialState() {
    return {
        hWalls: Array.from({ length: 8 }, () => Array(8).fill(false)),
        vWalls: Array.from({ length: 8 }, () => Array(8).fill(false)),
        players: [
            { color: 'white', pos: { r: 8, c: 4 }, wallsLeft: 10 },
            { color: 'black', pos: { r: 0, c: 4 }, wallsLeft: 10 },
        ],
        currentPlayer: 0,
        playerSockets: [null, null],
        playerTokens: [null, null],
        playerProfiles: [null, null],
        disconnectTimer: null,
        timers: [600, 600],
        increment: 0,
        lastMoveTimestamp: 0,
        history: [],
        isRanked: false,
    };
}

module.exports = {
    GOAL_ROW,
    pawnAt,
    blocked,
    onBoard,
    getJumpTargets,
    canMovePawn,
    checkWallPlacement,
    hasPathToGoal,
    isValidWallPlacement,
    isGameOver,
    createInitialState,
};
