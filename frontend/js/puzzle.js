var Puzzle = (function () {
    'use strict';

    var CELL = 120;
    var BOARD = 1080;
    var WALL_THICK = 20;
    var GAP = 8;

    var data = null;
    var state = null;
    var targets = [];
    var perspective = 0;
    var solved = false;

    var canvas = document.getElementById('puzzleCanvas');
    var ctx = canvas.getContext('2d');
    canvas.width = BOARD;
    canvas.height = BOARD;

    function label(id) { return document.getElementById(id); }

    function replayHistory(history) {
        var s = Shared.createInitialState({ base: 600 });
        for (var i = 0; i < (history || []).length; i++) {
            var record = history[i];
            if (!record || !record.move) continue;
            var m = record.move;
            s = Shared.gameReducer(s, {
                type: m.type,
                r: m.r,
                c: m.c,
                isVertical: m.isVertical || false,
                playerIdx: typeof m.playerIdx === 'number' ? m.playerIdx : record.playerIdx
            });
        }
        return s;
    }

    function tr(r) { return perspective === 1 ? 8 - r : r; }
    function invTr(r) { return perspective === 1 ? 8 - r : r; }

    function legalTargets() {
        var p = state.players[data.winner].pos;
        return Shared.getJumpTargets(state, p.r, p.c);
    }

    function draw() {
        ctx.clearRect(0, 0, BOARD, BOARD);
        drawGrid();
        drawCoords();
        drawWalls();
        drawTargets();
        drawPawns();
        drawGoalLine();
    }

    function drawGrid() {
        BoardRenderer.drawGrid(ctx, { cellSize: CELL });
    }

    function drawCoords() {
        BoardRenderer.drawCoordinates(ctx, { cellSize: CELL, fontFamily: 'Arial, sans-serif' });
    }

    function drawWalls() {
        BoardRenderer.drawPlacedWalls(ctx, state, {
            cellSize: CELL,
            gap: GAP,
            wallThick: WALL_THICK,
            transformWallRow: function (r) { return perspective === 1 ? 7 - r : r; }
        });
    }

    function drawTargets() {
        var idx = data.winner;
        var p = state.players[idx].pos;
        // Кольцо вокруг фишки решающего
        ctx.save();
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc((p.c + 0.5) * CELL, (tr(p.r) + 0.5) * CELL, CELL * 0.42, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // Доступные клетки
        for (var i = 0; i < targets.length; i++) {
            var t = targets[i];
            var cx = (t.c + 0.5) * CELL;
            var cy = (tr(t.r) + 0.5) * CELL;
            ctx.save();
            ctx.fillStyle = 'rgba(34,197,94,0.35)';
            ctx.beginPath();
            ctx.arc(cx, cy, CELL * 0.32, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(cx, cy, CELL * 0.32, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }

    function drawPawns() {
        BoardRenderer.drawPawns(ctx, state, {
            cellSize: CELL,
            transformRow: function (r) { return tr(r); }
        });
    }

    function drawGoalLine() {
        var row = data.winner === 1 ? 8 : 0;
        ctx.save();
        ctx.fillStyle = 'rgba(245,158,11,0.10)';
        ctx.fillRect(0, tr(row) * CELL, BOARD, CELL);
        ctx.restore();
    }

    function toGrid(event) {
        var rect = canvas.getBoundingClientRect();
        var x = (event.clientX - rect.left) * (BOARD / rect.width);
        var y = (event.clientY - rect.top) * (BOARD / rect.height);
        return { r: invTr(Math.floor(y / CELL)), c: Math.floor(x / CELL) };
    }

    function setStatus(text, cls) {
        var el = label('statusText');
        el.textContent = text;
        el.className = 'status' + (cls ? ' ' + cls : '');
    }

    function setDifficulty(val) {
        var el = label('difficultyLabel');
        el.textContent = val;
        el.className = 'v diff-' + val;
    }

    function renderSidebar() {
        label('dateLabel').textContent = data.date;
        setDifficulty(data.difficulty);
        label('youPlay').textContent = data.winner === 1 ? 'Black' : 'White';
        label('streakLabel').textContent = String(data.streak || 0) + ' day' + ((data.streak || 0) === 1 ? '' : 's');
        label('solvedLabel').textContent = String(data.puzzlesSolved || 0);
    }

    function onCanvasClick(event) {
        if (solved) return;
        var cell = toGrid(event);
        var hit = null;
        for (var i = 0; i < targets.length; i++) {
            if (targets[i].r === cell.r && targets[i].c === cell.c) { hit = targets[i]; break; }
        }
        if (!hit) {
            setStatus('That cell is not a legal destination for your pawn.', 'err');
            return;
        }
        submitMove(hit);
    }

    function submitMove(target) {
        fetch('/api/puzzles/solve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ move: { type: 'pawn', r: target.r, c: target.c } })
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (res.solved) {
                    solved = true;
                    if (res.alreadySolved) {
                        setStatus('Correct! You already solved today\u2019s puzzle. Come back tomorrow for a new one.', 'ok');
                    } else {
                        setStatus('Solved! Streak: ' + (res.streak || 1) + ' day(s). New puzzle every day \u2014 come back tomorrow!', 'ok');
                    }
                    if (res.streak != null) label('streakLabel').textContent = String(res.streak) + ' day' + (res.streak === 1 ? '' : 's');
                    if (res.puzzlesSolved != null) label('solvedLabel').textContent = String(res.puzzlesSolved);
                    trackEvent('puzzle-completed', { date: data.date, alreadySolved: !!res.alreadySolved });
                } else {
                    setStatus(res.message === 'Invalid pawn move' ? 'Illegal move.' : 'Not the winning move \u2014 your pawn must reach the goal row.', 'err');
                }
            })
            .catch(function () { setStatus('Failed to submit. Check your connection.', 'err'); });
    }

    function togglePerspective() {
        perspective = perspective === 0 ? 1 : 0;
        draw();
    }

    function init() {
        trackEvent('puzzle-viewed');
        fetch('/api/puzzles/today', { credentials: 'same-origin' })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (res) {
                data = res;
                state = replayHistory(data.moves);
                perspective = data.winner === 1 ? 1 : 0;
                targets = legalTargets();
                solved = !!data.solvedToday;
                renderSidebar();
                draw();
                if (solved) {
                    setStatus('You already solved today\u2019s puzzle. Come back tomorrow for a new one.', 'ok');
                } else {
                    setStatus('Your move. Tap a highlighted cell to reach the goal row.');
                }
            })
            .catch(function () { setStatus('Failed to load today\u2019s puzzle.', 'err'); });
    }

    canvas.addEventListener('click', onCanvasClick);

    return { init: init, togglePerspective: togglePerspective };
})();