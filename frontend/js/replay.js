const CELL = 120;
const BOARD = 1080;
const WALL_THICK = 20;
const GAP = 8;

let gameData = null;
let snapshots = [];
let currentMove = 0;
let isPlaying = false;
let playTimer = null;
let playSpeed = 1000;
let perspective = 0;

const canvas = document.getElementById('replayCanvas');
const ctx = canvas.getContext('2d');
canvas.width = BOARD;
canvas.height = BOARD;

function loadGame(gameId) {
  const info = document.getElementById('replayInfo');
  info.textContent = 'Loading...';
  fetch('/api/games/' + gameId)
    .then(function (r) { if (!r.ok) throw new Error('Not found'); return r.json(); })
    .then(function (data) {
      gameData = data;
      document.getElementById('topPlayerName').textContent = data.playerBlack?.username || 'Black';
      document.getElementById('bottomPlayerName').textContent = data.playerWhite?.username || 'White';
      var topAvatar = document.getElementById('topPlayerAvatar');
      var bottomAvatar = document.getElementById('bottomPlayerAvatar');
      if (data.playerBlack?.avatar) topAvatar.src = data.playerBlack.avatar;
      else topAvatar.src = 'https://ui-avatars.com/api/?name=B&background=333&color=fff';
      if (data.playerWhite?.avatar) bottomAvatar.src = data.playerWhite.avatar;
      else bottomAvatar.src = 'https://ui-avatars.com/api/?name=W&background=333&color=fff';
      info.textContent = '';
      if (data.history && data.history.length > 0) {
        buildSnapshots();
        updateCounter();
        updateTimers();
        renderWallInventory();
        draw();
        updateResult();
      } else {
        info.textContent = 'No replay data for this game.';
      }
    })
    .catch(function () { info.textContent = 'Failed to load game.'; });
}

function getBaseTime() {
  var t = gameData?.gameType;
  if (t === 'bullet') return 120;
  if (t === 'blitz') return 420;
  if (t === 'rapid') return 600;
  return 600;
}

function buildSnapshots() {
  snapshots = [];
  var initial = Shared.createInitialState({ base: getBaseTime() });
  snapshots.push(Shared.cloneState(initial));
  var state = Shared.cloneState(initial);
  var history = gameData.history || [];
  for (var i = 0; i < history.length; i++) {
    var record = history[i];
    if (!record.move) continue;
    var action = {
      type: record.move.type,
      r: record.move.r,
      c: record.move.c,
      isVertical: record.move.isVertical || false,
      playerIdx: record.playerIdx
    };
    try {
      state = Shared.gameReducer(state, action);
      snapshots.push(Shared.cloneState(state));
    } catch (e) { break; }
  }
  currentMove = 0;
}

function tr(r) { return perspective === 1 ? 8 - r : r; }

function wallDisplayR(r) { return perspective === 1 ? 7 - r : r; }

function draw() {
  var state = snapshots[currentMove];
  if (!state) return;
  ctx.clearRect(0, 0, BOARD, BOARD);
  drawGrid(state);
  drawCoords();
  drawWalls(state);
  drawPawns(state);
}

function drawGrid(state) {
  for (var r = 0; r < 9; r++) {
    for (var c = 0; c < 9; c++) {
      var x = c * CELL + 4;
      var y = tr(r) * CELL + 4;
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(x, y, CELL - 8, CELL - 8);
    }
  }
}

function drawCoords() {
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px Arial, sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  var padding = CELL * 0.08;
  for (var r = 0; r < 9; r++) {
    var x = 0 + 4;
    var y = tr(r) * CELL + 4;
    var label = (9 - r).toString();
    ctx.fillText(label, x + padding, y + padding);
  }
  var letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'right';
  for (var c = 0; c < 9; c++) {
    var x2 = (c + 1) * CELL - 4;
    var y2 = (tr(8) + 1) * CELL - 4;
    ctx.fillText(letters[c], x2 - padding, y2 - padding);
  }
}

function drawWalls(state) {
  ctx.fillStyle = '#e09f3e';
  for (var r = 0; r < 8; r++) {
    var dR = wallDisplayR(r);
    for (var c = 0; c < 8; c++) {
      if (state.hWalls[r][c]) {
        var x = c * CELL + GAP;
        var y = (dR + 1) * CELL - WALL_THICK / 2;
        ctx.fillRect(x, y, CELL * 2 - GAP * 2, WALL_THICK);
      }
      if (state.vWalls[r][c]) {
        var x2 = (c + 1) * CELL - WALL_THICK / 2;
        var y2 = dR * CELL + GAP;
        ctx.fillRect(x2, y2, WALL_THICK, CELL * 2 - GAP * 2);
      }
    }
  }
}

