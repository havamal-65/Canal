// Canal — global configuration and shared constants.
// Single global namespace so the game runs from file:// without modules.
window.Canal = window.Canal || {};

Canal.CONFIG = {
  // --- Grid ---
  COLS: 64,
  ROWS: 40,
  TILE: 16,

  // --- Elevation model (metres) ---
  MAX_ELEV: 16,
  SEA_LEVEL: 1.2,
  SOURCE_LEVEL: 12.5,
  DIG_STEP: 1.0,
  FILL_STEP: 1.0,
  MIN_GROUND: 0,

  // --- Water simulation (flux / shallow-water "virtual pipes" model) ---
  SIM_HZ: 30,
  WATER_SUBSTEPS: 6,    // flux substeps per sim tick (stability + speed)
  FLOW_GAIN: 16.0,      // g*A/l — how strongly head differences accelerate flow
  FLOW_DAMP: 0.992,     // per-substep flux damping (lower = livelier current/sloshing)
  MIN_DEPTH: 0.001,     // ignore films thinner than this for flow
  MIN_DRAFT: 0.45,      // default depth a boat needs to float

  // --- Locks ---
  LOCK_LEVEL_EPS: 0.08, // chamber considered "level" with a pound within this
  LOCK_GATE_TIME: 0.7,  // seconds for a gate to open/close
  LOCK_FILL_RATE: 2.0,  // m/s the chamber level rises/falls while cycling
  LOCK_LEAK: 0.03,      // m/s of water a lock leaks downhill (self-fills pounds)
  LOCK_PATH_COST: 6,    // A* penalty for routing through a lock (prefer open water)

  // --- Boats ---
  BOAT_SPEED: 2.6,      // tiles/second
  BOAT_DRAFT: 0.5,      // depth this boat needs
  DOCK_DELAY: 1.4,      // seconds loading/unloading
  BOAT_ENTER_TIME: 0.6, // seconds to glide into/out of a lock chamber
  BLOCK_TIMEOUT: 4.0,   // seconds stuck behind traffic before forcing a move
};

Canal.STRUCT = {
  NONE: 0,
  LOCK: 1,
  DOCK: 2,
  SOURCE: 3,
  WALL: 4,
};
