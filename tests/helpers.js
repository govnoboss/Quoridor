let appCache = null;

async function getApp() {
    if (!appCache) {
        appCache = require('../src/server').app;
    }
    return appCache;
}

async function setupTestEnvironment() {
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-secret-for-testing';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
}

async function teardownTestEnvironment() {
    appCache = null;
}

module.exports = { setupTestEnvironment, teardownTestEnvironment, getApp };
