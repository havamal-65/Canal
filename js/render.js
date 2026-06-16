// Canvas renderer: terrain hillshading, water with depth, animated flow
// (current) streaks from the velocity field, working locks (chamber level,
// animated gates, queue), boats, route lines, and the tool preview.
(function (Canal) {
  const C = Canal.CONFIG;
  const STRUCT = Canal.STRUCT;
  const T = C.TILE;

  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix(c1, c2, t) {
    return [Math.round(lerp(c1[0], c2[0], t)), Math.round(lerp(c1[1], c2[1], t)), Math.round(lerp(c1[2], c2[2], t))];
  }
  function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

  const RAMP = [
    [0, [70, 120, 70]], [5, [104, 132, 66]], [9, [150, 134, 84]], [12, [140, 110, 86]], [16, [156, 152, 142]],
  ];
  function terrainColor(h) {
    for (let k = 1; k < RAMP.length; k++) {
      if (h <= RAMP[k][0]) { const a = RAMP[k - 1], b = RAMP[k]; return mix(a[1], b[1], (h - a[0]) / (b[0] - a[0])); }
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
      const ctx = this.ctx, w = this.world;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.drawTerrainAndWater(ctx, w);
      this.drawFlow(ctx, w);
      this.drawStructures(ctx, w);
      this.drawRoutes(ctx, boatMgr);
      this.drawBoats(ctx, boatMgr);
      if (view) this.drawPreview(ctx, w, view);
    }

    drawTerrainAndWater(ctx, w) {
      const deepC = [22, 58, 92], shallowC = [74, 140, 180];
      for (let y = 0; y < w.rows; y++) {
        for (let x = 0; x < w.cols; x++) {
          const i = y * w.cols + x;
          const g = w.ground[i], depth = w.water[i];
          const px = x * T, py = y * T;
          let base = terrainColor(g);
          if (x > 0 && y > 0) {
            const slope = (g - w.ground[i - 1]) + (g - w.ground[i - w.cols]);
            const shade = Math.max(-0.28, Math.min(0.28, slope * 0.07));
            base = mix(base, shade >= 0 ? [255, 255, 255] : [0, 0, 0], Math.abs(shade));
          }
          ctx.fillStyle = rgb(base);
          ctx.fillRect(px, py, T, T);
          if (depth > 0.02) {
            const dn = Math.max(0, Math.min(1, depth / 3));
            const wc = mix(shallowC, deepC, dn);
            const navigable = depth >= C.MIN_DRAFT && w.struct[i] === STRUCT.NONE;
            ctx.fillStyle = 'rgba(' + wc[0] + ',' + wc[1] + ',' + wc[2] + ',' + (navigable ? 0.92 : 0.66) + ')';
            ctx.fillRect(px, py, T, T);
          }
        }
      }
    }

    // Animated current: short streaks aligned with the velocity field, with a
    // moving dash phase so water visibly flows.
    drawFlow(ctx, w) {
      ctx.lineCap = 'round';
      const phase = (this.time * 2) % 1;
      for (let y = 0; y < w.rows; y++) {
        for (let x = 0; x < w.cols; x++) {
          const i = y * w.cols + x;
          if (w.water[i] < 0.12) continue;
          const vx = w.vx[i], vy = w.vy[i];
          const sp = Math.hypot(vx, vy);
          if (sp < 0.05) continue;
          const ux = vx / sp, uy = vy / sp;
          const cx = x * T + T / 2, cy = y * T + T / 2;
          const len = Math.min(T * 0.42, T * 0.18 + sp * 1.4);
          const a = Math.min(0.5, 0.12 + sp * 0.9);
          // dash travels along the flow direction
          const off = (phase - 0.5) * len;
          ctx.strokeStyle = 'rgba(210,235,250,' + a + ')';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(cx - ux * len * 0.5 + ux * off, cy - uy * len * 0.5 + uy * off);
          ctx.lineTo(cx - ux * len * 0.1 + ux * off, cy - uy * len * 0.1 + uy * off);
          ctx.stroke();
          // arrowhead
          ctx.fillStyle = 'rgba(225,245,255,' + a + ')';
          const hx = cx + ux * len * 0.45, hy = cy + uy * len * 0.45;
          ctx.beginPath();
          ctx.moveTo(hx, hy);
          ctx.lineTo(hx - ux * 3 - uy * 2, hy - uy * 3 + ux * 2);
          ctx.lineTo(hx - ux * 3 + uy * 2, hy - uy * 3 - ux * 2);
          ctx.closePath();
          ctx.fill();
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
          else if (s === STRUCT.WALL) { ctx.fillStyle = '#5a5147'; ctx.fillRect(px + 1, py + 1, T - 2, T - 2); }
        }
      }
      for (const L of w.locks) this.drawLock(ctx, w, L);
    }

    drawSource(ctx, px, py) {
      const cx = px + T / 2, cy = py + T / 2;
      ctx.fillStyle = '#36c3ff';
      ctx.beginPath(); ctx.arc(cx, cy, T * 0.32, 0, Math.PI * 2); ctx.fill();
      const r = T * 0.18 + (Math.sin(this.time * 3) + 1) * T * 0.12;
      ctx.strokeStyle = 'rgba(160,230,255,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }

    drawDock(ctx, px, py) {
      ctx.fillStyle = '#b9a878'; ctx.fillRect(px + 2, py + 2, T - 4, T - 4);
      ctx.fillStyle = '#6e5f3e'; ctx.fillRect(px + 3, py + 3, T - 6, 2); ctx.fillRect(px + 3, py + T - 5, T - 6, 2);
      ctx.fillStyle = '#3a3326'; ctx.fillRect(px + 4, py + 4, 2, 2); ctx.fillRect(px + T - 6, py + T - 6, 2, 2);
    }

    drawLock(ctx, w, L) {
      const px = L.x * T, py = L.y * T;
      // chamber frame
      ctx.fillStyle = L.configured ? '#c9742e' : '#8a3a2a';
      ctx.fillRect(px + 1, py + 1, T - 2, T - 2);
      // chamber water level (0..1 between lo and hi pound surfaces)
      if (L.configured) {
        const los = w.surfaceI(L.loCell), his = w.surfaceI(L.hiCell), cs = w.surfaceI(L.cell);
        const f = his > los + 0.01 ? Math.max(0, Math.min(1, (cs - los) / (his - los))) : 1;
        const innerW = T - 6, innerH = T - 6;
        const fillH = Math.round(innerH * f);
        ctx.fillStyle = 'rgba(40,110,160,0.9)';
        ctx.fillRect(px + 3, py + 3 + (innerH - fillH), innerW, fillH);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(px + 3, py + 3, innerW, innerH - fillH);
        // gates on the hi and lo faces
        this.drawGate(ctx, w, L, px, py, L.hiCell, L.gateHi);
        this.drawGate(ctx, w, L, px, py, L.loCell, L.gateLo);
        // queue badge
        if (L.queue.length) {
          ctx.fillStyle = '#ffba08'; ctx.font = 'bold 9px sans-serif';
          ctx.fillText(String(L.queue.length), px + T - 8, py + 9);
        }
      }
    }

    drawGate(ctx, w, L, px, py, neighborCell, openness) {
      const dx = (neighborCell % w.cols) - L.x;
      const dy = ((neighborCell / w.cols) | 0) - L.y;
      ctx.strokeStyle = '#160d05'; ctx.lineWidth = 2.2;
      const gap = openness * (T * 0.36); // how far the two leaves retract
      ctx.beginPath();
      if (dx !== 0) { // vertical gate on a left/right face
        const gx = px + (dx > 0 ? T - 2 : 2);
        ctx.moveTo(gx, py + 2); ctx.lineTo(gx, py + T / 2 - gap);
        ctx.moveTo(gx, py + T - 2); ctx.lineTo(gx, py + T / 2 + gap);
      } else { // horizontal gate on a top/bottom face
        const gy = py + (dy > 0 ? T - 2 : 2);
        ctx.moveTo(px + 2, gy); ctx.lineTo(px + T / 2 - gap, gy);
        ctx.moveTo(px + T - 2, gy); ctx.lineTo(px + T / 2 + gap, gy);
      }
      ctx.stroke();
    }

    drawRoutes(ctx, boatMgr) {
      ctx.save(); ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
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
        const cx = b.x * T + T / 2, cy = b.y * T + T / 2;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(b.heading);
        ctx.fillStyle = b.idle ? '#8a4a4a' : '#7a4a2a';
        ctx.beginPath();
        ctx.moveTo(T * 0.42, 0); ctx.lineTo(T * 0.18, T * 0.22); ctx.lineTo(-T * 0.38, T * 0.22);
        ctx.lineTo(-T * 0.38, -T * 0.22); ctx.lineTo(T * 0.18, -T * 0.22); ctx.closePath(); ctx.fill();
        if (b.cargo) { ctx.fillStyle = '#e0b343'; ctx.fillRect(-T * 0.28, -T * 0.14, T * 0.34, T * 0.28); }
        ctx.restore();
        if (b.idle) {
          ctx.fillStyle = 'rgba(230,57,70,0.9)'; ctx.font = 'bold 10px sans-serif';
          ctx.fillText('!', cx - 2, cy - T * 0.4);
        } else if (b.cross) {
          ctx.fillStyle = 'rgba(255,186,8,0.95)'; ctx.font = 'bold 9px sans-serif';
          ctx.fillText('⧗', cx - 3, cy - T * 0.4);
        }
      }
    }

    drawPreview(ctx, w, view) {
      if (view.hoverX < 0) return;
      const r = view.brush;
      ctx.strokeStyle = view.valid ? 'rgba(46,196,182,0.9)' : 'rgba(230,57,70,0.9)';
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
