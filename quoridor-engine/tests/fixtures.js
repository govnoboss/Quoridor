'use strict';
/**
 * Position builders for tests. Everything starts from the canonical initial state so that a test only
 * has to describe what makes its position interesting.
 */

const Rules = require('../rules');

function createInitialState() {
    return Rules.createInitialState();
}

/** setWall(state, r, c, 'v' | 'h') — bypasses legality, for building deliberately weird positions. */
function setWall(state, r, c, orientation) {
    const vertical = orientation === 'v';
    if (vertical) state.vWalls[r][c] = true;
    else state.hWalls[r][c] = true;
}

/** setWalls(state, [[r, c, 'v'], ...]) */
function setWalls(state, list) {
    for (const [r, c, o] of list) setWall(state, r, c, o);
}

function setPawn(state, playerIdx, r, c) {
    state.players[playerIdx].pos = { r, c };
}

function setPawns(state, p0, p1) {
    if (p0) setPawn(state, 0, p0.r, p0.c);
    if (p1) setPawn(state, 1, p1.r, p1.c);
}

function setWallsLeft(state, p0, p1) {
    state.players[0].wallsLeft = p0;
    state.players[1].wallsLeft = p1;
}

function setTurn(state, playerIdx) {
    state.currentPlayer = playerIdx;
}

module.exports = { createInitialState, setWall, setWalls, setPawn, setPawns, setWallsLeft, setTurn };
