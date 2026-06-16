# Canal

A canal‑building transportation **tycoon** game for PC. Dig waterways, harness
realistic water flow, build locks to lift boats between canal levels, set up
docks and routes, and run a profitable freight network.

The whole game runs in the browser with no build step or dependencies — it's
plain HTML5 Canvas + JavaScript.

## Running it

**Easiest:** just open `index.html` in any modern browser (double‑click it).

**Recommended (serve locally)** so everything loads cleanly:

```bash
cd Canal
python3 -m http.server 8000
# then open http://localhost:8000 in your browser
```

## How to play

The game **boots into a demo loop** so you can immediately watch the systems
work: a **high lake** and a **low lake** joined by two single‑lane lock channels.
Three boats run the circuit continuously — up through the left lock into the top
lake, across, down through the right lock into the bottom lake, and round again —
so you can see the lock chambers fill and empty as each boat passes. You can
keep building your own canals on top of it with the tools.

The underlying sandbox is a procedurally generated landscape that slopes from a
highland down to the sea, fed by a **spring**. Your job is to move cargo by water
and get paid for it.

The loop:

1. **Dig** (`1`) a channel from a water source or the river. Water seeks its own
   level, pools in your trench, and spills over low ground — so dig a connected,
   level "pound" for boats to float in.
2. **Build a Lock** (`3`) where a canal needs to change height. A lock holds the
   two pounds apart at different levels and lifts boats between them; it also
   passes a trickle of water downhill to keep the lower pound topped up. This is
   the heart of canal engineering — to climb a hill, you build a flight of locks
   rather than digging through it.
3. **Build Docks** (`4`) beside navigable water at the places you want to connect.
4. **Open a Route** (`6`): click a pickup dock, then a destination dock. A boat is
   purchased and starts shuttling cargo. Each delivery pays you.
5. Watch your **income** climb and reinvest in more canals, locks, and routes.

### Tools

| Key | Tool | What it does |
|-----|------|--------------|
| `1` | Dig | Lower terrain to carve channels (click & drag) |
| `2` | Fill | Raise terrain to build banks / wall off water |
| `3` | Lock | Lift boats between pounds at different levels |
| `4` | Dock | Loading/unloading point beside water |
| `5` | Water Source | A spring that feeds a canal from up high |
| `6` | Route + Boat | Link two docks and buy a boat to run between them |
| `7` | Bulldoze | Remove a structure |
| `8` | Inspect | Read a tile's ground height, water depth, etc. |
| `Space` | — | Pause / resume |

Brush size and game speed are set with the buttons in the toolbar / top bar.

### Tips

- A tile is **navigable** only when the water is deep enough (the inspector tells
  you). If a boat shows a red `!`, it can't find a watered path to its dock —
  dig a connection or check your locks.
- Below sea level, land fills to the sea automatically (the water table). Above
  sea level you need a source or a lock feeding water in.
- Keep pounds **level**: a long flat channel holds water far better than one that
  runs downhill, which just drains to the sea.

## Project layout

```
index.html        markup + HUD/toolbar/inspector
css/style.css     styling
js/config.js      tunable constants (grid, costs, water/boat params)
js/rng.js         seeded RNG + value noise for terrain
js/terrain.js     World state and procedural terrain generation
js/water.js       cellular water‑flow simulation (sources, sea, locks, drainage)
js/pathfind.js    A* over navigable water (routes through locks)
js/boats.js       boats, routes, cargo, lock/dock timing
js/economy.js     money, costs, income
js/render.js      canvas rendering
js/input.js       tools, brush, route building, inspector
js/game.js        main loop (fixed‑timestep sim + rAF render) and HUD
```

## Design notes — the three hard systems

These are the parts that make the game what it is, so they're modelled properly
rather than faked.

**1. Flow-based water (`js/water.js`).** A shallow-water "virtual pipes" model:
every cell holds a depth plus four outflow fluxes, and each substep those fluxes
are *accelerated* by the hydraulic-head difference with each neighbour, then
clamped so no cell over-drains. Because flux carries momentum across frames you
get real **current** — rivers flow downhill with measurable velocity, channels
have throughput, and a freshly dug canal takes time to fill. The sea and springs
are fixed-head reservoirs (the sea drains inflow; springs supply it). Hover a
tile to read its flow rate; the animated streaks on the water show direction.

**2. Real locks (`js/locks.js`).** A lock is a one-cell chamber bridging an upper
and a lower pound, with two gates and two sluice valves driven by a state
machine. Crucially, the water sim moves water through whichever valve is open, so
the chamber genuinely **fills from the upper pound and empties into the lower
one** — meaning *every lock cycle spends a chamber-ful of water downhill*. That's
the real engineering constraint: a busy lock drains its summit, so you must feed
it from springs/reservoirs or boats get stranded. Closed locks also leak a little
downhill, which is how lower pounds first fill. Going up: enter low, gates close,
chamber fills, you rise, top gate opens, exit high (and the mirror going down).

**3. Boat navigation & traffic (`js/boats.js`, `js/pathfind.js`).** A* routes
over water for each boat's **draft** (deep boats avoid shallow channels) and can
cross a lock via a bridge edge between its two pounds. Boats reserve the cell
ahead so they **follow without overlapping**, **queue** at a busy lock (one boat
locks through at a time), and a boat inside a lock has right of way — a deadlock
breaker lets it push out past a boat squatting on the exit. Boats re-route when
their water changes. Single-lane canals serialise traffic; dig wider or add
passing places for throughput.
