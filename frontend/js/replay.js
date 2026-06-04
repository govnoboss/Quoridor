const CELL = 80;
const BOARD = 720;
const CONFIG = { gridCount: 9 };

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

async function loadGame(gameId) {
  const info = document.getElementById('replayInfo');
  info.textContent = 'Loading...';
  try {
    const res = await fetch('/api/games/' + gameId);
    if (!res.ok) throw new Error('Not found');
    gameData = await res.json();
    document.getElementById('playerWhiteName').textContent = gameData.playerWhite?.username || 'White';
    document.getElementById('playerBlackName').textContent = gameData.playerBlack?.username || 'Black';
    info.textContent = '';
    if (gameData.history && gameData.history.length > 0) {
      buildSnapshots();
      updateCounter();
      draw();
      updateResult();
    } else {
      info.textContent = 'No replay data for this game.';
    }
  } catch (e) {
    info.textContent = 'Failed to load game.';
  }
}

function getBaseTime() {
  const t = gameData?.gameType;
  if (t === 'bullet') return 120;
  if (t === 'blitz') return 420;
  if (t === 'rapid') return 600;
  return 600;
}

function buildSnapshots() {
  snapshots = [];
  const initial = Shared.createInitialState({ base: getBaseTime() });
  snapshots.push(Shared.cloneState(initial));
  let state = Shared.cloneState(initial);
  const history = gameData.history || [];
  for (const record of history) {
    if (!record.move) continue;
    const action = {
      type: record.move.type,
      r: record.move.r,
      c: record.move.c,
      isVertical: record.move.isVertical || false,
      playerIdx: record.playerIdx
    };
    try {
      state = Shared.gameReducer(state, action);
      snapshots.push(Shared.cloneState(state));
    } catch (e) {
      break;
    }
  }
  currentMove = 0;
}

function draw() {
  const state = snapshots[currentMove];
  if (!state) return;
  ctx.clearRect(0, 0, BOARD, BOARD);
  drawGrid(state);
  drawCoords();
  drawWalls(state);
  drawPawns(state);
}

function tr(r) {
  return perspective === 1 ? 8 - r : r;
}

function drawGrid(state) {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const x = c * CELL + 4;
      const y = tr(r) * CELL + 4;
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(x, y, CELL - 8, CELL - 8);
    }
  }
}

function drawCoords() {
  ctx.fillStyle = '#666';
  ctx.font = '11px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let c = 0; c < 9; c++) {
    const label = String.fromCharCode(97 + (perspective === 1 ? 8 - c : c));
    ctx.fillText(label, c * CELL + CELL / 2, 9 * CELL + 2);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let r = 0; r < 9; r++) {
    ctx.fillText(String(tr(r) + 1), -4, tr(r) * CELL + CELL / 2);
  }
}

function drawPawns(state) {
  for (const p of state.players) {
    const x = p.pos.c * CELL + CELL / 2;
    const y = tr(p.pos.r) * CELL + CELL / 2;
    const radius = CELL * 0.35;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    if (p.color === 'white') {
      ctx.fillStyle = '#f0f0f0';
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = '#222';
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }
  }
}

function drawWalls(state) {
  ctx.fillStyle = '#e09f3e';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (state.hWalls[r][c]) {
        const y = (tr(r) < tr(r + 1) ? tr(r) : tr(r + 1)) * CELL;
        const x = c * CELL + 2;
        ctx.fillRect(x, y, CELL * 2 - 4, 6);
      }
      if (state.vWalls[r][c]) {
        const x = c * CELL + CELL;
        const y = (tr(r) < tr(r + 1) ? tr(r) : tr(r + 1)) * CELL + 2;
        ctx.fillRect(x - 3, y, 6, CELL * 2 - 4);
      }
    }
  }
}

function updateCounter() {
  document.getElementById('moveCounter').textContent = currentMove + ' / ' + (snapshots.length - 1);
}

function updateResult() {
  const el = document.getElementById('gameResult');
  if (!gameData) return;
  const winner = gameData.winner;
  let label = 'Draw';
  if (winner === 0) label = gameData.playerWhite?.username + ' won';
  else if (winner === 1) label = gameData.playerBlack?.username + ' won';
  el.textContent = label + ' · ' + (gameData.reason || 'goal') + ' · ' + (gameData.turns || snapshots.length - 1) + ' moves';
}

function goToMove(idx) {
  if (idx < 0) idx = 0;
  if (idx >= snapshots.length) idx = snapshots.length - 1;
  currentMove = idx;
  draw();
  updateCounter();
}

