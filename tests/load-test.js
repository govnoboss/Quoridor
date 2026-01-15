/**
 * Load Test Script for Quoridor WebSocket Server
 * 
 * Usage:
 *   node tests/load-test.js [clients] [--url URL] [--find-game]
 * 
 * Examples:
 *   node tests/load-test.js 100                   # Connection test only
 *   node tests/load-test.js 100 --find-game       # Full matchmaking test
 *   node tests/load-test.js 50 -f                 # Short flag for --find-game
 */

const io = require('socket.io-client');
const crypto = require('crypto');

// ============================================================
// CONFIGURATION
// ============================================================

const config = {
    // Use explicit IPv4 to avoid Node.js resolving to IPv6 (::1)
    url: 'http://127.0.0.1:3000',
    clients: 10,
    delayBetweenConnections: 50, // ms - avoid burst connections
    connectionTimeout: 10000,    // 10 seconds
    findGame: false,             // --find-game mode
    timeControl: { base: 60, inc: 0 }, // 1 minute games
};

// Parse CLI arguments
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
        config.url = args[i + 1];
        i++;
    } else if (args[i] === '--find-game' || args[i] === '-f') {
        config.findGame = true;
    } else if (!isNaN(parseInt(args[i]))) {
        config.clients = parseInt(args[i]);
    }
}

// ============================================================
// METRICS
// ============================================================

const metrics = {
    total: config.clients,
    connected: 0,
    failed: 0,
    connectionTimes: [],
    errors: [],
    // Matchmaking metrics
    seenLobbies: new Set(),    // Track unique lobbies (each game = 1 lobby, 2 players)
    gamesFailed: 0,
    matchmakingTimes: [],
    findGameSentAt: new Map(), // socketId -> timestamp
};

const sockets = [];       // All socket instances
const clientData = [];    // { socket, token, index, inGame }

// ============================================================
// UTILITIES
// ============================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatPercent(num, total) {
    if (total === 0) return '0%';
    return ((num / total) * 100).toFixed(1) + '%';
}

function calculateStats(times) {
    if (times.length === 0) return { avg: 0, min: 0, max: 0 };
    const sum = times.reduce((a, b) => a + b, 0);
    return {
        avg: Math.round(sum / times.length),
        min: Math.min(...times),
        max: Math.max(...times),
    };
}

// ============================================================
// CLIENT CONNECTION
// ============================================================

async function connectClient(index) {
    return new Promise((resolve) => {
        const start = Date.now();
        const token = crypto.randomUUID(); // Unique token for each client

        const socket = io(config.url, {
            transports: ['polling', 'websocket'],
            timeout: config.connectionTimeout,
            reconnection: false,
            forceNew: true
        });

        sockets.push(socket);
        clientData.push({ socket, token, index, inGame: false });

        const timeoutId = setTimeout(() => {
            socket.disconnect();
            metrics.failed++;
            metrics.errors.push({ index, error: 'Connection timeout' });
            console.log(`[LOAD] Client ${index + 1} failed: timeout`);
            resolve(null);
        }, config.connectionTimeout);

        socket.on('connect', () => {
            clearTimeout(timeoutId);
            const elapsed = Date.now() - start;
            metrics.connected++;
            metrics.connectionTimes.push(elapsed);
            console.log(`[LOAD] Client ${index + 1} connected in ${elapsed}ms`);
            resolve(socket);
        });

        socket.on('connect_error', (err) => {
            clearTimeout(timeoutId);
            metrics.failed++;
            let desc = err.description;
            if (desc && typeof desc === 'object') {
                desc = JSON.stringify(desc);
            }
            const errorDetails = desc ? `${err.message} - ${desc}` : err.message;
            metrics.errors.push({ index, error: errorDetails });
            console.log(`[LOAD] Client ${index + 1} failed: ${errorDetails}`);
            resolve(null);
        });

        // --- Matchmaking event handlers ---
        socket.on('gameStart', (data) => {
            const sentAt = metrics.findGameSentAt.get(socket.id);
            if (sentAt) {
                const elapsed = Date.now() - sentAt;
                metrics.matchmakingTimes.push(elapsed);
            }

            // Track unique lobbies (each lobby has 2 players, so 2 gameStart per game)
            const isNewLobby = !metrics.seenLobbies.has(data.lobbyId);
            metrics.seenLobbies.add(data.lobbyId);

            const client = clientData.find(c => c.socket === socket);
            if (client) client.inGame = true;

            if (isNewLobby) {
                console.log(`[LOAD] Game ${metrics.seenLobbies.size} started (lobby: ${data.lobbyId})`);
            }
        });

        socket.on('findGameFailed', (data) => {
            metrics.gamesFailed++;
            console.log(`[LOAD] Client ${index + 1} findGame failed: ${data?.reason || 'unknown'}`);
        });
    });
}

// ============================================================
// MATCHMAKING TEST
// ============================================================

