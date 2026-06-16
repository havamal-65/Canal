// Boats and routes. A route ties a pickup dock to a drop-off dock; its boat
// shuttles between them, loading cargo, climbing through any locks on the way,
// and getting paid on delivery.
(function (Canal) {
  const C = Canal.CONFIG;
  const STRUCT = Canal.STRUCT;
  const DIRS = [ [1, 0], [-1, 0], [0, 1], [0, -1] ];

  function navWaterNeighbor(world, dock) {
    for (const [dx, dy] of DIRS) {
      const x = dock.x + dx, y = dock.y + dy;
      if (world.navigable(x, y)) return { x, y };
    }
    return null;
  }

  class BoatManager {
    constructor(world, economy) {
      this.world = world;
      this.economy = economy;
      this.routes = [];
      this.boats = [];
      this.routeSeq = 1;
    }

    addRoute(dockA, dockB) {
      const route = {
        id: this.routeSeq++,
        a: dockA,
        b: dockB,
        trips: 0,
      };
      this.routes.push(route);
      const spawn = navWaterNeighbor(this.world, dockA) || { x: dockA.x, y: dockA.y };
      this.boats.push({
        route,
        state: 'toPickup',
        cargo: false,
        x: spawn.x,
        y: spawn.y,
        path: null,
        pi: 1,
        goalX: -1,
        goalY: -1,
        repath: true,
        wait: 0,
        lockWait: 0,
        retry: 0,
        idle: false,
        locked: new Set(),
        heading: 0,
      });
      return route;
    }

    removeRoute(route) {
      this.routes = this.routes.filter((r) => r !== route);
      this.boats = this.boats.filter((b) => b.route !== route);
    }

    // Drop any routes that reference a dock that no longer exists.
    pruneRoutes() {
      const live = new Set(this.world.docks);
      for (const r of [...this.routes]) {
        if (!live.has(r.a) || !live.has(r.b)) this.removeRoute(r);
      }
    }

    goalDock(boat) {
      return (boat.state === 'toPickup' || boat.state === 'loading') ? boat.route.a : boat.route.b;
    }

    setLeg(boat, state) {
      boat.state = state;
      boat.path = null;
      boat.repath = true;
      boat.locked.clear();
    }

    update(dt) {
      for (const boat of this.boats) this.stepBoat(boat, dt);
    }

    stepBoat(boat, dt) {
      if (boat.state === 'loading' || boat.state === 'unloading') {
        boat.wait -= dt;
        if (boat.wait <= 0) {
          if (boat.state === 'loading') {
            boat.cargo = true;
            this.setLeg(boat, 'toDrop');
          } else {
            this.economy.deliver();
            boat.route.trips++;
            boat.cargo = false;
            this.setLeg(boat, 'toPickup');
          }
        }
        return;
      }

      const world = this.world;
      const dock = this.goalDock(boat);
      const goal = navWaterNeighbor(world, dock);
      if (!goal) { boat.idle = true; return; }

      if (boat.repath || !boat.path || boat.goalX !== goal.x || boat.goalY !== goal.y) {
        boat.retry -= dt;
        if (boat.retry > 0 && boat.path === null && !boat.repath) { boat.idle = true; return; }
        const path = Canal.Pathfind.find(world, Math.round(boat.x), Math.round(boat.y), goal.x, goal.y);
        boat.path = path;
        boat.pi = 1;
        boat.goalX = goal.x;
        boat.goalY = goal.y;
        boat.repath = false;
        if (!path) { boat.idle = true; boat.retry = 0.7; return; }
      }
      boat.idle = false;

      if (boat.lockWait > 0) { boat.lockWait -= dt; return; }

      if (!boat.path || boat.pi >= boat.path.length) { this.arrive(boat); return; }

      const target = boat.path[boat.pi];
      if (!world.navigable(target.x, target.y)) { boat.repath = true; return; }

      const dx = target.x - boat.x;
      const dy = target.y - boat.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.0001) boat.heading = Math.atan2(dy, dx);
      const stepDist = C.BOAT_SPEED * dt;

      if (dist <= stepDist || dist < 0.01) {
        boat.x = target.x;
        boat.y = target.y;
        const ti = world.idx(target.x, target.y);
        if (world.struct[ti] === STRUCT.LOCK && !boat.locked.has(ti)) {
          boat.locked.add(ti);
          boat.lockWait = C.LOCK_DELAY;
        }
        boat.pi++;
        if (boat.pi >= boat.path.length) this.arrive(boat);
      } else {
        boat.x += (dx / dist) * stepDist;
        boat.y += (dy / dist) * stepDist;
      }
    }

    arrive(boat) {
      if (boat.state === 'toPickup') {
        this.setLeg(boat, 'loading');
        boat.wait = C.DOCK_DELAY;
      } else if (boat.state === 'toDrop') {
        this.setLeg(boat, 'unloading');
        boat.wait = C.DOCK_DELAY;
      }
    }
  }

  Canal.BoatManager = BoatManager;
  Canal.navWaterNeighbor = navWaterNeighbor;
})(window.Canal);
