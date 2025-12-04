// js/game.js — ИСПРАВЛЕНО: больше никаких мутаций глобального state!
const Game = {
  canvas: document.getElementById('board'),
  ctx: null,
  CONFIG: { cellSize: 60, gridCount: 9, slotCount: 8, wallThick: 10, gap: 4 },
  directions: [{dr:-1,dc:0},{dr:1,dc:0},{dr:0,dc:-1},{dr:0,dc:1}],

  state: {
    hWalls: Array.from({length:8},()=>Array(8).fill(false)),
    vWalls: Array.from({length:8},()=>Array(8).fill(false)),
    players: [
      {color:'white', pos:{r:8, c:4}, wallsLeft:10},
      {color:'black', pos:{r:0, c:4}, wallsLeft:10}
    ],
    currentPlayer: 0,
    drag: null,
    botDifficulty: 'none'
  },

  // === Запуск режимов ===
  startPvP() {
    this.state.botDifficulty = 'none';
    this.reset();
    UI.showScreen('gameScreen');
    this.draw();
  },

  startVsBot(diff) {
    this.state.botDifficulty = diff;
    this.reset();
    UI.showScreen('gameScreen');
    this.draw();
  },

  setupCanvas() {
    this.ctx = this.canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const size = this.CONFIG.cellSize * this.CONFIG.gridCount;
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.canvas.style.width = size + 'px';
    this.canvas.style.height = size + 'px';
    this.ctx.scale(dpr, dpr);
  },

  draw() {
    const size = this.CONFIG.cellSize * this.CONFIG.gridCount;
    this.ctx.clearRect(0,0,size,size);
    this.drawGrid();
    this.drawPossibleMoves();
    this.drawPlacedWalls();
    this.drawPawns();
    this.drawDragPreview();
  },

  drawGrid() {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const x = c * this.CONFIG.cellSize + 2;
        const y = r * this.CONFIG.cellSize + 2;
        this.ctx.fillStyle = '#2a2a2a';
        this.ctx.fillRect(x, y, this.CONFIG.cellSize - 4, this.CONFIG.cellSize - 4);
      }
    }
  },

  drawPossibleMoves() {
    if (!this.state.drag || this.state.drag.type !== 'pawn' || this.state.drag.playerIdx !== this.state.currentPlayer) return;
    const {r, c} = this.state.players[this.state.currentPlayer].pos;

    const moves = this.getJumpTargets(r, c);
    for (const {r: nr, c: nc} of moves) {
      this.drawMoveHint(nr, nc, '#4ade80');
    }
  },

  drawMoveHint(r, c, color = '#4ade80') {
    const x = c * this.CONFIG.cellSize + this.CONFIG.cellSize / 2;
    const y = r * this.CONFIG.cellSize + this.CONFIG.cellSize / 2;
    this.ctx.fillStyle = color;
    this.ctx.globalAlpha = 0.35;
    this.ctx.beginPath();
    this.ctx.arc(x, y, this.CONFIG.cellSize * 0.38, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.globalAlpha = 1;
  },

  drawPawns() {
    const radius = this.CONFIG.cellSize * 0.35;
    this.state.players.forEach((p, i) => {
      const x = (p.pos.c + 0.5) * this.CONFIG.cellSize;
      const y = (p.pos.r + 0.5) * this.CONFIG.cellSize;
      this.ctx.fillStyle = p.color === 'white' ? '#fff' : '#000';
      this.ctx.beginPath();
      this.ctx.arc(x, y, radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.strokeStyle = p.color === 'white' ? '#ccc' : '#444';
      this.ctx.lineWidth = 3;
      this.ctx.stroke();
    });
  },

  drawPlacedWalls() {
    this.ctx.fillStyle = '#e09f3e';
    const len = this.CONFIG.cellSize * 2;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (this.state.hWalls[r][c]) {
        const x = c * this.CONFIG.cellSize + this.CONFIG.gap;
        const y = (r + 1) * this.CONFIG.cellSize - this.CONFIG.wallThick / 2;
        this.ctx.fillRect(x, y, len - this.CONFIG.gap * 2, this.CONFIG.wallThick);
      }
      if (this.state.vWalls[r][c]) {
        const x = (c + 1) * this.CONFIG.cellSize - this.CONFIG.wallThick / 2;
        const y = r * this.CONFIG.cellSize + this.CONFIG.gap;
        this.ctx.fillRect(x, y, this.CONFIG.wallThick, len - this.CONFIG.gap * 2);
      }
    }
  },

  drawDragPreview() {
    if (!this.state.drag) return;
    if (this.state.drag.type === 'pawn') {
      const target = this.getCellFromCoords(this.state.drag.x, this.state.drag.y);
      const {r, c} = this.state.players[this.state.drag.playerIdx].pos;
      if (target && this.canMovePawn(r, c, target.r, target.c)) {
        const x = (target.c + 0.5) * this.CONFIG.cellSize;
        const y = (target.r + 0.5) * this.CONFIG.cellSize;
        this.ctx.globalAlpha = 0.5;
        this.ctx.fillStyle = this.state.players[this.state.drag.playerIdx].color === 'white' ? '#fff' : '#000';
        this.ctx.beginPath();
        this.ctx.arc(x, y, this.CONFIG.cellSize * 0.35, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.globalAlpha = 1;
      }
      this.ctx.fillStyle = this.state.players[this.state.drag.playerIdx].color === 'white' ? '#fff' : '#000';
      this.ctx.beginPath();
      this.ctx.arc(this.state.drag.x, this.state.drag.y, this.CONFIG.cellSize * 0.35, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.strokeStyle = '#ccc';
      this.ctx.lineWidth = 3;
      this.ctx.stroke();
    } else if (this.state.drag.type === 'wall') {
      const slot = this.getNearestSlot(this.state.drag.x, this.state.drag.y);
      if (slot && this.checkWallPlacement(slot.r, slot.c, this.state.drag.isVertical)) {
        const tempV = this.state.drag.isVertical;
        const tr = slot.r, tc = slot.c;
        if (tempV) this.state.vWalls[tr][tc] = true; else this.state.hWalls[tr][tc] = true;
        const valid = this.isValidWallPlacement();
        if (tempV) this.state.vWalls[tr][tc] = false; else this.state.hWalls[tr][tc] = false;

        this.ctx.fillStyle = valid ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.5)';
        const len = this.CONFIG.cellSize * 2;
        if (this.state.drag.isVertical) {
          const x = (slot.c + 1) * this.CONFIG.cellSize - this.CONFIG.wallThick / 2;
          const y = slot.r * this.CONFIG.cellSize + this.CONFIG.gap;
          this.ctx.fillRect(x, y, this.CONFIG.wallThick, len - this.CONFIG.gap * 2);
        } else {
          const x = slot.c * this.CONFIG.cellSize + this.CONFIG.gap;
          const y = (slot.r + 1) * this.CONFIG.cellSize - this.CONFIG.wallThick / 2;
          this.ctx.fillRect(x, y, len - this.CONFIG.gap * 2, this.CONFIG.wallThick);
        }
      }
      this.ctx.fillStyle = '#e09f3e';
      const w = this.state.drag.isVertical ? this.CONFIG.wallThick : this.CONFIG.cellSize * 2;
      const h = this.state.drag.isVertical ? this.CONFIG.cellSize * 2 : this.CONFIG.wallThick;
      this.ctx.fillRect(this.state.drag.x - w/2, this.state.drag.y - h/2, w, h);
    }
  },

  getCellFromCoords(x, y) {
    const c = Math.floor(x / this.CONFIG.cellSize);
    const r = Math.floor(y / this.CONFIG.cellSize);
    return (r >= 0 && r < 9 && c >= 0 && c < 9) ? {r, c} : null;
  },

  getNearestSlot(x, y) {
    const c = Math.round(x / this.CONFIG.cellSize) - 1;
    const r = Math.round(y / this.CONFIG.cellSize) - 1;
    return (r >= 0 && r < 8 && c >= 0 && c < 8) ? {r, c} : null;
  },

  hasPawnAt(r, c) { 
    return this.state.players.some(p => p.pos.r === r && p.pos.c === c); 
  },
  
  getPlayerAt(r, c) {
    return this.state.players[0].pos.r === r && this.state.players[0].pos.c === c ? 0 :
           this.state.players[1].pos.r === r && this.state.players[1].pos.c === c ? 1 : -1;
  },

  isWallBetween(fr, fc, tr, tc) {
    const dr = tr - fr, dc = tc - fc;
    if (Math.abs(dr) + Math.abs(dc) !== 1) return true;
    if (dc === 1) { 
      let b=false; 
      if(fr>0) b=b||this.state.vWalls[fr-1][fc]; 
      if(fr<8) b=b||this.state.vWalls[fr][fc]; 
      return b; 
    }
    if (dc === -1 && fc > 0) { 
      let b=false; 
      if(fr>0) b=b||this.state.vWalls[fr-1][fc-1]; 
      if(fr<8) b=b||this.state.vWalls[fr][fc-1]; 
      return b; 
    }
    if (dr === 1) { 
      let b=false; 
      if(fc>0) b=b||this.state.hWalls[fr][fc-1]; 
      b=b||this.state.hWalls[fr][fc]; 
      return b; 
    }
    if (dr === -1 && fr > 0) { 
      let b=false; 
      if(fc>0) b=b||this.state.hWalls[fr-1][fc-1]; 
      b=b||this.state.hWalls[fr-1][fc]; 
      return b; 
    }
    return false;
  },


  hasPathToGoal(playerIdx) {
    const targetRow = playerIdx === 0 ? 0 : 8;
    const start = this.state.players[playerIdx].pos;
    const visited = Array(9).fill().map(() => Array(9).fill(false));
    const queue = [{r: start.r, c: start.c}];
    visited[start.r][start.c] = true;

    while (queue.length) {
      const {r, c} = queue.shift();
      if (r === targetRow) return true;
      for (const {dr, dc} of this.directions) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 && !visited[nr][nc] && 
            !this.isWallBetween(r, c, nr, nc)) {
          visited[nr][nc] = true;
          queue.push({r: nr, c: nc});
        }
      }
    }
    return false;
  },

  isValidWallPlacement() { 
    return this.hasPathToGoal(0) && this.hasPathToGoal(1); 
  },

  checkWallPlacement(r, c, vertical) {
    if (vertical) {
      if (this.state.vWalls[r][c]) return false;
      if (r > 0 && this.state.vWalls[r-1][c]) return false;
      if (r < 7 && this.state.vWalls[r+1][c]) return false;
      if (this.state.hWalls[r][c]) return false;
    } else {
      if (this.state.hWalls[r][c]) return false;
      if (c > 0 && this.state.hWalls[r][c-1]) return false;
      if (c < 7 && this.state.hWalls[r][c+1]) return false;
      if (this.state.vWalls[r][c]) return false;
    }
    return true;
  },

  placeWall(r, c, vertical) {
    if (!this.checkWallPlacement(r, c, vertical)) return false;
    if (vertical) this.state.vWalls[r][c] = true; 
    else this.state.hWalls[r][c] = true;
    
    if (!this.isValidWallPlacement()) {
      if (vertical) this.state.vWalls[r][c] = false; 
      else this.state.hWalls[r][c] = false;
      return false;
    }
    this.state.players[this.state.currentPlayer].wallsLeft--;
    return true;
  },

  updateTurnDisplay() {
    const p = this.state.players[this.state.currentPlayer];
    document.getElementById('turnInfo').textContent = 
      `${p.color === 'white' ? 'Белый' : 'Чёрный'} ходит • Стен: ${p.wallsLeft}`;
    const opacity = p.wallsLeft > 0 ? '1' : '0.3';
    document.getElementById('hTpl').style.opacity = opacity;
    document.getElementById('vTpl').style.opacity = opacity;
  },

  checkVictory() {
    const p = this.state.players[this.state.currentPlayer];
    if ((this.state.currentPlayer === 0 && p.pos.r === 0) || 
        (this.state.currentPlayer === 1 && p.pos.r === 8)) {
      alert(`${p.color === 'white' ? 'Белый' : 'Чёрный'} победил!`);
      UI.backToMenu();
      return true;
    }
    return false;
  },

  nextTurn() {
    this.state.currentPlayer = 1 - this.state.currentPlayer;
    this.updateTurnDisplay();

    if (this.state.botDifficulty !== 'none' && this.state.currentPlayer === 1) {
      setTimeout(() => {
        document.getElementById('turnInfo').textContent = 'Бот думает...';
        AI.makeMove(this.state.botDifficulty);
      }, 600);
    }
  },

  reset() {
    this.state.hWalls.forEach(r=>r.fill(false));
    this.state.vWalls.forEach(r=>r.fill(false));
    this.state.players[0].pos = {r:8,c:4}; 
    this.state.players[0].wallsLeft = 10;
    this.state.players[1].pos = {r:0,c:4}; 
    this.state.players[1].wallsLeft = 10;
    this.state.currentPlayer = 0;
    this.state.drag = null;
    this.updateTurnDisplay();
  },

  startWallDrag(vertical, e) {
    if (this.state.players[this.state.currentPlayer].wallsLeft <= 0) return;
    const rect = this.canvas.getBoundingClientRect();
    this.state.drag = { 
      type: 'wall', 
      isVertical: vertical, 
      x: e.clientX - rect.left, 
      y: e.clientY - rect.top 
    };
    this.draw();
  },

  initEvents() {
    this.canvas.addEventListener('pointerdown', e => {
      if (this.state.currentPlayer !== 0 && this.state.botDifficulty !== 'none') return;

      if (this.state.drag) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const player = this.state.players[this.state.currentPlayer];
      const px = (player.pos.c + 0.5) * this.CONFIG.cellSize;
      const py = (player.pos.r + 0.5) * this.CONFIG.cellSize;
      if ((x - px)**2 + (y - py)**2 < (this.CONFIG.cellSize * 0.4)**2) {
        this.state.drag = { type: 'pawn', playerIdx: this.state.currentPlayer, x, y };
        this.canvas.style.cursor = 'grabbing';
        this.draw();
      }
    });

    document.getElementById('hTpl').onpointerdown = e => { 
      if (this.state.currentPlayer !== 0 && this.state.botDifficulty !== 'none') return;
      e.preventDefault(); 
      this.startWallDrag(false, e); 
    };

    document.getElementById('vTpl').onpointerdown = e => { 
      if (this.state.currentPlayer !== 0 && this.state.botDifficulty !== 'none') return;
      e.preventDefault(); 
      this.startWallDrag(true, e); 
    };

    document.getElementById('hTpl').onpointerdown = e => { 
      e.preventDefault(); 
      this.startWallDrag(false, e); 
    };
    
    document.getElementById('vTpl').onpointerdown = e => { 
      e.preventDefault(); 
      this.startWallDrag(true, e); 
    };

    window.addEventListener('pointermove', e => {
      if (!this.state.drag) return;
      const rect = this.canvas.getBoundingClientRect();
      this.state.drag.x = e.clientX - rect.left;
      this.state.drag.y = e.clientY - rect.top;
      this.draw();
    });

    window.addEventListener('pointerup', e => {
      if (!this.state.drag) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (this.state.drag.type === 'pawn') {
        const target = this.getCellFromCoords(x, y);
        const player = this.state.players[this.state.drag.playerIdx];
        if (target && this.canMovePawn(player.pos.r, player.pos.c, target.r, target.c)) {
          player.pos = {r: target.r, c: target.c};
          if (!this.checkVictory()) this.nextTurn();
        }
      } else if (this.state.drag.type === 'wall') {
        const slot = this.getNearestSlot(x, y);
        if (slot && this.state.players[this.state.currentPlayer].wallsLeft > 0 && 
            this.placeWall(slot.r, slot.c, this.state.drag.isVertical)) {
          this.nextTurn();
        }
      }

      this.state.drag = null;
      this.canvas.style.cursor = 'default';
      this.draw();
    });

    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.state.drag) {
        this.state.drag = null;
        this.canvas.style.cursor = 'default';
        this.draw();
      }
      if ((e.key === 'r' || e.key === 'R') && this.state.drag?.type === 'wall') {
        this.state.drag.isVertical = !this.state.drag.isVertical;
        this.draw();
      }
    });

    document.getElementById('rotateBtn').onclick = () => {
      if (this.state.drag?.type === 'wall') {
        this.state.drag.isVertical = !this.state.drag.isVertical;
        this.draw();
      }
    };

    document.getElementById('resetBtn').onclick = () => {
      this.reset();
      this.draw();
    };
  }
};


