
const Game = {
  /** @type {HTMLCanvasElement} Ссылка на элемент Canvas. */
  canvas: document.getElementById('board'),
  /** @type {?CanvasRenderingContext2D} 2D-контекст для отрисовки. */
  ctx: null,
  myPlayerIndex: -1,
  timers: [600, 600],
  timerInterval: null,
  initialTime: 600,
  /**
   * @typedef {object} GameConfig
   * @property {number} cellSize Размер одной ячейки в пикселях (60).
   * @property {number} gridCount Количество ячеек по одной стороне (9x9).
   * @property {number} slotCount Количество слотов для стен (8x8).
   * @property {number} wallThick Толщина стены в пикселях (10).
   * @property {number} gap Небольшой отступ от краев ячейки (4).
   */
  /** @type {GameConfig} Конфигурация игры. */
  CONFIG: { cellSize: 60, gridCount: 9, slotCount: 8, wallThick: 10, gap: 4 },

  /**
   * @typedef {object} Direction
   * @property {number} dr Смещение по строке (-1, 1, 0).
   * @property {number} dc Смещение по столбцу (0, 0, -1, 1).
   */
  /** @type {Direction[]} Массив возможных направлений движения. */
  directions: [{dr:-1,dc:0},{dr:1,dc:0},{dr:0,dc:-1},{dr:0,dc:1}],

  /**
   * @typedef {object} Player
   * @property {'white'|'black'} color Цвет фишки игрока.
   * @property {{r: number, c: number}} pos Текущая позиция игрока (строка/столбец).
   * @property {number} wallsLeft Оставшееся количество стен.
   */
  /**
   * @typedef {object} GameState
   * @property {boolean[][]} hWalls Двумерный массив 8x8 для горизонтальных стен.
   * @property {boolean[][]} vWalls Двумерный массив 8x8 для вертикальных стен.
   * @property {Player[]} players Массив объектов игроков (0: Белый, 1: Черный).
   * @property {number} currentPlayer Индекс игрока, чей сейчас ход (0 или 1).
   * @property {?{type: 'pawn'|'wall', playerIdx: number, isVertical: boolean, x: number, y: number}} drag Информация о перетаскиваемом объекте.
   * @property {'none'|'easy'|'medium'|'hard'} botDifficulty Уровень сложности бота.
   */
  /** @type {GameState} Текущее состояние игры. */
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

  // ====================================================================
  // 1. МЕТОДЫ ЗАПУСКА И ИНИЦИАЛИЗАЦИИ
  // ====================================================================
  /**
   * Запускает сетевую игру.
   * @param {'white'|'black'} color Цвет игрока
   */
  startOnline(color, playerIdx) {
    this.reset();
    this.state.botDifficulty = 'none'; 

    this.myPlayerIndex = playerIdx;
    
    console.log(`[GAME] Старт Онлайн. Я играю за: ${color} (Индекс: ${this.myPlayerIndex})`);
    
    UI.showScreen('gameScreen');
    this.draw();
  },

  /**
   * Настраивает Canvas для отрисовки, учитывая Device Pixel Ratio.
   */
  setupCanvas() {
    this.ctx = this.canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const size = this.CONFIG.cellSize * this.CONFIG.gridCount;
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.canvas.style.width = size + 'px';
    this.canvas.style.height = size + 'px';
    // Масштабируем контекст для поддержки высокого разрешения
    this.ctx.scale(dpr, dpr);
  },
handleGameOver(winnerIdx, reason) {
    const myIdx = Net.myColor === 'white' ? 0 : 1;
    
    let message = '';
    this.stopTimer()
    
    if (winnerIdx === myIdx) {
        // Мы победили
        message = (reason === 'Opponent disconnected') 
            ? 'ПОБЕДА! Соперник покинул игру.' 
            : 'ПОБЕДА! Вы достигли цели!';
    } else {
        // Мы проиграли
        message = (reason === 'Goal reached')
            ? 'ПОРАЖЕНИЕ. Соперник достиг цели.'
            : 'ИГРА ОКОНЧЕНА. Соперник победил.'; // На всякий случай
    }

    console.log(`[GAME OVER] ${message}`);
    
    alert(message); 
    
    this.goToMainMenu();
  },
  
  /**
   * Сбрасывает состояние игры к начальным параметрам.
   * Вызывается при старте новой игры или нажатии кнопки "Сброс".
   */
  reset() {
    this.state.hWalls.forEach(r=>r.fill(false));
    this.state.vWalls.forEach(r=>r.fill(false));
    this.state.players[0].pos = {r:8,c:4}; 
    this.state.players[0].wallsLeft = 10;
    this.state.players[1].pos = {r:0,c:4}; 
    this.state.players[1].wallsLeft = 10;
    this.state.currentPlayer = 0;
    this.state.drag = null;
    this.stopTimer();
    this.timers = [this.initialTime, this.initialTime];
    this.updateTimerDisplay();
    this.updateTurnDisplay();
  },

  /**
   * Запускает игру в режиме "Человек против Человека".
   */
  startPvP() {
    this.state.botDifficulty = 'none';
    this.reset();
    UI.showScreen('gameScreen');
    this.startTimer();
    this.draw();
  },

  /**
   * Запускает игру против бота.
   * @param {'easy'|'medium'|'hard'} diff Уровень сложности бота.
   */
  startVsBot(diff) {
    this.state.botDifficulty = diff;
    this.reset();
    UI.showScreen('gameScreen');
    this.startTimer();
    this.draw();
  },

  startTimer() {
    this.stopTimer();
    this.timerInterval = setInterval(() => {
      const activeIdx = this.state.currentPlayer;
      if (this.timers[activeIdx] > 0) {
        this.timers[activeIdx]--;
        this.updateTimerDisplay();
      } else {
        this.handleTimeOut(activeIdx);
      }
    }, 1000);
  },

  stopTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
  },

  updateTimerDisplay() {
    const bottomIdx = (this.myPlayerIndex === 1) ? 1 : 0;
    const topIdx = 1 - bottomIdx;

    const formatTime = (s) => {
      const min = Math.floor(s / 60);
      const sec = s % 60;
      return `${min}:${sec < 10 ? '0' : ''}${sec}`;
    };

    const elBottom = document.getElementById('bottomPlayerTimer');
    const elTop = document.getElementById('topPlayerTimer');

    if (elBottom) elBottom.textContent = formatTime(this.timers[bottomIdx]);
    if (elTop) elTop.textContent = formatTime(this.timers[topIdx]);
  },

  handleTimeOut(playerIdx) {
    this.stopTimer();
    alert(`Время вышло! Игрок ${playerIdx + 1} проиграл.`);
    UI.backToMenu();
  },

  // ====================================================================
  // 2. МЕТОДЫ ОТРЕЗОВКИ (ВИЗУАЛИЗАЦИЯ)
  // ====================================================================

  /**
   * Главная функция отрисовки. Очищает Canvas и вызывает
   * все функции для пошаговой отрисовки игровых элементов.
   */
  draw() {
    const size = this.CONFIG.cellSize * this.CONFIG.gridCount;
    this.ctx.clearRect(0,0,size,size);
    this.drawGrid();
    this.drawPossibleMoves();
    this.drawPlacedWalls();
    this.drawPawns();
    this.drawDragPreview();
  },

  /**
   * Рисует сетку игрового поля 9x9 (темные квадраты).
   */
  drawGrid() {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const x = c * this.CONFIG.cellSize + 2;
        const y = this.transformRow(r) * this.CONFIG.cellSize + 2;
        this.ctx.fillStyle = '#2a2a2a'; 
        this.ctx.fillRect(x, y, this.CONFIG.cellSize - 4, this.CONFIG.cellSize - 4);
      }
    }
  },

  /**
   * Рисует фишки игроков в их текущих позициях.
   */
  drawPawns() {
    const radius = this.CONFIG.cellSize * 0.35;
    this.state.players.forEach((p) => {
      const x = (p.pos.c + 0.5) * this.CONFIG.cellSize;
      const y = (this.transformRow(p.pos.r) + 0.5) * this.CONFIG.cellSize;
      this.ctx.fillStyle = p.color === 'white' ? '#fff' : '#000';
      this.ctx.beginPath();
      this.ctx.arc(x, y, radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.strokeStyle = p.color === 'white' ? '#ccc' : '#444';
      this.ctx.lineWidth = 3;
      this.ctx.stroke();
    });
  },

  /**
   * Рисует все размещенные стены (горизонтальные и вертикальные).
   */
  drawPlacedWalls() {
    this.ctx.fillStyle = '#e09f3e';
    const len = this.CONFIG.cellSize * 2;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {

      // НОВЫЙ КОД: Переворот индекса стены R_WALL
      const displayRWall = this.myPlayerIndex === 1 ? 7 - r : r; 

      // Горизонтальные стены
      if (this.state.hWalls[r][c]) {
        const x = c * this.CONFIG.cellSize + this.CONFIG.gap;
        // ИСПОЛЬЗУЕМ displayRWall (по сути, это отображаемая строка r-ячейки, над которой стена)
        const y = (displayRWall + 1) * this.CONFIG.cellSize - this.CONFIG.wallThick / 2;
        this.ctx.fillRect(x, y, len - this.CONFIG.gap * 2, this.CONFIG.wallThick);
      }
      // Вертикальные стены
      if (this.state.vWalls[r][c]) {
        // Стена находится между столбцом c и c+1
        const x = (c + 1) * this.CONFIG.cellSize - this.CONFIG.wallThick / 2;
        // ИСПОЛЬЗУЕМ displayRWall
        const y = displayRWall * this.CONFIG.cellSize + this.CONFIG.gap;
        this.ctx.fillRect(x, y, this.CONFIG.wallThick, len - this.CONFIG.gap * 2);
      }
    }
  },

  /**
   * Рисует подсказки (зеленые круги) для возможных ходов фишки текущего игрока,
   * если он перетаскивает свою фишку.
   */
  drawPossibleMoves() {
    if (!this.state.drag || this.state.drag.type !== 'pawn' || this.state.drag.playerIdx !== this.state.currentPlayer) return;
    const {r, c} = this.state.players[this.state.currentPlayer].pos;

    // Получаем все возможные целевые позиции
    const moves = this.getJumpTargets(r, c);
    for (const {r: nr, c: nc} of moves) {
      this.drawMoveHint(nr, nc, '#4ade80');
    }
  },

  /**
   * Рисует один полупрозрачный круг-подсказку в заданной ячейке.
   * @param {number} r Строка ячейки.
   * @param {number} c Столбец ячейки.
   * @param {string} color Цвет подсказки.
   */
  drawMoveHint(r, c, color = '#4ade80') {
    const x = c * this.CONFIG.cellSize + this.CONFIG.cellSize / 2;
    const y = this.transformRow(r) * this.CONFIG.cellSize + this.CONFIG.cellSize / 2;
    this.ctx.fillStyle = color;
    this.ctx.globalAlpha = 0.35;
    this.ctx.beginPath();
    this.ctx.arc(x, y, this.CONFIG.cellSize * 0.38, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.globalAlpha = 1;
  },
  
  /**
   * Рисует предварительный просмотр (полупрозрачный вид) перетаскиваемого
   * элемента (фишки или стены).
   * Показывает, куда будет совершён ход/поставлена стена, и допустимо ли это.
   */
  drawDragPreview() {
    if (!this.state.drag) return;
    
    if (this.state.drag.type === 'pawn') {
      // Предпросмотр для фишки
      const target = this.getCellFromCoords(this.state.drag.x, this.state.drag.y);
      const {r, c} = this.state.players[this.state.drag.playerIdx].pos;
      // Если целевая клетка допустима, рисуем полупрозрачную фишку там
      if (target && this.canMovePawn(r, c, target.r, target.c)) {
        const x = (target.c + 0.5) * this.CONFIG.cellSize;
        const y = (this.transformRow(target.r) + 0.5) * this.CONFIG.cellSize;
        this.ctx.globalAlpha = 0.5;
        this.ctx.fillStyle = this.state.players[this.state.drag.playerIdx].color === 'white' ? '#fff' : '#000';
        this.ctx.beginPath();
        this.ctx.arc(x, y, this.CONFIG.cellSize * 0.35, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.globalAlpha = 1;
      }
      // Рисуем фишку под курсором (саму "руку")
      this.ctx.fillStyle = this.state.players[this.state.drag.playerIdx].color === 'white' ? '#fff' : '#000';
      this.ctx.beginPath();
      this.ctx.arc(this.state.drag.x, this.state.drag.y, this.CONFIG.cellSize * 0.35, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.strokeStyle = '#ccc';
      this.ctx.lineWidth = 3;
      this.ctx.stroke();

    } else if (this.state.drag.type === 'wall') {
      // Предпросмотр для стены
      const slot = this.getNearestSlot(this.state.drag.x, this.state.drag.y);

      if (slot && this.checkWallPlacement(slot.r, slot.c, this.state.drag.isVertical)) {
        const tempV = this.state.drag.isVertical;
        const tr = slot.r, tc = slot.c;
        
        // Временно ставим стену для проверки пути
        if (tempV) this.state.vWalls[tr][tc] = true; else this.state.hWalls[tr][tc] = true;
        const valid = this.isValidWallPlacement(); // Проверка, не блокирует ли стена путь
        // Откатываем временное размещение
        if (tempV) this.state.vWalls[tr][tc] = false; else this.state.hWalls[tr][tc] = false;

        // Определяем цвет предпросмотра (зеленый - разрешено, красный - заблокирует путь)
        this.ctx.fillStyle = valid ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.5)';
        const len = this.CONFIG.cellSize * 2;
        
        // Рисуем полупрозрачную стену в слоте
        if (this.state.drag.isVertical) {
            // ВЕРТИКАЛЬНАЯ — между r и r+1
            const top = this.transformRow(tr);
            const bottom = this.transformRow(tr + 1);

            const rDisp = Math.min(top, bottom);

            const x = (tc + 1) * this.CONFIG.cellSize - this.CONFIG.wallThick / 2;
            const y = rDisp * this.CONFIG.cellSize + this.CONFIG.gap;

            this.ctx.fillRect(x, y, this.CONFIG.wallThick, len - this.CONFIG.gap * 2);

        } else {
            // ГОРИЗОНТАЛЬНАЯ — между r и r+1 по вертикали
            const top = this.transformRow(tr);
            const bottom = this.transformRow(tr + 1);

            const rDisp = Math.min(top, bottom);

            const x = tc * this.CONFIG.cellSize + this.CONFIG.gap;
            const y = (rDisp + 1) * this.CONFIG.cellSize - this.CONFIG.wallThick / 2;

            this.ctx.fillRect(x, y, len - this.CONFIG.gap * 2, this.CONFIG.wallThick);
        }
      }
      // Рисуем стену под курсором (саму "руку")
      this.ctx.fillStyle = '#e09f3e';
      const w = this.state.drag.isVertical ? this.CONFIG.wallThick : this.CONFIG.cellSize * 2;
      const h = this.state.drag.isVertical ? this.CONFIG.cellSize * 2 : this.CONFIG.wallThick;
      this.ctx.fillRect(this.state.drag.x - w/2, this.state.drag.y - h/2, w, h);
    }
  },

  // ====================================================================
  // 3. МЕТОДЫ ИГРОВОЙ ЛОГИКИ (ВСПОМОГАТЕЛЬНЫЕ)
  // ====================================================================

  /**
   * Преобразует координаты курсора (x, y в пикселях) в координаты ячейки
   * (r, c в сетке 9x9).
   * @param {number} x Координата X.
   * @param {number} y Координата Y.
   * @returns {?{r: number, c: number}} Координаты ячейки или null, если за пределами поля.
   */
  getCellFromCoords(x, y) {
  const c = Math.floor(x / this.CONFIG.cellSize);
  const r_display = Math.floor(y / this.CONFIG.cellSize);

  if (r_display >= 0 && r_display < 9 && c >= 0 && c < 9) {
      // НОВЫЙ КОД: Обратная трансформация
      const r_absolute = this.transformRow(r_display); 
      return {r: r_absolute, c};
  }
  return null;
  },
  /**
 * Трансформирует абсолютную строку (R) в отображаемую (R_display)
 * и наоборот, если мы играем за Черного (Player 1).
 * @param {number} r Абсолютная строка (0-8).
 * @returns {number} Отображаемая строка (0-8).
 */

  transformRow(r) {
  // Переворачиваем доску только для Черного игрока (Player 1)
  if (this.myPlayerIndex === 1) {
    return 8 - r; 
  }
  return r;
  },  

  /**
   * Преобразует координаты курсора (x, y в пикселях) в координаты ближайшего
   * слота для стены (r, c в сетке 8x8).
   * @param {number} x Координата X.
   * @param {number} y Координата Y.
   * @returns {?{r: number, c: number}} Координаты слота или null, если за пределами слотов.
   */
  getNearestSlot(x, y) {
  const c = Math.round(x / this.CONFIG.cellSize) - 1;
  const r_display = Math.round(y / this.CONFIG.cellSize) - 1;

  if (r_display >= 0 && r_display < 8 && c >= 0 && c < 8) {
      // НОВЫЙ КОД: Обратная трансформация для 8x8 (7 - r_display)
      const r_absolute = this.myPlayerIndex === 1 ? 7 - r_display : r_display; 
      return {r: r_absolute, c};
  }
  return null;
  },

  /**
   * Проверяет, находится ли фишка на заданной ячейке.
   * @param {number} r Строка.
   * @param {number} c Столбец.
   * @returns {boolean} True, если фишка найдена.
   */
  hasPawnAt(r, c) { 
    return this.state.players.some(p => p.pos.r === r && p.pos.c === c); 
  },
  
  /**
   * Возвращает индекс игрока, находящегося в заданной ячейке.
   * @param {number} r Строка.
   * @param {number} c Столбец.
   * @returns {0|1|-1} Индекс игрока (0 или 1) или -1, если фишки нет.
   */
  getPlayerAt(r, c) {
    return this.state.players[0].pos.r === r && this.state.players[0].pos.c === c ? 0 :
           this.state.players[1].pos.r === r && this.state.players[1].pos.c === c ? 1 : -1;
  },

  /**
   * Проверяет, стоит ли стена между двумя соседними ячейками.
   * @param {number} fr Строка отправления.
   * @param {number} fc Столбец отправления.
   * @param {number} tr Строка назначения.
   * @param {number} tc Столбец назначения.
   * @returns {boolean} True, если между ячейками есть стена.
   */
  isWallBetween(fr, fc, tr, tc) {
    // В Quoridor стена занимает два слота. Проверяем нужные слоты hWalls или vWalls.
    const dr = tr - fr, dc = tc - fc;
    if (Math.abs(dr) + Math.abs(dc) !== 1) return true; // Проверяем только соседние ячейки

    // Движение вправо (dc = 1)
    if (dc === 1) { 
      let b = false; 
      // Проверяем вертикальную стену, которая может перекрыть путь (она стоит в столбце fc)
      if (fr > 0) b = b || this.state.vWalls[fr-1][fc]; // Верхний слот
      if (fr < 8) b = b || this.state.vWalls[fr][fc];   // Нижний слот
      return b; 
    }
    // Движение влево (dc = -1)
    if (dc === -1 && fc > 0) { 
      let b = false; 
      // Проверяем вертикальную стену, которая может перекрыть путь (она стоит в столбце fc-1)
      if (fr > 0) b = b || this.state.vWalls[fr-1][fc-1]; 
      if (fr < 8) b = b || this.state.vWalls[fr][fc-1]; 
      return b; 
    }
    // Движение вниз (dr = 1)
    if (dr === 1) { 
      let b = false; 
      // Проверяем горизонтальную стену, которая может перекрыть путь (она стоит в строке fr)
      if (fc > 0) b = b || this.state.hWalls[fr][fc-1]; // Левый слот
      b = b || this.state.hWalls[fr][fc];               // Правый слот
      return b; 
    }
    // Движение вверх (dr = -1)
    if (dr === -1 && fr > 0) { 
      let b = false; 
      // Проверяем горизонтальную стену, которая может перекрыть путь (она стоит в строке fr-1)
      if (fc > 0) b = b || this.state.hWalls[fr-1][fc-1]; 
      b = b || this.state.hWalls[fr-1][fc]; 
      return b; 
    }
    return false;
  },

  // ====================================================================
  // 4. МЕТОДЫ ИГРОВОЙ ЛОГИКИ (ДВИЖЕНИЕ ФИШКИ)
  // ====================================================================

  /**
   * Определяет все возможные целевые ячейки для движения фишки из (fr, fc).
   * Учитывает простые ходы, прямые прыжки и диагональные прыжки вокруг соперника.
   * @param {number} fr Строка текущей позиции.
   * @param {number} fc Столбец текущей позиции.
   * @returns {{r: number, c: number}[]} Массив целевых позиций.
   */
  getJumpTargets(fr, fc) {
    const targets = [];

    for (const {dr, dc} of this.directions) {
      const nr = fr + dr, nc = fc + dc; // Соседняя ячейка
      if (nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;

      if (!this.hasPawnAt(nr, nc) && !this.isWallBetween(fr, fc, nr, nc)) {
        // 1. Простое движение (если нет фишки и нет стены)
        targets.push({r: nr, c: nc});
      } else if (this.hasPawnAt(nr, nc)) {
        const midR = nr, midC = nc; // Позиция фишки соперника
        const jumpR = nr + dr, jumpC = nc + dc; // Ячейка за соперником

        // Прямой прыжок
        if (jumpR >= 0 && jumpR < 9 && jumpC >= 0 && jumpC < 9 &&
            !this.hasPawnAt(jumpR, jumpC) && // Должна быть пуста
            !this.isWallBetween(fr, fc, midR, midC) && // Нет стены к сопернику
            !this.isWallBetween(midR, midC, jumpR, jumpC)) { // Нет стены за соперником
          targets.push({r: jumpR, c: jumpC});
        } else {
          // Если прямой прыжок невозможен (за соперником стена или край поля),
          // совершаем диагональные прыжки.
          
          if (dr !== 0) { // Движение было вертикальным (соперник сверху/снизу)
            for (const dcDiag of [-1, 1]) { // Проверяем влево и вправо
              const diagR = midR, diagC = midC + dcDiag;
              if (diagC >= 0 && diagC < 9 &&
                  !this.hasPawnAt(diagR, diagC) &&
                  !this.isWallBetween(midR, midC, diagR, diagC)) {
                targets.push({r: diagR, c: diagC});
              }
            }
          }
          if (dc !== 0) { // Движение было горизонтальным (соперник слева/справа)
            for (const drDiag of [-1, 1]) { // Проверяем вверх и вниз
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
  },

  /**
   * Проверяет, допустим ли ход фишки из (fr, fc) в (tr, tc).
   * @param {number} fr Строка отправления.
   * @param {number} fc Столбец отправления.
   * @param {number} tr Строка назначения.
   * @param {number} tc Столбец назначения.
   * @returns {boolean} True, если ход возможен.
   */
  canMovePawn(fr, fc, tr, tc) {
    const moves = this.getJumpTargets(fr, fc);
    return moves.some(m => m.r === tr && m.c === tc);
  },

  // ====================================================================
  // 5. МЕТОДЫ ИГРОВОЙ ЛОГИКИ (СТЕНЫ)
  // ====================================================================

  /**
   * Проверяет локальные условия для размещения стены в слоте (r, c).
   * Проверка включает: не занят ли слот, нет ли рядом перекрестной стены.
   * @param {number} r Строка слота (0-7).
   * @param {number} c Столбец слота (0-7).
   * @param {boolean} vertical True, если стена вертикальная.
   * @returns {boolean} True, если локальные условия размещения соблюдены.
   */
  checkWallPlacement(r, c, vertical) {
    if (vertical) {
      if (this.state.vWalls[r][c]) return false; // Занята
      if (r > 0 && this.state.vWalls[r-1][c]) return false; // Пересекается со стеной над
      if (r < 7 && this.state.vWalls[r+1][c]) return false; // Пересекается со стеной под
      if (this.state.hWalls[r][c]) return false; // Пересекается с горизонтальной
    } else { // Горизонтальная
      if (this.state.hWalls[r][c]) return false; // Занята
      if (c > 0 && this.state.hWalls[r][c-1]) return false; // Пересекается со стеной слева
      if (c < 7 && this.state.hWalls[r][c+1]) return false; // Пересекается со стеной справа
      if (this.state.vWalls[r][c]) return false; // Пересекается с вертикальной
    }
    return true;
  },

  /**
   * Выполняет попытку размещения стены в слоте (r, c).
   * Проверяет локальные условия и, ГЛАВНОЕ, не блокирует ли стена путь
   * ни одному из игроков.
   * @param {number} r Строка слота (0-7).
   * @param {number} c Столбец слота (0-7).
   * @param {boolean} vertical True, если стена вертикальная.
   * @returns {boolean} True, если стена успешно размещена и ход завершен.
   */
  placeWall(r, c, vertical) {
    if (!this.checkWallPlacement(r, c, vertical)) return false;
    
    // Временно ставим стену
    if (vertical) this.state.vWalls[r][c] = true; 
    else this.state.hWalls[r][c] = true;
    
    // Проверяем, остался ли путь для обоих игроков
    if (!this.isValidWallPlacement()) {
      // Откатываем, если путь заблокирован
      if (vertical) this.state.vWalls[r][c] = false; 
      else this.state.hWalls[r][c] = false;
      return false;
    }
    
    // Если все OK, уменьшаем счетчик стен
    this.state.players[this.state.currentPlayer].wallsLeft--;
    return true;
  },

  /**
   * Глобальная проверка: есть ли у обоих игроков путь к их целевой линии.
   * @returns {boolean} True, если у обоих игроков есть путь.
   */
  isValidWallPlacement() { 
    return this.hasPathToGoal(0) && this.hasPathToGoal(1); 
  },

  /**
   * Выполняет поиск в ширину (BFS) для проверки, может ли фишка игрока
   * достигнуть целевой линии (строка 0 для Белого, строка 8 для Черного).
   * Использует текущее глобальное состояние.
   * @param {0|1} playerIdx Индекс игрока.
   * @returns {boolean} True, если путь к цели существует.
   */
  hasPathToGoal(playerIdx) {
    const targetRow = playerIdx === 0 ? 0 : 8;
    const start = this.state.players[playerIdx].pos;
    const visited = Array(9).fill().map(() => Array(9).fill(false));
    const queue = [{r: start.r, c: start.c}];
    visited[start.r][start.c] = true;

    while (queue.length) {
      const {r, c} = queue.shift();
      if (r === targetRow) return true; // Цель достигнута
      
      for (const {dr, dc} of this.directions) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 && !visited[nr][nc] && 
            !this.isWallBetween(r, c, nr, nc)) { // Если нет стены
          visited[nr][nc] = true;
          queue.push({r: nr, c: nc});
        }
      }
    }
    return false;
  },

  // ====================================================================
  // 6. МЕТОДЫ УПРАВЛЕНИЯ ХОДОМ
  // ====================================================================

applyServerMove(data) {
      console.log('[GAME] Сервер подтвердил ход:', data);
      const { playerIdx, move, nextPlayer } = data;
      // 1. Применяем изменения к локальному State
      if (move.type === 'pawn') {
          this.state.players[playerIdx].pos = { r: move.r, c: move.c };
      } else if (move.type === 'wall') {
          if (move.isVertical) this.state.vWalls[move.r][move.c] = true;
          else this.state.hWalls[move.r][move.c] = true;
          this.state.players[playerIdx].wallsLeft--;
      }

      if (data.timers) {
      this.timers = [...data.timers];
      }
      // 2. Обновляем текущего игрока
      this.state.currentPlayer = nextPlayer;
      
      // 3. Обновляем UI
      this.updateTurnDisplay();
      this.updateTimerDisplay();
      this.startTimer(); 
      this.draw();
  },

  /**
   * Проверяет, достиг ли текущий игрок своей целевой линии.
   * @returns {boolean} True, если игра окончена.
   */
  checkVictory() {
    const p = this.state.players[this.state.currentPlayer];
    // Белый побеждает, если достиг строки 0. Черный — строки 8.
    if ((this.state.currentPlayer === 0 && p.pos.r === 0) || 
        (this.state.currentPlayer === 1 && p.pos.r === 8)) {
      alert(`${p.color === 'white' ? 'Белый' : 'Чёрный'} победил!`);
      UI.backToMenu();
      return true;
    }
    return false;
  },

  /**
   * Переключает ход на следующего игрока и запускает логику бота, если нужно.
   */
  nextTurn() {
    this.state.currentPlayer = 1 - this.state.currentPlayer;
    this.isWallPlacementMode = false;
    this.selectedWall = null;
    

    // Вместо обращения к turnInfo напрямую, вызываем наш новый метод обновления UI
    this.updateTurnDisplay();

    if (this.state.botDifficulty !== 'none' && this.state.currentPlayer === 1) {
      setTimeout(() => AI.makeMove(this.state.botDifficulty), 50);
    }
    this.startTimer();
    this.draw();
  },

  /**
   * Обновляет информационный блок с данными о текущем ходе.
   */
  /**
   * Обновляет UI: плашки игроков, стены, подсветку хода.
   */
  updateTurnDisplay() {
    // 1. Определяем, кто есть кто
    // Если игра онлайн или мы играем за черных (индекс 1) -> Мы снизу
    // По умолчанию в Локальной игре (PvP) Player 0 (Белый) снизу, Player 1 (Черный) сверху.
    // Но если мы перевернули доску (играем за черных), логика меняется.
    
    // Индекс того, кто отображается СНИЗУ (обычно "Вы")
    const bottomIdx = (this.myPlayerIndex === 1) ? 1 : 0; 
    const topIdx = 1 - bottomIdx;

    const bottomPlayer = this.state.players[bottomIdx];
    const topPlayer = this.state.players[topIdx];

    // 2. Обновляем тексты Стен
    const elBottomWalls = document.getElementById('bottomPlayerWalls');
    const elTopWalls = document.getElementById('topPlayerWalls');
    
    if (elBottomWalls) elBottomWalls.textContent = bottomPlayer.wallsLeft;
    if (elTopWalls) elTopWalls.textContent = topPlayer.wallsLeft;

    // 3. Обновляем имена (Опционально, можно делать 1 раз при старте, но здесь надежнее)
    const elBottomName = document.getElementById('bottomPlayerName');
    const elTopName = document.getElementById('topPlayerName');
    
    if (elBottomName) elBottomName.textContent = (this.myPlayerIndex === -1) ? "Игрок 1 (Белый)" : "Вы";
    if (elTopName) elTopName.textContent = (this.myPlayerIndex === -1) ? "Игрок 2 (Черный)" : "Оппонент";
    
    // В локальном PvP можно писать "Белый" / "Черный"
    if (this.myPlayerIndex === -1) {
       if(elBottomName) elBottomName.textContent = "Белый";
       if(elTopName) elTopName.textContent = "Черный";
    }

    // 4. Подсветка активного хода (CSS класс .active-turn)
    const bottomBar = document.getElementById('bottomPlayerBar');
    const topBar = document.getElementById('topPlayerBar');

    // Сбрасываем классы
    bottomBar.classList.remove('active-turn');
    topBar.classList.remove('active-turn');

    if (this.state.currentPlayer === bottomIdx) {
      bottomBar.classList.add('active-turn');
    } else {
      topBar.classList.add('active-turn');
    }

    // 5. Управляем прозрачностью кнопок выбора стен
    // Если сейчас ход "Меня" (нижнего), и у меня есть стены — кнопки активны
    const isMyTurn = (this.state.currentPlayer === bottomIdx);
    // Если локальная игра - всегда активны, если есть стены у текущего
    const localPlay = (this.myPlayerIndex === -1);
    
    const currentWalls = this.state.players[this.state.currentPlayer].wallsLeft;
    const canBuild = (localPlay || isMyTurn) && currentWalls > 0;

    const opacity = canBuild ? '1' : '0.3';
    document.getElementById('hTpl').style.opacity = opacity;
    document.getElementById('vTpl').style.opacity = opacity;
  },

  /**
   * Инициализирует перетаскивание стены.
   * @param {boolean} vertical Определяет, вертикальная ли стена.
   * @param {PointerEvent} e Событие указателя.
   */
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

  // ====================================================================
  // 7. МЕТОДЫ ОБРАБОТКИ СОБЫТИЙ
  // ====================================================================

  /**
   * Устанавливает обработчики событий для взаимодействия с пользователем
   * (мышь, клавиатура).
   */
  initEvents() {
    // === 7.1. Начало перетаскивания (pointerdown) ===
    this.canvas.addEventListener('pointerdown', e => {
    // 1. Если онлайн и сейчас НЕ мой ход — запрещаем трогать
    if (Net.isOnline) {
      const myIdx = Net.myColor === 'white' ? 0 : 1;
      if (this.state.currentPlayer !== myIdx) {
          console.log('[GAME] Сейчас не ваш ход!');
          return;
      }
      // 2. Если пытаемся взять ЧУЖУЮ фишку
      // (Логика определения клика по фишке идет дальше, но мы можем проверить чей сейчас ход)
      // Так как currentPlayer проверен выше, мы точно знаем, что ход наш.
      // Но технически мы можем кликнуть по фишке врага. 
      // Добавьте проверку playerIdx в логике drag, чтобы drag создавался только для playerIdx === myIdx
  }
      // Игнорируем нажатия, если ходит бот
      if (this.state.currentPlayer !== 0 && this.state.botDifficulty !== 'none') return;
      if (this.state.drag) return; // Игнорируем, если уже что-то перетаскивается

      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const player = this.state.players[this.state.currentPlayer];
      
      // Проверяем, находится ли нажатие в пределах радиуса фишки
      const px = (player.pos.c + 0.5) * this.CONFIG.cellSize;
      const py = (this.transformRow(player.pos.r) + 0.5) * this.CONFIG.cellSize;
      if ((x - px)**2 + (y - py)**2 < (this.CONFIG.cellSize * 0.4)**2) {
        this.state.drag = { type: 'pawn', playerIdx: this.state.currentPlayer, x, y };
        this.canvas.style.cursor = 'grabbing';
        this.draw();
      }
    });

    // Обработчики для начала перетаскивания шаблонов стен
    // Примечание: Убран дубликат, добавлен общий обработчик для проверки хода бота
    const wallDragHandler = (vertical) => (e) => {
      if (this.state.currentPlayer !== 0 && this.state.botDifficulty !== 'none') return;
      e.preventDefault(); 
      this.startWallDrag(vertical, e); 
    };
    
    document.getElementById('hTpl').onpointerdown = wallDragHandler(false);
    document.getElementById('vTpl').onpointerdown = wallDragHandler(true);


    // === 7.2. Перемещение (pointermove) ===
    window.addEventListener('pointermove', e => {
      const rect = this.canvas.getBoundingClientRect();
      window.lastPointerX = e.clientX - rect.left;
      window.lastPointerY = e.clientY - rect.top;
      if (Net.isOnline) {
        const myIdx = Net.myColor === 'white' ? 0 : 1;
      if (this.state.currentPlayer !== myIdx) return;
      }
      if (!this.state.drag) return;
      this.state.drag.x = e.clientX - rect.left;
      this.state.drag.y = e.clientY - rect.top;
      this.draw();
    });

    // === 7.3. Окончание перетаскивания (pointerup) ===
  window.addEventListener('pointerup', e => {
      if (!this.state.drag) return;
      
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      let potentialMove = null;

      if (this.state.drag.type === 'pawn') {
        const target = this.getCellFromCoords(x, y);
        if (target) {
           potentialMove = { type: 'pawn', r: target.r, c: target.c };
        }
      } else if (this.state.drag.type === 'wall') {
        const slot = this.getNearestSlot(x, y);
        if (slot) {
           potentialMove = { type: 'wall', r: slot.r, c: slot.c, isVertical: this.state.drag.isVertical };
        }
      }

      if (potentialMove) {
          if (Net.isOnline) {
              console.log('[GAME] Отправляю ход на проверку:', potentialMove);
              Net.sendMove(potentialMove);
          } else {
              // ЛОКАЛЬНАЯ ИГРА: Восстановленная логика
              const playerIdx = this.state.currentPlayer;
              
              if (potentialMove.type === 'pawn') {
                  const { r: tr, c: tc } = potentialMove;
                  const player = this.state.players[playerIdx];
                  // Проверяем, что ход допустим (нужна реальная проверка, а не только потенциальный ход)
                  if (this.canMovePawn(player.pos.r, player.pos.c, tr, tc)) {
                      player.pos = { r: tr, c: tc };
                      if (!this.checkVictory()) this.nextTurn();
                  }

              } else if (potentialMove.type === 'wall') {
                  const { r: wr, c: wc, isVertical } = potentialMove;
                  // Проверяем, что есть стены и размещение прошло успешно
                  if (this.state.players[playerIdx].wallsLeft > 0 && 
                      this.placeWall(wr, wc, isVertical)) {
                      // Логика placeWall уже уменьшила wallsLeft и проверила победу (не блокирует ли путь)
                      this.nextTurn();
                  }
              }
          }
      }

      // Сбрасываем перетаскивание визуально
      this.state.drag = null;
      this.canvas.style.cursor = 'default';
      this.draw(); // Перерисует фишку на СТАРОМ месте, пока сервер не ответит
    });

    // === 7.4. Клавиатура и UI ===
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
      if (e.key === 'h' || e.key === 'H' || e.key === 'v' || e.key === 'V') {

      // 1. Проверка: есть ли стены у игрока
      const p = this.state.players[this.state.currentPlayer];
      if (p.wallsLeft <= 0) return;

      // 2. Проверка: если онлайн — только если мой ход
      if (Net.isOnline) {
        const myIdx = Net.myColor === 'white' ? 0 : 1;
        if (this.state.currentPlayer !== myIdx) return;
      }

      // 3. Определяем ориентацию по клавише
      const isVertical = (e.key === 'v' || e.key === 'V');

      // 4. Берём координаты курсора
      const rect = this.canvas.getBoundingClientRect();
      const cursorX = window.lastPointerX ?? (rect.width / 2);
      const cursorY = window.lastPointerY ?? (rect.height / 2);

      // 5. Создаём drag-объект стены прямо в руку
      this.state.drag = {
        type: 'wall',
        isVertical,
        x: cursorX,
        y: cursorY
      };

      this.canvas.style.cursor = 'grabbing';
      this.draw();
      return;
    }
  });

    // Кнопка поворота стены в UI
    document.getElementById('rotateBtn').onclick = () => {
      if (this.state.drag?.type === 'wall') {
        this.state.drag.isVertical = !this.state.drag.isVertical;
        this.draw();
      }
    };
  },
  
  // ====================================================================
  // 8. ЧИСТЫЕ ФУНКЦИИ (ДЛЯ ЛОГИКИ AI И СИМУЛЯЦИЙ)
  // Эти функции принимают состояние 'state' как аргумент и не мутируют глобальное 'this.state'
  // ====================================================================

  /**
   * Чистая версия hasPawnAt. Проверяет, находится ли фишка на заданной ячейке
   * для указанного состояния.
   * @param {GameState} state Состояние игры.
   * @param {number} r Строка.
   * @param {number} c Столбец.
   * @returns {boolean} True, если фишка найдена.
   */
  hasPawnAtWithState(state, r, c) {
    return state.players.some(p => p.pos.r === r && p.pos.c === c);
  },

  /**
   * Чистая версия getPlayerAt. Возвращает индекс игрока, находящегося в заданной ячейке.
   * @param {GameState} state Состояние игры.
   * @param {number} r Строка.
   * @param {number} c Столбец.
   * @returns {0|1|-1} Индекс игрока (0 или 1) или -1, если фишки нет.
   */
  getPlayerAtWithState(state, r, c) {
    return state.players[0].pos.r === r && state.players[0].pos.c === c ? 0 :
           state.players[1].pos.r === r && state.players[1].pos.c === c ? 1 : -1;
  },
  
  /**
   * Чистая версия isWallBetween. Проверяет, стоит ли стена между двумя соседними ячейками
   * в указанном состоянии. Логика идентична isWallBetween, но использует переданный state.
   * @param {GameState} state Состояние игры.
   * @param {number} fr Строка отправления.
   * @param {number} fc Столбец отправления.
   * @param {number} tr Строка назначения.
   * @param {number} tc Столбец назначения.
   * @returns {boolean} True, если между ячейками есть стена.
   */
  isWallBetweenWithState(state, fr, fc, tr, tc) {
    const dr = tr - fr, dc = tc - fc;
    if (Math.abs(dr) + Math.abs(dc) !== 1) return true;
    
    // Логика проверки совпадает с isWallBetween, но использует state.vWalls и state.hWalls
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
  },

  /**
   * Чистая версия checkWallPlacement. Проверяет локальные условия для размещения стены
   * в слоте (r, c) для указанного состояния.
   * @param {GameState} state Состояние игры.
   * @param {number} r Строка слота (0-7).
   * @param {number} c Столбец слота (0-7).
   * @param {boolean} vertical True, если стена вертикальная.
   * @returns {boolean} True, если локальные условия размещения соблюдены.
   */
  checkWallPlacementWithState(state, r, c, vertical) {
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
  },

  /**
   * Чистая версия hasPathToGoal. Выполняет поиск в ширину (BFS) для проверки пути
   * для указанного состояния.
   * @param {GameState} state Состояние игры.
   * @param {0|1} playerIdx Индекс игрока.
   * @returns {boolean} True, если путь к цели существует.
   */
  hasPathToGoalWithState(state, playerIdx) {
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
  },

  /**
   * Чистая версия isValidWallPlacement. Глобальная проверка: есть ли у обоих
   * игроков путь к их целевой линии в указанном состоянии.
   * @param {GameState} state Состояние игры.
   * @returns {boolean} True, если у обоих игроков есть путь.
   */
  isValidWallPlacementWithState(state) {
    return Game.hasPathToGoalWithState(state, 0) && 
           Game.hasPathToGoalWithState(state, 1);
  },
  goToMainMenu() {
    this.reset();
    UI.backToMenu();
  }
};



// Запуск инициализации после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
  Game.setupCanvas();
  Game.updateTurnDisplay();
  Game.initEvents();
});