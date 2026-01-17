const io = require('socket.io-client');
const BotAI = require('./BotAI');
const Shared = require('../core/shared');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const PLAYER_TOKEN = process.env.PLAYER_TOKEN;
const DIFFICULTY = process.env.BOT_DIFFICULTY || 'medium';
const IS_RANKED = process.env.IS_RANKED === 'true';

if (!PLAYER_TOKEN) {
    console.error('[BOT] Error: No PLAYER_TOKEN provided');
    process.exit(1);
}

const socket = io(SERVER_URL, {
    auth: { token: PLAYER_TOKEN },
    reconnection: true,
    transports: ['websocket']
});

let gameState = null;
let currentLobbyId = null;
let myColor = null;
let myPlayerIdx = -1;
let botTimeout = null;

console.log(`[BOT] Starting ${DIFFICULTY} bot (Ranked: ${IS_RANKED}). Connecting to ${SERVER_URL}...`);

// --- Socket Events ---

socket.on('connect', () => {
    console.log(`[BOT] Connected! ID: ${socket.id}`);
    startSearch();
});

socket.on('disconnect', (reason) => {
    console.log(`[BOT] Disconnected: ${reason}`);
    clearTimeout(botTimeout);
});

socket.on('connect_error', (err) => {
    console.error(`[BOT] Connection Error: ${err.message}`, err);
});

socket.on('connect_timeout', () => {
    console.error('[BOT] Connection Custom Timeout');
});

socket.on('botStateUpdate', (data) => {
    console.log(`[BOT] State Updated: Paused=${data.isPaused}`);
    isPaused = data.isPaused;

    if (isPaused) {
        // We are now paused.
        // If searching, we should cancel.
        socket.emit('cancelSearch', { token: PLAYER_TOKEN });
    } else {
        // We are currently resumed.
        // If not in game, start searching.
        if (!gameState) {
            startSearch();
        }
    }
});

socket.on('findGameFailed', (data) => {
    console.log('[BOT] Search Failed:', data.reason);
    // Retry after delay
    setTimeout(startSearch, 5000);
});

socket.on('gameStart', (data) => {
    console.log(`[BOT] Game Started! Lobby: ${data.lobbyId}, Color: ${data.color}, Opponent: ${data.opponent?.username}`);

    myColor = data.color;
    currentLobbyId = data.lobbyId;
    myPlayerIdx = (myColor === 'white') ? 0 : 1;

    // Initialize State
    // We recreate the state assuming standard start positions
    gameState = Shared.createInitialState({ base: 300 }, IS_RANKED);

    checkTurn();
});

socket.on('serverMove', (data) => {
    // data: { move, playerIdx, remainingTime }
    if (!gameState) return;

    try {
        const action = { ...data.move, playerIdx: data.playerIdx };
        gameState = Shared.gameReducer(gameState, action);
        checkTurn();
    } catch (e) {
        console.error('[BOT] Logic Error (Sync):', e.message);
        // Request fuller state if possible? Or just ignore
    }
});

socket.on('gameOver', (data) => {
    console.log(`[BOT] Game Over. Winner: ${data.winner}`);
    gameState = null;
    clearTimeout(botTimeout);

    // Re-queue after 5 seconds
    setTimeout(startSearch, 5000);
});

socket.on('error', (err) => {
    console.error('[BOT] Socket Error:', err);
});

// --- Logic ---

const IS_PAUSED_ENV = process.env.IS_PAUSED === 'true';
let isPaused = IS_PAUSED_ENV;

// ...

function startSearch() {
    if (isPaused) {
        console.log('[BOT] State is PAUSED. Skipping search.');
        return;
    }
    console.log('[BOT] Searching for game...');
    socket.emit('findGame', {
        token: PLAYER_TOKEN,
        timeControl: { base: 300, inc: 0 },
        isRanked: IS_RANKED // Bots mimic player choice
    });
}

function checkTurn() {
    if (!gameState) {
        // console.log('[BOT-DEBUG] checkTurn: No gameState');
        return;
    }

    // console.log(`[BOT-DEBUG] checkTurn: Turn=${gameState.currentPlayer}, MyIdx=${myPlayerIdx}`);

    if (gameState.currentPlayer === myPlayerIdx) {
        // Bot's Turn - Start thinking
        makeMove();
    }
}

async function makeMove() {
    if (!gameState) return;

    try {
        const startThink = Date.now();
        const bestMove = BotAI.think(gameState, myPlayerIdx, DIFFICULTY);
        const thinkDuration = Date.now() - startThink;

        // Humanize Timer
        // Impossible/Hard: Minimal delay if think was long. Artificial delay if think was instant (cache).
        // Easy/Medium: More random delays.

        let targetDelay = 1000; // Minimum time a human takes
        if (DIFFICULTY === 'hard' || DIFFICULTY === 'impossible') {
            targetDelay = 1500;
        } else {
            targetDelay = 2000; // Slower for easier bots
        }

        // If we thought for 2000ms, and target is 1500, we wait 0 extra.
        // If we thought for 2ms, and target is 1500, we wait 1498ms.
        let waitTime = targetDelay - thinkDuration;

        // Add Randomness
        waitTime += Math.random() * 500;

        if (waitTime < 500) waitTime = 500; // Always at least slight pause after decision

        // Wait
        await new Promise(resolve => setTimeout(resolve, waitTime));

        if (bestMove) {
            const movePayload = {
                type: bestMove.type,
                r: bestMove.r,
                c: bestMove.c
            };
            if (bestMove.type === 'wall') {
                movePayload.isVertical = bestMove.isVertical;
            }
            socket.emit('playerMove', {
                lobbyId: currentLobbyId,
                move: movePayload
            });
        } else {
            console.error('[BOT] No valid moves found inside AI? Resigning...');
            socket.emit('surrender');
        }
    } catch (e) {
        console.error('[BOT] Error thinking:', e);
    }
}
