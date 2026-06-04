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
let cachedBlob = null;
let cachedURL = null;

const canvas = document.getElementById('replayCanvas');
const ctx = canvas.getContext('2d');
canvas.width = BOARD;
canvas.height = BOARD;

function loadGame(gameId) {
  var info = document.getElementById('replayInfo');
  info.textContent = 'Loading...';
  fetch('/api/games/' + gameId)
    .then(function (r) { if (!r.ok) throw new Error('Not found'); return r.json(); })
    .then(function (data) {
      gameData = data;
      info.textContent = '';
      if (data.history && data.history.length > 0) {
        buildSnapshots();
        currentMove = 0;
        renderMoveHistory();
        updatePlayerBars();
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
  var base = getBaseTime();
  var initial = Shared.createInitialState({ base: base });
  snapshots.push(Shared.cloneState(initial));
  var state = Shared.cloneState(initial);
  var history = gameData.history || [];
  var timers = [base, base];
  var lastTimestamp = gameData.date ? new Date(gameData.date).getTime() : Date.now();

  for (var i = 0; i < history.length; i++) {
    var record = history[i];
    if (!record.move) {
      console.warn('[replay] history[' + i + '] missing move, skipping');
      continue;
    }

    var playerIdx = record.playerIdx;
    if (record.timestamp && lastTimestamp) {
      var elapsed = (record.timestamp - lastTimestamp) / 1000;
      if (elapsed > 0) {
        timers[playerIdx] = Math.max(0, timers[playerIdx] - elapsed);
      }
    }
    lastTimestamp = record.timestamp;

    var px = typeof record.move.playerIdx === 'number' ? record.move.playerIdx : playerIdx;
    var action = {
      type: record.move.type,
      r: record.move.r,
      c: record.move.c,
      isVertical: record.move.isVertical || false,
      playerIdx: px
    };
    try {
      state = Shared.gameReducer(state, action);
      var snapshot = Shared.cloneState(state);
      snapshot.timers = [timers[0], timers[1]];
      snapshots.push(snapshot);
    } catch (e) {
      console.error('[replay] gameReducer error at history[' + i + ']:', e.message, action);
      break;
    }
  }
  if (snapshots.length < 2) {
    console.warn('[replay] no valid moves in history, snapshots=', snapshots.length);
  }
}

function tr(r) { return perspective === 1 ? 8 - r : r; }

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
      var y = r * CELL + 4;
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
    ctx.fillText((9 - r).toString(), 4 + padding, r * CELL + 4 + padding);
  }
  var letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'right';
  for (var c = 0; c < 9; c++) {
    ctx.fillText(letters[c], (c + 1) * CELL - 4 - padding, 9 * CELL - 4 - padding);
  }
}

function drawWalls(state) {
  ctx.fillStyle = '#e09f3e';
  for (var r = 0; r < 8; r++) {
    for (var c = 0; c < 8; c++) {
      if (state.hWalls[r][c]) {
        ctx.fillRect(c * CELL + GAP, (r + 1) * CELL - WALL_THICK / 2, CELL * 2 - GAP * 2, WALL_THICK);
      }
      if (state.vWalls[r][c]) {
        ctx.fillRect((c + 1) * CELL - WALL_THICK / 2, r * CELL + GAP, WALL_THICK, CELL * 2 - GAP * 2);
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

function formatTime(s) {
  var min = Math.floor(s / 60);
  var sec = Math.floor(s % 60);
  return min + ':' + (sec < 10 ? '0' : '') + sec;
}

function updatePlayerBars() {
  var state = snapshots[currentMove];
  if (!state || !gameData) return;

  var topIdx = perspective === 1 ? 0 : 1;
  var bottomIdx = perspective === 1 ? 1 : 0;

  var topPlayer = gameData.playerBlack;
  var bottomPlayer = gameData.playerWhite;
  if (perspective === 1) {
    topPlayer = gameData.playerWhite;
    bottomPlayer = gameData.playerBlack;
  }

  document.getElementById('topPlayerName').textContent = topPlayer?.username || 'Black';
  document.getElementById('bottomPlayerName').textContent = bottomPlayer?.username || 'White';

  var topAvatar = document.getElementById('topPlayerAvatar');
  var bottomAvatar = document.getElementById('bottomPlayerAvatar');
  if (topPlayer?.avatar) topAvatar.src = topPlayer.avatar;
  else topAvatar.src = 'https://ui-avatars.com/api/?name=B&background=333&color=fff';
  if (bottomPlayer?.avatar) bottomAvatar.src = bottomPlayer.avatar;
  else bottomAvatar.src = 'https://ui-avatars.com/api/?name=W&background=333&color=fff';

  document.getElementById('topPlayerTimer').textContent = formatTime(state.timers[topIdx]);
  document.getElementById('bottomPlayerTimer').textContent = formatTime(state.timers[bottomIdx]);

  var topInv = document.getElementById('topWallInventory');
  var bottomInv = document.getElementById('bottomWallInventory');
  renderWallsFor(topInv, state.players[topIdx].wallsLeft);
  renderWallsFor(bottomInv, state.players[bottomIdx].wallsLeft);

  document.getElementById('topPlayerBar').classList.toggle('active-turn', state.currentPlayer === topIdx);
  document.getElementById('bottomPlayerBar').classList.toggle('active-turn', state.currentPlayer === bottomIdx);
}

function renderWallsFor(el, wallsLeft) {
  if (el.childNodes.length === 10) {
    for (var w = 0; w < 10; w++) {
      el.childNodes[w].className = 'wall-piece' + (w >= wallsLeft ? ' used' : '');
    }
  } else {
    el.innerHTML = '';
    for (var w = 0; w < 10; w++) {
      var piece = document.createElement('div');
      piece.className = 'wall-piece' + (w >= wallsLeft ? ' used' : '');
      el.appendChild(piece);
    }
  }
}

function getNotation(move) {
  if (move.type === 'pawn') {
    var col = String.fromCharCode('a'.charCodeAt(0) + move.c);
    var row = 9 - move.r;
    return col + row;
  }
  if (move.type === 'wall') {
    var col2 = String.fromCharCode('a'.charCodeAt(0) + move.c);
    var row2 = 9 - move.r;
    return col2 + row2 + (move.isVertical ? 'v' : 'h');
  }
  return '?';
}

function renderMoveHistory() {
  var list = document.getElementById('historyList');
  if (!list || !gameData) return;

  var history = gameData.history || [];
  var rowCount = Math.ceil(history.length / 2) + 1;

  if (list.childNodes.length !== rowCount) {
    list.innerHTML = '';

    var startRow = document.createElement('div');
    startRow.className = 'history-row start-row';
    startRow.innerHTML = '<span class="move' + (currentMove === 0 ? ' active' : '') + '" onclick="goToMove(0)">Start</span>';
    list.appendChild(startRow);

    for (var i = 0; i < history.length; i += 2) {
      var row = document.createElement('div');
      row.className = 'history-row';

      var move1 = history[i];
      var move2 = history[i + 1];

      var n1 = move1 ? getNotation(move1.move) : '';
      var n2 = move2 ? getNotation(move2.move) : '';

      var active1 = currentMove === i + 1 ? ' active' : '';
      var active2 = currentMove === i + 2 ? ' active' : '';

      row.innerHTML = '<span class="move' + active1 + '" onclick="goToMove(' + (i + 1) + ')">' + n1 + '</span>' +
                      '<span class="move' + active2 + '" onclick="goToMove(' + (i + 2) + ')">' + n2 + '</span>';
      list.appendChild(row);
    }
  } else {
    var allSpans = list.querySelectorAll('.move');
    for (var s = 0; s < allSpans.length; s++) {
      var span = allSpans[s];
      var idx = Number(span.getAttribute('onclick').match(/\d+/)[0]);
      span.classList.toggle('active', idx === currentMove);
    }
  }

  if (!isPlaying) {
    var active = list.querySelector('.move.active');
    if (active) active.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
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

function goToMove(idx) {
  if (idx < 0) idx = 0;
  if (idx >= snapshots.length) idx = snapshots.length - 1;
  currentMove = idx;
  draw();
  renderMoveHistory();
  updatePlayerBars();
}

function prevMove() { goToMove(currentMove - 1); }
function nextMove() { goToMove(currentMove + 1); }
function goToStart() { goToMove(0); }
function goToEnd() { goToMove(snapshots.length - 1); }

function scheduleNextTick() {
  if (!isPlaying) return;
  if (currentMove >= snapshots.length - 1) {
    isPlaying = false;
    var btn = document.getElementById('playBtn');
    if (btn) btn.textContent = '\u25B6';
    return;
  }
  playTimer = setTimeout(function () {
    if (!isPlaying) return;
    nextMove();
    scheduleNextTick();
  }, playSpeed);
}

function togglePlay() {
  if (isNaN(playSpeed) || playSpeed < 50) playSpeed = 1000;
  var btn = document.getElementById('playBtn');
  if (isPlaying) {
    clearTimeout(playTimer);
    isPlaying = false;
    btn.textContent = '\u25B6';
  } else {
    if (currentMove >= snapshots.length - 1) goToMove(0);
    isPlaying = true;
    btn.textContent = '\u23F8';
    scheduleNextTick();
  }
}

function setSpeed(speed) {
  speed = Number(speed);
  if (isNaN(speed) || speed < 50) speed = 1000;
  playSpeed = speed;
  if (isPlaying) {
    clearTimeout(playTimer);
    scheduleNextTick();
  }
}

function togglePerspective() {
  perspective = perspective === 0 ? 1 : 0;
  updatePlayerBars();
  draw();
  if (cachedURL) {
    var video = document.getElementById('exportVideo');
    if (video) {
      video.style.transform = perspective === 1 ? 'scaleY(-1)' : '';
    }
  }
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

  var progressEl = document.getElementById('exportProgress');
  var progressBar = document.getElementById('exportBar');
  var modal = document.getElementById('exportModal');
  var preview = document.getElementById('exportPreview');
  modal.style.display = 'flex';

  if (cachedBlob) {
    progressEl.style.display = 'none';
    preview.style.display = 'block';
    showExportResult(cachedBlob, progressEl, progressBar, preview);
    return;
  }

  progressEl.style.display = 'block';
  preview.style.display = 'none';

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

  console.log('[export] using WebCodecs + mp4-muxer, fps=' + fps + ', framesPerMove=' + framesPerMove);
  try {
    var muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: 'avc', width: 1080, height: 1920 },
      fastStart: 'in-memory'
    });

    var encoderFailed = false;
    var encoder = new VideoEncoder({
      output: function (chunk, meta) {
        if (encoderFailed || !muxer) return;
        muxer.addVideoChunk(chunk, meta);
      },
      error: function () {
        encoderFailed = true;
      }
    });

    encoder.configure({
      codec: 'avc1.42001f',
      width: 1080,
      height: 1920,
      bitrate: 2_000_000
    });

    for (var i = 1; i < snapshots.length; i++) {
      drawExportFrame(ectx, snapshots[i], cellSize, boardSize, topBarH, bottomBarH);
      for (var f = 0; f < framesPerMove; f++) {
        var frame = new VideoFrame(exportCanvas, {
          timestamp: ((i - 1) * framesPerMove + f) * 1_000_000 / fps
        });
        encoder.encode(frame, { keyFrame: f === 0 });
        frame.close();
      }
      var pct = Math.round((i / (snapshots.length - 1)) * 100);
      progressBar.style.width = pct + '%';
      await new Promise(function (r) { setTimeout(r, 0); });
    }

    await encoder.flush();
    muxer.finalize();
    var blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    if (cachedURL) URL.revokeObjectURL(cachedURL);
    cachedBlob = blob;
    cachedURL = URL.createObjectURL(blob);
    showExportResult(cachedBlob, progressEl, progressBar, preview);
  } catch (e) {
    exportFallback();
  }
}

function exportFallback() {
  var modal = document.getElementById('exportModal');
  var progressEl = document.getElementById('exportProgress');
  var progressBar = document.getElementById('exportBar');
  var preview = document.getElementById('exportPreview');
  if (modal) modal.style.display = 'flex';
  if (progressEl) progressEl.style.display = 'block';
  if (preview) preview.style.display = 'none';
  console.log('[export] using MediaRecorder fallback');

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
  var framesPerMove = 60;
  var moveIdx = 1;
  var frameCount = 0;

  var stream = exportCanvas.captureStream(fps);
  var mime = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E')
    ? 'video/mp4;codecs=avc1.42E01E'
    : 'video/webm;codecs=vp9';

  var recorder = new MediaRecorder(stream, { mimeType: mime });
  var chunks = [];
  recorder.ondataavailable = function (e) { if (e.data.size > 0) chunks.push(e.data); };

  recorder.onstop = function () {
    var blob = new Blob(chunks, { type: mime });
    if (cachedURL) URL.revokeObjectURL(cachedURL);
    cachedBlob = blob;
    cachedURL = URL.createObjectURL(blob);
    showExportResult(cachedBlob, progressEl, progressBar, preview);
  };

  recorder.start();

  function loop() {
    if (moveIdx >= snapshots.length) {
      recorder.stop();
      return;
    }
    drawExportFrame(ectx, snapshots[moveIdx], cellSize, boardSize, topBarH, bottomBarH);
    frameCount++;
    if (frameCount >= framesPerMove) {
      frameCount = 0;
      moveIdx++;
      progressBar.style.width = Math.round(((moveIdx - 1) / totalMoves) * 100) + '%';
    }
    requestAnimationFrame(loop);
  }
  loop();
}

function drawExportFrame(ectx, state, cellSize, boardSize, topBarH, bottomBarH) {
  var w = 1080;
  var h = 1920;

  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, w, h);

  var boardX = Math.floor((w - boardSize) / 2);
  var boardY = topBarH;
  ectx.save();
  ectx.translate(boardX, boardY);

  for (var r = 0; r < 9; r++) {
    for (var c = 0; c < 9; c++) {
      ectx.fillStyle = '#2a2a2a';
      ectx.fillRect(c * cellSize + 4, r * cellSize + 4, cellSize - 8, cellSize - 8);
    }
  }

  ectx.fillStyle = '#e09f3e';
  for (var r2 = 0; r2 < 8; r2++) {
    for (var c2 = 0; c2 < 8; c2++) {
      if (state.hWalls[r2][c2]) {
        ectx.fillRect(c2 * cellSize + GAP, (r2 + 1) * cellSize - WALL_THICK / 2, cellSize * 2 - GAP * 2, WALL_THICK);
      }
      if (state.vWalls[r2][c2]) {
        ectx.fillRect((c2 + 1) * cellSize - WALL_THICK / 2, r2 * cellSize + GAP, WALL_THICK, cellSize * 2 - GAP * 2);
      }
    }
  }

  for (var i = 0; i < state.players.length; i++) {
    var p = state.players[i];
    var px = p.pos.c * cellSize + cellSize / 2;
    var py = (perspective === 1 ? 8 - p.pos.r : p.pos.r) * cellSize + cellSize / 2;
    ectx.beginPath();
    ectx.arc(px, py, cellSize * 0.35, 0, Math.PI * 2);
    ectx.fillStyle = p.color === 'white' ? '#fff' : '#000';
    ectx.strokeStyle = p.color === 'white' ? '#ccc' : '#444';
    ectx.lineWidth = 3;
    ectx.fill();
    ectx.stroke();
  }

  ectx.restore();

  var topIdx = perspective === 1 ? 0 : 1;
  var bottomIdx = perspective === 1 ? 1 : 0;
  var topPlayerData = perspective === 1 ? gameData?.playerWhite : gameData?.playerBlack;
  var bottomPlayerData = perspective === 1 ? gameData?.playerBlack : gameData?.playerWhite;
  drawExportPlayerBar(ectx, w, topPlayerData, topIdx === 0 ? 'white' : 'black', state, true);
  drawExportPlayerBar(ectx, w, bottomPlayerData, bottomIdx === 0 ? 'white' : 'black', state, false);
}

function roundRect(ectx, x, y, w, h, r) {
  ectx.beginPath();
  ectx.moveTo(x + r, y);
  ectx.lineTo(x + w - r, y);
  ectx.quadraticCurveTo(x + w, y, x + w, y + r);
  ectx.lineTo(x + w, y + h - r);
  ectx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ectx.lineTo(x + r, y + h);
  ectx.quadraticCurveTo(x, y + h, x, y + h - r);
  ectx.lineTo(x, y + r);
  ectx.quadraticCurveTo(x, y, x + r, y);
  ectx.closePath();
}

function drawExportPlayerBar(ectx, w, player, colorName, state, isTop) {
  if (!state) return;
  var label = player?.username || (colorName === 'white' ? 'White' : 'Black');
  var playerIdx = colorName === 'white' ? 0 : 1;
  var isActive = state.currentPlayer === playerIdx;

  var barH = 70;
  var barX = 30;
  var barW = w - 60;
  var invH = 24;
  var gap = 6;
  var boardTop = Math.floor((1920 - 1080) / 2);
  var boardBottom = boardTop + 1080;
  var invY, barY;
  if (isTop) {
    invY = boardTop - gap - invH;
    barY = invY - gap - barH;
  } else {
    invY = boardBottom + gap;
    barY = invY + invH + gap;
  }

  ectx.fillStyle = isActive ? '#3c3a37' : '#262421';
  roundRect(ectx, barX, barY, barW, barH, 6);
  ectx.fill();

  if (isActive) {
    ectx.fillStyle = '#e09f3e';
    roundRect(ectx, barX + 12, barY + barH - 3, barW - 24, 3, 1.5);
    ectx.fill();
  }

  var cy = barY + barH / 2;
  var avatarR = 26;
  ectx.beginPath();
  ectx.arc(66, cy, avatarR, 0, Math.PI * 2);
  ectx.fillStyle = colorName === 'white' ? '#f0f0f0' : '#222';
  ectx.fill();
  ectx.strokeStyle = colorName === 'white' ? '#999' : '#555';
  ectx.lineWidth = 2;
  ectx.stroke();

  ectx.fillStyle = colorName === 'white' ? '#222' : '#f0f0f0';
  ectx.font = 'bold 24px Arial, sans-serif';
  ectx.textAlign = 'center';
  ectx.textBaseline = 'middle';
  ectx.fillText(label.charAt(0).toUpperCase(), 66, cy);

  ectx.fillStyle = '#eee';
  ectx.font = 'bold 24px Arial, sans-serif';
  ectx.textAlign = 'left';
  ectx.textBaseline = 'middle';
  ectx.fillText(label, 108, cy);

  var timerText = state.timers ? formatTime(state.timers[playerIdx]) : '10:00';
  var timerBX = w - 200;
  var timerBY = barY + 12;
  var timerBW = 160;
  var timerBH = barH - 24;

  ectx.fillStyle = isActive ? '#eee' : '#1a1a1a';
  roundRect(ectx, timerBX, timerBY, timerBW, timerBH, 6);
  ectx.fill();

  ectx.fillStyle = isActive ? '#111' : '#fff';
  ectx.font = 'bold 28px monospace';
  ectx.textAlign = 'center';
  ectx.textBaseline = 'middle';
  ectx.fillText(timerText, timerBX + timerBW / 2, timerBY + timerBH / 2);

  var wallsLeft = state.players[playerIdx] ? state.players[playerIdx].wallsLeft : 10;
  var invBgW = 340;
  var invBgX = (w - invBgW) / 2;
  var pieceW = 26;
  var pieceGap = 6;
  var piecesW = 10 * pieceW + 9 * pieceGap;
  var pieceStartX = (w - piecesW) / 2;
  var pieceY = invY + (invH - 12) / 2;

  ectx.fillStyle = '#333';
  roundRect(ectx, invBgX, invY, invBgW, invH, 4);
  ectx.fill();

  for (var i = 0; i < 10; i++) {
    ectx.fillStyle = i < wallsLeft ? '#e09f3e' : 'rgba(224,159,62,0.15)';
    roundRect(ectx, pieceStartX + i * (pieceW + pieceGap), pieceY, pieceW, 12, 2);
    ectx.fill();
  }
}

function showExportResult(blob, progressEl, progressBar, preview) {
  progressEl.style.display = 'none';
  progressBar.style.width = '0%';

  var ext = blob.type.indexOf('webm') !== -1 ? 'webm' : 'mp4';
  var video = document.getElementById('exportVideo');
  var link = document.getElementById('downloadLink');
  video.src = cachedURL;
  video.load();
  link.href = cachedURL;
  link.download = 'quoridor_replay.' + ext;
  link.textContent = '\u2B07 Download ' + ext.toUpperCase();

  preview.style.display = 'block';
}

function setVideoSpeed(speed) {
  var video = document.getElementById('exportVideo');
  if (video) video.playbackRate = speed;
  var btns = document.querySelectorAll('#exportPreview .speed-btn');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', Number(btns[i].getAttribute('onclick').match(/[\d.]+/)[0]) === speed);
  }
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
