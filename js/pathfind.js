// A* over navigable water. Normal moves are 4-connected open-water steps; a
// boat can additionally cross a lock via a "bridge" edge that jumps from the
// lock's upper pound cell to its lower pound cell (and back) at extra cost.
// Navigability is per-boat (draft), so deep boats avoid shallow channels.
(function (Canal) {
  const C = Canal.CONFIG;
  const DIRS = [ [1, 0], [-1, 0], [0, 1], [0, -1] ];

  class Heap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(node) {
      const a = this.a; a.push(node);
      let i = a.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
    }
    pop() {
      const a = this.a; const top = a[0]; const last = a.pop();
      if (a.length) {
        a[0] = last; let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = 2 * i + 2; let s = i;
          if (l < a.length && a[l].f < a[s].f) s = l;
          if (r < a.length && a[r].f < a[s].f) s = r;
          if (s === i) break; [a[s], a[i]] = [a[i], a[s]]; i = s;
        }
      }
      return top;
    }
  }

  function find(world, sx, sy, gx, gy, draft) {
    draft = draft || C.MIN_DRAFT;
    const cols = world.cols, n = world.n;
    const startI = sy * cols + sx;
    const goalI = gy * cols + gx;
    if (startI === goalI) return [{ x: sx, y: sy }];

    const came = new Int32Array(n).fill(-1);
    const g = new Float32Array(n).fill(Infinity);
    const closed = new Uint8Array(n);
    const open = new Heap();
    const h = (x, y) => Math.abs(x - gx) + Math.abs(y - gy);

    const passable = (x, y, i) => i === goalI || world.navigableFor(x, y, draft);

    g[startI] = 0;
    open.push({ i: startI, x: sx, y: sy, f: h(sx, sy) });

    while (open.size) {
      const cur = open.pop();
      if (closed[cur.i]) continue;
      closed[cur.i] = 1;
      if (cur.i === goalI) {
        const path = [];
        let i = goalI, x = gx, y = gy;
        while (i !== -1) { path.push({ x, y }); i = came[i]; if (i !== -1) { x = i % cols; y = (i / cols) | 0; } }
        return path.reverse();
      }
      const relax = (ni, nx, ny, cost) => {
        if (closed[ni]) return;
        const ng = g[cur.i] + cost;
        if (ng < g[ni]) { g[ni] = ng; came[ni] = cur.i; open.push({ i: ni, x: nx, y: ny, f: ng + h(nx, ny) }); }
      };
      for (let d = 0; d < 4; d++) {
        const nx = cur.x + DIRS[d][0], ny = cur.y + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= world.rows) continue;
        const ni = ny * cols + nx;
        if (passable(nx, ny, ni)) relax(ni, nx, ny, 1);
      }
      const bridges = world.lockBridges.get(cur.i);
      if (bridges) {
        for (const b of bridges) {
          const nx = b.opp % cols, ny = (b.opp / cols) | 0;
          if (passable(nx, ny, b.opp)) relax(b.opp, nx, ny, C.LOCK_PATH_COST);
        }
      }
    }
    return null;
  }

  Canal.Pathfind = { find };
})(window.Canal);
