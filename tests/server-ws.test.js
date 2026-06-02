jest.mock('redis');
jest.mock('../src/storage/db', () => jest.fn().mockResolvedValue());

jest.mock('../src/models/User', () => {
    const store = new Map();
    let nextId = 1;
    const MockUser = jest.fn().mockImplementation((data) => {
        const user = {
            _id: String(nextId++),
            username: data.username,
            passwordHash: data.passwordHash,
            rating: 1200,
            stats: { totalGames: 0, wins: 0, losses: 0, playTimeSeconds: 0 },
            createdAt: new Date(),
            isBot: false, isAdmin: false, avatarUrl: '', status: '', bio: '',
            country: 'XX', achievements: [],
            preferences: { boardTheme: 'default', pieceSet: 'default' },
            save: jest.fn().mockResolvedValue(true),
        };
        store.set(user.username, user);
        return user;
    });
    MockUser.findOne = jest.fn(({ username } = {}) => store.get(username) || null);
    MockUser.findById = jest.fn((id) => ({
        select() {
            for (const user of store.values()) {
                if (user._id === id) return Promise.resolve({ ...user });
            }
            return Promise.resolve(null);
        }
    }));
    MockUser.find = jest.fn((query = {}) => {
        let filtered = Array.from(store.values());
        if (query && Object.keys(query).length > 0) {
            filtered = filtered.filter((user) => Object.entries(query).every(([k, v]) => user[k] === v));
        }
        const chain = {
            select() { return chain; },
            sort() {
                filtered = [...filtered].sort((a, b) => (b.rating || 0) - (a.rating || 0));
                return chain;
            },
            limit(n) {
                filtered = filtered.slice(0, n);
                return Promise.resolve(filtered);
            },
            then(resolve, reject) {
                return Promise.resolve(filtered).then(resolve, reject);
            },
        };
        return chain;
    });
    MockUser.findByIdAndUpdate = jest.fn(() => Promise.resolve(null));
    MockUser.__clearStore = () => { store.clear(); nextId = 1; };
    MockUser.__seedUser = (data) => {
        const user = { _id: String(nextId++), ...data, save: jest.fn().mockResolvedValue(true) };
        store.set(user.username, user);
        return user;
    };
    return MockUser;
});

jest.mock('../src/models/GameResult', () => {
    const MockGameResult = jest.fn().mockImplementation((data) => ({ ...data, save: jest.fn().mockResolvedValue(true) }));
    MockGameResult.find = jest.fn().mockResolvedValue([]);
    MockGameResult.findById = jest.fn().mockResolvedValue(null);
    return MockGameResult;
});

const { io: ioc } = require('socket.io-client');

let httpServer, port, io;
const sockets = [];

