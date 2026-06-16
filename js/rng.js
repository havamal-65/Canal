// Small seeded RNG + value-noise helper used for terrain generation.
(function (Canal) {
  // Mulberry32 — compact, deterministic PRNG.
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Smooth value noise over a grid, built by bilinearly interpolating a coarse
  // lattice of random values. Returns a function (x, y) -> [0,1].
  function makeValueNoise(rng, cols, rows, cellSize) {
    const gc = Math.ceil(cols / cellSize) + 2;
    const gr = Math.ceil(rows / cellSize) + 2;
    const lattice = new Float32Array(gc * gr);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rng();

    function smooth(t) { return t * t * (3 - 2 * t); } // smoothstep

    return function (x, y) {
      const gx = x / cellSize;
      const gy = y / cellSize;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = smooth(gx - x0);
      const fy = smooth(gy - y0);
      const v00 = lattice[y0 * gc + x0];
      const v10 = lattice[y0 * gc + x0 + 1];
      const v01 = lattice[(y0 + 1) * gc + x0];
      const v11 = lattice[(y0 + 1) * gc + x0 + 1];
      const top = v00 + (v10 - v00) * fx;
      const bot = v01 + (v11 - v01) * fx;
      return top + (bot - top) * fy;
    };
  }

  Canal.makeRng = makeRng;
  Canal.makeValueNoise = makeValueNoise;
})(window.Canal);
