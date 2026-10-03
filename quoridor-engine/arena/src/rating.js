'use strict';
// Bradley-Terry maximum-likelihood ratings from a pairwise score matrix (MM algorithm).
// pairs: [{a, b, w, d, l}] (from A's point of view). Returns {name: elo}, anchored.

function bradleyTerry(names, pairs, anchor) {
  const idx = new Map(names.map((n, i) => [n, i]));
  const N = names.length;
  const pts = Array.from({ length: N }, () => new Array(N).fill(0));
  const cnt = Array.from({ length: N }, () => new Array(N).fill(0));
  for (const { a, b, w, d, l } of pairs) {
    const i = idx.get(a), j = idx.get(b);
    const n = w + d + l;
    if (!n) continue;
    // small prior (half a draw each way) keeps ratings finite for 100% scores
    pts[i][j] += w + d / 2 + 0.25; pts[j][i] += l + d / 2 + 0.25;
    cnt[i][j] += n + 0.5;          cnt[j][i] += n + 0.5;
  }
  let p = new Array(N).fill(1);
  for (let it = 0; it < 5000; it++) {
    const np = p.map((_, i) => {
      let W = 0, den = 0;
      for (let j = 0; j < N; j++) if (j !== i && cnt[i][j]) { W += pts[i][j]; den += cnt[i][j] / (p[i] + p[j]); }
      return den ? W / den : p[i];
    });
    const g = Math.exp(np.reduce((s, x) => s + Math.log(x), 0) / N);
    const norm = np.map((x) => x / g);
    const diff = Math.max(...norm.map((x, i) => Math.abs(x - p[i])));
    p = norm;
    if (diff < 1e-10) break;
  }
  const elo = p.map((x) => 400 * Math.log10(x));
  const shift = anchor != null && idx.has(anchor) ? elo[idx.get(anchor)] : elo.reduce((s, x) => s + x, 0) / N;
  const out = {};
  names.forEach((n, i) => (out[n] = elo[i] - shift));
  return out;
}

module.exports = { bradleyTerry };
