'use strict';
/**
 * Bot matchmaking (src/bots/matchmaking.js). Pure-function tests: no Mongo, Redis or sockets.
 */

const { botIdentity, styleOf, chooseBot } = require('../src/bots/matchmaking');

const cand = (identity, difficulty, style) => ({ identity, difficulty, style: style || `${difficulty}/race` });
const rec = (id, difficulty, style) => ({ id, difficulty, style: style || `${difficulty}/race`, at: Date.now() });

describe('matchmaking', () => {
    it('botIdentity is stable per account and per guest template', () => {
        expect(botIdentity({ kind: 'account', userId: 'u1' })).toBe('acct:u1');
        expect(botIdentity({ kind: 'guest', name: 'Guest-a1b2' })).toBe('guest:Guest-a1b2');
        expect(botIdentity({ kind: 'guest', name: 'Guest-a1b2' })).toBe('guest:Guest-a1b2');
    });

    it('styleOf is deterministic and combines tier with the signature plan', () => {
        const a = styleOf('acct:u1', 'hard');
        expect(a).toBe(styleOf('acct:u1', 'hard'));
        expect(a.startsWith('hard/')).toBe(true);
        expect(styleOf('acct:u1', 'medium')).toBe(styleOf('acct:u1', 'medium'));
        expect(styleOf('acct:u1', 'medium')).not.toBe(styleOf('acct:u1', 'hard'));
    });

    it('empty candidates give null, a lone candidate is always returned', () => {
        expect(chooseBot([], [])).toBeNull();
        const only = cand('acct:x', 'easy');
        expect(chooseBot([only], [rec('acct:x', 'easy')])).toBe(only);
    });

    it('the last opponents are avoided when alternatives exist', () => {
        const candidates = [cand('acct:a', 'easy'), cand('acct:b', 'medium'), cand('acct:c', 'hard')];
        const recent = [rec('acct:a', 'easy'), rec('acct:b', 'medium')];
        for (let i = 0; i < 50; i++) {
            expect(chooseBot(candidates, recent, { rng: Math.random }).identity).toBe('acct:c');
        }
    });

    it('least-recently-seen wins: a never-faced bot beats a recently-faced one', () => {
        const candidates = [cand('acct:a', 'easy'), cand('acct:new', 'hard')];
        // last style is different from both candidates, so only the LRU rule decides here.
        const recent = [rec('acct:a', 'easy', 'easy/other')];
        // avoidLast 0 so nothing is excluded by the hard rule; the LRU rule must still pick the new bot.
        for (let i = 0; i < 50; i++) {
            expect(chooseBot(candidates, recent, { rng: Math.random, avoidLast: 0 }).identity).toBe('acct:new');
        }
    });

    it('contrast mode prefers a different tier/style from the previous opponent', () => {
        const candidates = [cand('acct:a', 'easy', 'easy/race'), cand('acct:b', 'hard', 'hard/hoard')];
        const recent = [rec('acct:a', 'easy', 'easy/race')];
        // rng()->0 forces the contrast branch and the first (only) contrast candidate.
        const picked = chooseBot(candidates, recent, { rng: () => 0, contrastP: 0.2 });
        expect(picked.identity).toBe('acct:b');
    });

    it('the immediately previous style is avoided when another style remains', () => {
        const same = cand('acct:s', 'hard', 'hard/race');
        const other = cand('acct:o', 'hard', 'hard/hoard');
        const recent = [rec('acct:x', 'hard', 'hard/race')];   // different id, same style as `same`
        for (let i = 0; i < 50; i++) {
            expect(chooseBot([same, other], recent, { rng: Math.random }).identity).toBe('acct:o');
        }
    });
});