Game.hasPawnAtWithState = function(state, r, c) {
  return state.players.some(p => p.pos.r === r && p.pos.c === c);
};

Game.getPlayerAtWithState = function(state, r, c) {
  return state.players[0].pos.r === r && state.players[0].pos.c === c ? 0 :
         state.players[1].pos.r === r && state.players[1].pos.c === c ? 1 : -1;
};
Game.canMovePawn = function(fr, fc, tr, tc) {
  const moves = this.getJumpTargets(fr, fc);
  return moves.some(m => m.r === tr && m.c === tc);
};

Game.isWallBetweenWithState = function(state, fr, fc, tr, tc) {
  const dr = tr - fr, dc = tc - fc;
  if (Math.abs(dr) + Math.abs(dc) !== 1) return true;
  
  if (dc === 1) { 
    let b = false; 
    if (fr > 0) b = b || state.vWalls[fr-1][fc]; 
    if (fr < 8) b = b || state.vWalls[fr][fc]; 
    return b; 
  }
  if (dc === -1 && fc > 0) { 
    let b = false; 
    if (fr > 0) b = b || state.vWalls[fr-1][fc-1]; 
    if (fr < 8) b = b || state.vWalls[fr][fc-1]; 
    return b; 
  }
  if (dr === 1) { 
    let b = false; 
    if (fc > 0) b = b || state.hWalls[fr][fc-1]; 
    b = b || state.hWalls[fr][fc]; 
    return b; 
  }
  if (dr === -1 && fr > 0) { 
    let b = false; 
    if (fc > 0) b = b || state.hWalls[fr-1][fc-1]; 
    b = b || state.hWalls[fr-1][fc]; 
    return b; 
  }
  return false;
};

