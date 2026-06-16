// Water simulation: a stable cellular flow model.
//
// Each tile has a ground height and a water depth; the "surface" is their sum.
// Every tick water relaxes toward equal surface levels with its neighbours, so
// it seeks its own level, pools in dug trenches, and spills over low walls.
// Locks and walls are barriers that block this equalisation — which is exactly
// what lets two canal "pounds" sit at different levels with a boat lift between
// them. Locks pass a small trickle downhill to keep lower pounds topped up.
(function (Canal) {
  const C = Canal.CONFIG;
  const STRUCT = Canal.STRUCT;
  const DIRS = [ [1, 0], [-1, 0], [0, 1], [0, -1] ];

  function isBarrier(w, i) {
    const s = w.struct[i];
    return s === STRUCT.WALL || s === STRUCT.LOCK;
  }

  function step(w) {
    const cols = w.cols, rows = w.rows;
    const ground = w.ground, water = w.water, struct = w.struct;

    // 1. Sources inject water up to their maintained level.
    for (const s of w.sources) {
      const i = w.idx(s.x, s.y);
      const target = C.SOURCE_LEVEL - ground[i];
      if (water[i] < target) {
        water[i] = Math.min(target, water[i] + C.SOURCE_FEED);
      }
    }

    // 2. The sea / water table acts as a fixed boundary: any ground below sea
    //    level is pinned to exactly sea level. This makes the sea an infinite
    //    sink that absorbs river inflow (draining it) and never floods, as well
    //    as a source that keeps below-sea land at the water table.
    for (let i = 0; i < ground.length; i++) {
      if (ground[i] < C.SEA_LEVEL) {
        water[i] = C.SEA_LEVEL - ground[i];
      }
    }

    // 3. Relaxation passes — diffuse water toward level surfaces.
    const delta = w._delta || (w._delta = new Float32Array(ground.length));
    for (let pass = 0; pass < C.WATER_ITER; pass++) {
      delta.fill(0);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          if (isBarrier(w, i)) continue;
          const wi = water[i];
          if (wi <= C.MIN_FLOW) continue;
          const si = ground[i] + wi;

          // Gather outflow to lower, non-barrier neighbours.
          let total = 0;
          let f0 = 0, f1 = 0, f2 = 0, f3 = 0;
          for (let d = 0; d < 4; d++) {
            const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const j = ny * cols + nx;
            if (isBarrier(w, j)) continue;
            const diff = si - (ground[j] + water[j]);
            if (diff > C.MIN_FLOW) {
              const f = diff * C.FLOW_RATE;
              if (d === 0) f0 = f; else if (d === 1) f1 = f; else if (d === 2) f2 = f; else f3 = f;
              total += f;
            }
          }
          if (total <= 0) continue;
          // Never give away more than we hold (keeps depth non-negative).
          let scale = total > wi ? wi / total : 1;
          for (let d = 0; d < 4; d++) {
            const f = d === 0 ? f0 : d === 1 ? f1 : d === 2 ? f2 : f3;
            if (f <= 0) continue;
            const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
            const j = ny * cols + nx;
            const m = f * scale;
            delta[i] -= m;
            delta[j] += m;
          }
        }
      }
      for (let i = 0; i < delta.length; i++) {
        if (delta[i] !== 0) {
          water[i] += delta[i];
          if (water[i] < 0) water[i] = 0;
          // record flow magnitude for the render shimmer
          const m = delta[i] < 0 ? -delta[i] : delta[i];
          if (m > w.flow[i]) w.flow[i] = m;
        }
      }
    }

    // 4. Locks: hold their pounds apart, show water, and trickle downhill.
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (struct[i] !== STRUCT.LOCK) continue;
        // The high side must actually hold water (the supply); the low side is
        // chosen by surface even if it is still dry, so a fresh lower pound can
        // start to fill instead of being stuck empty forever.
        let hiJ = -1, loJ = -1, hiS = -Infinity, loS = Infinity;
        for (let d = 0; d < 4; d++) {
          const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const j = ny * cols + nx;
          if (struct[j] === STRUCT.WALL) continue;
          const s = ground[j] + water[j];
          const supplies = water[j] > 0.02 || struct[j] === STRUCT.SOURCE;
          if (supplies && s > hiS) { hiS = s; hiJ = j; }
          if (s < loS) { loS = s; loJ = j; }
        }
        if (hiJ < 0) { water[i] = 0; continue; }
        // Visible water in the lock chamber.
        water[i] = Math.max(C.MIN_DRAFT + 0.15, Math.min(3, hiS - ground[i]));
        // Trickle from the high pound to the low pound.
        if (loJ >= 0 && hiJ !== loJ && hiS - loS > 0.05) {
          let m = Math.min(C.LOCK_TRICKLE, water[hiJ], hiS - loS);
          if (m > 0) { water[hiJ] -= m; water[loJ] += m; }
        }
      }
    }

    // 5. Edges drain off-map; gentle evaporation dries abandoned puddles.
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (w.isEdge(x, y)) {
          const cap = Math.max(0, C.SEA_LEVEL - ground[i] + 0.2);
          if (water[i] > cap) water[i] = cap + (water[i] - cap) * 0.4;
        }
        if (ground[i] >= C.SEA_LEVEL && struct[i] !== STRUCT.SOURCE && water[i] > 0) {
          water[i] = Math.max(0, water[i] - C.EVAP);
        }
        // decay the shimmer record
        w.flow[i] *= 0.86;
      }
    }
  }

  Canal.Water = { step };
})(window.Canal);