function drawPawns(state) {
  var radius = CELL * 0.35;
  for (var i = 0; i < state.players.length; i++) {
    var p = state.players[i];
    var x = (p.pos.c + 0.5) * CELL;
    var y = (tr(p.pos.r) + 0.5) * CELL;
    ctx.fillStyle = p.color === 'white' ? '#fff' : '#000';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = p.color === 'white' ? '#ccc' : '#444';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

function updateCounter() {
  document.getElementById('moveCounter').textContent = currentMove + ' / ' + (snapshots.length - 1);
}

function updateResult() {
  var el = document.getElementById('gameResult');
  if (!gameData) return;
  var winner = gameData.winner;
  var label = 'Draw';
  if (winner === 0) label = (gameData.playerWhite?.username || 'White') + ' won';
  else if (winner === 1) label = (gameData.playerBlack?.username || 'Black') + ' won';
  el.textContent = label + ' \u00B7 ' + (gameData.reason || 'goal') + ' \u00B7 ' + (gameData.turns || snapshots.length - 1) + ' moves';
}

function formatTime(s) {
  var min = Math.floor(s / 60);
  var sec = s % 60;
  return min + ':' + (sec < 10 ? '0' : '') + sec;
}

function updateTimers() {
  var state = snapshots[currentMove];
  if (!state || !state.timers) return;
  document.getElementById('topPlayerTimer').textContent = formatTime(state.timers[1]);
  document.getElementById('bottomPlayerTimer').textContent = formatTime(state.timers[0]);
}

function renderWallInventory() {
  var state = snapshots[currentMove];
  if (!state) return;
  var topInv = document.getElementById('topWallInventory');
  var bottomInv = document.getElementById('bottomWallInventory');
  [topInv, bottomInv].forEach(function (el, idx) {
    var wallsLeft = state.players[idx === 0 ? 1 : 0].wallsLeft;
    el.innerHTML = '';
    for (var w = 0; w < 10; w++) {
      var piece = document.createElement('div');
      piece.className = 'wall-piece' + (w >= wallsLeft ? ' used' : '');
      el.appendChild(piece);
    }
  });
}

function goToMove(idx) {
  if (idx < 0) idx = 0;
  if (idx >= snapshots.length) idx = snapshots.length - 1;
  currentMove = idx;
  draw();
  updateCounter();
  updateTimers();
  renderWallInventory();
}

function prevMove() { goToMove(currentMove - 1); }
function nextMove() { goToMove(currentMove + 1); }
function goToStart() { goToMove(0); }
function goToEnd() { goToMove(snapshots.length - 1); }

function togglePlay() {
  var btn = document.getElementById('playBtn');
  if (isPlaying) {
    clearInterval(playTimer);
    isPlaying = false;
    btn.textContent = '\u25B6';
  } else {
    if (currentMove >= snapshots.length - 1) goToMove(0);
    isPlaying = true;
    btn.textContent = '\u23F8';
    playTimer = setInterval(function () {
      if (currentMove >= snapshots.length - 1) {
        clearInterval(playTimer);
        isPlaying = false;
        btn.textContent = '\u25B6';
        return;
      }
      nextMove();
    }, playSpeed);
  }
}

function setSpeed(speed) {
  playSpeed = speed;
  if (isPlaying) {
    clearInterval(playTimer);
    playTimer = setInterval(function () {
      if (currentMove >= snapshots.length - 1) {
        clearInterval(playTimer);
        isPlaying = false;
        document.getElementById('playBtn').textContent = '\u25B6';
        return;
      }
      nextMove();
    }, playSpeed);
  }
}

function togglePerspective() {
  perspective = perspective === 0 ? 1 : 0;
  draw();
}

function copyLink() {
  navigator.clipboard.writeText(window.location.href).then(function () {
    var btn = document.getElementById('copyBtn');
    btn.textContent = '\u2713 Copied!';
    setTimeout(function () { btn.textContent = '\uD83D\uDCCB Copy Link'; }, 2000);
  });
}

async function exportVideo() {
  if (snapshots.length < 2) return;
  if (typeof VideoEncoder === 'undefined') {
    exportFallback();
    return;
  }
  var exportCanvas = document.createElement('canvas');
  exportCanvas.width = 1080;
  exportCanvas.height = 1920;
  var ectx = exportCanvas.getContext('2d');
  var cellSize = 120;
  var boardSize = cellSize * 9;
  var topBarH = Math.floor((1920 - boardSize) / 2);
  var bottomBarH = 1920 - boardSize - topBarH;
  var fps = 30;
  var framesPerMove = fps;

  var progressEl = document.getElementById('exportProgress');
  var progressBar = document.getElementById('exportBar');
  var modal = document.getElementById('exportModal');
  var preview = document.getElementById('exportPreview');
  modal.style.display = 'flex';
  progressEl.style.display = 'block';
  preview.style.display = 'none';

  try {
    var muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: 'avc', width: 1080, height: 1920 },
      fastStart: 'in-memory'
    });

    var encoder = new VideoEncoder({
      output: function (chunk, meta) { muxer.addVideoChunk(chunk, meta); },
      error: function () {
        progressEl.textContent = 'Encoder error, trying fallback...';
        muxer = null;
      }
    });

    encoder.configure({
      codec: 'avc1.42001f',
      width: 1080,
      height: 1920,
      bitrate: 2_000_000
    });

    for (var i = 1; i < snapshots.length; i++) {
      drawExportFrame(ectx, snapshots[i], i, cellSize, boardSize, topBarH, bottomBarH);
      for (var f = 0; f < framesPerMove; f++) {
        var frame = new VideoFrame(exportCanvas, {
          timestamp: ((i - 1) * framesPerMove + f) * 1_000_000 / fps
        });
        encoder.encode(frame, { keyFrame: f === 0 });
        frame.close();
      }
      var pct = Math.round((i / (snapshots.length - 1)) * 100);
      progressBar.style.width = pct + '%';
      progressEl.innerHTML = '<p>Encoding... ' + pct + '%</p>';
      await new Promise(function (r) { setTimeout(r, 0); });
    }

    await encoder.flush();
    muxer.finalize();
    var blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    showExportResult(blob, progressEl, progressBar, preview);
  } catch (e) {
    exportFallback();
  }
}

