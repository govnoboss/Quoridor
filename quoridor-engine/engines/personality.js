'use strict';
/**
 * Per-bot "personality": a deterministic weight perturbation derived from the bot's id, so different
 * bot accounts prefer different structures (more/less wall-happy, more/less tempo-driven) and open
 * differently even before any randomness. Keep `spread` small; verify strength on the arena.
 *
 *   const { weights, archetypes } = personality(botAccountId);
 *   createEngineV3({ seed: <random per game>, weights, variety: VARIETY_DEFAULT,
 *                    archetype: { names: archetypes } });
 *
 * `center`/`infl` keep their tuned v3 defaults — the perturbation only touches the terms the v1
 * reference (engines/v1) already varied, which is where the measured style diversity comes from.
 *
 * `archetypes` is a set of 3 preferred opening plans for the bot (see engines/v3 ARCHETYPE_NAMES); the
 * engine draws one per game with its seeded rng, so the same bot still opens differently game to game.
 * The names are duplicated here rather than required from v3 so this module stays dependency-free for
 * the browser bundle; tests assert the two lists agree.
 */
function hashStr(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const BASE = { path: 100, tempo: 45, wall: 220, flex: 9, race: 1200, urg: 5 };
const ARCHETYPES = ['race', 'center', 'flank', 'wall', 'hoard'];

function personality(botId, spread = 0.25) {
  const r = mulberry32(hashStr(String(botId)));
  const m = (k, sp) => Math.round(BASE[k] * (1 + (r() * 2 - 1) * sp));
  const weights = {
    path: m('path', spread / 2),
    tempo: m('tempo', spread),
    wall: m('wall', spread),
    flex: m('flex', spread),
    race: BASE.race,
    urg: m('urg', spread),
  };
  const pool = ARCHETYPES.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
  return { weights, archetypes: pool.slice(0, 3) };
}

module.exports = { personality, ARCHETYPES };