async function runMatchmakingTest() {
    console.log(`\n[LOAD] Starting matchmaking test with ${config.clients} clients\n`);
    console.log(`[LOAD] Time control: ${config.timeControl.base}s + ${config.timeControl.inc}s\n`);

    // Phase 1: Connect all clients
    const startTime = Date.now();

    for (let i = 0; i < config.clients; i++) {
        await connectClient(i);
        if (i < config.clients - 1) {
            await sleep(config.delayBetweenConnections);
        }
    }

    console.log(`\n[LOAD] All ${metrics.connected} clients connected\n`);

    if (metrics.connected < 2) {
        console.log('[LOAD] Not enough clients connected for matchmaking');
        printMatchmakingResults(Date.now() - startTime);
        cleanup();
        return;
    }

    // Phase 2: Send findGame from all connected clients
    console.log('[LOAD] Sending findGame requests...\n');

    const expectedGames = Math.floor(metrics.connected / 2);

    for (const client of clientData) {
        if (client.socket.connected) {
            metrics.findGameSentAt.set(client.socket.id, Date.now());
            client.socket.emit('findGame', {
                token: client.token,
                timeControl: config.timeControl
            });
            // Small delay to avoid rate limiting
            await sleep(50);
        }
    }

    // Phase 3: Wait for all games to be created (with timeout)
    console.log(`[LOAD] Waiting for ${expectedGames} games to be created...\n`);

    const matchmakingTimeout = 30000; // 30 seconds max
    const pollInterval = 100;
    let waited = 0;

    while (metrics.gamesCreated < expectedGames && waited < matchmakingTimeout) {
        await sleep(pollInterval);
        waited += pollInterval;
    }

    if (metrics.gamesCreated >= expectedGames) {
        console.log(`\n[LOAD] All ${metrics.gamesCreated} games created!`);
    } else {
        console.log(`\n[LOAD] Timeout: Only ${metrics.gamesCreated}/${expectedGames} games created`);
    }

    // Phase 4: Wait 2 seconds, then disconnect
    console.log('[LOAD] Waiting 2s before disconnect...\n');
    await sleep(2000);

    const totalTime = Date.now() - startTime;
    printMatchmakingResults(totalTime);
    cleanup();
}

// ============================================================
// CONNECTION-ONLY TEST (original behavior)
// ============================================================

async function runConnectionTest() {
    console.log(`\n[LOAD] Starting ${config.clients} clients to ${config.url}\n`);

    const startTime = Date.now();

    for (let i = 0; i < config.clients; i++) {
        await connectClient(i);
        if (i < config.clients - 1) {
            await sleep(config.delayBetweenConnections);
        }
    }

    const totalTime = Date.now() - startTime;
    await sleep(1000);

    printConnectionResults(totalTime);
    cleanup();
}

// ============================================================
// OUTPUT
// ============================================================

function printConnectionResults(totalTime) {
    const stats = calculateStats(metrics.connectionTimes);

    console.log(`
═══════════════════════════════════
  LOAD TEST RESULTS
═══════════════════════════════════
  Total:      ${metrics.total}
  Connected:  ${metrics.connected} (${formatPercent(metrics.connected, metrics.total)})
  Failed:     ${metrics.failed} (${formatPercent(metrics.failed, metrics.total)})
  
  Connection Times:
    Avg:  ${stats.avg}ms
    Min:  ${stats.min}ms
    Max:  ${stats.max}ms
  
  Total Test Time: ${(totalTime / 1000).toFixed(1)}s
═══════════════════════════════════
`);

    printErrors();
}

function printMatchmakingResults(totalTime) {
    const connStats = calculateStats(metrics.connectionTimes);
    const matchStats = calculateStats(metrics.matchmakingTimes);
    const expectedGames = Math.floor(metrics.connected / 2);

    console.log(`
═══════════════════════════════════
  LOAD TEST RESULTS (MATCHMAKING)
═══════════════════════════════════
  Total Clients:  ${metrics.total}
  Connected:      ${metrics.connected} (${formatPercent(metrics.connected, metrics.total)})
  Games Created:  ${metrics.seenLobbies.size}/${expectedGames}
  Games Failed:   ${metrics.gamesFailed}
  
  Connection Times:
    Avg:  ${connStats.avg}ms
    Min:  ${connStats.min}ms
    Max:  ${connStats.max}ms
  
  Matchmaking Times:
    Avg:  ${matchStats.avg}ms
    Min:  ${matchStats.min}ms
    Max:  ${matchStats.max}ms
  
  Total Test Time: ${(totalTime / 1000).toFixed(1)}s
═══════════════════════════════════
`);

    printErrors();
}

function printErrors() {
    if (metrics.failed > 0 && metrics.errors.length <= 5) {
        console.log('Errors:');
        metrics.errors.forEach(e => {
            console.log(`  - Client ${e.index + 1}: ${e.error}`);
        });
        console.log('');
    }
}

// ============================================================
// CLEANUP
// ============================================================

function cleanup() {
    console.log('[LOAD] Disconnecting all clients...');
    sockets.forEach(socket => {
        if (socket.connected) {
            socket.disconnect();
        }
    });

    if (metrics.connected === 0) {
        console.log('[LOAD] All connections failed. Is the server running?');
        process.exit(1);
    }

    process.exit(0);
}

// Graceful shutdown on Ctrl+C
process.on('SIGINT', () => {
    console.log('\n[LOAD] Interrupted. Cleaning up...');
    cleanup();
});

// ============================================================
// RUN
// ============================================================

const runTest = config.findGame ? runMatchmakingTest : runConnectionTest;

runTest().catch(err => {
    console.error('[LOAD] Fatal error:', err.message);
    process.exit(1);
});
