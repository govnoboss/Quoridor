'use strict';
/**
 * Локальный GUI арены. Нужен, чтобы проверять версии ботов не через запоминание флагов CLI.
 *
 * Намеренно отдельный сервер, а не маршрут в src/server.js:
 *   - арена нагружает все ядра (worker_threads) и не должна конкурировать с живыми партиями сайта;
 *   - прод-серверу нужны Mongo и Redis, а здесь ничего этого нет и не нужно;
 *   - арена исполняет код движков, поэтому слушает ТОЛЬКО 127.0.0.1 и не имеет авторизации.
 *     Никогда не выставляйте этот порт наружу.
 *
 *   node arena/server.js            # http://127.0.0.1:8787
 *   PORT=9000 node arena/server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { Arena } = require('./src/runner');

const PORT = +(process.env.PORT || 8787);
const HOST = '127.0.0.1';
const ARENA_DIR = __dirname;
const RESULTS_DIR = path.join(ARENA_DIR, 'results');
const ADAPTER = path.join(ARENA_DIR, 'adapters', 'quoridor.js');
const BOTS = path.join(ARENA_DIR, 'bots.json');

const readBots = () => JSON.parse(fs.readFileSync(BOTS, 'utf8'));

// Один матч за раз: worker_threads уже занимает все ядра, второй параллельный матч вдвое замедлит
// первый и не даст честного замера по времени на узел. Поэтому очередь, а не параллельность.
let current = null;
const queue = [];
// Завершённые задания. Без них результат пропадает: матч на 20 партий укладывается в несколько
// секунд, и GUI, опрашивающий раз в 400 мс, вполне может не застать задание в очереди — тогда
// страница показала бы вечный «старт…» вместо вердикта. Храним последние 50.
const finished = new Map();
const FINISHED_MAX = 50;

function send(res, code, body, type = 'application/json') {
    const payload = type === 'application/json' ? JSON.stringify(body) : body;
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(payload);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (c) => {
            data += c;
            if (data.length > 1e6) { reject(new Error('body too large')); req.destroy(); }
        });
        req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
        req.on('error', reject);
    });
}

function runNext() {
    if (current || !queue.length) return;
    const job = queue.shift();
    const arena = new Arena({
        adapterPath: ADAPTER,
        botsPath: BOTS,
        threads: job.threads,
        seed: job.seed,
        limits: job.limits,
        openingPlies: job.openingPlies,
        maxPlies: job.maxPlies,
        repetitionDraw: job.repetitionDraw,
        outFile: job.outFile,
        saveMoves: job.saveMoves,
        quiet: true, // иначе лог матча сыпется в консоль сервера
        shouldStop: () => job.cancelRequested === true,
        onProgress: (p) => { job.progress = p; job.events++; },
        onRoundRobin: (p) => { job.progress = { ...p, phase: 'roundrobin' }; job.events++; },
    });
    current = { job, arena };
    job.status = 'running';

    const done = (status, result) => {
        job.status = status;
        job.result = result;
        job.finishedAt = Date.now();
        current = null;
        finished.set(job.id, job);
        if (finished.size > FINISHED_MAX) finished.delete(finished.keys().next().value);
        runNext();
    };

    const promise = job.mode === 'roundrobin'
        ? arena.roundRobin({ names: job.names, games: job.games, anchor: job.anchor })
        : arena.match({ a: job.a, b: job.b, games: job.games, sprt: job.sprt });

    promise.then((r) => done('done', r), (e) => {
        job.error = (e && e.message) || String(e);
        done('error', null);
    }).finally(() => { arena.close().catch(() => {}); });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${HOST}`);
    const p = url.pathname;
    try {
        if (p === '/api/bots' && req.method === 'GET') {
            const bots = readBots();
            return send(res, 200, { names: Object.keys(bots), specs: bots, cpus: os.cpus().length, defaultThreads: Math.max(1, os.cpus().length - 1) });
        }

        if (p === '/api/match' && req.method === 'POST') {
            const b = await readBody(req);
            const bots = readBots();
            const mode = b.mode === 'roundrobin' ? 'roundrobin' : 'match';
            if (mode === 'match' && (!bots[b.a] || !bots[b.b])) return send(res, 400, { error: 'unknown bot name' });
            if (mode === 'roundrobin' && (!Array.isArray(b.names) || !b.names.length || b.names.some((n) => !bots[n]))) {
                return send(res, 400, { error: 'unknown bot name in names' });
            }
            // Лимит на длину очереди: иначе можно случайно набить её тысячами матчей и заблокировать
            // сам стенд до перезапуска.
            if (queue.length + (current ? 1 : 0) >= 8) return send(res, 429, { error: 'queue full (8)' });

            const games = Math.max(2, Math.min(20000, +b.games || 200));
            const job = {
                id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
                mode, games,
                a: b.a, b: b.b, names: b.names, anchor: b.anchor,
                sprt: b.sprt ? { elo0: +b.sprt.elo0, elo1: +b.sprt.elo1 } : null,
                threads: Math.max(1, Math.min(os.cpus().length, +b.threads || Math.max(1, os.cpus().length - 1))),
                seed: +b.seed || 1,
                openingPlies: b.openingPlies === undefined ? 4 : Math.max(0, Math.min(16, +b.openingPlies)),
                maxPlies: b.maxPlies === undefined ? 300 : Math.max(20, Math.min(2000, +b.maxPlies)),
                repetitionDraw: b.repetitionDraw === undefined ? 3 : Math.max(0, Math.min(20, +b.repetitionDraw)),
                limits: b.limitType === 'nodes' ? { nodes: +b.nodes || 10000 }
                    : b.limitType === 'depth' ? { depth: +b.depth || 4 }
                        : b.limitType === 'time' ? { timeMs: +b.movetime || 100 } : {},
                outFile: b.saveLog ? path.join(RESULTS_DIR, `${b.saveLog}.jsonl`) : null,
                saveMoves: false,
                status: 'queued', progress: null, events: 0,
                createdAt: Date.now(),
            };
            if (job.outFile) fs.mkdirSync(RESULTS_DIR, { recursive: true });
            queue.push(job);
            runNext();
            return send(res, 200, { id: job.id, queued: queue.length });
        }

        if (p.startsWith('/api/job/') && p.endsWith('/cancel') && req.method === 'POST') {
            const id = p.slice('/api/job/'.length, -'/cancel'.length);
            const job = (current && current.job.id === id) ? current.job : queue.find((j) => j.id === id);
            if (!job) return send(res, 404, { error: 'no such running job' });
            job.cancelRequested = true;
            if (queue.includes(job)) {           // ещё не стартовал — убираем из очереди сразу
                queue.splice(queue.indexOf(job), 1);
                job.status = 'cancelled';
                job.finishedAt = Date.now();
                finished.set(job.id, job);
                if (finished.size > FINISHED_MAX) finished.delete(finished.keys().next().value);
                return send(res, 200, { id: job.id, status: 'cancelled' });
            }
            return send(res, 200, { id: job.id, status: 'stopping', note: 'running games will finish' });
        }

        if (p.startsWith('/api/job/') && req.method === 'GET') {
            const id = p.slice('/api/job/'.length);
            const job = (current && current.job.id === id) ? current.job
                : queue.find((j) => j.id === id) || finished.get(id);
            if (!job) return send(res, 404, { error: 'no such job' });
            return send(res, 200, {
                id: job.id, mode: job.mode, status: job.status, games: job.games,
                a: job.a, b: job.b, names: job.names, anchor: job.anchor,
                sprt: job.sprt, threads: job.threads, seed: job.seed,
                openingPlies: job.openingPlies, maxPlies: job.maxPlies,
                repetitionDraw: job.repetitionDraw, limits: job.limits,
                outFile: job.outFile ? path.basename(job.outFile) : null,
                progress: job.progress, result: job.result, error: job.error,
                queue: queue.length, running: !!current,
            });
        }

        if (p === '/api/logs' && req.method === 'GET') {
            let files = [];
            try {
                files = fs.readdirSync(RESULTS_DIR)
                    .filter((f) => f.endsWith('.jsonl'))
                    .map((f) => {
                        const st = fs.statSync(path.join(RESULTS_DIR, f));
                        const lines = fs.readFileSync(path.join(RESULTS_DIR, f), 'utf8').split('\n').filter(Boolean).length;
                        return { name: f, size: st.size, mtime: st.mtimeMs, games: lines };
                    })
                    .sort((x, y) => y.mtime - x.mtime);
            } catch (e) { /* папки может не быть — это не ошибка */ }
            return send(res, 200, { files });
        }

        if (p === '/api/log' && req.method === 'GET') {
            // Отдаём только basename: иначе через ?name=../../../etc/passwd читается что угодно.
            const name = path.basename(url.searchParams.get('name') || '');
            if (!name.endsWith('.jsonl')) return send(res, 400, { error: 'bad name' });
            const file = path.join(RESULTS_DIR, name);
            if (!file.startsWith(RESULTS_DIR)) return send(res, 400, { error: 'bad path' });
            if (!fs.existsSync(file)) return send(res, 404, { error: 'no such log' });
            const limit = Math.min(5000, +url.searchParams.get('limit') || 200);
            const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
            return send(res, 200, { name, total: lines.length, lines: lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch (e) { return { reason: 'unparsed' }; } }) });
        }

        if (p.startsWith('/api/')) return send(res, 404, { error: 'no such endpoint' });

        // Статика: только из папки ui, с защитой от выхода за её пределы.
        const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
        const file = path.join(ARENA_DIR, 'ui', rel);
        if (!file.startsWith(path.join(ARENA_DIR, 'ui')) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            return send(res, 404, 'not found', 'text/plain');
        }
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
        return send(res, 200, fs.readFileSync(file), types[path.extname(file)] || 'application/octet-stream');
    } catch (e) {
        send(res, 500, { error: (e && e.message) || String(e) });
    }
});

server.listen(PORT, HOST, () => {
    console.log(`arena gui  http://${HOST}:${PORT}`);
    console.log(`  bots     ${Object.keys(readBots()).join(', ')}`);
    console.log(`  cores    ${os.cpus().length} (default threads ${Math.max(1, os.cpus().length - 1)})`);
    console.log('  local only - do not expose this port');
});
