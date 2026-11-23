const { parentPort, workerData } = require('node:worker_threads');
const { createBotEngine } = require('./BotManager');
const engine = createBotEngine(workerData.difficulty, workerData.identity);
parentPort.on('message', ({ state, limits }) => {
    try { parentPort.postMessage({ result: engine.think(state, limits) }); }
    catch (err) { parentPort.postMessage({ error: err.message }); }
});