function exportFallback() {
  var progressEl = document.getElementById('exportProgress');
  var progressBar = document.getElementById('exportBar');
  var preview = document.getElementById('exportPreview');
  progressEl.innerHTML = '<p>Using fallback encoder...</p>';

  var exportCanvas = document.createElement('canvas');
  exportCanvas.width = 1080;
  exportCanvas.height = 1920;
  var ectx = exportCanvas.getContext('2d');
  var cellSize = 120;
  var boardSize = cellSize * 9;
  var topBarH = Math.floor((1920 - boardSize) / 2);
  var bottomBarH = 1920 - boardSize - topBarH;
  var totalMoves = snapshots.length - 1;
  var fps = 15;
  var moveIdx = 1;
  var frameCount = 0;
  var totalFrames = totalMoves * fps;

  var stream = exportCanvas.captureStream(fps);
  var mime = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E')
    ? 'video/mp4;codecs=avc1.42E01E'
    : 'video/webm;codecs=vp9';

  var recorder = new MediaRecorder(stream, { mimeType: mime });
  var chunks = [];
  recorder.ondataavailable = function (e) { if (e.data.size > 0) chunks.push(e.data); };

  recorder.onstop = function () {
    var blob2 = new Blob(chunks, { type: mime });
    showExportResult(blob2, progressEl, progressBar, preview);
  };

  recorder.start();

  function renderLoop() {
    if (moveIdx >= snapshots.length) {
      recorder.stop();
      return;
    }
    drawExportFrame(ectx, snapshots[moveIdx], moveIdx, cellSize, boardSize, topBarH, bottomBarH);
    frameCount++;
    if (frameCount >= fps) {
      frameCount = 0;
      moveIdx++;
      var pct2 = Math.round(((moveIdx - 1) / totalMoves) * 100);
      progressBar.style.width = pct2 + '%';
      progressEl.innerHTML = '<p>Rendering... ' + pct2 + '%</p>';
    }
    requestAnimationFrame(renderLoop);
  }
  renderLoop();
}

