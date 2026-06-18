// Locks — channel-spanning, manager-driven.
//
// A lock occupies a line of cells spanning the full width of the channel it's
// placed in. Those cells are the chamber; the cells just up- and down-stream
// are the high and low pounds. The lock cells are solid barriers in the water
// sim, and this manager drives the chamber water directly: it raises/lowers a
// single chamber level and moves the corresponding volume to/from the pounds,
// so every cycle still consumes a chamber-ful of water downhill. Boats pass
// through along any column; the gates and chamber render across the whole width.
(function (Canal) {
  const C = Canal.CONFIG;
  const STRUCT = Canal.STRUCT;
  const opp = (s) => (s === 'hi' ? 'lo' : 'hi');

  class LockManager {
    constructor(world) { this.world = world; }

    build(x, y) {
      const w = this.world, c = w.idx(x, y);
      if (w.struct[c] !== STRUCT.NONE) return false;
      const geo = this.detectChannel(x, y);
      const lock = {
        x, y,
        cells: geo.cells, hiCells: geo.hiCells, loCells: geo.loCells,
        axis: geo.axis, spanDir: geo.spanDir, flowDir: geo.flowDir,
        configured: true,
        state: 'open_lo', chamberLevel: 0,
        gateHi: 0, gateLo: 1,
        occupant: null, occupantSide: null, goalSide: null, occupantRiding: false, queue: [],
      };
      const li = w.locks.length;
      w.locks.push(lock);
      for (const cell of lock.cells) { w.struct[cell] = STRUCT.LOCK; w.lockOf[cell] = li; }
      // excavate a flat chamber floor low enough to drain to the low pound
      let floor = Infinity;
      for (const cc of lock.hiCells.concat(lock.loCells)) if (cc >= 0) floor = Math.min(floor, w.ground[cc]);
      if (!isFinite(floor)) floor = w.ground[c];
      for (const cell of lock.cells) w.ground[cell] = floor;
      lock.chamberLevel = this.loLevel(lock);
      this.setChamber(lock);
      this.rebuildBridges();
      return true;
    }

    // Work out the lock geometry from one clicked cell:
    //  - flow axis: the direction with a clear height step (a lock bridging two
    //    pounds), or, on flat ground, the longer run of dug "channel" cells;
    //  - span: extend perpendicular across the channel while the up/down-stream
    //    neighbours stay at the channel floor (bounded by the banks).
    detectChannel(x, y) {
      const w = this.world, cols = w.cols, rows = w.rows, g0 = w.ground[w.idx(x, y)];
      const G = (cx, cy) => (cx < 0 || cy < 0 || cx >= cols || cy >= rows) ? Infinity : w.ground[cy * cols + cx];
      const step = (dx, dy) => {
        const a = G(x + dx, y + dy), b = G(x - dx, y - dy);
        return Math.abs((a === Infinity ? g0 : a) - (b === Infinity ? g0 : b));
      };
      const stepH = step(1, 0), stepV = step(0, 1);
      const low = (cx, cy) => { const g = G(cx, cy); return g !== Infinity && g <= g0 + 1.0; };
      const run = (dx, dy) => {
        let n = 1, cx = x + dx, cy = y + dy;
        while (low(cx, cy)) { n++; cx += dx; cy += dy; }
        cx = x - dx; cy = y - dy;
        while (low(cx, cy)) { n++; cx -= dx; cy -= dy; }
        return n;
      };
      let flowDir;
      if (Math.max(stepH, stepV) > 1.0) flowDir = stepH >= stepV ? [1, 0] : [0, 1];
      else flowDir = run(1, 0) >= run(0, 1) ? [1, 0] : [0, 1];
      const spanDir = flowDir[0] !== 0 ? [0, 1] : [1, 0];
      const gp = G(x + flowDir[0], y + flowDir[1]), gm = G(x - flowDir[0], y - flowDir[1]);
      const hiSign = (gp === Infinity ? -Infinity : gp) >= (gm === Infinity ? -Infinity : gm) ? 1 : -1;
      const gHi = G(x + flowDir[0] * hiSign, y + flowDir[1] * hiSign);
      const gLo = G(x - flowDir[0] * hiSign, y - flowDir[1] * hiSign);
      const validSpan = (qx, qy) => {
        if (qx < 0 || qy < 0 || qx >= cols || qy >= rows) return false;
        const i = qy * cols + qx;
        if (w.struct[i] === STRUCT.WALL || w.struct[i] === STRUCT.LOCK) return false;
        const ghi = G(qx + flowDir[0] * hiSign, qy + flowDir[1] * hiSign);
        const glo = G(qx - flowDir[0] * hiSign, qy - flowDir[1] * hiSign);
        return ghi !== Infinity && glo !== Infinity && ghi <= gHi + 1.0 && glo <= gLo + 1.0;
      };
      const cells = [w.idx(x, y)];
      for (const s of [1, -1]) {
        let cx = x + spanDir[0] * s, cy = y + spanDir[1] * s;
        while (validSpan(cx, cy)) { cells.push(cy * cols + cx); cx += spanDir[0] * s; cy += spanDir[1] * s; }
      }
      cells.sort((a, b) => a - b);
      const inb = (ax, ay) => (ax >= 0 && ay >= 0 && ax < cols && ay < rows) ? ay * cols + ax : -1;
      const hiCells = [], loCells = [];
      for (const cell of cells) {
        const cx = cell % cols, cy = (cell / cols) | 0;
        hiCells.push(inb(cx + flowDir[0] * hiSign, cy + flowDir[1] * hiSign));
        loCells.push(inb(cx - flowDir[0] * hiSign, cy - flowDir[1] * hiSign));
      }
      return { cells, hiCells, loCells, axis: flowDir[0] !== 0 ? 'H' : 'V', spanDir, flowDir };
    }

    remove(x, y) {
      const w = this.world, idx = w.lockOf[w.idx(x, y)];
      if (idx < 0) return false;
      const lock = w.locks[idx];
      w.locks.splice(idx, 1);
      w.lockOf.fill(-1);
      for (let k = 0; k < w.locks.length; k++) for (const cc of w.locks[k].cells) w.lockOf[cc] = k;
      for (const cc of lock.cells) if (w.struct[cc] === STRUCT.LOCK) w.struct[cc] = STRUCT.NONE;
      this.rebuildBridges();
      return true;
    }

    lockAt(cell) { const i = this.world.lockOf[cell]; return i < 0 ? null : this.world.locks[i]; }

    rebuildBridges() {
      const w = this.world;
      w.lockBridges.clear();
      const add = (from, to, L, chamber) => {
        if (from < 0 || to < 0) return;
        let arr = w.lockBridges.get(from); if (!arr) { arr = []; w.lockBridges.set(from, arr); }
        arr.push({ opp: to, lock: L, chamber });
      };
      for (const L of w.locks) {
        if (!L.configured) continue;
        for (let k = 0; k < L.cells.length; k++) {
          add(L.hiCells[k], L.loCells[k], L, L.cells[k]);
          add(L.loCells[k], L.hiCells[k], L, L.cells[k]);
        }
      }
    }

    // ---- water bookkeeping ----
    surfAvg(arr) {
      const w = this.world; let s = 0, n = 0;
      for (const cc of arr) if (cc >= 0) { s += w.ground[cc] + w.water[cc]; n++; }
      return n ? s / n : 0;
    }
    hiLevel(L) { return this.surfAvg(L.hiCells); }
    loLevel(L) { return this.surfAvg(L.loCells); }
    chamberVol(L, level) {
      const w = this.world; let v = 0;
      for (const cell of L.cells) v += Math.max(0, level - w.ground[cell]);
      return v;
    }
    setChamber(L) {
      const w = this.world;
      for (const cell of L.cells) w.water[cell] = Math.max(0, L.chamberLevel - w.ground[cell]);
    }
    spread(cells, vol, sign) {
      const w = this.world; const live = cells.filter((c) => c >= 0); if (!live.length) return;
      const per = vol / live.length;
      for (const cc of live) w.water[cc] = Math.max(0, w.water[cc] + sign * per);
    }
    moveChamber(L, target, dt) {
      const rate = C.LOCK_FILL_RATE * dt, old = L.chamberLevel;
      L.chamberLevel = L.chamberLevel < target ? Math.min(target, L.chamberLevel + rate) : Math.max(target, L.chamberLevel - rate);
      const dVol = this.chamberVol(L, L.chamberLevel) - this.chamberVol(L, old);
      if (dVol > 0) this.spread(L.hiCells, dVol, -1);       // fill: take from the high pound
      else if (dVol < 0) this.spread(L.loCells, -dVol, 1);  // empty: give to the low pound
      this.setChamber(L);
    }

    update(dt) {
      for (const L of this.world.locks) {
        if (!L.configured) continue;
        this.updateLock(L, dt);
        this.animateGates(L, dt);
      }
    }

    updateLock(L, dt) {
      const hi = this.hiLevel(L), lo = this.loLevel(L), EPS = C.LOCK_LEVEL_EPS;
      switch (L.state) {
        case 'open_lo': L.chamberLevel = lo; this.setChamber(L); this.handleOpen(L, 'lo'); break;
        case 'open_hi': L.chamberLevel = hi; this.setChamber(L); this.handleOpen(L, 'hi'); break;
        case 'filling': this.moveChamber(L, hi, dt); if (L.chamberLevel >= hi - EPS) L.state = 'open_hi'; break;
        case 'emptying': this.moveChamber(L, lo, dt); if (L.chamberLevel <= lo + EPS) L.state = 'open_lo'; break;
      }
      if (hi > lo + 0.001) { const m = Math.min(C.LOCK_LEAK * dt, 0.5); this.spread(L.hiCells, m, -1); this.spread(L.loCells, m, 1); }
    }

    gate(L, side) { return side === 'hi' ? L.gateHi : L.gateLo; }

    // ---- boat-facing protocol (one occupant at a time) ----
    requestEntry(L, boat, side) {
      if (L.occupant === boat) return;
      const e = L.queue.find((q) => q.boat === boat);
      if (e) e.side = side; else L.queue.push({ boat, side });
    }
    cancelRequest(L, boat) {
      L.queue = L.queue.filter((q) => q.boat !== boat);
      if (L.occupant === boat) { L.occupant = null; L.occupantRiding = false; }
    }
    isAdmitted(L, boat) { return L.occupant === boat; }
    notifyRiding(L, boat) { if (L.occupant === boat) L.occupantRiding = true; }
    canExit(L, boat) {
      return L.occupant === boat && L.occupantRiding && L.state === 'open_' + L.goalSide && this.gate(L, L.goalSide) >= 0.95;
    }
    notifyExited(L, boat) {
      if (L.occupant === boat) { L.occupant = null; L.occupantRiding = false; L.occupantSide = null; L.goalSide = null; }
    }

    handleOpen(L, side) {
      if (L.occupant) {
        if (!L.occupantRiding) return;
        if (L.goalSide === side) return;
        L.state = L.goalSide === 'hi' ? 'filling' : 'emptying';
        return;
      }
      const here = L.queue.find((q) => q.side === side);
      if (here) {
        if (this.gate(L, side) >= 0.95) {
          L.queue = L.queue.filter((q) => q !== here);
          L.occupant = here.boat; L.occupantSide = side; L.goalSide = opp(side); L.occupantRiding = false;
        }
        return;
      }
      const far = L.queue.find((q) => q.side === opp(side));
      if (far) L.state = opp(side) === 'hi' ? 'filling' : 'emptying';
    }

    animateGates(L, dt) {
      const speed = dt / C.LOCK_GATE_TIME;
      const hiT = L.state === 'open_hi' ? 1 : 0, loT = L.state === 'open_lo' ? 1 : 0;
      L.gateHi += Math.sign(hiT - L.gateHi) * Math.min(speed, Math.abs(hiT - L.gateHi));
      L.gateLo += Math.sign(loT - L.gateLo) * Math.min(speed, Math.abs(loT - L.gateLo));
    }
  }

  Canal.LockManager = LockManager;
})(window.Canal);
