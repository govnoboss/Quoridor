// Node.js entry point for the canonical Quoridor rules.
// The browser gets the very same file via server route /shared.js, so there is exactly one
// implementation of the rules in the repository.
'use strict';

const path = require('path');

const RULES_FILE = path.join(__dirname, 'quoridor-rules.js');
const Rules = require(RULES_FILE);

if (!Rules || typeof Rules.gameReducer !== 'function') {
    throw new Error('quoridor-engine/rules: failed to load canonical rules from ' + RULES_FILE);
}

module.exports = Rules;