function drawExportFrame(ectx, state, moveIdx, cellSize, boardSize, topBarH, bottomBarH) {
  var w = 1080;
  var h = 1920;

  ectx.fillStyle = '#1a1a1a';
  ectx.fillRect(0, 0, w, h);

  if (topBarH > 0) {
    var grad = ectx.createLinearGradient(0, 0, 0, topBarH);
    grad.addColorStop(0, '#262421');
    grad.addColorStop(1, '#1a1a1a');
    ectx.fillStyle = grad;
    ectx.fillRect(0, 0, w, topBarH);
  }

  if (bottomBarH > 0) {
    var grad2 = ectx.createLinearGradient(0, h - bottomBarH, 0, h);
    grad2.addColorStop(0, '#1a1a1a');
    grad2.addColorStop(1, '#262421');
    ectx.fillStyle = grad2;
    ectx.fillRect(0, h - bottomBarH, w, bottomBarH);
  }

  var boardX = Math.floor((w - boardSize) / 2);
  var boardY = topBarH;
  ectx.save();
  ectx.translate(boardX, boardY);

  for (var r = 0; r < 9; r++) {
    for (var c = 0; c < 9; c++) {
      var x = c * cellSize + 4;
      var y = (perspective === 1 ? 8 - r : r) * cellSize + 4;
      ectx.fillStyle = '#2a2a2a';
      ectx.fillRect(x, y, cellSize - 8, cellSize - 8);
    }
  }

  ectx.fillStyle = '#e09f3e';
  for (var r2 = 0; r2 < 8; r2++) {
    var dR = perspective === 1 ? 7 - r2 : r2;
    for (var c2 = 0; c2 < 8; c2++) {
      if (state.hWalls[r2][c2]) {
        var hx = c2 * cellSize + GAP;
        var hy = (dR + 1) * cellSize - WALL_THICK / 2;
        ectx.fillRect(hx, hy, cellSize * 2 - GAP * 2, WALL_THICK);
      }
      if (state.vWalls[r2][c2]) {
        var vx = (c2 + 1) * cellSize - WALL_THICK / 2;
        var vy = dR * cellSize + GAP;
        ectx.fillRect(vx, vy, WALL_THICK, cellSize * 2 - GAP * 2);
      }
    }
  }

  for (var i = 0; i < state.players.length; i++) {
    var p = state.players[i];
    var px = p.pos.c * cellSize + cellSize / 2;
    var py = (perspective === 1 ? 8 - p.pos.r : p.pos.r) * cellSize + cellSize / 2;
    var rad = cellSize * 0.35;
    ectx.beginPath();
    ectx.arc(px, py, rad, 0, Math.PI * 2);
    if (p.color === 'white') {
      ectx.fillStyle = '#fff';
      ectx.strokeStyle = '#ccc';
    } else {
      ectx.fillStyle = '#000';
      ectx.strokeStyle = '#444';
    }
    ectx.lineWidth = 3;
    ectx.fill();
    ectx.stroke();
  }

  ectx.restore();

  drawExportPlayerBar(ectx, w, topBarH, gameData?.playerBlack, 'white', moveIdx, cellSize, boardSize, true);
  drawExportPlayerBar(ectx, w, bottomBarH, gameData?.playerWhite, 'black', moveIdx, cellSize, boardSize, false);
}

function drawExportPlayerBar(ectx, w, barH, player, colorName, moveIdx, cellSize, boardSize, isTop) {
  if (barH < 40) return;
  var label = player?.username || (colorName === 'white' ? 'White' : 'Black');
  var textY = isTop ? barH / 2 : 1920 - barH / 2;

  ectx.beginPath();
  ectx.arc(60, textY, 24, 0, Math.PI * 2);
  ectx.fillStyle = colorName === 'white' ? '#f0f0f0' : '#222';
  ectx.strokeStyle = colorName === 'white' ? '#888' : '#555';
  ectx.lineWidth = 2;
  ectx.fill();
  ectx.stroke();

  ectx.fillStyle = '#fff';
  ectx.font = 'bold 36px Arial, sans-serif';
  ectx.textAlign = 'left';
  ectx.textBaseline = 'middle';
  ectx.fillText(label, 100, textY);

  var whiteWalls = 10;
  var blackWalls = 10;
  if (snapshots[moveIdx]) {
    whiteWalls = snapshots[moveIdx].players[0].wallsLeft;
    blackWalls = snapshots[moveIdx].players[1].wallsLeft;
  }
  var showWalls = isTop ? blackWalls : whiteWalls;

  var wallX = w - 220;
  var wallY = textY - 5;
  for (var i = 0; i < 10; i++) {
    ectx.fillStyle = i < showWalls ? '#e09f3e' : 'rgba(224,159,62,0.15)';
    ectx.fillRect(wallX + i * 18, wallY, 14, 10);
  }

  var timerVal = formatTime(snapshots[moveIdx]?.timers ? snapshots[moveIdx].timers[isTop ? 1 : 0] : 600);
  ectx.fillStyle = '#fff';
  ectx.font = 'bold 32px monospace';
  ectx.textAlign = 'right';
  ectx.fillText(timerVal, w - 40, textY);
}

function showExportResult(blob, progressEl, progressBar, preview) {
  progressEl.style.display = 'none';
  progressBar.style.width = '0%';
  var url = URL.createObjectURL(blob);
  preview.innerHTML = '<video src="' + url + '" controls style="max-width:100%;max-height:60vh"></video><br><a href="' + url + '" download="quoridor_replay.mp4" class="export-btn">\u2B07 Download MP4</a>';
  preview.style.display = 'block';
}

function closeExportModal() {
  document.getElementById('exportModal').style.display = 'none';
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'ArrowLeft') { e.preventDefault(); prevMove(); }
  if (e.key === 'ArrowRight') { e.preventDefault(); nextMove(); }
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  if (e.key === 'Home') { e.preventDefault(); goToStart(); }
  if (e.key === 'End') { e.preventDefault(); goToEnd(); }
});
