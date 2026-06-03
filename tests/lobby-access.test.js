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
    const store = new Map();
    const MockGameResult = jest.fn().mockImplementation((data) => {
        const doc = { ...data, save: jest.fn().mockResolvedValue(true) };
        if (data.lobbyId) store.set(data.lobbyId, doc);
        return doc;
    });
    MockGameResult.find = jest.fn().mockResolvedValue([]);
    MockGameResult.findById = jest.fn().mockResolvedValue(null);
    MockGameResult.findOne = jest.fn(({ lobbyId }) => Promise.resolve(store.get(lobbyId) || null));
    MockGameResult.__seed = (data) => {
        const doc = { ...data, save: jest.fn().mockResolvedValue(true) };
        if (data.lobbyId) store.set(data.lobbyId, doc);
        return doc;
    };
    MockGameResult.__clearStore = () => store.clear();
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

async function createAndStartGame() {
    const p1 = await connectClient();
    const t1 = p1.captured.find(e => e.event === 'assignToken').args[0].token;
    p1.sock.emit('createRoom', { token: t1 });
    const { roomCode } = await waitForEvent(p1.sock, 'roomCreated');

    const p2 = await connectClient();
    const t2 = p2.captured.find(e => e.event === 'assignToken').args[0].token;
    p2.sock.emit('joinRoom', { roomCode, token: t2 });

    const [g1] = await Promise.all([
        waitForEvent(p1.sock, 'gameStart'),
        waitForEvent(p2.sock, 'gameStart'),
    ]);

    return {
        lobbyCode: g1.lobbyCode || g1.lobbyId,
        lobbyId: g1.lobbyId,
        p1: p1.sock, t1,
        p2: p2.sock, t2,
        g1,
    };
}

beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-secret-lobby';
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
    const GameResult = require('../src/models/GameResult');
    GameResult.__clearStore();
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

describe('Lobby Access Control', () => {

    describe('rejoinLobby — active game', () => {

        it('emits gameResumed when token matches', async () => {
            const { lobbyCode, p1, t1 } = await createAndStartGame();

            const p1b = await connectClient({ auth: { token: t1 } });
            p1b.sock.emit('rejoinLobby', { lobbyCode, token: t1 });

            const resumed = await waitForEvent(p1b.sock, 'gameResumed');
            expect(resumed.lobbyId).toBe(lobbyCode);
            expect(resumed.color).toBeDefined();
            expect(resumed.myPlayerIndex).toBeDefined();
            expect(resumed.state).toBeDefined();
        });

        it('emits gameActiveError when token does not match', async () => {
            const { lobbyCode } = await createAndStartGame();

            const intruder = await connectClient();
            const badToken = intruder.captured.find(e => e.event === 'assignToken').args[0].token;
            intruder.sock.emit('rejoinLobby', { lobbyCode, token: badToken });

            const err = await waitForEvent(intruder.sock, 'gameActiveError');
            expect(err.lobbyCode).toBe(lobbyCode);
        });

        it('emits gameActiveError for a third client with random token', async () => {
            const { lobbyCode } = await createAndStartGame();

            const p3 = await connectClient();
            const t3 = p3.captured.find(e => e.event === 'assignToken').args[0].token;
            p3.sock.emit('rejoinLobby', { lobbyCode, token: t3 });

            const err = await waitForEvent(p3.sock, 'gameActiveError');
            expect(err.lobbyCode).toBe(lobbyCode);
        });
    });

    describe('rejoinLobby — finished game (Redis copy)', () => {

        it('emits gameReplayAvailable with history from saveFinishedGame', async () => {
            const game = await createAndStartGame();

            const black = game.g1.color === 'black' ? game.p1 : game.p2;
            black.emit('surrender', { lobbyId: game.lobbyId });
            await Promise.all([
                waitForEvent(game.p1, 'gameOver'),
                waitForEvent(game.p2, 'gameOver'),
            ]);

            const viewer = await connectClient();
            const viewToken = viewer.captured.find(e => e.event === 'assignToken').args[0].token;
            viewer.sock.emit('rejoinLobby', { lobbyCode: game.lobbyCode, token: viewToken });

            const replay = await waitForEvent(viewer.sock, 'gameReplayAvailable');
            expect(replay.lobbyCode).toBe(game.lobbyCode);
            expect(replay.history).toBeDefined();
            expect(Array.isArray(replay.history)).toBe(true);
            expect(replay.playerProfiles).toBeDefined();
            expect(replay.playerProfiles.length).toBe(2);
        });
    });

    describe('rejoinLobby — archived game (MongoDB)', () => {

        it('emits gameReplayAvailable from GameResult.findOne', async () => {
            const GameResult = require('../src/models/GameResult');
            GameResult.__seed({
                lobbyId: 'ARCHV',
                history: [{ move: { type: 'pawn', r: 7, c: 4 }, notation: 'e4' }],
                playerWhite: { username: 'Alice' },
                playerBlack: { username: 'Bob' },
                winner: 0,
                reason: 'Checkmate',
            });

            const viewer = await connectClient();
            const viewToken = viewer.captured.find(e => e.event === 'assignToken').args[0].token;
            viewer.sock.emit('rejoinLobby', { lobbyCode: 'ARCHV', token: viewToken });

            const replay = await waitForEvent(viewer.sock, 'gameReplayAvailable');
            expect(replay.lobbyCode).toBe('ARCHV');
            expect(replay.history).toEqual([{ move: { type: 'pawn', r: 7, c: 4 }, notation: 'e4' }]);
            expect(replay.playerProfiles[0].username).toBe('Alice');
            expect(replay.playerProfiles[1].username).toBe('Bob');
            expect(replay.result.winnerIdx).toBe(0);
            expect(replay.result.reason).toBe('Checkmate');
        });
    });

    describe('rejoinLobby — not found', () => {

        it('does not emit any event for non-existent lobby', async () => {
            const viewer = await connectClient();
            const viewToken = viewer.captured.find(e => e.event === 'assignToken').args[0].token;
            viewer.sock.emit('rejoinLobby', { lobbyCode: 'ZZZZZ', token: viewToken });

            await new Promise(r => setTimeout(r, 800));
            const events = viewer.captured.filter(e =>
                ['gameResumed', 'gameActiveError', 'gameReplayAvailable'].includes(e.event)
            );
            expect(events.length).toBe(0);
        });
    });

    describe('rejoinLobby — ?replay flag', () => {

        it('works with replay flag for finished game', async () => {
            const game = await createAndStartGame();

            const black = game.g1.color === 'black' ? game.p1 : game.p2;
            black.emit('surrender', { lobbyId: game.lobbyId });
            await Promise.all([
                waitForEvent(game.p1, 'gameOver'),
                waitForEvent(game.p2, 'gameOver'),
            ]);

            const viewer = await connectClient();
            const viewToken = viewer.captured.find(e => e.event === 'assignToken').args[0].token;
            viewer.sock.emit('rejoinLobby', { lobbyCode: game.lobbyCode, token: viewToken, replay: true });

            const replay = await waitForEvent(viewer.sock, 'gameReplayAvailable');
            expect(replay.lobbyCode).toBe(game.lobbyCode);
            expect(replay.history).toBeDefined();
        });
    });
});
