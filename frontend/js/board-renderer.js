// BoardRenderer — переиспользуемый рендер доски.
//
// Этап 2 (ТЗ §4.1): рендерер параметризован (цвета/пропорции через opts).
// Все opts имеют дефолты «старой темы», поэтому игровой экран и реплей
// (которые ничего не передают) рисуются как раньше. Новая главная
// (DemoBoard) передаёт тему «новая»: цвета — из CSS-переменных, а не hex.
const BoardRenderer = {
  // Прямоугольник со скруглением (roundRect недоступен в старых браузерах — fallback).
  fillRectRound(ctx, x, y, w, h, radius) {
    if (radius > 0 && typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, w, h);
    }
  },

  drawGrid(ctx, opts) {
    const t = opts.transformRow || (function(r) { return r; });
    var pad = opts.padding !== undefined ? opts.padding : 4;
    var visual = opts.cellVisual !== undefined ? opts.cellVisual : (opts.cellSize - pad * 2);
    var radius = opts.cellRadius !== undefined ? opts.cellRadius : 0;
    var fillEven = opts.cellFillEven || '#1D1F22';
    var fillOdd = opts.cellFillOdd || '#191B1E';
    for (var r = 0; r < 9; r++) {
      for (var c = 0; c < 9; c++) {
        var x = c * opts.cellSize + pad;
        var y = t(r) * opts.cellSize + pad;
        if (opts.cellFill !== undefined) {
          // Равномерная заливка (новая тема): клетки одного цвета.
          ctx.fillStyle = opts.cellFill;
        } else {
          // Шахматные оттенки (старая тема по умолчанию).
          ctx.fillStyle = (r + c) % 2 === 0 ? fillEven : fillOdd;
        }
        this.fillRectRound(ctx, x, y, visual, visual, radius);
      }
    }
  },

  drawCoordinates(ctx, opts) {
    var fontFamily = opts.fontFamily || 'Inter, sans-serif';
    var cellSize = opts.cellSize;
    var t = opts.transformRow || (function(r) { return r; });
    var pad = opts.padding !== undefined ? opts.padding : 4;
    // Сдвиг подписи по умолчанию — как в старой теме (pad + cellSize * 0.08).
    var legacyInset = pad + cellSize * 0.08;
    var insetLeft = opts.coordInsetLeft !== undefined ? opts.coordInsetLeft : legacyInset;
    var insetTop = opts.coordInsetTop !== undefined ? opts.coordInsetTop : legacyInset;
    var insetRight = opts.coordInsetRight !== undefined ? opts.coordInsetRight : legacyInset;
    var insetBottom = opts.coordInsetBottom !== undefined ? opts.coordInsetBottom : legacyInset;

    ctx.fillStyle = opts.coordColor !== undefined ? opts.coordColor : 'rgba(242, 242, 242, 0.5)';
    ctx.font = '600 ' + (opts.fontSize || cellSize * 0.2) + 'px ' + fontFamily;

    // Цифры 9…1 — в левой колонке клеток, сдвиг от верхнего левого угла клетки.
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    for (var r = 0; r < 9; r++) {
      ctx.fillText(String(9 - r), insetLeft, t(r) * cellSize + insetTop);
    }

    // Буквы a…i — в нижнем ряду, сдвиг от правого нижнего угла клетки.
    var letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'right';
    var bottomY = (t(8) + 1) * cellSize - insetBottom;
    for (var c = 0; c < 9; c++) {
      ctx.fillText(letters[c], (c + 1) * cellSize - insetRight, bottomY);
    }
  },

  drawPlacedWalls(ctx, state, opts) {
    var t = opts.transformWallRow || opts.transformRow || (function(r) { return r; });
    ctx.fillStyle = opts.wallColor || '#E9A22C';
    var fullLen = opts.cellSize * 2;
    var g = opts.gap !== undefined ? opts.gap : 8;
    var wt = opts.wallThick !== undefined ? opts.wallThick : 20;
    var radius = opts.wallRadius !== undefined ? opts.wallRadius : 0;

    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var displayR = t(r);

        if (state.hWalls[r][c]) {
          var key = r + '-' + c + '-h';
          var animProgress = opts.wallAnims ? opts.wallAnims[key] : undefined;
          if (animProgress !== undefined && animProgress < 1) {
            var bs = this.backOut(animProgress);
            var len = fullLen - g * 2;
            var curLen = len * bs;
            var off = (len - curLen) / 2;
            this.fillRectRound(ctx, c * opts.cellSize + g + off, (displayR + 1) * opts.cellSize - wt / 2, curLen, wt, radius);
          } else {
            this.fillRectRound(ctx, c * opts.cellSize + g, (displayR + 1) * opts.cellSize - wt / 2, fullLen - g * 2, wt, radius);
          }
        }

        if (state.vWalls[r][c]) {
          var key = r + '-' + c + '-v';
          var animProgress = opts.wallAnims ? opts.wallAnims[key] : undefined;
          if (animProgress !== undefined && animProgress < 1) {
            var bs = this.backOut(animProgress);
            var len = fullLen - g * 2;
            var curLen = len * bs;
            var off = (len - curLen) / 2;
            this.fillRectRound(ctx, (c + 1) * opts.cellSize - wt / 2, displayR * opts.cellSize + g + off, wt, curLen, radius);
          } else {
            this.fillRectRound(ctx, (c + 1) * opts.cellSize - wt / 2, displayR * opts.cellSize + g, wt, fullLen - g * 2, radius);
          }
        }
      }
    }
  },

  drawPawns(ctx, state, opts) {
    var t = opts.transformRow || (function(r) { return r; });
    var radius = opts.pawnRadius !== undefined ? opts.pawnRadius : opts.cellSize * 0.35;

    for (var i = 0; i < state.players.length; i++) {
      var p = state.players[i];
      var pos;
      if (opts.pawnPositions && opts.pawnPositions[i] !== undefined) {
        pos = opts.pawnPositions[i];
      } else {
        pos = p.pos;
      }

      var x = (pos.c + 0.5) * opts.cellSize;
      var y = (t(pos.r) + 0.5) * opts.cellSize;

      if (opts.pawnFillColors) {
        ctx.fillStyle = opts.pawnFillColors[i];
      } else {
        ctx.fillStyle = p.color === 'white' ? '#F2F2F2' : '#0E0E10';
      }
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      if (opts.pawnStrokeColors) {
        ctx.strokeStyle = opts.pawnStrokeColors[i];
      } else {
        ctx.strokeStyle = p.color === 'white' ? '#9A9A9A' : '#5A5A5E';
      }
      ctx.lineWidth = opts.pawnStrokeWidth !== undefined ? opts.pawnStrokeWidth : 3;
      ctx.stroke();
    }
  },

  backOut(t) {
    var c1 = 1.70158;
    var c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};
