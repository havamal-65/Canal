// Boats, routes, traffic, and lock transit.
//
// A boat shuttles cargo between two docks. It pathfinds over water for its
// draft, follows other boats without overlapping (one-tile-ahead reservation
// with a deadlock breaker), queues at locks, and rides a full lock cycle to
// change level. Re-routes when its water changes.
(function (Canal) {
  const C = Canal.CONFIG;
  const STRUCT = Canal.STRUCT;
  const DIRS = [ [1, 0], [-1, 0], [0, 1], [0, -1] ];
  const opp = (s) => (s === 'hi' ? 'lo' : 'hi');

  function navWaterNeighbor(world, dock, draft) {
    for (const [dx, dy] of DIRS) {
      const x = dock.x + dx, y = dock.y + dy;
      if (world.navigableFor(x, y, draft)) return { x, y };
    }
    return null;
  }

  class BoatManager {
    constructor(world, economy, lockMgr) {
      this.world = world;
      this.economy = economy;
      this.lockMgr = lockMgr;
      this.routes = [];
      this.boats = [];
      this.occ = new Map(); // cell -> boat (held or reserved)
      this.routeSeq = 1;
    }

    addRoute(dockA, dockB) {
      const route = { id: this.routeSeq++, a: dockA, b: dockB, trips: 0 };
      this.routes.push(route);
      const draft = C.BOAT_DRAFT;
      const spawn = navWaterNeighbor(this.world, dockA, draft) || { x: dockA.x, y: dockA.y };
      const boat = {
        route, draft, cargo: false, state: 'toPickup',
        x: spawn.x, y: spawn.y, cell: this.world.idx(spawn.x, spawn.y),
        path: null, pi: 1, goalX: -1, goalY: -1, repath: true, retry: 0, pathAge: 0,
        wait: 0, idle: false, heading: 0, blockTimer: 0,
        cross: null,
      };
      this.occ.set(boat.cell, boat);
      this.boats.push(boat);
      return route;
    }

    removeRoute(route) {
      this.routes = this.routes.filter((r) => r !== route);
      for (const b of this.boats) if (b.route === route) this.freeBoat(b);
      this.boats = this.boats.filter((b) => b.route !== route);
    }

    pruneRoutes() {
      const live = new Set(this.world.docks);
      for (const r of [...this.routes]) if (!live.has(r.a) || !live.has(r.b)) this.removeRoute(r);
    }

    freeBoat(b) {
      if (b.cell >= 0 && this.occ.get(b.cell) === b) this.occ.delete(b.cell);
      if (b.cross) this.lockMgr.cancelRequest(b.cross.lock, b);
    }

    setCell(b, cell) {
      if (b.cell >= 0 && this.occ.get(b.cell) === b) this.occ.delete(b.cell);
      b.cell = cell;
      if (cell >= 0) this.occ.set(cell, b);
    }

    goalDock(b) { return (b.state === 'toPickup' || b.state === 'loading') ? b.route.a : b.route.b; }

    setLeg(b, state) { b.state = state; b.path = null; b.repath = true; }

    update(dt) {
      for (const b of this.boats) this.stepBoat(b, dt);
    }

    stepBoat(b, dt) {
      if (b.state === 'loading' || b.state === 'unloading') {
        b.wait -= dt;
        if (b.wait <= 0) {
          if (b.state === 'loading') { b.cargo = true; this.setLeg(b, 'toDrop'); }
          else { this.economy.deliver(); b.route.trips++; b.cargo = false; this.setLeg(b, 'toPickup'); }
        }
        return;
      }

      if (b.cross) { this.stepCross(b, dt); return; }

      const world = this.world;
      const dock = this.goalDock(b);
      const goal = navWaterNeighbor(world, dock, b.draft);
      if (!goal) { b.idle = true; return; }

      this.ensurePath(b, goal, dt);
      if (!b.path) { b.idle = true; return; }
      b.idle = false;

      if (b.pi >= b.path.length) { this.arrive(b); return; }

      const target = b.path[b.pi];
      const curCell = world.idx(Math.round(b.x), Math.round(b.y));
      const ti = world.idx(target.x, target.y);

      // Lock crossing: hi/lo pound cells are 2 apart with the lock between.
      const bridge = this.bridgeStep(curCell, ti);
      if (bridge) { this.startCross(b, bridge, ti); return; }

      const goalCell = world.idx(goal.x, goal.y);
      if (ti !== goalCell && !world.navigableFor(target.x, target.y, b.draft)) { b.repath = true; return; }

      // Traffic: reserve the next cell before entering it.
      const o = this.occ.get(ti);
      if (o && o !== b) {
        b.blockTimer += dt;
        if (b.blockTimer < C.BLOCK_TIMEOUT) return; // wait behind traffic
        // deadlock breaker: force through after waiting too long
      } else {
        b.blockTimer = 0;
        this.occ.set(ti, b); // reserve
      }

      this.moveToward(b, target, dt, ti);
    }

    ensurePath(b, goal, dt) {
      const world = this.world;
      b.pathAge += dt;
      const needs = b.repath || !b.path || b.goalX !== goal.x || b.goalY !== goal.y || b.pathAge > 2.5;
      if (!needs) return;
      if (!b.path && b.retry > 0) { b.retry -= dt; if (b.retry > 0) return; }
      const p = Canal.Pathfind.find(world, Math.round(b.x), Math.round(b.y), goal.x, goal.y, b.draft);
      if (p) { b.path = p; b.pi = 1; b.goalX = goal.x; b.goalY = goal.y; b.repath = false; b.pathAge = 0; }
      else { b.path = null; b.retry = 0.7; }
    }

    moveToward(b, target, dt, ti) {
      const dx = target.x - b.x, dy = target.y - b.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-4) b.heading = Math.atan2(dy, dx);
      const step = C.BOAT_SPEED * dt;
      if (dist <= step || dist < 0.01) {
        b.x = target.x; b.y = target.y;
        this.setCell(b, ti);
        b.blockTimer = 0;
        b.pi++;
        if (b.pi >= b.path.length) this.arrive(b);
      } else {
        b.x += (dx / dist) * step; b.y += (dy / dist) * step;
      }
    }

    bridgeStep(curCell, ti) {
      const arr = this.world.lockBridges.get(curCell);
      if (!arr) return null;
      for (const br of arr) if (br.opp === ti && br.lock.configured) return br;
      return null;
    }

    startCross(b, bridge, oppCell) {
      const L = bridge.lock;
      const curCell = this.world.idx(Math.round(b.x), Math.round(b.y));
      const entrySide = curCell === L.hiCell ? 'hi' : 'lo';
      b.cross = { lock: L, entrySide, oppCell, phase: 'request' };
      this.stepCross(b, 0);
    }

    stepCross(b, dt) {
      const lm = this.lockMgr, world = this.world;
      const L = b.cross.lock;
      if (!L.configured) { lm.cancelRequest(L, b); b.cross = null; b.repath = true; return; }

      switch (b.cross.phase) {
        case 'request':
          lm.requestEntry(L, b, b.cross.entrySide);
          b.cross.phase = 'await';
          return;
        case 'await':
          b.idle = true;
          if (lm.isAdmitted(L, b)) { b.idle = false; b.cross.phase = 'enter'; }
          return;
        case 'enter':
          if (this.glideTo(b, L.x, L.y, dt)) {
            this.setCell(b, L.cell);
            lm.notifyRiding(L, b);
            b.cross.phase = 'ride';
          }
          return;
        case 'ride':
          if (lm.canExit(L, b)) b.cross.phase = 'exit';
          return;
        case 'exit': {
          const ox = b.cross.oppCell % world.cols, oy = (b.cross.oppCell / world.cols) | 0;
          // A boat in the lock has priority. Wait for the far cell to clear, but
          // if a boat queued to enter is squatting on it, push out after a
          // timeout so the waiter gives way (breaks the head-on lock conflict).
          const occ = this.occ.get(b.cross.oppCell);
          if (occ && occ !== b) {
            b.cross.exitWait = (b.cross.exitWait || 0) + dt;
            if (b.cross.exitWait < C.BLOCK_TIMEOUT) return;
          }
          if (this.glideTo(b, ox, oy, dt)) {
            b.cross.exitWait = 0;
            lm.notifyExited(L, b);
            this.setCell(b, b.cross.oppCell);
            b.pi++; // advance past the bridge target in the path
            b.cross = null;
            if (b.pi >= b.path.length) this.arrive(b);
          }
          return;
        }
      }
    }

    glideTo(b, tx, ty, dt) {
      const dx = tx - b.x, dy = ty - b.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-4) b.heading = Math.atan2(dy, dx);
      const step = dt / C.BOAT_ENTER_TIME; // one tile over BOAT_ENTER_TIME seconds
      if (dist <= step || dist < 0.01) { b.x = tx; b.y = ty; return true; }
      b.x += (dx / dist) * step; b.y += (dy / dist) * step;
      return false;
    }

    arrive(b) {
      if (b.state === 'toPickup') { this.setLeg(b, 'loading'); b.wait = C.DOCK_DELAY; }
      else if (b.state === 'toDrop') { this.setLeg(b, 'unloading'); b.wait = C.DOCK_DELAY; }
    }
  }

  Canal.BoatManager = BoatManager;
  Canal.navWaterNeighbor = navWaterNeighbor;
})(window.Canal);
