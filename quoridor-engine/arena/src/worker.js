'use strict';
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const { playGame } = require('./match');

const adapter = require(path.resolve(workerData.adapterPath));
const botSpecs = require(path.resolve(workerData.botsPath));
const cache = new Map(); // "<slot>:<name>" -> bot instance (slot separates A/B so self-play gets two engines)

function getBot(slot, name) {
  const key = slot + ':' + name;
  if (!cache.has(key)) {
    if (!botSpecs[name]) throw new Error('unknown bot: ' + name);
    cache.set(key, adapter.makeBot(botSpecs[name], name));
  }
  return cache.get(key);
}

parentPort.on('message', (job) => {
  try {
    const res = playGame(adapter, getBot('A', job.a), getBot('B', job.b), job);
    parentPort.postMessage({ result: { ...res, gameId: job.gameId, a: job.a, b: job.b, aFirst: job.aFirst, openingId: job.openingId } });
  } catch (e) {
    parentPort.postMessage({ error: (e && e.stack) || String(e) });
  }
});
