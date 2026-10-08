'use strict';
/**
 * Adapter for the site's Quoridor core (src/core/shared.js + src/core/ai-core.js).
 *
 * !!! Everything marked ADAPT depends on the real signatures in shared.js — check and fix them. !!!
 * The arena needs exactly this interface (see adapters/toy.js for a minimal example):
 *   createInitialState(), cloneState(s), currentPlayer(s), winner(s) -> 0|1|null,
 *   positionKey(s) -> string, legalMoves(s) -> move[], applyMove(s, m) -> {state} | {error},
 *   makeBot(spec, name) -> { newGame(), think(state, playerIdx, limits) -> move }
 */
const path = require('path');

// ADAPT: paths (env overrides let you point the arena at any version of the engine)
const Shared = require(process.env.QUORIDOR_SHARED || path.resolve(__dirname, '../../src/core/shared.js'));
const AICoreModule = process.env.QUORIDOR_AICORE || path.resolve(__dirname, '../../src/core/ai-core.js');

const GOAL_ROW = [8, 0]; // ADAPT: target rows for player 0 / player 1 (check Shared.createInitialState)

function createInitialState() {
  return Shared.createInitialState(); // ADAPT: arguments (colors, timers...) if required
}

const cloneState = (s) => Shared.cloneState(s);
const currentPlayer = (s) => s.currentPlayer;

function winner(s) {
  // ADAPT: use Shared.checkVictory if it exists; this is the fallback via goal rows
  for (let p = 0; p < 2; p++) if (s.players[p].pos.r === GOAL_ROW[p]) return p;
  return null;
}

// Position key for repetition detection. Must include walls, pawns, side to move.
function positionKey(s) {
  return JSON.stringify([s.players[0].pos, s.players[1].pos, s.players[0].wallsLeft, s.players[1].wallsLeft, s.currentPlayer, s.hWalls, s.vWalls]);
}

// All legal moves (used only for random openings and perft/tests, so speed is not critical).
function legalMoves(s) {
  const moves = [];
  const me = s.players[s.currentPlayer];
  for (const t of Shared.getJumpTargets(s, me.pos.r, me.pos.c)) moves.push({ type: 'pawn', r: t.r, c: t.c });
  if (me.wallsLeft > 0) {
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        for (const isVertical of [false, true]) {
          const m = { type: 'wall', r, c, isVertical }; // ADAPT: wall move shape used by gameReducer
          if (applyMove(s, m).state) moves.push(m);
        }
  }
  return moves;
}

// Referee: MUST go through the same validation the server uses.
function applyMove(s, move) {
  try {
    const next = Shared.gameReducer(cloneState(s), move, s.currentPlayer); // ADAPT: real signature of gameReducer
    if (!next) return { error: 'rejected' };
    return { state: next };
  } catch (e) {
    return { error: String(e && e.message) };
  }
}

/**
 * Bot wrapper. spec examples (bots.json):
 *   { "difficulty": "hard" }                       -> legacy AICore.think(state, idx, difficulty)
 *   { "difficulty": "hard", "params": {...} }      -> future engine with tunable weights
 * limits = { timeMs?, depth?, nodes? } from the CLI.
 *
 * ADAPT: legacy AICore.think has a hardcoded 2000 ms and global TT. To make arena results meaningful,
 * patch ai-core.js so that think(state, idx, difficulty, opts) honours opts.timeMs / opts.depth / opts.nodes /
 * opts.params / opts.rng, and stop sharing TT/killers between instances (see README).
 */
function makeBot(spec) {
  // fresh copy of the module per bot instance so global TT/killers are not shared (works for UMD modules)
  const resolved = require.resolve(AICoreModule);
  delete require.cache[resolved];
  const AICore = require(resolved);
  if (AICore.init) AICore.init(Shared);
  return {
    newGame() { if (AICore.reset) AICore.reset(); },
    think(state, playerIdx, limits) {
      return AICore.think(state, playerIdx, spec.difficulty || 'hard', { ...limits, params: spec.params });
    },
  };
}

module.exports = { createInitialState, cloneState, currentPlayer, winner, positionKey, legalMoves, applyMove, makeBot };