function prevMove() { goToMove(currentMove - 1); }
function nextMove() { goToMove(currentMove + 1); }
function goToStart() { goToMove(0); }
function goToEnd() { goToMove(snapshots.length - 1); }

function togglePlay() {
  const btn = document.getElementById('playBtn');
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
    const btn = document.getElementById('copyBtn');
    btn.textContent = '\u2713 Copied!';
    setTimeout(function () { btn.textContent = '\uD83D\uDCCB Copy Link'; }, 2000);
  });
}

function getPlayerInfo(idx) {
  return {
    name: gameData?.playerWhite?.username || 'White',
    color: '#f0f0f0'
  };
}

async function exportVideo() {
  if (snapshots.length < 2) return;
  if (typeof VideoEncoder === 'undefined') {
    exportFallback();
    return;
  }
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = 1080;
  exportCanvas.height = 1920;
  const ectx = exportCanvas.getContext('2d');
  const cellSize = 120;
  const boardSize = cellSize * 9;
  const topBarH = Math.floor((1920 - boardSize) / 2);
  const bottomBarH = 1920 - boardSize - topBarH;
  const fps = 30;
  const framesPerMove = fps;

  const progressEl = document.getElementById('exportProgress');
  const progressBar = document.getElementById('exportBar');
  const modal = document.getElementById('exportModal');
  const preview = document.getElementById('exportPreview');
  modal.style.display = 'flex';
  progressEl.style.display = 'block';
  preview.style.display = 'none';

  try {
    const muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: 'avc', width: 1080, height: 1920 },
      fastStart: 'in-memory'
    });

    const encoder = new VideoEncoder({
      output: function (chunk, meta) { muxer.addVideoChunk(chunk, meta); },
      error: function (e) {
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

    for (let i = 1; i < snapshots.length; i++) {
      drawExportFrame(ectx, snapshots[i], i, cellSize, boardSize, topBarH, bottomBarH);
      for (let f = 0; f < framesPerMove; f++) {
        const frame = new VideoFrame(exportCanvas, {
          timestamp: ((i - 1) * framesPerMove + f) * 1_000_000 / fps
        });
        encoder.encode(frame, { keyFrame: f === 0 });
        frame.close();
      }
      const pct = Math.round((i / (snapshots.length - 1)) * 100);
      progressBar.style.width = pct + '%';
      progressEl.textContent = 'Encoding... ' + pct + '%';
      await new Promise(function (r) { setTimeout(r, 0); });
    }

    await encoder.flush();
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    showExportResult(blob, progressEl, progressBar, preview);
  } catch (e) {
    exportFallback();
  }
}

function exportFallback() {
  const progressEl = document.getElementById('exportProgress');
  const progressBar = document.getElementById('exportBar');
  const preview = document.getElementById('exportPreview');
  progressEl.textContent = 'Using fallback encoder...';

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = 1080;
  exportCanvas.height = 1920;
  const ectx = exportCanvas.getContext('2d');
  const cellSize = 120;
  const boardSize = cellSize * 9;
  const topBarH = Math.floor((1920 - boardSize) / 2);
  const bottomBarH = 1920 - boardSize - topBarH;
  const totalMoves = snapshots.length - 1;
  const fps = 15;
  let moveIdx = 1;
  let frameCount = 0;
  const totalFrames = totalMoves * fps;

  const stream = exportCanvas.captureStream(fps);
  const mime = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E')
    ? 'video/mp4;codecs=avc1.42E01E'
    : 'video/webm;codecs=vp9';

  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks = [];
  recorder.ondataavailable = function (e) { if (e.data.size > 0) chunks.push(e.data); };

  recorder.onstop = function () {
    const blob = new Blob(chunks, { type: mime });
    const preview = document.getElementById('exportPreview');
    const progressEl = document.getElementById('exportProgress');
    const progressBar = document.getElementById('exportBar');
    showExportResult(blob, progressEl, progressBar, preview);
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
      const pct = Math.round(((moveIdx - 1) / totalMoves) * 100);
      progressBar.style.width = pct + '%';
      progressEl.textContent = 'Rendering... ' + pct + '%';
    }
    requestAnimationFrame(renderLoop);
  }
  renderLoop();
}