Game.checkWallPlacementWithState = function(state, r, c, vertical) {
  if (vertical) {
    if (state.vWalls[r][c]) return false;
    if (r > 0 && state.vWalls[r-1][c]) return false;
    if (r < 7 && state.vWalls[r+1][c]) return false;
    if (state.hWalls[r][c]) return false;
  } else {
    if (state.hWalls[r][c]) return false;
    if (c > 0 && state.hWalls[r][c-1]) return false;
    if (c < 7 && state.hWalls[r][c+1]) return false;
    if (state.vWalls[r][c]) return false;
  }
  return true;
};

// ✅ ГЛАВНОЕ ИСПРАВЛЕНИЕ: функция теперь чистая, без мутаций!
Game.isValidWallPlacementWithState = function(state) {
  // Проверяем путь для обоих игроков БЕЗ изменения глобального state
  return Game.hasPathToGoalWithState(state, 0) && 
         Game.hasPathToGoalWithState(state, 1);
};

// Новая чистая функция для проверки пути
Game.hasPathToGoalWithState = function(state, playerIdx) {
  const targetRow = playerIdx === 0 ? 0 : 8;
  const start = state.players[playerIdx].pos;
  const visited = Array(9).fill().map(() => Array(9).fill(false));
  const queue = [{r: start.r, c: start.c}];
  visited[start.r][start.c] = true;

  while (queue.length) {
    const {r, c} = queue.shift();
    if (r === targetRow) return true;
    
    for (const {dr, dc} of Game.directions) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 && !visited[nr][nc] && 
          !Game.isWallBetweenWithState(state, r, c, nr, nc)) {
        visited[nr][nc] = true;
        queue.push({r: nr, c: nc});
      }
    }
  }
  return false;
};
Game.getJumpTargets = function(fr, fc) {
  const targets = [];

  for (const {dr, dc} of this.directions) {
    const nr = fr + dr, nc = fc + dc;
    if (nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;

    if (!this.hasPawnAt(nr, nc) && !this.isWallBetween(fr, fc, nr, nc)) {
      // Простое движение
      targets.push({r: nr, c: nc});
    } else if (this.hasPawnAt(nr, nc)) {
      const midR = nr, midC = nc;
      const jumpR = nr + dr, jumpC = nc + dc;

      // Прямой прыжок
      if (jumpR >= 0 && jumpR < 9 && jumpC >= 0 && jumpC < 9 &&
          !this.hasPawnAt(jumpR, jumpC) &&
          !this.isWallBetween(fr, fc, midR, midC) &&
          !this.isWallBetween(midR, midC, jumpR, jumpC)) {
        targets.push({r: jumpR, c: jumpC});
      } else {
        // Диагональные прыжки
        if (dr !== 0) { // соперник сверху/снизу
          for (const dcDiag of [-1, 1]) {
            const diagR = midR, diagC = midC + dcDiag;
            if (diagC >= 0 && diagC < 9 &&
                !this.hasPawnAt(diagR, diagC) &&
                !this.isWallBetween(midR, midC, diagR, diagC)) {
              targets.push({r: diagR, c: diagC});
            }
          }
        }
        if (dc !== 0) { // соперник слева/справа
          for (const drDiag of [-1, 1]) {
            const diagR = midR + drDiag, diagC = midC;
            if (diagR >= 0 && diagR < 9 &&
                !this.hasPawnAt(diagR, diagC) &&
                !this.isWallBetween(midR, midC, diagR, diagC)) {
              targets.push({r: diagR, c: diagC});
            }
          }
        }
      }
    }
  }

  return targets;
};

document.addEventListener('DOMContentLoaded', () => {
  Game.setupCanvas();
  Game.updateTurnDisplay();
  Game.initEvents();
});