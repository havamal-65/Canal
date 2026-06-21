// Mouse + keyboard input: tool selection, terrain painting, structure
// placement, route building, and the inspector panel.
(function (Canal) {
  const C = Canal.CONFIG;
  const STRUCT = Canal.STRUCT;
  const T = C.TILE;
  const PAINT_INTERVAL = 0.07; // seconds between paint applications when held

  const BRUSH_RADIUS = [0, 1, 2];

  class Input {
    constructor(game) {
      this.game = game;
      this.world = game.world;
      this.tool = 'inspect';
      this.brush = 1; // index into BRUSH_RADIUS
      this.hoverX = -1;
      this.hoverY = -1;
      this.painting = false;
      this.paintAccum = 0;
      this.routePick = null; // first dock chosen for a route
      this.lineStart = null; this.lineEnd = null; // line-tool drag endpoints

      this.bindToolbar();
      this.bindCanvas();
      this.bindKeys();
    }

    // ---- shared view state for the renderer/preview ----
    get view() {
      return {
        hoverX: this.hoverX,
        hoverY: this.hoverY,
        brush: BRUSH_RADIUS[this.brush],
        tool: this.tool,
        valid: this.previewValid(),
        lineCells: (this.tool === 'line' && this.lineStart) ? this.lineCells(this.lineStart, this.lineEnd || this.lineStart) : null,
      };
    }

    previewValid() {
      return this.hoverX >= 0;
    }

    // ---- toolbar / speed / brush buttons ----
    bindToolbar() {
      document.querySelectorAll('.tool').forEach((btn) => {
        btn.addEventListener('click', () => this.selectTool(btn.dataset.tool));
      });
      document.querySelectorAll('.brush').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.brush = parseInt(btn.dataset.brush, 10);
          document.querySelectorAll('.brush').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
      document.querySelectorAll('.speed-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.game.setSpeed(parseInt(btn.dataset.speed, 10));
          document.querySelectorAll('.speed-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
    }

    selectTool(tool) {
      this.tool = tool;
      this.routePick = null;
      this.lineStart = null; this.lineEnd = null;
      document.querySelectorAll('.tool').forEach((b) => {
        b.classList.toggle('active', b.dataset.tool === tool);
      });
      this.game.setHint(this.hintFor(tool));
    }

    hintFor(tool) {
      switch (tool) {
        case 'dig': return 'Click & drag to dig a channel. Water seeks its own level.';
        case 'line': return 'Click & drag to dig a straight, flat-bottomed canal (brush sets width).';
        case 'fill': return 'Click & drag to raise terrain and wall off water.';
        case 'lock': return 'Place a lock where two pounds meet to lift boats between levels.';
        case 'dock': return 'Place a dock beside navigable water to load or unload cargo.';
        case 'source': return 'Place a water source to feed a canal from the top of a hill.';
        case 'route': return 'Click a pickup dock, then a destination dock, to run a boat.';
        case 'bulldoze': return 'Click a structure to remove it.';
        default: return 'Hover a tile to inspect it. Pick a tool from the left to build.';
      }
    }

    // ---- canvas pointer handling ----
    bindCanvas() {
      const cv = this.game.renderer.canvas;
      const pick = (e) => this.game.renderer.pickTile(e.clientX, e.clientY);

      cv.addEventListener('mousemove', (e) => {
        const t = pick(e);
        this.hoverX = t.x; this.hoverY = t.y;
        if (this.lineStart && t.x >= 0) this.lineEnd = { x: t.x, y: t.y };
        this.updateInspector();
      });
      cv.addEventListener('mouseleave', () => {
        this.hoverX = -1; this.hoverY = -1;
        this.painting = false;
      });
      cv.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; // left button builds; right/middle drive the camera
        const t = pick(e);
        this.hoverX = t.x; this.hoverY = t.y;
        if (t.x < 0) return;
        if (this.tool === 'line') { this.lineStart = { x: t.x, y: t.y }; this.lineEnd = { x: t.x, y: t.y }; return; }
        this.onClick(t.x, t.y);
        if (this.isPaintTool()) { this.painting = true; this.paintAccum = PAINT_INTERVAL; }
      });
      window.addEventListener('mouseup', () => {
        this.painting = false;
        if (this.lineStart) { this.commitLine(); this.lineStart = null; this.lineEnd = null; }
      });
    }

    markTerrain(x0, y0, x1, y1) { const r = this.game.renderer; if (r && r.markTerrainDirty) r.markTerrainDirty(x0, y0, x1, y1); }

    isPaintTool() {
      return this.tool === 'dig' || this.tool === 'fill';
    }

    // continuous painting while the mouse is held — driven by the game loop
    tickPaint(dt) {
      if (!this.painting || !this.isPaintTool()) return;
      this.paintAccum += dt;
      while (this.paintAccum >= PAINT_INTERVAL) {
        this.paintAccum -= PAINT_INTERVAL;
        this.paintBrush();
      }
    }

    bindKeys() {
      window.addEventListener('keydown', (e) => {
        if (e.key === ' ') {
          e.preventDefault();
          this.game.togglePause();
          return;
        }
        const map = { '1': 'dig', '2': 'line', '3': 'fill', '4': 'lock', '5': 'dock', '6': 'source', '7': 'route', '8': 'bulldoze', '9': 'inspect' };
        if (map[e.key]) {
          this.selectTool(map[e.key]);
          document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === map[e.key]));
        }
      });
    }

    // ---- actions ----
    onClick(x, y) {
      if (!this.world.inBounds(x, y)) return;
      switch (this.tool) {
        case 'dig': case 'fill': this.paintBrush(); break;
        case 'lock': this.placeLock(x, y); break;
        case 'dock': this.placeDock(x, y); break;
        case 'source': this.placeSource(x, y); break;
        case 'route': this.pickRoute(x, y); break;
        case 'bulldoze': this.bulldoze(x, y); break;
        default: break;
      }
    }

    brushTiles() {
      const r = BRUSH_RADIUS[this.brush];
      const tiles = [];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = this.hoverX + dx, y = this.hoverY + dy;
          if (this.world.inBounds(x, y)) tiles.push({ x, y });
        }
      }
      return tiles;
    }

    paintBrush() {
      const w = this.world;
      let changed = false;
      for (const { x, y } of this.brushTiles()) {
        const i = w.idx(x, y);
        if (w.struct[i] !== STRUCT.NONE) continue; // don't carve through structures
        if (this.tool === 'dig') {
          if (w.ground[i] <= C.MIN_GROUND) continue;
          w.ground[i] = Math.max(C.MIN_GROUND, w.ground[i] - C.DIG_STEP);
          this.seedFromNeighbours(x, y);
          changed = true;
        } else {
          if (w.ground[i] >= C.MAX_ELEV) continue;
          w.ground[i] = Math.min(C.MAX_ELEV, w.ground[i] + C.FILL_STEP);
          // filling pushes water out of the tile
          if (w.water[i] > 0 && w.ground[i] > C.SEA_LEVEL) w.water[i] = Math.max(0, w.water[i] - C.FILL_STEP);
          changed = true;
        }
      }
      if (changed) { const r = BRUSH_RADIUS[this.brush]; this.markTerrain(this.hoverX - r, this.hoverY - r, this.hoverX + r, this.hoverY + r); }
    }

    // let adjacent water flow into a freshly dug cell (seed partway; the sim
    // flows in the rest with a visible current)
    seedFromNeighbours(x, y) {
      const w = this.world, i = w.idx(x, y);
      let maxSurf = -Infinity;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!w.inBounds(nx, ny)) continue;
        const ni = w.idx(nx, ny);
        if (w.struct[ni] === STRUCT.WALL || w.struct[ni] === STRUCT.LOCK) continue;
        const wet = w.water[ni] > 0.02 || w.ground[ni] < C.SEA_LEVEL || w.struct[ni] === STRUCT.SOURCE;
        if (wet) maxSurf = Math.max(maxSurf, w.ground[ni] + w.water[ni]);
      }
      if (maxSurf > w.ground[i] + 0.02) w.water[i] = Math.max(w.water[i], (maxSurf - w.ground[i]) * 0.6);
    }

    // cells along a straight line (Bresenham) widened by the brush radius
    lineCells(a, b) {
      const cells = [], seen = new Set(), r = BRUSH_RADIUS[this.brush];
      let x0 = a.x, y0 = a.y; const x1 = b.x, y1 = b.y;
      const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx - dy, guard = 0;
      for (;;) {
        for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
          const cx = x0 + ox, cy = y0 + oy;
          if (!this.world.inBounds(cx, cy)) continue;
          const key = cy * this.world.cols + cx;
          if (seen.has(key)) continue;
          seen.add(key); cells.push({ x: cx, y: cy });
        }
        if ((x0 === x1 && y0 === y1) || ++guard > 4000) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
      }
      return cells;
    }

    // dig a straight flat-bottomed canal from lineStart to lineEnd
    commitLine() {
      if (!this.lineStart || !this.lineEnd) return;
      const w = this.world;
      const cells = this.lineCells(this.lineStart, this.lineEnd)
        .filter(({ x, y }) => w.struct[w.idx(x, y)] === STRUCT.NONE);
      if (!cells.length) return;
      let minG = Infinity;
      for (const { x, y } of cells) minG = Math.min(minG, w.ground[w.idx(x, y)]);
      const target = Math.max(C.MIN_GROUND, minG - C.DIG_STEP * 4);
      let changed = false;
      for (const { x, y } of cells) {
        const i = w.idx(x, y);
        if (w.ground[i] <= target) continue;
        w.ground[i] = target;
        this.seedFromNeighbours(x, y);
        changed = true;
      }
      if (changed) {
        const r = BRUSH_RADIUS[this.brush];
        this.markTerrain(Math.min(this.lineStart.x, this.lineEnd.x) - r, Math.min(this.lineStart.y, this.lineEnd.y) - r,
          Math.max(this.lineStart.x, this.lineEnd.x) + r, Math.max(this.lineStart.y, this.lineEnd.y) + r);
        Canal.toast('Channel dug.', 'good');
      }
    }

    placeLock(x, y) {
      const w = this.world;
      const i = w.idx(x, y);
      if (w.struct[i] !== STRUCT.NONE) { Canal.toast('Tile is already occupied.', 'bad'); return; }
      this.game.lockMgr.build(x, y);
      this.markTerrain();
      const L = this.game.lockMgr.lockAt(i);
      Canal.toast(L && L.configured ? 'Lock built — it will lift boats between the two pounds.'
        : 'Lock built. Dig a channel on both sides so it can bridge two pounds.', 'good');
    }

    placeDock(x, y) {
      const w = this.world;
      const i = w.idx(x, y);
      if (w.struct[i] !== STRUCT.NONE) { Canal.toast('Tile is already occupied.', 'bad'); return; }
      w.addDock(x, y);
      Canal.toast('Dock built. Link two docks with the Route tool.', 'good');
    }

    placeSource(x, y) {
      const w = this.world;
      const i = w.idx(x, y);
      if (w.struct[i] !== STRUCT.NONE) { Canal.toast('Tile is already occupied.', 'bad'); return; }
      w.addSource(x, y);
      this.markTerrain();
      Canal.toast('Water source placed.', 'good');
    }

    bulldoze(x, y) {
      const w = this.world;
      const i = w.idx(x, y);
      let removed = false;
      if (w.struct[i] === STRUCT.LOCK) removed = this.game.lockMgr.remove(x, y);
      else removed = w.removeStructure(x, y);
      if (removed) {
        this.game.boatMgr.pruneRoutes();
        Canal.toast('Removed.', 'info');
        this.game.updateHud();
      }
    }

    pickRoute(x, y) {
      const dock = this.world.dockAt(x, y);
      if (!dock) { Canal.toast('Click on a dock.', 'bad'); return; }
      if (!this.routePick) {
        this.routePick = dock;
        Canal.toast('Pickup set at Dock ' + dock.id + '. Now click the destination dock.', 'info');
        return;
      }
      if (dock === this.routePick) { Canal.toast('Pick a different destination dock.', 'bad'); return; }
      this.game.boatMgr.addRoute([this.routePick, dock]);
      Canal.toast('Route opened: Dock ' + this.routePick.id + ' → Dock ' + dock.id + '. Boat added.', 'good');
      this.routePick = null;
      this.game.updateHud();
    }

    updateInspector() {
      const el = document.getElementById('inspector-body');
      const w = this.world;
      if (!w.inBounds(this.hoverX, this.hoverY)) {
        el.innerHTML = '<p class="muted">Hover or click a tile to inspect it.</p>';
        return;
      }
      const i = w.idx(this.hoverX, this.hoverY);
      const ground = w.ground[i];
      const depth = w.water[i];
      const surf = ground + depth;
      const structNames = ['Open', 'Lock', 'Dock', 'Water source', 'Wall'];
      const nav = w.navigable(this.hoverX, this.hoverY);
      const speed = Math.hypot(w.vx[i], w.vy[i]);
      const rows = [
        ['Tile', this.hoverX + ', ' + this.hoverY],
        ['Ground', ground.toFixed(1) + ' m'],
        ['Water depth', depth.toFixed(2) + ' m'],
        ['Surface', surf.toFixed(1) + ' m'],
        ['Flow', speed < 0.03 ? 'still' : speed.toFixed(2) + ' m³/s'],
        ['Structure', structNames[w.struct[i]]],
        ['Navigable', nav ? 'yes' : 'no'],
      ];
      if (w.struct[i] === STRUCT.LOCK) {
        const L = this.game.lockMgr.lockAt(i);
        if (L) {
          const stateLabel = { open_lo: 'open (low)', open_hi: 'open (high)', filling: 'filling ▲', emptying: 'emptying ▼' };
          rows.push(['Lock', L.configured ? (stateLabel[L.state] || L.state) : 'needs two pounds']);
          if (L.configured) rows.push(['Queue', String(L.queue.length + (L.occupant ? 1 : 0))]);
        }
      }
      el.innerHTML = rows.map((r) => '<div class="row"><span class="muted">' + r[0] + '</span><span>' + r[1] + '</span></div>').join('');
    }
  }

  Canal.Input = Input;
})(window.Canal);