function connectClient(opts = {}) {
    return new Promise((resolve, reject) => {
        const sock = ioc(`http://localhost:${port}`, {
            transports: ['websocket'],
            forceNew: true,
            ...opts,
        });
        const captured = [];
        sock.onAny((event, ...args) => {
            captured.push({ event, args });
        });
        const timeout = setTimeout(() => reject(new Error('connect timeout')), 5000);
        sock.on('connect', () => {
            clearTimeout(timeout);
            sockets.push(sock);
            resolve({ sock, captured });
        });
        sock.on('connect_error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

function waitForEvent(socket, event, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timeout waiting for "${event}" after ${timeoutMs}ms`));
        }, timeoutMs);
        socket.once(event, (...args) => {
            clearTimeout(timer);
            resolve(args.length <= 1 ? args[0] : args);
        });
    });
}

beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-secret-ws';
    jest.setTimeout(30000);

    const mod = require('../src/server');
    httpServer = mod.server;
    io = mod.io;

    const Redis = require('../src/storage/redis');
    await Redis.connect();

    await new Promise(resolve => httpServer.listen(0, resolve));
    port = httpServer.address().port;
}, 15000);

afterEach(async () => {
    await Promise.all(sockets.map(s => { try { s.close(); } catch {} }));
    sockets.length = 0;
    jest.clearAllMocks();
    const User = require('../src/models/User');
    User.__clearStore();
    const Redis = require('../src/storage/redis');
    await Redis.disconnect();
    await Redis.connect();
});

afterAll(async () => {
    try {
        if (io) {
            await Promise.race([
                new Promise(resolve => io.close(resolve)),
                new Promise(r => setTimeout(r, 500)),
            ]);
            io.httpServer?.close();
        }
        if (httpServer) {
            httpServer.close();
        }
        const Redis = require('../src/storage/redis');
        await Redis.disconnect();
    } catch (e) {
        // cleanup
    }
});

describe('WebSocket Connection', () => {
    it('assigns a token to a guest client', async () => {
        const { sock, captured } = await connectClient();
        const assign = captured.find(e => e.event === 'assignToken');
        expect(assign).toBeDefined();
        expect(assign.args[0].token).toBeDefined();
        expect(typeof assign.args[0].token).toBe('string');
        expect(assign.args[0].token.length).toBeGreaterThan(10);
    });

    it('reuses an existing token from handshake auth', async () => {
        const existingToken = 'existing-token-for-test-123';
        const { captured } = await connectClient({ auth: { token: existingToken } });
        const assign = captured.find(e => e.event === 'assignToken');
        expect(assign).toBeUndefined();
    });

    it('receives onlineStats on connect', async () => {
        const { captured } = await connectClient();
        const stats = captured.find(e => e.event === 'onlineStats');
        expect(stats).toBeDefined();
        expect(stats.args[0]).toHaveProperty('online');
        expect(stats.args[0]).toHaveProperty('playing');
    });
});

describe('Matchmaking', () => {
    it('matches two players and starts a game', async () => {
        const { sock: p1, captured: c1 } = await connectClient();
        const t1 = c1.find(e => e.event === 'assignToken').args[0].token;

        const { sock: p2, captured: c2 } = await connectClient();
        const t2 = c2.find(e => e.event === 'assignToken').args[0].token;

        p1.emit('findGame', { token: t1 });
        await new Promise(r => setTimeout(r, 100));
        p2.emit('findGame', { token: t2 });

        const [g1, g2] = await Promise.all([
            waitForEvent(p1, 'gameStart'),
            waitForEvent(p2, 'gameStart'),
        ]);

        expect(g1.lobbyId).toBeDefined();
        expect(g1.lobbyId).toBe(g2.lobbyId);
        expect(g1.lobbyId).toMatch(/^[A-Z0-9]{5}$/);
        expect(g1.lobbyCode).toBe(g1.lobbyId);
        expect(g1.color === 'white' || g1.color === 'black').toBe(true);
        expect(g2.color === 'white' || g2.color === 'black').toBe(true);
        expect(g1.color).not.toBe(g2.color);
        expect(g1.opponent).toBeDefined();
        expect(g2.opponent).toBeDefined();
    });

    it('rejects invalid time control', async () => {
        const { sock, captured } = await connectClient();
        const token = captured.find(e => e.event === 'assignToken').args[0].token;

        sock.emit('findGame', { token, timeControl: { base: 9999, inc: 0 } });
        const fail = await waitForEvent(sock, 'findGameFailed');
        expect(fail.reason).toMatch(/time limit/i);
    });

    it('rejects ranked play for guests (no userId)', async () => {
        const { sock, captured } = await connectClient();
        const token = captured.find(e => e.event === 'assignToken').args[0].token;

        sock.emit('findGame', { token, isRanked: true });
        const fail = await waitForEvent(sock, 'findGameFailed');
        expect(fail.reason).toMatch(/login/i);
    });
});

describe('Cancel Search', () => {
    it('cancels a pending search without errors', async () => {
        const { sock, captured } = await connectClient();
        const token = captured.find(e => e.event === 'assignToken').args[0].token;

        sock.emit('findGame', { token });
        sock.emit('cancelSearch', { token });
        await new Promise(r => setTimeout(r, 300));

        const { sock: p2, captured: c2 } = await connectClient();
        const t2 = c2.find(e => e.event === 'assignToken').args[0].token;
        p2.emit('findGame', { token: t2 });
        await new Promise(r => setTimeout(r, 200));

        let gotGameStart = false;
        p2.on('gameStart', () => { gotGameStart = true; });
        await new Promise(r => setTimeout(r, 500));
        expect(gotGameStart).toBe(false);
    });
});

describe('Private Rooms', () => {
    it('creates a room and allows a second player to join', async () => {
        const { sock: p1, captured: c1 } = await connectClient();
        const t1 = c1.find(e => e.event === 'assignToken').args[0].token;

        p1.emit('createRoom', { token: t1 });
        const { roomCode } = await waitForEvent(p1, 'roomCreated');
        expect(roomCode).toBeDefined();
        expect(roomCode.length).toBe(5);

        const { sock: p2, captured: c2 } = await connectClient();
        const t2 = c2.find(e => e.event === 'assignToken').args[0].token;

        p2.emit('joinRoom', { roomCode, token: t2 });

        const [g1, g2] = await Promise.all([
            waitForEvent(p1, 'gameStart'),
            waitForEvent(p2, 'gameStart'),
        ]);

        expect(g1.lobbyId).toBe(g2.lobbyId);
        expect(g1.lobbyId).toMatch(/^[A-Z0-9]{5}$/);
        expect(g1.color).not.toBe(g2.color);
    });

    it('fails to join a non-existent room', async () => {
        const { sock, captured } = await connectClient();
        const token = captured.find(e => e.event === 'assignToken').args[0].token;

        sock.emit('joinRoom', { roomCode: 'XXXXX', token });
        const fail = await waitForEvent(sock, 'joinRoomFailed');
        expect(fail.reason).toBeDefined();
    });

    it('fails to join a full room', async () => {
        const { sock: p1, captured: c1 } = await connectClient();
        const t1 = c1.find(e => e.event === 'assignToken').args[0].token;
        p1.emit('createRoom', { token: t1 });
        const { roomCode } = await waitForEvent(p1, 'roomCreated');

        const { sock: p2, captured: c2 } = await connectClient();
        const t2 = c2.find(e => e.event === 'assignToken').args[0].token;
        p2.emit('joinRoom', { roomCode, token: t2 });
        await waitForEvent(p2, 'gameStart');

        const { sock: p3, captured: c3 } = await connectClient();
        const t3 = c3.find(e => e.event === 'assignToken').args[0].token;
        p3.emit('joinRoom', { roomCode, token: t3 });
        const fail = await waitForEvent(p3, 'joinRoomFailed');
        expect(fail.reason).toMatch(/не найдена|not found/i);
    });
});

describe('Game Flow', () => {
    it('processes a valid pawn move and broadcasts serverMove', async () => {
        const { sock: p1, captured: c1 } = await connectClient();
        const t1 = c1.find(e => e.event === 'assignToken').args[0].token;
        p1.emit('createRoom', { token: t1 });
        const { roomCode } = await waitForEvent(p1, 'roomCreated');

        const { sock: p2, captured: c2 } = await connectClient();
        const t2 = c2.find(e => e.event === 'assignToken').args[0].token;
        p2.emit('joinRoom', { roomCode, token: t2 });
        const [g1, g2] = await Promise.all([
            waitForEvent(p1, 'gameStart'),
            waitForEvent(p2, 'gameStart'),
        ]);
        const lobbyId = g1.lobbyId;

        const white = g1.color === 'white' ? p1 : p2;

        white.emit('playerMove', { lobbyId, move: { type: 'pawn', r: 7, c: 4 } });

        const [m1, m2] = await Promise.all([
            waitForEvent(p1, 'serverMove'),
            waitForEvent(p2, 'serverMove'),
        ]);

        expect(m1.playerIdx).toBe(0);
        expect(m1.move).toEqual({ type: 'pawn', r: 7, c: 4 });
        expect(m1.nextPlayer).toBe(1);
        expect(m1.timers).toBeDefined();
        expect(m1.timers[0]).toBeGreaterThan(0);
        expect(m1).toEqual(m2);
    });

    it('rejects an invalid pawn move', async () => {
        const { sock: p1, captured: c1 } = await connectClient();
        const t1 = c1.find(e => e.event === 'assignToken').args[0].token;
        p1.emit('createRoom', { token: t1 });
        const { roomCode } = await waitForEvent(p1, 'roomCreated');

        const { sock: p2, captured: c2 } = await connectClient();
        const t2 = c2.find(e => e.event === 'assignToken').args[0].token;
        p2.emit('joinRoom', { roomCode, token: t2 });
        const [g1] = await Promise.all([
            waitForEvent(p1, 'gameStart'),
            waitForEvent(p2, 'gameStart'),
        ]);
        const lobbyId = g1.lobbyId;
        const white = g1.color === 'white' ? p1 : p2;

        white.emit('playerMove', { lobbyId, move: { type: 'pawn', r: 99, c: 99 } });
        const rejected = await waitForEvent(white, 'moveRejected');
        expect(rejected.reason).toBeDefined();
    });

    it('ends the game when a player surrenders', async () => {
        const { sock: p1, captured: c1 } = await connectClient();
        const t1 = c1.find(e => e.event === 'assignToken').args[0].token;
        p1.emit('createRoom', { token: t1 });
        const { roomCode } = await waitForEvent(p1, 'roomCreated');

        const { sock: p2, captured: c2 } = await connectClient();
        const t2 = c2.find(e => e.event === 'assignToken').args[0].token;
        p2.emit('joinRoom', { roomCode, token: t2 });
        const [g1, g2] = await Promise.all([
            waitForEvent(p1, 'gameStart'),
            waitForEvent(p2, 'gameStart'),
        ]);
        const lobbyId = g1.lobbyId;

        const black = g1.color === 'black' ? p1 : p2;
        black.emit('surrender', { lobbyId });

        const [o1, o2] = await Promise.all([
            waitForEvent(p1, 'gameOver'),
            waitForEvent(p2, 'gameOver'),
        ]);

        expect(o1.winnerIdx).toBe(0);
        expect(o1.reason).toBe('Surrender');
        expect(o1).toEqual(o2);
    });
});

describe('Rematch', () => {
    it('both players can request a rematch after game over', async () => {
        const { sock: p1, captured: c1 } = await connectClient();
        const t1 = c1.find(e => e.event === 'assignToken').args[0].token;
        p1.emit('createRoom', { token: t1 });
        const { roomCode } = await waitForEvent(p1, 'roomCreated');

        const { sock: p2, captured: c2 } = await connectClient();
        const t2 = c2.find(e => e.event === 'assignToken').args[0].token;
        p2.emit('joinRoom', { roomCode, token: t2 });
        const [g1] = await Promise.all([
            waitForEvent(p1, 'gameStart'),
            waitForEvent(p2, 'gameStart'),
        ]);
        const lobbyId = g1.lobbyId;

        // End the game via surrender
        const black = g1.color === 'black' ? p1 : p2;
        black.emit('surrender', { lobbyId });
        await Promise.all([
            waitForEvent(p1, 'gameOver'),
            waitForEvent(p2, 'gameOver'),
        ]);

        // Both players request rematch
        p1.emit('requestRematch', { lobbyId, token: t1 });
        await new Promise(r => setTimeout(r, 100));
        p2.emit('requestRematch', { lobbyId, token: t2 });

        const [r1, r2] = await Promise.all([
            waitForEvent(p1, 'rematchStarted'),
            waitForEvent(p2, 'rematchStarted'),
        ]);

        expect(r1.lobbyId).toBeDefined();
        expect(r1.lobbyId).toBe(r2.lobbyId);
        expect(r1.lobbyId).not.toBe(lobbyId);
        expect(r1.lobbyId).toMatch(/^[A-Z0-9]{5}$/);
        expect(r1.color === 'white' || r1.color === 'black').toBe(true);
        expect(r2.color === 'white' || r2.color === 'black').toBe(true);
        expect(r1.color).not.toBe(r2.color);
        expect(r1.opponent).toBeDefined();
        expect(r2.opponent).toBeDefined();
    });

    it('rematch fails for non-existent lobby', async () => {
        const { sock, captured } = await connectClient();
        const token = captured.find(e => e.event === 'assignToken').args[0].token;

        sock.emit('requestRematch', { lobbyId: 'ABCDE', token });
        const fail = await waitForEvent(sock, 'rematchFailed');
        expect(fail.reason).toBeDefined();
    });

    it('single player requesting rematch does not trigger rematchStarted', async () => {
        const { sock: p1, captured: c1 } = await connectClient();
        const t1 = c1.find(e => e.event === 'assignToken').args[0].token;
        p1.emit('createRoom', { token: t1 });
        const { roomCode } = await waitForEvent(p1, 'roomCreated');

        const { sock: p2, captured: c2 } = await connectClient();
        const t2 = c2.find(e => e.event === 'assignToken').args[0].token;
        p2.emit('joinRoom', { roomCode, token: t2 });
        const [g1] = await Promise.all([
            waitForEvent(p1, 'gameStart'),
            waitForEvent(p2, 'gameStart'),
        ]);
        const lobbyId = g1.lobbyId;

        const black = g1.color === 'black' ? p1 : p2;
        black.emit('surrender', { lobbyId });
        await Promise.all([
            waitForEvent(p1, 'gameOver'),
            waitForEvent(p2, 'gameOver'),
        ]);

        // Only p1 requests rematch
        p1.emit('requestRematch', { lobbyId, token: t1 });
        await new Promise(r => setTimeout(r, 300));

        let gotRematch = false;
        p1.on('rematchStarted', () => { gotRematch = true; });
        await new Promise(r => setTimeout(r, 500));
        expect(gotRematch).toBe(false);
    });
});

describe('Bot matchmaking fallback', () => {
    afterEach(() => {
        process.env.BOTS_ENABLED = 'false';
        process.env.BOT_RANKED_ENABLED = 'false';
        process.env.BOT_FALLBACK_MIN_WAIT_MS = '15000';
        process.env.BOT_FALLBACK_MAX_WAIT_MS = '25000';
    });

    it('starts a casual game against a bot after the fallback delay', async () => {
        process.env.BOTS_ENABLED = 'true';
        process.env.BOT_FALLBACK_MIN_WAIT_MS = '20';
        process.env.BOT_FALLBACK_MAX_WAIT_MS = '20';
        process.env.BOT_MAX_ACTIVE_GAMES = '15';
        process.env.BOT_MOVE_MIN_DELAY_MS = '1000';
        process.env.BOT_MOVE_MAX_DELAY_MS = '1000';

        const { sock, captured } = await connectClient();
        const token = captured.find(e => e.event === 'assignToken').args[0].token;

        sock.emit('findGame', { token });
        const gameStart = await waitForEvent(sock, 'gameStart', 2000);

        const Redis = require('../src/storage/redis');
        const game = await Redis.getGame(gameStart.lobbyId);

        expect(gameStart.lobbyId).toMatch(/^[A-Z0-9]{5}$/);
        expect(game.hasBot).toBe(true);
        expect(game.botPlayerIdx === 0 || game.botPlayerIdx === 1).toBe(true);
        expect(game.playerProfiles[game.botPlayerIdx]).toHaveProperty('name');
        sock.emit('surrender', { lobbyId: gameStart.lobbyId });
        await waitForEvent(sock, 'gameOver', 2000);
    });

    it('does not start a bot game after cancelSearch', async () => {
        process.env.BOTS_ENABLED = 'true';
        process.env.BOT_FALLBACK_MIN_WAIT_MS = '30';
        process.env.BOT_FALLBACK_MAX_WAIT_MS = '30';

        const { sock, captured } = await connectClient();
        const token = captured.find(e => e.event === 'assignToken').args[0].token;

        sock.emit('findGame', { token });
        sock.emit('cancelSearch', { token });
        await new Promise(r => setTimeout(r, 150));

        expect(captured.some(e => e.event === 'gameStart')).toBe(false);
    });
});
