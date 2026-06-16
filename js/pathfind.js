// A* pathfinding over navigable water tiles. Lock tiles count as navigable, so
// a path can climb between two pounds that sit at different levels by routing
// through a lock.
(function (Canal) {
  const DIRS = [ [1, 0], [-1, 0], [0, 1], [0, -1] ];

  // Binary min-heap keyed on f-score.
  class Heap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(node) {
      const a = this.a; a.push(node);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].f <= a[i].f) break;
        [a[p], a[i]] = [a[i], a[p]]; i = p;
      }
    }
    pop() {
      const a = this.a; const top = a[0]; const last = a.pop();
      if (a.length) {
        a[0] = last; let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = 2 * i + 2; let s = i;
          if (l < a.length && a[l].f < a[s].f) s = l;
          if (r < a.length && a[r].f < a[s].f) s = r;
          if (s === i) break;
          [a[s], a[i]] = [a[i], a[s]]; i = s;
        }
      }
      return top;
    }
  }

  // Returns an array of {x,y} from start to goal (inclusive), or null.
  function find(world, sx, sy, gx, gy) {
    const cols = world.cols, rows = world.rows;
    const n = cols * rows;
    const startI = sy * cols + sx;
    const goalI = gy * cols + gx;
    if (startI === goalI) return [{ x: sx, y: sy }];

    const came = new Int32Array(n).fill(-1);
    const g = new Float32Array(n).fill(Infinity);
    const closed = new Uint8Array(n);
    const open = new Heap();

    const h = (x, y) => Math.abs(x - gx) + Math.abs(y - gy);
    g[startI] = 0;
    open.push({ i: startI, x: sx, y: sy, f: h(sx, sy) });

    while (open.size) {
      const cur = open.pop();
      if (closed[cur.i]) continue;
      closed[cur.i] = 1;
      if (cur.i === goalI) {
        const path = [];
        let i = goalI, x = gx, y = gy;
        while (i !== -1) {
          path.push({ x, y });
          i = came[i];
          if (i !== -1) { x = i % cols; y = (i / cols) | 0; }
        }
        return path.reverse();
      }
      for (let d = 0; d < 4; d++) {
        const nx = cur.x + DIRS[d][0], ny = cur.y + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const ni = ny * cols + nx;
        if (closed[ni]) continue;
        // Goal may be a dock tile, which is reachable from adjacent water.
        const passable = world.navigable(nx, ny) || ni === goalI;
        if (!passable) continue;
        const ng = g[cur.i] + 1;
        if (ng < g[ni]) {
          g[ni] = ng;
          came[ni] = cur.i;
          open.push({ i: ni, x: nx, y: ny, f: ng + h(nx, ny) });
        }
      }
    }
    return null;
  }

  Canal.Pathfind = { find };
})(window.Canal);
