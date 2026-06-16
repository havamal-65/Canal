// Built-in demo scenario: two bodies of water at different heights connected by
// two lock channels (boats lock UP the left channel and DOWN the right one),
// with three boats running the loop continuously — bottom lake → up through the
// lock → top lake → down through the lock → bottom lake → repeat.
(function (Canal) {
  const C = Canal.CONFIG;
  const STRUCT = Canal.STRUCT;

  function buildScenario(game) {
    const w = game.world, lm = game.lockMgr, bm = game.boatMgr;
    const idx = (x, y) => w.idx(x, y);

    // --- wipe the world to high, dry land ---
    for (let i = 0; i < w.n; i++) { w.ground[i] = 14; w.water[i] = 0; w.struct[i] = 0; }
    w.fL.fill(0); w.fR.fill(0); w.fU.fill(0); w.fD.fill(0); w.vx.fill(0); w.vy.fill(0);
    w.sources = []; w.docks = []; w.dockSeq = 1;
    w.locks = []; w.lockOf.fill(-1); w.lockBridges.clear();
    bm.routes = []; bm.boats = []; bm.occ = new Map();

    const TOP_LEVEL = 11, TOP_G = 7, TOP_W = TOP_LEVEL - TOP_G; // top pound surface 11
    const BOT_LEVEL = 6, BOT_G = 3, BOT_W = BOT_LEVEL - BOT_G;  // bottom pound surface 6

    const rect = (x0, x1, y0, y1, g, water) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = idx(x, y); w.ground[i] = g; w.water[i] = water; w.struct[i] = 0;
      }
    };

    // two bodies of water at different heights
    rect(8, 56, 4, 14, TOP_G, TOP_W);   // top lake (high)
    rect(8, 56, 26, 36, BOT_G, BOT_W);  // bottom lake (low)

    // two 3-wide connecting channels, pinched to one cell at the lock so boats
    // funnel through it. Top half sits in the upper pound, bottom half in the
    // lower pound; the lock bridges the step.
    const channel = (cx) => {
      for (let dx = -1; dx <= 1; dx++) {
        for (let y = 15; y <= 19; y++) { const i = idx(cx + dx, y); w.ground[i] = TOP_G; w.water[i] = TOP_W; }
        for (let y = 21; y <= 25; y++) { const i = idx(cx + dx, y); w.ground[i] = BOT_G; w.water[i] = BOT_W; }
      }
      // row 20: only the lock cell (cx) is passable; sides stay land
    };
    channel(12); // left channel — boats lock UP here
    channel(52); // right channel — boats lock DOWN here

    // spring clusters feeding each pound to its level
    for (let x = 30; x <= 34; x++) { w.struct[idx(x, 4)] = STRUCT.SOURCE; w.sources.push({ x, y: 4, level: TOP_LEVEL }); }
    for (let x = 30; x <= 34; x++) { w.struct[idx(x, 36)] = STRUCT.SOURCE; w.sources.push({ x, y: 36, level: BOT_LEVEL }); }

    // locks (vertical: upper pound above, lower pound below)
    lm.build(12, 20);
    lm.build(52, 20);

    // four corner docks forming the loop
    const dBL = w.addDock(7, 30);   // bottom-left
    const dTL = w.addDock(7, 8);    // top-left
    const dTR = w.addDock(57, 8);   // top-right
    const dBR = w.addDock(57, 30);  // bottom-right

    // one circuit route, three boats spaced around it
    bm.addRoute([dBL, dTL, dTR, dBR], 3);
  }

  Canal.buildScenario = buildScenario;
})(window.Canal);
