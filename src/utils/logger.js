/**
 * Структурированное логирование через debug.
 *
 * Использование:
 *   const log = require('./utils/logger');
 *   log.server('Server started on port %d', port);
 *   log.redis('Connected to Redis');
 *   log.game('Game %s created', lobbyId);
 *   log.ai('AI thinking depth=%d', depth);
 *   log.db('Query took %dms', elapsed);
 *
 * Включить:
 *   DEBUG=quoridor:* node src/server.js         // все логи
 *   DEBUG=quoridor:server,quoridor:redis npm run dev // только сервер + redis
 *   DEBUG=quoridor:game,quoridor:ai npm start    // только игра + AI
 */
const debug = require('debug');

const server = debug('quoridor:server');
const redis = debug('quoridor:redis');
const game = debug('quoridor:game');
const ai = debug('quoridor:ai');
const db = debug('quoridor:db');
const auth = debug('quoridor:auth');
const matchmaking = debug('quoridor:matchmaking');
const error = debug('quoridor:error');

module.exports = { server, redis, game, ai, db, auth, matchmaking, error };
