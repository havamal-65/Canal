// Canvas renderer: terrain hillshading, water with depth + flow shimmer,
// structures, boats, route lines, and the tool/brush preview overlay.
(function (Canal) {
  const C = Canal.CONFIG;
  const STRUCT = Canal.STRUCT;
  const T = C.TILE;

  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix(c1, c2, t) {
    return [
      Math.round(lerp(c1[0], c2[0], t)),
      Math.round(lerp(c1[1], c2[1], t)),
      Math.round(lerp(c1[2], c2[2], t)),
    ];
  }
  function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

  // Elevation colour ramp (above water).
  const RAMP = [
    [0, [70, 120, 70]],    // lowland green
    [5, [104, 132, 66]],
    [9, [150, 134, 84]],   // dry tan
    [12, [140, 110, 86]],  // brown
    [16, [156, 152, 142]], // rock
  ];
  function terrainColor(h) {
    for (let k = 1; k < RAMP.length; k++) {
      if (h <= RAMP[k][0]) {
        const a = RAMP[k - 1], b = RAMP[k];
        const t = (h - a[0]) / (b[0] - a[0]);
        return mix(a[1], b[1], t);
      }
    }
    return RAMP[RAMP.length - 1][1];
  }

  class Renderer {
    constructor(canvas, world) {
      this.canvas = canvas;
      this.world = world;
      canvas.width = world.cols * T;
      canvas.height = world.rows * T;
      this.ctx = canvas.getContext('2d');
      this.time = 0;
    }

    draw(boatMgr, view, dt) {
      this.time += dt;
      const ctx = this.ctx;
      const w = this.world;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      this.drawTerrainAndWater(ctx, w);
      this.drawStructures(ctx, w);
      this.drawRoutes(ctx, boatMgr);
      this.drawBoats(ctx, boatMgr);
      if (view) this.drawPreview(ctx, w, view);
    }

    drawTerrainAndWater(ctx, w) {
      const deepC = [22, 58, 92];
      const shallowC = [74, 140, 180];
      for (let y = 0; y < w.rows; y++) {
        for (let x = 0; x < w.cols; x++) {
          const i = y * w.cols + x;
          const g = w.ground[i];
          const depth = w.water[i];
          const px = x * T, py = y * T;

          // Ground with simple hillshade from the up-left neighbour.
          let base = terrainColor(g);
          let shade = 0;
          if (x > 0 && y > 0) {
            const gnL = w.ground[i - 1];
            const gnU = w.ground[i - w.cols];
            const slope = (g - gnL) + (g - gnU);
            shade = Math.max(-0.28, Math.min(0.28, slope * 0.07));
          }
          base = mix(base, shade >= 0 ? [255, 255, 255] : [0, 0, 0], Math.abs(shade));
          ctx.fillStyle = rgb(base);
          ctx.fillRect(px, py, T, T);

          // Water overlay.
          if (depth > 0.02) {
            const dn = Math.max(0, Math.min(1, depth / 3));
            let wc = mix(shallowC, deepC, dn);
            // flow shimmer
            const fl = w.flow[i];
            if (fl > 0.01) {
              const sh = Math.min(0.5, fl * 12);
              const pulse = 0.5 + 0.5 * Math.sin(this.time * 4 + (x + y));
              wc = mix(wc, [180, 220, 245], sh * pulse);
            }
            const navigable = depth >= C.MIN_DRAFT && w.struct[i] !== STRUCT.WALL;
            ctx.fillStyle = 'rgba(' + wc[0] + ',' + wc[1] + ',' + wc[2] + ',' + (navigable ? 0.92 : 0.7) + ')';
            ctx.fillRect(px, py, T, T);
            // shallow / too-shallow hint: dashed lighter edge
            if (!navigable) {
              ctx.fillStyle = 'rgba(255,255,255,0.06)';
              ctx.fillRect(px, py, T, T);
            }
          }
        }
      }
    }

    drawStructures(ctx, w) {
      for (let y = 0; y < w.rows; y++) {
        for (let x = 0; x < w.cols; x++) {
          const i = y * w.cols + x;
          const s = w.struct[i];
          if (s === STRUCT.NONE) continue;
          const px = x * T, py = y * T;
          if (s === STRUCT.SOURCE) this.drawSource(ctx, px, py);
          else if (s === STRUCT.DOCK) this.drawDock(ctx, px, py);
          else if (s === STRUCT.LOCK) this.drawLock(ctx, w, x, y, px, py);
          else if (s === STRUCT.WALL) {
            ctx.fillStyle = '#5a5147';
            ctx.fillRect(px + 1, py + 1, T - 2, T - 2);
          }
        }
      }
    }

    drawSource(ctx, px, py) {
      const cx = px + T / 2, cy = py + T / 2;
      ctx.fillStyle = '#36c3ff';
      ctx.beginPath();
      ctx.arc(cx, cy, T * 0.32, 0, Math.PI * 2);
      ctx.fill();
      const r = T * 0.18 + (Math.sin(this.time * 3) + 1) * T * 0.12;
      ctx.strokeStyle = 'rgba(160,230,255,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    drawDock(ctx, px, py) {
      ctx.fillStyle = '#b9a878';
      ctx.fillRect(px + 2, py + 2, T - 4, T - 4);
      ctx.fillStyle = '#6e5f3e';
      ctx.fillRect(px + 3, py + 3, T - 6, 2);
      ctx.fillRect(px + 3, py + T - 5, T - 6, 2);
      // bollards
      ctx.fillStyle = '#3a3326';
      ctx.fillRect(px + 4, py + 4, 2, 2);
      ctx.fillRect(px + T - 6, py + T - 6, 2, 2);
    }

    drawLock(ctx, w, x, y, px, py) {
      // chamber
      ctx.fillStyle = '#c9742e';
      ctx.fillRect(px + 1, py + 1, T - 2, T - 2);
      ctx.fillStyle = 'rgba(40,90,130,0.65)';
      ctx.fillRect(px + 3, py + 3, T - 6, T - 6);
      // gates run across the canal axis (perpendicular to the water neighbours)
      const horiz = w.navigable(x - 1, y) || w.navigable(x + 1, y);
      ctx.strokeStyle = '#1a120a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (horiz) {
        ctx.moveTo(px + 3, py + 2); ctx.lineTo(px + 3, py + T - 2);
        ctx.moveTo(px + T - 3, py + 2); ctx.lineTo(px + T - 3, py + T - 2);
      } else {
        ctx.moveTo(px + 2, py + 3); ctx.lineTo(px + T - 2, py + 3);
        ctx.moveTo(px + 2, py + T - 3); ctx.lineTo(px + T - 2, py + T - 3);
      }
      ctx.stroke();
    }

    drawRoutes(ctx, boatMgr) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      for (const r of boatMgr.routes) {
        ctx.strokeStyle = 'rgba(46,196,182,0.35)';
        ctx.beginPath();
        ctx.moveTo(r.a.x * T + T / 2, r.a.y * T + T / 2);
        ctx.lineTo(r.b.x * T + T / 2, r.b.y * T + T / 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawBoats(ctx, boatMgr) {
      for (const b of boatMgr.boats) {
        const cx = b.x * T + T / 2;
        const cy = b.y * T + T / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(b.heading);
        // hull
        ctx.fillStyle = b.idle ? '#8a4a4a' : '#7a4a2a';
        ctx.beginPath();
        ctx.moveTo(T * 0.42, 0);
        ctx.lineTo(T * 0.18, T * 0.22);
        ctx.lineTo(-T * 0.38, T * 0.22);
        ctx.lineTo(-T * 0.38, -T * 0.22);
        ctx.lineTo(T * 0.18, -T * 0.22);
        ctx.closePath();
        ctx.fill();
        // cargo
        if (b.cargo) {
          ctx.fillStyle = '#e0b343';
          ctx.fillRect(-T * 0.28, -T * 0.14, T * 0.34, T * 0.28);
        }
        ctx.restore();
        if (b.idle) {
          ctx.fillStyle = 'rgba(230,57,70,0.9)';
          ctx.font = 'bold 10px sans-serif';
          ctx.fillText('!', cx - 2, cy - T * 0.4);
        }
      }
    }

    drawPreview(ctx, w, view) {
      if (view.hoverX < 0) return;
      const r = view.brush;
      const color = view.valid ? 'rgba(46,196,182,0.9)' : 'rgba(230,57,70,0.9)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = view.hoverX + dx, y = view.hoverY + dy;
          if (!w.inBounds(x, y)) continue;
          ctx.strokeRect(x * T + 0.5, y * T + 0.5, T - 1, T - 1);
        }
      }
    }
  }

  Canal.Renderer = Renderer;
})(window.Canal);
