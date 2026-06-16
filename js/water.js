// Flux-based shallow-water simulation ("virtual pipes" model).
//
// Each cell stores a water depth and four outflow fluxes (L/R/U/D). Every
// substep the fluxes are accelerated by the hydraulic-head difference with each
// neighbour (so water gains momentum and keeps flowing — real current, not just
// instant level-equalising), then clamped so a cell never gives away more than
// it holds, and finally depths are updated from net flux. Sources and the sea
// are fixed-head reservoirs; walls and (closed) lock faces block flux. This is
// what produces visible currents, fill times, and flow rates.
(function (Canal) {
  const C = Canal.CONFIG;
  const STRUCT = Canal.STRUCT;

  function applyBoundaries(w) {
    const ground = w.ground, water = w.water, struct = w.struct;
    for (const s of w.sources) {
      const i = w.idx(s.x, s.y);
      const lvl = s.level || C.SOURCE_LEVEL;
      water[i] = Math.max(0, lvl - ground[i]); // fixed-head spring (supplies and caps)
    }
    for (let i = 0; i < ground.length; i++) {
      if (ground[i] < C.SEA_LEVEL) water[i] = C.SEA_LEVEL - ground[i]; // sea boundary (sink+source)
    }
  }

  function buildPassability(w) {
    const cols = w.cols, rows = w.rows, struct = w.struct;
    const passR = w.passR, passD = w.passD;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const blocked = struct[i] === STRUCT.WALL || struct[i] === STRUCT.LOCK;
        if (x < cols - 1) {
          const j = i + 1;
          passR[i] = (blocked || struct[j] === STRUCT.WALL || struct[j] === STRUCT.LOCK) ? 0 : 1;
        } else passR[i] = 0;
        if (y < rows - 1) {
          const j = i + cols;
          passD[i] = (blocked || struct[j] === STRUCT.WALL || struct[j] === STRUCT.LOCK) ? 0 : 1;
        } else passD[i] = 0;
      }
    }
    // Open the valve faces of configured locks.
    for (const L of w.locks) {
      if (!L.configured) continue;
      openFace(w, L.cell, L.hiCell, L.valveHi);
      openFace(w, L.cell, L.loCell, L.valveLo);
    }
  }

  function openFace(w, c, other, open) {
    if (!open || other < 0) return;
    const cols = w.cols;
    if (other === c + 1) w.passR[c] = 1;
    else if (other === c - 1) w.passR[c - 1] = 1;
    else if (other === c + cols) w.passD[c] = 1;
    else if (other === c - cols) w.passD[c - cols] = 1;
  }

  function step(w) {
    const cols = w.cols, rows = w.rows, n = w.n;
    const ground = w.ground, water = w.water, struct = w.struct;
    const fL = w.fL, fR = w.fR, fU = w.fU, fD = w.fD;
    const passR = w.passR, passD = w.passD;

    buildPassability(w);

    const dt = 1 / C.SIM_HZ;
    const sub = dt / C.WATER_SUBSTEPS;
    const k = sub * C.FLOW_GAIN;
    const damp = C.FLOW_DAMP;

    for (let s = 0; s < C.WATER_SUBSTEPS; s++) {
      applyBoundaries(w);

      // 1) update + clamp fluxes
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          if (struct[i] === STRUCT.WALL) { fL[i] = fR[i] = fU[i] = fD[i] = 0; continue; }
          const si = ground[i] + water[i];

          let r = 0, l = 0, d = 0, u = 0;
          if (passR[i]) r = Math.max(0, (fR[i] + k * (si - (ground[i + 1] + water[i + 1]))) * damp);
          if (x > 0 && passR[i - 1]) l = Math.max(0, (fL[i] + k * (si - (ground[i - 1] + water[i - 1]))) * damp);
          if (passD[i]) d = Math.max(0, (fD[i] + k * (si - (ground[i + cols] + water[i + cols]))) * damp);
          if (y > 0 && passD[i - cols]) u = Math.max(0, (fU[i] + k * (si - (ground[i - cols] + water[i - cols]))) * damp);

          // never drain a cell below empty within this substep
          const out = (l + r + u + d) * sub;
          if (out > water[i] && out > 1e-9) {
            const sc = water[i] / out;
            r *= sc; l *= sc; d *= sc; u *= sc;
          }
          fR[i] = r; fL[i] = l; fD[i] = d; fU[i] = u;
        }
      }

      // 2) integrate depths from net flux
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          if (struct[i] === STRUCT.WALL) continue;
          let inflow = 0;
          if (x > 0) inflow += fR[i - 1];
          if (x < cols - 1) inflow += fL[i + 1];
          if (y > 0) inflow += fD[i - cols];
          if (y < rows - 1) inflow += fU[i + cols];
          const outflow = fL[i] + fR[i] + fU[i] + fD[i];
          water[i] += sub * (inflow - outflow);
          if (water[i] < 0) water[i] = 0;
        }
      }
    }

    applyBoundaries(w);

    // 3) smoothed velocity field for rendering (net flux through each cell)
    const vx = w.vx, vy = w.vy;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        let nx = 0, ny = 0;
        if (x > 0) nx += fR[i - 1]; if (x < cols - 1) nx -= fL[i + 1];
        nx += fR[i] - fL[i];
        if (y > 0) ny += fD[i - cols]; if (y < rows - 1) ny -= fU[i + cols];
        ny += fD[i] - fU[i];
        vx[i] += (nx * 0.5 - vx[i]) * 0.25;
        vy[i] += (ny * 0.5 - vy[i]) * 0.25;
      }
    }
  }

  Canal.Water = { step };
})(window.Canal);
