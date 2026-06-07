const BoardRenderer = {
  drawGrid(ctx, opts) {
    const t = opts.transformRow || (function(r) { return r; });
    var pad = opts.padding !== undefined ? opts.padding : 4;
    for (var r = 0; r < 9; r++) {
      for (var c = 0; c < 9; c++) {
        var x = c * opts.cellSize + pad;
        var y = t(r) * opts.cellSize + pad;
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(x, y, opts.cellSize - pad * 2, opts.cellSize - pad * 2);
      }
    }
  },

  drawCoordinates(ctx, opts) {
    var fontFamily = opts.fontFamily || 'Inter, sans-serif';
    var cellSize = opts.cellSize;
    var t = opts.transformRow || (function(r) { return r; });
    var pad = opts.padding !== undefined ? opts.padding : 4;

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold ' + (opts.fontSize || cellSize * 0.2) + 'px ' + fontFamily;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    var padding = cellSize * 0.08;

    for (var r = 0; r < 9; r++) {
      ctx.fillText((9 - r).toString(), 0 + pad + padding, t(r) * cellSize + pad + padding);
    }

    var letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'right';
    var bottomY = (t(8) + 1) * cellSize - pad - padding;
    for (var c = 0; c < 9; c++) {
      ctx.fillText(letters[c], (c + 1) * cellSize - pad - padding, bottomY);
    }
  },

  drawPlacedWalls(ctx, state, opts) {
    var t = opts.transformWallRow || opts.transformRow || (function(r) { return r; });
    ctx.fillStyle = '#e09f3e';
    var fullLen = opts.cellSize * 2;
    var g = opts.gap !== undefined ? opts.gap : 8;
    var wt = opts.wallThick !== undefined ? opts.wallThick : 20;

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
            ctx.fillRect(c * opts.cellSize + g + off, (displayR + 1) * opts.cellSize - wt / 2, curLen, wt);
          } else {
            ctx.fillRect(c * opts.cellSize + g, (displayR + 1) * opts.cellSize - wt / 2, fullLen - g * 2, wt);
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
            ctx.fillRect((c + 1) * opts.cellSize - wt / 2, displayR * opts.cellSize + g + off, wt, curLen);
          } else {
            ctx.fillRect((c + 1) * opts.cellSize - wt / 2, displayR * opts.cellSize + g, wt, fullLen - g * 2);
          }
        }
      }
    }
  },

  drawPawns(ctx, state, opts) {
    var t = opts.transformRow || (function(r) { return r; });
    var radius = opts.cellSize * 0.35;

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
        ctx.fillStyle = p.color === 'white' ? '#fff' : '#000';
      }
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      if (opts.pawnStrokeColors) {
        ctx.strokeStyle = opts.pawnStrokeColors[i];
      } else {
        ctx.strokeStyle = p.color === 'white' ? '#ccc' : '#444';
      }
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  },

  backOut(t) {
    var c1 = 1.70158;
    var c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};
