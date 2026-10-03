// Filesystem locations of the engine's browser-facing artefacts.
//
// The rules are a single UMD file: Node requires it through quoridor-engine/rules/index.js, the
// browser gets the exact same bytes from the /shared.js route in src/server.js. Keep this in one
// place so server.js never has to know the internal layout of quoridor-engine.
'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

module.exports = {
    ROOT,
    RULES_FILE: path.join(ROOT, 'rules', 'quoridor-rules.js'),
    getEngineFile(name) {
        return path.join(ROOT, 'engines', name, 'engine.js');
    },
};
