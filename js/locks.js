// Locks — genuine lock operation, not a fixed delay.
//
// A lock is a one-cell chamber bridging an UPPER pound and a LOWER pound along
// its axis. It has two gates (hi/lo) and two sluice valves. The water sim moves
// water through whichever valve is open, so the chamber really fills from the
// upper pound and empties into the lower one — and every cycle therefore spends
// a chamber-ful of water downhill (the constraint that forces summit feeding).
//
// Cycle for a boat going UP:  enter on lo side (chamber low, lo gate open) →
//   close gates, open hi valve → chamber fills, boat rises → hi gate opens →
//   boat exits up. Going DOWN is the mirror. With no boat the chamber can also
//   cycle empty to reposition for a boat waiting on the far side (also costs a
//   chamber-ful) — exactly like a real lock.
(function (Canal) {
  const C = Canal.CONFIG;
  const STRUCT = Canal.STRUCT;

  const opp = (s) => (s === 'hi' ? 'lo' : 'hi');

  class LockManager {
    constructor(world) {
      this.world = world;
    }

    build(x, y) {
      const w = this.world;
      const cell = w.idx(x, y);
      if (w.struct[cell] !== STRUCT.NONE) return false;
      w.struct[cell] = STRUCT.LOCK;
      const lock = {
        cell, x, y,
        configured: false,
        axis: 'H',
        hiCell: -1, loCell: -1,
        valveHi: false, valveLo: false,
        state: 'open_lo',
        gateHi: 0, gateLo: 1,
        occupant: null, occupantSide: null, goalSide: null, occupantRiding: false,
        queue: [],
      };
      w.locks.push(lock);
      w.lockOf[cell] = w.locks.length - 1;
      this.resolveGeometry(lock);
      this.rebuildBridges();
      return true;
    }

    remove(x, y) {
      const w = this.world;
      const cell = w.idx(x, y);
      const idx = w.lockOf[cell];
      if (idx < 0) return false;
      w.locks.splice(idx, 1);
      w.lockOf.fill(-1);
      for (let k = 0; k < w.locks.length; k++) w.lockOf[w.locks[k].cell] = k;
      w.struct[cell] = STRUCT.NONE;
      this.rebuildBridges();
      return true;
    }

    lockAt(cell) {
      const i = this.world.lockOf[cell];
      return i < 0 ? null : this.world.locks[i];
    }

    // Decide the lock's axis and which neighbour is the upper / lower pound,
    // using channel-floor ground height (stable across water fluctuations).
    resolveGeometry(L) {
      const w = this.world, c = L.cell, cols = w.cols;
      const pairs = [];
      const consider = (a, b, axis) => {
        if (a < 0 || b < 0) return;
        if (w.struct[a] === STRUCT.WALL || w.struct[a] === STRUCT.LOCK) return;
        if (w.struct[b] === STRUCT.WALL || w.struct[b] === STRUCT.LOCK) return;
        const diff = Math.abs(w.ground[a] - w.ground[b]);
        const wet = (w.water[a] > 0.05 ? 1 : 0) + (w.water[b] > 0.05 ? 1 : 0);
        pairs.push({ a, b, axis, diff, wet });
      };
      if (L.x > 0 && L.x < cols - 1) consider(c - 1, c + 1, 'H');
      if (L.y > 0 && L.y < w.rows - 1) consider(c - cols, c + cols, 'V');
      if (!pairs.length) { L.configured = false; L.hiCell = L.loCell = -1; return; }
      pairs.sort((p, q) => (q.wet - p.wet) || (q.diff - p.diff));
      const best = pairs[0];
      L.axis = best.axis;
      if (w.ground[best.a] >= w.ground[best.b]) { L.hiCell = best.a; L.loCell = best.b; }
      else { L.hiCell = best.b; L.loCell = best.a; }
      // Excavate the chamber floor to the lower channel bottom so it can
      // equalise with both pounds (fill up to the upper, drain to the lower).
      w.ground[L.cell] = Math.min(w.ground[L.hiCell], w.ground[L.loCell]);
      L.configured = true;
    }

    rebuildBridges() {
      const w = this.world;
      w.lockBridges.clear();
      const add = (from, opp, L) => {
        let arr = w.lockBridges.get(from);
        if (!arr) { arr = []; w.lockBridges.set(from, arr); }
        arr.push({ opp, lock: L });
      };
      for (const L of w.locks) {
        if (!L.configured) continue;
        add(L.hiCell, L.loCell, L);
        add(L.loCell, L.hiCell, L);
      }
    }

    gate(L, side) { return side === 'hi' ? L.gateHi : L.gateLo; }

    // ---- boat-facing protocol ----
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
      return L.occupant === boat && L.occupantRiding &&
        L.state === 'open_' + L.goalSide && this.gate(L, L.goalSide) >= 0.95;
    }
    notifyExited(L, boat) {
      if (L.occupant === boat) { L.occupant = null; L.occupantRiding = false; L.occupantSide = null; L.goalSide = null; }
    }

    update(dt) {
      for (const L of this.world.locks) {
        if (!L.configured) { this.resolveGeometry(L); }
        if (L.configured) this.updateLock(L, dt);
        this.animateGates(L, dt);
      }
    }

    updateLock(L, dt) {
      const w = this.world;
      const cs = w.surfaceI(L.cell);
      const his = w.surfaceI(L.hiCell);
      const los = w.surfaceI(L.loCell);
      const EPS = C.LOCK_LEVEL_EPS;

      switch (L.state) {
        case 'filling':
          L.valveHi = true; L.valveLo = false;
          if (cs >= his - EPS) L.state = 'open_hi';
          break;
        case 'emptying':
          L.valveLo = true; L.valveHi = false;
          if (cs <= los + EPS) L.state = 'open_lo';
          break;
        case 'open_hi':
          L.valveHi = true; L.valveLo = false;
          this.handleOpen(L, 'hi');
          break;
        case 'open_lo':
          L.valveLo = true; L.valveHi = false;
          this.handleOpen(L, 'lo');
          break;
      }

      // Closed locks leak a little downhill, so lower pounds gradually fill and
      // a long canal stays watered from its summit supply.
      if (his > los + 0.001) {
        const m = Math.min(C.LOCK_LEAK * dt, w.water[L.hiCell], his - los);
        if (m > 0) { w.water[L.hiCell] -= m; w.water[L.loCell] += m; }
      }
    }

    handleOpen(L, side) {
      if (L.occupant) {
        if (!L.occupantRiding) return; // boat still gliding into the chamber
        if (L.goalSide === side) return; // arrived; boat will exit itself
        L.state = L.goalSide === 'hi' ? 'filling' : 'emptying';
        return;
      }
      // No occupant: admit a boat waiting on this side, else reposition for one
      // waiting on the far side (an empty cycle, which also costs water).
      const here = L.queue.find((q) => q.side === side);
      if (here) {
        if (this.gate(L, side) >= 0.95) {
          L.queue = L.queue.filter((q) => q !== here);
          L.occupant = here.boat;
          L.occupantSide = side;
          L.goalSide = opp(side);
          L.occupantRiding = false;
        }
        return;
      }
      const far = L.queue.find((q) => q.side === opp(side));
      if (far) L.state = opp(side) === 'hi' ? 'filling' : 'emptying';
    }

    animateGates(L, dt) {
      const speed = dt / C.LOCK_GATE_TIME;
      // Targets: gate open only when its side is the open state.
      const hiTarget = L.state === 'open_hi' ? 1 : 0;
      const loTarget = L.state === 'open_lo' ? 1 : 0;
      L.gateHi += Math.sign(hiTarget - L.gateHi) * Math.min(speed, Math.abs(hiTarget - L.gateHi));
      L.gateLo += Math.sign(loTarget - L.gateLo) * Math.min(speed, Math.abs(loTarget - L.gateLo));
    }
  }

  Canal.LockManager = LockManager;
})(window.Canal);
