// Canal — global configuration and shared constants.
// Everything hangs off a single global namespace so the game can run from
// file:// without ES module / CORS issues (just open index.html, or serve it).
window.Canal = window.Canal || {};

Canal.CONFIG = {
  // --- Grid ---
  COLS: 64,
  ROWS: 40,
  TILE: 16,            // pixel size of a tile at zoom 1

  // --- Elevation model (metres) ---
  MAX_ELEV: 16,        // ceiling for ground height
  SEA_LEVEL: 1.2,      // the open sea sits at this surface height
  DIG_STEP: 1.0,       // metres of ground removed per dig application
  FILL_STEP: 1.0,      // metres of ground added per fill application
  MIN_GROUND: 0,

  // --- Water simulation ---
  WATER_ITER: 2,       // relaxation passes per simulation tick
  FLOW_RATE: 0.45,     // fraction of the level difference moved per pass (<0.5 keeps it stable)
  MIN_FLOW: 0.0005,    // ignore trickles smaller than this
  SOURCE_LEVEL: 12.5,  // surface height a water source maintains
  SOURCE_FEED: 0.6,    // max metres of water a source injects per tick
  LOCK_TRICKLE: 0.10,  // water a lock passes from its high pound to its low pound per tick
  EVAP: 0.0006,        // tiny evaporation so abandoned puddles dry up
  MIN_DRAFT: 0.45,     // water depth a boat needs to float / pass

  // --- Economy ---
  START_MONEY: 6000,
  COST_DIG: 8,         // per tile per dig step
  COST_FILL: 5,
  COST_LOCK: 600,
  COST_DOCK: 350,
  COST_SOURCE: 250,
  COST_BOAT: 800,      // buying a boat when a route is created
  CARGO_VALUE: 140,    // paid per delivered load

  // --- Boats ---
  BOAT_SPEED: 2.6,     // tiles per second
  LOCK_DELAY: 2.2,     // seconds a boat spends locking through
  DOCK_DELAY: 1.4,     // seconds loading / unloading at a dock

  // --- Simulation timing ---
  SIM_HZ: 30,          // fixed simulation steps per second
};

// Tile structure types
Canal.STRUCT = {
  NONE: 0,
  LOCK: 1,
  DOCK: 2,
  SOURCE: 3,
  WALL: 4,
};
