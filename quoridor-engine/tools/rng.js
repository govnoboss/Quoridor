'use strict';
/**
 * Seedable RNG. The engine and the arena must never call Math.random(): a bug found in a match has to
 * be reproducible from the match seed alone.
 */

/** mulberry32 — small, fast, good enough, and trivially portable to other languages. */
function mulberry32(seed) {
    let a = seed | 0;
    return function () {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 32-bit integer from an arbitrary string, so seeds can be human-readable ("game-42"). */
function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** Combine a base seed with an id so each game of a match gets its own reproducible stream. */
function deriveSeed(seed, id) {
    return (Math.imul(seed | 0, 2654435761) ^ Math.imul(id + 1, 40503)) >>> 0;
}

function makeRng(seed) {
    const next = mulberry32(typeof seed === 'string' ? hashSeed(seed) : seed);
    return {
        next,
        int: (n) => Math.floor(next() * n),
        pick: (arr) => arr[Math.floor(next() * arr.length)],
        // Box-Muller, for eval noise
        normal: () => {
            const u = Math.max(1e-12, next());
            const v = next();
            return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        },
    };
}

module.exports = { mulberry32, hashSeed, deriveSeed, makeRng };
