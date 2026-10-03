'use strict';
const Rules = require('../rules');
const RefRules = require('../rules/reference');
const { createInitialState } = require('../tests/fixtures');

function bench(name, fn, iters) {
    fn();
    const t = Date.now();
    let acc = 0;
    for (let i = 0; i < iters; i++) acc += fn() ? 1 : 0;
    console.log(`${name} ${iters} = ${Date.now() - t}ms (acc=${acc})`);
}

const s = createInitialState();
bench('canon  isWallBetween', () => Rules.isWallBetween(s, 4, 4, 3, 4), 500000);
bench('canon  checkWallPlace ', () => Rules.checkWallPlacement(s, 4, 4, true), 500000);
bench('canon  hasPawnAt     ', () => Rules.hasPawnAt(s, 4, 4), 500000);
bench('canon  hasPathToGoal ', () => Rules.hasPathToGoal(s, 0), 20000);
bench('ref    hasPathToGoal ', () => RefRules.hasPathToGoal(s, 0), 20000);
bench('canon  getJumpTargets', () => Rules.getJumpTargets(s, 4, 4).length, 200000);
bench('ref    getJumpTargets', () => RefRules.getJumpTargets(s, 4, 4).length, 200000);
