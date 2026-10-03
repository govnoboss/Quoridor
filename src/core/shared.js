// Thin Node re-export. The canonical implementation lives in quoridor-engine/rules/quoridor-rules.js
// so that the website, the engines and the arena referee cannot drift apart.
//
// The browser does NOT load this file: server.js serves the canonical UMD file directly as /shared.js
// (see the /shared.js routes in src/server.js). This shim only has to work under Node require().
'use strict';

module.exports = require('../../quoridor-engine/rules');