function drawExportFrame(ectx, state, moveIdx, cellSize, boardSize, topBarH, bottomBarH) {
  const w = 1080;
  const h = 1920;

  ectx.fillStyle = '#1a1a1a';
  ectx.fillRect(0, 0, w, h);

  if (topBarH > 0) {
    var grad = ectx.createLinearGradient(0, 0, 0, topBarH);
    grad.addColorStop(0, '#1a1a2e');
    grad.addColorStop(1, '#1a1a1a');
    ectx.fillStyle = grad;
    ectx.fillRect(0, 0, w, topBarH);
  }

  if (bottomBarH > 0) {
    var grad2 = ectx.createLinearGradient(0, h - bottomBarH, 0, h);
    grad2.addColorStop(0, '#1a1a1a');
    grad2.addColorStop(1, '#1a1a2e');
    ectx.fillStyle = grad2;
    ectx.fillRect(0, h - bottomBarH, w, bottomBarH);
  }

  const boardX = Math.floor((w - boardSize) / 2);
  const boardY = topBarH;
  ectx.save();
  ectx.translate(boardX, boardY);

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const x = c * cellSize + 4;
      const y = (perspective === 1 ? 8 - r : r) * cellSize + 4;
      ectx.fillStyle = '#2a2a2a';
      ectx.fillRect(x, y, cellSize - 8, cellSize - 8);
    }
  }

  ectx.fillStyle = '#e09f3e';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (state.hWalls[r][c]) {
        var yy = (perspective === 1 ? (7 - r < 7 - (r + 1) ? 7 - r : 7 - (r + 1)) : r) * cellSize + cellSize;
        var xx = c * cellSize + 2;
        ectx.fillRect(xx, yy - 3, cellSize * 2 - 4, 6);
      }
      if (state.vWalls[r][c]) {
        var xx2 = c * cellSize + cellSize;
        var rr = perspective === 1 ? 7 - r : r;
        var yy2 = rr * cellSize + 2;
        ectx.fillRect(xx2 - 3, yy2, 6, cellSize * 2 - 4);
      }
    }
  }

  for (const p of state.players) {
    var px = p.pos.c * cellSize + cellSize / 2;
    var py = (perspective === 1 ? 8 - p.pos.r : p.pos.r) * cellSize + cellSize / 2;
    var rad = cellSize * 0.35;
    ectx.beginPath();
    ectx.arc(px, py, rad, 0, Math.PI * 2);
    if (p.color === 'white') {
      ectx.fillStyle = '#f0f0f0';
      ectx.strokeStyle = '#888';
    } else {
      ectx.fillStyle = '#222';
      ectx.strokeStyle = '#555';
    }
    ectx.lineWidth = 3;
    ectx.fill();
    ectx.stroke();
  }

  ectx.restore();

  drawPlayerBar(ectx, w, topBarH, gameData?.playerBlack, 'white', moveIdx, cellSize, boardSize, true);
  drawPlayerBar(ectx, w, bottomBarH, gameData?.playerWhite, 'black', moveIdx, cellSize, boardSize, false);
}

function drawPlayerBar(ectx, w, barH, player, opponentColor, moveIdx, cellSize, boardSize, isTop) {
  if (barH < 40) return;
  var label = player?.username || opponentColor;
  ectx.fillStyle = '#fff';
  ectx.font = 'bold 36px Arial';
  ectx.textAlign = 'left';
  ectx.textBaseline = 'middle';
  var textY = isTop ? barH / 2 : 1920 - barH / 2;

  ectx.beginPath();
  ectx.arc(60, textY, 24, 0, Math.PI * 2);
  if (opponentColor === 'white') {
    ectx.fillStyle = '#f0f0f0';
    ectx.strokeStyle = '#888';
  } else {
    ectx.fillStyle = '#222';
    ectx.strokeStyle = '#555';
  }
  ectx.lineWidth = 2;
  ectx.fill();
  ectx.stroke();

  ectx.fillStyle = '#e09f3e';
  ectx.font = 'bold 36px Arial';
  ectx.textAlign = 'left';
  ectx.fillText(label, 100, textY);

  var whiteWalls = 10;
  var blackWalls = 10;
  if (snapshots[moveIdx]) {
    whiteWalls = snapshots[moveIdx].players[0].wallsLeft;
    blackWalls = snapshots[moveIdx].players[1].wallsLeft;
  }
  var showWalls = isTop ? blackWalls : whiteWalls;
  var wallsLabel = '\u25A0'.repeat(showWalls) + '\u25A1'.repeat(10 - showWalls);
  ectx.fillStyle = '#888';
  ectx.font = '20px Arial';
  ectx.textAlign = 'right';
  ectx.fillText(wallsLabel, w - 30, textY);
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
