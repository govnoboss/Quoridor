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
        // Bot's Turn
        const thinkTime = Math.random() * 2000 + 1000;

        if (botTimeout) clearTimeout(botTimeout);

        botTimeout = setTimeout(() => {
            makeMove();
        }, thinkTime);
    }
}

function makeMove() {
    if (!gameState) return;
    // console.log('[BOT-DEBUG] makeMove: Thinking...');

    try {
        const bestMove = BotAI.think(gameState, myPlayerIdx, DIFFICULTY);
        // console.log(`[BOT-DEBUG] Think Result:`, bestMove);

        if (bestMove) {
            const movePayload = {
                type: bestMove.type,
                r: bestMove.r,
                c: bestMove.c
            };
            if (bestMove.type === 'wall') {
                movePayload.isVertical = bestMove.isVertical;
            }

            // console.log(`[BOT] Moving: ${JSON.stringify(movePayload)}`);
            socket.emit('playerMove', {
                lobbyId: currentLobbyId,
                move: movePayload
            });

            // Apply locally to prevent double-think before server response
            // (Assuming server accepts it. If not, we desync. Ideally we wait for 'move' event)
            // But gameReducer checks turn.
            // We should NOT update state here, waiting for server 'move' event is safer for sync.
            // BUT we should prevent 'checkTurn' from firing again.
            // Using a flag 'isThinking' or just relying on 'currentPlayer' not changing until event.
            // Since we set timeout only when currentPlayer == myIndex, and we don't change state here,
            // we will re-enter checkTurn only if logic calls it.
            // Logic calls checkTurn on 'move' event.
            // So we are safe.

        } else {
            console.error('[BOT] No valid moves found inside AI? Resigning...');
            socket.emit('surrender');
        }
    } catch (e) {
        console.error('[BOT] Error thinking:', e);
    }
}
