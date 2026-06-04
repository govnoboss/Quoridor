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

// Animation state (matching game.js architecture)
let activeAnimations = {};   // { [playerIdx]: { start: {r,c}, end: {r,c}, startTime, duration } }
let activeWallAnimations = {}; // { [key]: { startTime, duration } } where key = r-c-v/h
let animFrame = null;       // requestAnimationFrame ID

const canvas = document.getElementById('replayCanvas');
const ctx = canvas.getContext('2d');
canvas.width = BOARD;
canvas.height = BOARD;

function loadGame(gameId) {
  var info = document.getElementById('replayInfo');
  info.textContent = 'Loading...';

  if (gameId === 'local') {
    try {
      var stored = localStorage.getItem('quoridor_replay_local');
      if (stored) {
        gameData = JSON.parse(stored);
        info.textContent = '';
        if (gameData.history && gameData.history.length > 0) {
          buildSnapshots();
          currentMove = 0;
          renderMoveHistory();
          updatePlayerBars();
          draw();
          updateResult();
        } else {
          info.textContent = 'No replay data for this game.';
        }
      } else {
        info.textContent = 'No local game found.';
      }
    } catch (e) {
      console.error(e);
      info.textContent = 'Failed to load local game.';
    }
    return;
  }

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
  ctx.clearRect(0, 0, BOARD, BOARD);
  var state = snapshots[currentMove];
  if (!state) return;
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

// [Animation] Helper for BackOut easing
function backOut(t) {
  var c1 = 1.70158;
  var c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function drawWalls(state) {
  ctx.fillStyle = '#e09f3e';
  for (var r = 0; r < 8; r++) {
    for (var c = 0; c < 8; c++) {
      var displayRWall = perspective === 1 ? 7 - r : r;
      if (state.hWalls[r][c]) {
        var key = r + '-' + c + '-h';
        var anim = activeWallAnimations[key];
        if (anim) {
          // Wall is animating (appearing)
          var now = performance.now();
          var progress = Math.min((now - anim.startTime) / anim.duration, 1);
          var scale = backOut(progress);
          var len = CELL * 2 - GAP * 2;
          var currentLen = len * scale;
          var offset = (len - currentLen) / 2;
          ctx.fillRect(c * CELL + GAP + offset, (displayRWall + 1) * CELL - WALL_THICK / 2, currentLen, WALL_THICK);

          if (progress >= 1) {
            delete activeWallAnimations[key];
          } else {
            animFrame = requestAnimationFrame(draw);
          }
        } else {
          // Normal wall
          ctx.fillRect(c * CELL + GAP, (displayRWall + 1) * CELL - WALL_THICK / 2, CELL * 2 - GAP * 2, WALL_THICK);
        }
      }
      if (state.vWalls[r][c]) {
        var key = r + '-' + c + '-v';
        var anim = activeWallAnimations[key];
        if (anim) {
          // Wall is animating (appearing)
          var now = performance.now();
          var progress = Math.min((now - anim.startTime) / anim.duration, 1);
          var scale = backOut(progress);
          var len = CELL * 2 - GAP * 2;
          var currentLen = len * scale;
          var offset = (len - currentLen) / 2;
          ctx.fillRect((c + 1) * CELL - WALL_THICK / 2, displayRWall * CELL + GAP + offset, WALL_THICK, currentLen);

          if (progress >= 1) {
            delete activeWallAnimations[key];
          } else {
            animFrame = requestAnimationFrame(draw);
          }
        } else {
          // Normal wall
          ctx.fillRect((c + 1) * CELL - WALL_THICK / 2, displayRWall * CELL + GAP, WALL_THICK, CELL * 2 - GAP * 2);
        }
      }
    }
  }
}

// [Animation] Helper for linear interpolation
function lerp(start, end, t) {
  return start + (end - start) * t;
}

function drawPawns(state) {
  var radius = CELL * 0.35;
  for (var i = 0; i < state.players.length; i++) {
    var p = state.players[i];
    var x, y;
    
    // [Animation] Check if this pawn is currently animating
    var anim = activeAnimations[i];
    if (anim) {
      // Interpolate position
      var now = performance.now();
      var progress = Math.min((now - anim.startTime) / anim.duration, 1);
      
      // Use QuadEaseOut easing (same as game)
      var ease = 1 - (1 - progress) * (1 - progress);
      
      // Logical coordinates lerp from start to end position
      var curR = lerp(anim.start.r, p.pos.r, ease);
      var curC = lerp(anim.start.c, p.pos.c, ease);
      
      x = (curC + 0.5) * CELL;
      y = (tr(curR) + 0.5) * CELL;
      
      // Clean up if finished
      if (progress >= 1) {
        delete activeAnimations[i];
      } else {
        // Keep animating
        animFrame = requestAnimationFrame(draw);
      }
    } else {
      // Static position
      x = (p.pos.c + 0.5) * CELL;
      y = (tr(p.pos.r) + 0.5) * CELL;
    }
    
    ctx.fillStyle = p.color === 'white' ? '#fff' : '#000';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = p.color === 'white' ? '#ccc' : '#444';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}


function getMoveData(idx) {
  if (idx <= 0 || !gameData || !gameData.history) return null;
  var histIdx = idx - 1;
  if (histIdx < gameData.history.length) {
    return gameData.history[histIdx].move || null;
  }
  return null;
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

function goToMove(idx, animate) {
  if (idx < 0) idx = 0;
  if (idx >= snapshots.length) idx = snapshots.length - 1;

  var oldMove = currentMove;
  currentMove = idx;

  if (animate && idx === oldMove + 1 && idx > 0 && idx < snapshots.length) {
    cancelAnimationFrame(animFrame);
    var prevSnap = snapshots[idx - 1];
    var newSnap = snapshots[idx];
    var move = getMoveData(idx);
    
    if (move) {
      if (move.type === 'wall') {
        var key = move.r + '-' + move.c + '-' + (move.isVertical ? 'v' : 'h');
        activeWallAnimations[key] = {
          startTime: performance.now(),
          duration: 150
        };
        animFrame = requestAnimationFrame(draw);
      } else if (move.type === 'pawn') {
        var playerIdx = typeof move.playerIdx === 'number' ? move.playerIdx : prevSnap.currentPlayer;
        var prevPos = prevSnap.players[playerIdx].pos;
        var newPos = newSnap.players[playerIdx].pos;
        activeAnimations[playerIdx] = {
          start: { r: prevPos.r, c: prevPos.c },
          end: { r: newPos.r, c: newPos.c },
          startTime: performance.now(),
          duration: 120
        };
        animFrame = requestAnimationFrame(draw);
      }
    }
  } else {
    cancelAnimationFrame(animFrame);
    activeAnimations = {};
    activeWallAnimations = {};
  }

  draw();
  renderMoveHistory();
  updatePlayerBars();
}

function prevMove() { goToMove(currentMove - 1); }
function nextMove() { goToMove(currentMove + 1, true); }
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
  cancelAnimationFrame(animFrame);
  activeAnimations = {};
  activeWallAnimations = {};
  updatePlayerBars();
  draw();
  if (cachedURL) {
    URL.revokeObjectURL(cachedURL);
    cachedURL = null;
    cachedBlob = null;
    var preview = document.getElementById('exportPreview');
    if (preview) preview.style.display = 'none';
    var progressEl = document.getElementById('exportProgress');
    if (progressEl) progressEl.style.display = 'none';
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
  var fps = 60;
  var framesPerMove = Math.floor(fps * 1.2);

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
      var moveData = getMoveData(i);
      for (var f = 0; f < framesPerMove; f++) {
        if (framesPerMove > 1 && f < framesPerMove - 1) {
          var elapsedMs = (f / fps) * 1000;
          drawExportFrame(ectx, snapshots[i], cellSize, boardSize, topBarH, snapshots[i - 1], elapsedMs, moveData);
        } else {
          drawExportFrame(ectx, snapshots[i], cellSize, boardSize, topBarH);
        }
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
  var fps = 60;
  var framesPerMove = Math.floor(fps * 1.2);
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
    var moveData = getMoveData(moveIdx);
    if (framesPerMove > 1 && frameCount < framesPerMove - 1) {
      var elapsedMs = (frameCount / fps) * 1000;
      drawExportFrame(ectx, snapshots[moveIdx], cellSize, boardSize, topBarH, snapshots[moveIdx - 1], elapsedMs, moveData);
    } else {
      drawExportFrame(ectx, snapshots[moveIdx], cellSize, boardSize, topBarH);
    }
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

function drawExportWallPanel(ectx, x, y, w, wallsLeft) {
  var panelH = 42;
  ectx.fillStyle = '#333';
  ectx.fillRect(x, y, w, panelH);

  var pieceW = 34;
  var pieceH = 10;
  var gap = 4;
  var totalW = 10 * pieceW + 9 * gap;
  var startX = x + Math.floor((w - totalW) / 2);
  var pieceY = y + Math.floor((panelH - pieceH) / 2);

  for (var i = 0; i < 10; i++) {
    if (i >= wallsLeft) ectx.globalAlpha = 0.15;
    ectx.fillStyle = '#e09f3e';
    ectx.fillRect(startX + i * (pieceW + gap), pieceY, pieceW, pieceH);
    ectx.globalAlpha = 1;
  }
}

function drawExportFrame(ectx, state, cellSize, boardSize, topBarH, prevState, elapsedMs, move) {
  var w = 1080;
  var h = 1920;
  var boardX = Math.floor((w - boardSize) / 2);
  var boardY = topBarH;

  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, w, h);

  // Wall panels
  var topIdx = perspective === 1 ? 0 : 1;
  var bottomIdx = perspective === 1 ? 1 : 0;
  drawExportWallPanel(ectx, boardX, boardY - 48, boardSize, state.players[topIdx].wallsLeft);
  drawExportWallPanel(ectx, boardX, boardY + boardSize + 6, boardSize, state.players[bottomIdx].wallsLeft);

  // Board
  ectx.save();
  ectx.translate(boardX, boardY);

  for (var r = 0; r < 9; r++) {
    for (var c = 0; c < 9; c++) {
      ectx.fillStyle = '#2a2a2a';
      ectx.fillRect(c * cellSize + 4, r * cellSize + 4, cellSize - 8, cellSize - 8);
    }
  }

  var isAnimating = prevState && elapsedMs !== undefined && move;
  var animDuration = move ? (move.type === 'wall' ? 250 : 200) : 0;
  var progress = isAnimating ? Math.min(elapsedMs / animDuration, 1) : 1;

  ectx.fillStyle = '#e09f3e';
  for (var r2 = 0; r2 < 8; r2++) {
    for (var c2 = 0; c2 < 8; c2++) {
      var displayRWall = perspective === 1 ? 7 - r2 : r2;
      if (state.hWalls[r2][c2]) {
        var isNew = isAnimating && move.type === 'wall' && !move.isVertical
          && move.r === r2 && move.c === c2 && prevState && !prevState.hWalls[r2][c2];
        if (isNew) {
          var bs = backOut(progress);
          var len = cellSize * 2 - GAP * 2;
          var curLen = len * bs;
          var off = (len - curLen) / 2;
          ectx.fillRect(c2 * cellSize + GAP + off, (displayRWall + 1) * cellSize - WALL_THICK / 2, curLen, WALL_THICK);
        } else {
          ectx.fillRect(c2 * cellSize + GAP, (displayRWall + 1) * cellSize - WALL_THICK / 2, cellSize * 2 - GAP * 2, WALL_THICK);
        }
      }
      if (state.vWalls[r2][c2]) {
        var isNew = isAnimating && move.type === 'wall' && move.isVertical
          && move.r === r2 && move.c === c2 && prevState && !prevState.vWalls[r2][c2];
        if (isNew) {
          var bs = backOut(progress);
          var len = cellSize * 2 - GAP * 2;
          var curLen = len * bs;
          var off = (len - curLen) / 2;
          ectx.fillRect((c2 + 1) * cellSize - WALL_THICK / 2, displayRWall * cellSize + GAP + off, WALL_THICK, curLen);
        } else {
          ectx.fillRect((c2 + 1) * cellSize - WALL_THICK / 2, displayRWall * cellSize + GAP, WALL_THICK, cellSize * 2 - GAP * 2);
        }
      }
    }
  }

  var pawnEase = isAnimating ? 1 - (1 - progress) * (1 - progress) : 1;
  for (var i = 0; i < state.players.length; i++) {
    var p = state.players[i];
    var px, py;

    if (isAnimating && move && i === move.playerIdx && prevState && prevState.players[i]) {
      var prevP = prevState.players[i];
      var curR = prevP.pos.r + (p.pos.r - prevP.pos.r) * pawnEase;
      var curC = prevP.pos.c + (p.pos.c - prevP.pos.c) * pawnEase;
      px = curC * cellSize + cellSize / 2;
      py = (perspective === 1 ? 8 - curR : curR) * cellSize + cellSize / 2;
    } else {
      px = p.pos.c * cellSize + cellSize / 2;
      py = (perspective === 1 ? 8 - p.pos.r : p.pos.r) * cellSize + cellSize / 2;
    }

    ectx.beginPath();
    ectx.arc(px, py, cellSize * 0.35, 0, Math.PI * 2);
    ectx.fillStyle = p.color === 'white' ? '#fff' : '#000';
    ectx.strokeStyle = p.color === 'white' ? '#ccc' : '#444';
    ectx.lineWidth = 3;
    ectx.fill();
    ectx.stroke();
  }

  ectx.restore();
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
