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

You start with a procedurally generated landscape that slopes from a highland
(top‑left) down to the sea (bottom‑right). A natural **spring** at the top of
the map feeds the river. Your job is to move cargo by water and get paid for it.

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

## Design notes

The "realistic water flow" is a stable cellular relaxation: every tick each
tile diffuses water toward equal surface height with its neighbours, so water
levels out, pools, and spills naturally. The sea is a fixed boundary that drains
inflow, sources inject water up to a maintained level, and locks act as barriers
that keep two pounds at different heights while passing boats — exactly why real
canals need them.
