// World state: the tile grid, simulation buffers, and procedural terrain.
(function (Canal) {
  const C = Canal.CONFIG;
  const STRUCT = Canal.STRUCT;

  class World {
    constructor(seed) {
      this.seed = seed >>> 0;
      this.cols = C.COLS;
      this.rows = C.ROWS;
      const n = this.cols * this.rows;
      this.n = n;

      this.ground = new Float32Array(n);
      this.water = new Float32Array(n);
      this.struct = new Uint8Array(n);

      // Flux model buffers: outflow per cell to L/R/Up/Down, plus velocity.
      this.fL = new Float32Array(n);
      this.fR = new Float32Array(n);
      this.fU = new Float32Array(n);
      this.fD = new Float32Array(n);
      this.vx = new Float32Array(n); // smoothed velocity for rendering
      this.vy = new Float32Array(n);

      // Face passability (rebuilt each tick from walls + lock valves).
      this.passR = new Uint8Array(n); // face between i and i+1
      this.passD = new Uint8Array(n); // face between i and i+cols

      // Lock + traffic bookkeeping.
      this.locks = [];                 // Lock objects
      this.lockOf = new Int32Array(n).fill(-1); // cell -> index into locks, or -1
      this.lockBridges = new Map();    // cell -> [{opp, lock}] crossing edges
      this.boatCell = new Int32Array(n).fill(-1); // cell -> boat index, or -1

      this.sources = [];
      this.docks = [];
      this.dockSeq = 1;

      this.generate();
    }

    idx(x, y) { return y * this.cols + x; }
    inBounds(x, y) { return x >= 0 && y >= 0 && x < this.cols && y < this.rows; }
    surface(x, y) { const i = y * this.cols + x; return this.ground[i] + this.water[i]; }
    surfaceI(i) { return this.ground[i] + this.water[i]; }
    isEdge(x, y) { return x === 0 || y === 0 || x === this.cols - 1 || y === this.rows - 1; }

    // Open-water tile a boat of the given draft can float in. Structures
    // (locks, docks, sources, walls) are never plain navigable nodes; locks are
    // crossed via bridge edges instead.
    navigableFor(x, y, draft) {
      if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return false;
      const i = y * this.cols + x;
      if (this.struct[i] !== STRUCT.NONE) return false;
      return this.water[i] >= draft;
    }
    navigable(x, y) { return this.navigableFor(x, y, C.MIN_DRAFT); }

    generate() {
      const rng = Canal.makeRng(this.seed);
      const noise = Canal.makeValueNoise(rng, this.cols, this.rows, 9);
      const detail = Canal.makeValueNoise(rng, this.cols, this.rows, 4);

      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          const i = this.idx(x, y);
          const nx = x / this.cols;
          const ny = y / this.rows;
          const slope = 1 - (nx * 0.55 + ny * 0.65) / 1.2;
          let h = slope * C.MAX_ELEV;
          h += (noise(x, y) - 0.5) * 6.0;
          h += (detail(x, y) - 0.5) * 2.2;
          const riverX = 0.18 + 0.5 * ny + 0.12 * Math.sin(ny * Math.PI * 2.3 + this.seed);
          const valley = Math.max(0, 1 - Math.abs(nx - riverX) * 7.0);
          h -= valley * 7.5;
          // quantise to 1 m terraces so blocky terrain stays clean (no stair-step
          // noise) and the wall count stays bounded on large maps
          this.ground[i] = Math.round(Math.max(C.MIN_GROUND, Math.min(C.MAX_ELEV, h)));
        }
      }

      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          const i = this.idx(x, y);
          const seaPull = (x / this.cols + y / this.rows) / 2;
          if (seaPull > 0.82 && this.ground[i] < C.SEA_LEVEL + 1.5) {
            this.ground[i] = Math.min(this.ground[i], C.SEA_LEVEL - 0.6);
          }
          if (this.ground[i] < C.SEA_LEVEL) this.water[i] = C.SEA_LEVEL - this.ground[i];
        }
      }

      this.placeNaturalSpring();
    }

    placeNaturalSpring() {
      let best = null;
      for (let y = 1; y < this.rows * 0.35; y++) {
        for (let x = 1; x < this.cols - 1; x++) {
          const i = this.idx(x, y);
          const h = this.ground[i];
          if (h > 9 && h < 14 && (!best || h > best.h)) best = { x, y, h, i };
        }
      }
      if (best) {
        this.struct[best.i] = STRUCT.SOURCE;
        this.sources.push({ x: best.x, y: best.y });
        this.ground[best.i] = Math.min(this.ground[best.i], C.SOURCE_LEVEL - 1.5);
      }
    }

    addSource(x, y) {
      const i = this.idx(x, y);
      if (this.struct[i] !== STRUCT.NONE) return false;
      this.struct[i] = STRUCT.SOURCE;
      this.sources.push({ x, y });
      this.ground[i] = Math.min(this.ground[i], C.SOURCE_LEVEL - 1.5);
      return true;
    }

    addDock(x, y) {
      const i = this.idx(x, y);
      if (this.struct[i] !== STRUCT.NONE) return null;
      const dock = { id: this.dockSeq++, x, y, name: 'Dock ' + this.dockSeq };
      this.struct[i] = STRUCT.DOCK;
      this.docks.push(dock);
      return dock;
    }

    dockAt(x, y) { return this.docks.find((d) => d.x === x && d.y === y) || null; }

    removeStructure(x, y) {
      const i = this.idx(x, y);
      const s = this.struct[i];
      if (s === STRUCT.NONE) return false;
      if (s === STRUCT.SOURCE) this.sources = this.sources.filter((p) => !(p.x === x && p.y === y));
      else if (s === STRUCT.DOCK) this.docks = this.docks.filter((d) => !(d.x === x && d.y === y));
      this.struct[i] = STRUCT.NONE;
      return true;
    }
  }

  Canal.World = World;
})(window.Canal);
