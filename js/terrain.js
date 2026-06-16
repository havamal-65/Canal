// World state: the tile grid plus procedural terrain generation.
(function (Canal) {
  const C = Canal.CONFIG;
  const STRUCT = Canal.STRUCT;

  class World {
    constructor(seed) {
      this.seed = seed >>> 0;
      this.cols = C.COLS;
      this.rows = C.ROWS;
      const n = this.cols * this.rows;

      this.ground = new Float32Array(n);  // terrain elevation (metres)
      this.water = new Float32Array(n);   // water depth on top of ground (metres)
      this.struct = new Uint8Array(n);    // structure type (Canal.STRUCT)
      this.lockHigh = new Int8Array(n);   // for locks: which neighbour is the high side (dir index) or -1
      this.flow = new Float32Array(n);    // recent net flow magnitude, for rendering shimmer

      this.sources = [];   // {x,y}
      this.docks = [];     // {id,x,y,name}
      this.dockSeq = 1;

      this.generate();
    }

    idx(x, y) { return y * this.cols + x; }
    inBounds(x, y) { return x >= 0 && y >= 0 && x < this.cols && y < this.rows; }
    surface(x, y) { const i = this.idx(x, y); return this.ground[i] + this.water[i]; }

    isEdge(x, y) {
      return x === 0 || y === 0 || x === this.cols - 1 || y === this.rows - 1;
    }

    // A tile a boat can occupy: enough water depth and not a solid wall.
    navigable(x, y) {
      if (!this.inBounds(x, y)) return false;
      const i = this.idx(x, y);
      if (this.struct[i] === STRUCT.WALL) return false;
      if (this.struct[i] === STRUCT.LOCK) return true; // locks bridge pounds
      return this.water[i] >= C.MIN_DRAFT;
    }

    generate() {
      const rng = Canal.makeRng(this.seed);
      const noise = Canal.makeValueNoise(rng, this.cols, this.rows, 9);
      const detail = Canal.makeValueNoise(rng, this.cols, this.rows, 4);

      // Build a landscape that slopes from a highland (top-left) down to the
      // sea (bottom-right), with a meandering river valley carved through it.
      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          const i = this.idx(x, y);
          const nx = x / this.cols;
          const ny = y / this.rows;

          // Base slope highland -> sea.
          const slope = 1 - (nx * 0.55 + ny * 0.65) / 1.2;
          let h = slope * C.MAX_ELEV;

          // Rolling hills.
          h += (noise(x, y) - 0.5) * 6.0;
          h += (detail(x, y) - 0.5) * 2.2;

          // Carve a winding river valley as a low corridor.
          const riverX = 0.18 + 0.5 * ny + 0.12 * Math.sin(ny * Math.PI * 2.3 + this.seed);
          const dist = Math.abs(nx - riverX);
          const valley = Math.max(0, 1 - dist * 7.0);
          h -= valley * 7.5;

          h = Math.max(C.MIN_GROUND, Math.min(C.MAX_ELEV, h));
          this.ground[i] = h;
        }
      }

      // Flatten an open sea in the bottom-right and pre-fill it with water.
      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          const i = this.idx(x, y);
          const ny = y / this.rows;
          const nx = x / this.cols;
          const seaPull = (nx + ny) / 2;
          if (seaPull > 0.82 && this.ground[i] < C.SEA_LEVEL + 1.5) {
            this.ground[i] = Math.min(this.ground[i], C.SEA_LEVEL - 0.6);
          }
          if (this.ground[i] < C.SEA_LEVEL) {
            this.water[i] = C.SEA_LEVEL - this.ground[i];
          }
        }
      }

      // A natural spring high up that always feeds the river head.
      this.placeNaturalSpring(rng);
    }

    placeNaturalSpring(rng) {
      // Find a high tile near the top of the river corridor to use as the source.
      let best = null;
      for (let y = 1; y < this.rows * 0.35; y++) {
        for (let x = 1; x < this.cols - 1; x++) {
          const i = this.idx(x, y);
          const h = this.ground[i];
          if (h > 9 && h < 14) {
            if (!best || h > best.h) best = { x, y, h, i };
          }
        }
      }
      if (best) {
        this.struct[best.i] = STRUCT.SOURCE;
        this.sources.push({ x: best.x, y: best.y });
        // dig a little basin so the spring has somewhere to pool
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

    dockAt(x, y) {
      return this.docks.find((d) => d.x === x && d.y === y) || null;
    }

    removeStructure(x, y) {
      const i = this.idx(x, y);
      const s = this.struct[i];
      if (s === STRUCT.NONE) return false;
      if (s === STRUCT.SOURCE) {
        this.sources = this.sources.filter((p) => !(p.x === x && p.y === y));
      } else if (s === STRUCT.DOCK) {
        this.docks = this.docks.filter((d) => !(d.x === x && d.y === y));
      }
      this.struct[i] = STRUCT.NONE;
      this.lockHigh[i] = 0;
      return true;
    }
  }

  Canal.World = World;
})(window.Canal);
