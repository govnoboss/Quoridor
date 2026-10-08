'use strict';
// Elo / SPRT math. Scores: win=1, draw=0.5, loss=0.

const clamp = (x, lo = 1e-9, hi = 1 - 1e-9) => Math.min(hi, Math.max(lo, x));
const eloFromScore = (p) => -400 * Math.log10(1 / clamp(p) - 1);
const scoreFromElo = (e) => 1 / (1 + Math.pow(10, -e / 400));

function erf(x) { // Abramowitz-Stegun 7.1.26
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

// stats of A vs B from W/D/L (A's point of view)
function computeStats({ w, d, l }) {
  const n = w + d + l;
  if (!n) return { n: 0, w, d, l, score: 0.5, elo: 0, eloLo: 0, eloHi: 0, eloErr: Infinity, los: 0.5 };
  const p = (w + d / 2) / n;
  const variance = (w * (1 - p) ** 2 + d * (0.5 - p) ** 2 + l * p ** 2) / n;
  const se = Math.sqrt(variance / n);
  const elo = eloFromScore(p);
  const eloLo = eloFromScore(p - 1.96 * se);
  const eloHi = eloFromScore(p + 1.96 * se);
  const los = (w + l) > 0 ? 0.5 * (1 + erf((w - l) / Math.sqrt(2 * (w + l)))) : 0.5;
  return { n, w, d, l, score: p, elo, eloLo, eloHi, eloErr: (eloHi - eloLo) / 2, los };
}

// GSPRT log-likelihood ratio, normal approximation (as in fishtest)
function sprtLLR({ w, d, l }, elo0, elo1) {
  const n = w + d + l;
  if (!n) return 0;
  const p = (w + d / 2) / n;
  const variance = (w * (1 - p) ** 2 + d * (0.5 - p) ** 2 + l * p ** 2) / n;
  if (variance <= 0) return 0;
  const s0 = scoreFromElo(elo0), s1 = scoreFromElo(elo1);
  return (n * (s1 - s0) * (2 * p - s0 - s1)) / (2 * variance);
}
const sprtBounds = (alpha = 0.05, beta = 0.05) => ({
  lower: Math.log(beta / (1 - alpha)),
  upper: Math.log((1 - beta) / alpha),
});

module.exports = { eloFromScore, scoreFromElo, computeStats, sprtLLR, sprtBounds };
