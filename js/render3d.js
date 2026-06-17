// 3D renderer (Three.js). Replaces the 2D canvas renderer. The simulation is
// unchanged — this reads world state each frame and draws it as a 3D scene:
//   - terrain as a lit, vertex-coloured heightmesh
//   - a live water surface whose vertices follow ground+water depth, tinted by
//     depth and brightened by the flow/velocity field
//   - boats, locks (with animated gates), docks and sources as meshes
//   - an orbit/pan/zoom camera and raycast picking for the build tools
//
// Loaded as an ES module; it attaches itself as Canal.Renderer before the
// classic game bootstrap runs on DOMContentLoaded.
import * as THREE from 'three';

const C = window.Canal.CONFIG;
const STRUCT = window.Canal.STRUCT;
const HS = 0.55; // vertical scale: metres -> world units

// ---- terrain colour ramp (same palette as the 2D version) ----
const RAMP = [
  [0, [70, 120, 70]], [5, [104, 132, 66]], [9, [150, 134, 84]], [12, [140, 110, 86]], [16, [156, 152, 142]],
];
function terrainColor(h, out) {
  let c = RAMP[RAMP.length - 1][1];
  for (let k = 1; k < RAMP.length; k++) {
    if (h <= RAMP[k][0]) {
      const a = RAMP[k - 1], b = RAMP[k];
      const t = (h - a[0]) / (b[0] - a[0]);
      out[0] = (a[1][0] + (b[1][0] - a[1][0]) * t) / 255;
      out[1] = (a[1][1] + (b[1][1] - a[1][1]) * t) / 255;
      out[2] = (a[1][2] + (b[1][2] - a[1][2]) * t) / 255;
      return;
    }
  }
  out[0] = c[0] / 255; out[1] = c[1] / 255; out[2] = c[2] / 255;
}

class ThreeRenderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.world = world;
    this.cols = world.cols;
    this.rows = world.rows;
    this.time = 0;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c1b2c);
    this.scene.fog = new THREE.Fog(0x0c1b2c, 90, 200);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);

    // lighting
    this.scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x40513a, 0.75));
    const sun = new THREE.DirectionalLight(0xfff3e0, 1.0);
    sun.position.set(this.cols * 0.35, 70, this.rows * 0.15);
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.18));

    this.raycaster = new THREE.Raycaster();

    this._cacheGeoMat();
    this._buildTerrain();
    this._buildWater();

    this.structures = new THREE.Group();
    this.boatsGroup = new THREE.Group();
    this.highlightGroup = new THREE.Group();
    this.scene.add(this.structures, this.boatsGroup, this.highlightGroup);

    this._initCamera();
    this._bindCameraControls();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // ---------- geometry / material cache ----------
  _cacheGeoMat() {
    this.G = {
      dock: new THREE.BoxGeometry(0.8, 0.35, 0.8),
      source: new THREE.CylinderGeometry(0.28, 0.34, 0.5, 12),
      wall: new THREE.BoxGeometry(0.92, 1.3, 0.92),
      gateV: new THREE.BoxGeometry(0.9, 1, 0.14),
      gateH: new THREE.BoxGeometry(0.14, 1, 0.9),
      chamberV: new THREE.BoxGeometry(0.16, 0.7, 1.0),
      chamberH: new THREE.BoxGeometry(1.0, 0.7, 0.16),
      hull: new THREE.BoxGeometry(0.62, 0.2, 0.34),
      cabin: new THREE.BoxGeometry(0.22, 0.16, 0.24),
      cargo: new THREE.BoxGeometry(0.26, 0.2, 0.26),
      prow: new THREE.ConeGeometry(0.17, 0.3, 4),
      highlight: new THREE.BoxGeometry(1.0, 0.12, 1.0),
    };
    this.M = {
      dock: new THREE.MeshStandardMaterial({ color: 0xb9a878, roughness: 0.85 }),
      dockPost: new THREE.MeshStandardMaterial({ color: 0x5a4a2c, roughness: 0.9 }),
      source: new THREE.MeshStandardMaterial({ color: 0x39c6ff, emissive: 0x1a5a7a, roughness: 0.4 }),
      wall: new THREE.MeshStandardMaterial({ color: 0x5a5147, roughness: 0.95 }),
      chamber: new THREE.MeshStandardMaterial({ color: 0x8a5a2e, roughness: 0.85 }),
      gate: new THREE.MeshStandardMaterial({ color: 0x3c2a16, roughness: 0.8 }),
      hull: new THREE.MeshStandardMaterial({ color: 0x7a4a2a, roughness: 0.7 }),
      hullIdle: new THREE.MeshStandardMaterial({ color: 0x8a4a4a, roughness: 0.7 }),
      cabin: new THREE.MeshStandardMaterial({ color: 0xb98a52, roughness: 0.7 }),
      cargo: new THREE.MeshStandardMaterial({ color: 0xe0b343, roughness: 0.6 }),
      hlOk: new THREE.MeshBasicMaterial({ color: 0x2ec4b6, transparent: true, opacity: 0.4 }),
      hlBad: new THREE.MeshBasicMaterial({ color: 0xe63946, transparent: true, opacity: 0.4 }),
    };
  }

  // ---------- terrain ----------
  vertexGround(i, j) {
    const w = this.world, cols = this.cols, rows = this.rows;
    let s = 0, n = 0;
    for (const [ci, cj] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) {
      if (ci >= 0 && cj >= 0 && ci < cols && cj < rows) { s += w.ground[cj * cols + ci]; n++; }
    }
    return n ? s / n : 0;
  }

  _gridGeometry() {
    const cols = this.cols, rows = this.rows;
    const vw = cols + 1, vh = rows + 1;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vw * vh * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vw * vh * 3), 3));
    const idx = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = j * vw + i, b = a + 1, c = a + vw, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    geo.setIndex(idx);
    return geo;
  }

  _buildTerrain() {
    const cols = this.cols, rows = this.rows, vw = cols + 1;
    const geo = this._gridGeometry();
    const pos = geo.attributes.position.array, col = geo.attributes.color.array;
    const rgb = [0, 0, 0];
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const g = this.vertexGround(i, j);
        const k = (j * vw + i) * 3;
        pos[k] = i; pos[k + 1] = g * HS; pos[k + 2] = j;
        terrainColor(g, rgb);
        col[k] = rgb[0]; col[k + 1] = rgb[1]; col[k + 2] = rgb[2];
      }
    }
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.0 });
    this.terrainMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.terrainMesh);
  }

  // call when terrain heights change (dig/fill)
  refreshTerrain() {
    const cols = this.cols, rows = this.rows, vw = cols + 1;
    const geo = this.terrainMesh.geometry;
    const pos = geo.attributes.position.array, col = geo.attributes.color.array;
    const rgb = [0, 0, 0];
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const g = this.vertexGround(i, j);
        const k = (j * vw + i) * 3;
        pos[k + 1] = g * HS;
        terrainColor(g, rgb);
        col[k] = rgb[0]; col[k + 1] = rgb[1]; col[k + 2] = rgb[2];
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.computeVertexNormals();
  }

  // ---------- water ----------
  _buildWater() {
    this.waterGeo = this._gridGeometry();
    // lay out the X/Z grid once (updateWater only moves Y each frame)
    const cols = this.cols, rows = this.rows, vw = cols + 1;
    const pos = this.waterGeo.attributes.position.array;
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) { const k = (j * vw + i) * 3; pos[k] = i; pos[k + 1] = 0; pos[k + 2] = j; }
    }
    this.waterGeo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, transparent: true, opacity: 0.95,
      roughness: 0.3, metalness: 0.0, side: THREE.DoubleSide,
      emissive: 0x0a2238, emissiveIntensity: 0.6,
    });
    this.waterMesh = new THREE.Mesh(this.waterGeo, mat);
    this.scene.add(this.waterMesh);
  }

  updateWater() {
    const w = this.world, cols = this.cols, rows = this.rows, vw = cols + 1;
    const pos = this.waterGeo.attributes.position.array;
    const col = this.waterGeo.attributes.color.array;
    const t = this.time;
    const shallow = [0.22, 0.55, 0.88], deep = [0.06, 0.28, 0.62];
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        // gather the up-to-4 cells around this vertex
        let depth = 0, surfSum = 0, surfN = 0, gSum = 0, gN = 0, vel = 0;
        for (const [ci, cj] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) {
          if (ci < 0 || cj < 0 || ci >= cols || cj >= rows) continue;
          const id = cj * cols + ci;
          gSum += w.ground[id]; gN++;
          const d = w.water[id];
          if (d > depth) depth = d;
          if (d > 0.04) { surfSum += w.ground[id] + d; surfN++; vel += Math.hypot(w.vx[id], w.vy[id]); }
        }
        const k = (j * vw + i) * 3;
        const gAvg = gN ? gSum / gN : 0;
        if (depth > 0.05 && surfN) {
          const surf = surfSum / surfN;
          const ripple = Math.sin(t * 1.6 + (i + j) * 0.6) * 0.025 + Math.sin(t * 2.3 + i * 0.5) * 0.02;
          pos[k + 1] = surf * HS + ripple;
          const dn = Math.min(depth / 3, 1);
          const sp = Math.min((vel / surfN) * 8, 0.4);
          col[k] = shallow[0] + (deep[0] - shallow[0]) * dn + sp * 0.25;
          col[k + 1] = shallow[1] + (deep[1] - shallow[1]) * dn + sp * 0.3;
          col[k + 2] = shallow[2] + (deep[2] - shallow[2]) * dn + sp * 0.35;
        } else {
          // dry: tuck the water surface just under the terrain so it's hidden
          pos[k + 1] = gAvg * HS - 0.25;
          col[k] = deep[0]; col[k + 1] = deep[1]; col[k + 2] = deep[2];
        }
      }
    }
    this.waterGeo.attributes.position.needsUpdate = true;
    this.waterGeo.attributes.color.needsUpdate = true;
    this.waterGeo.computeVertexNormals();
  }

  // ---------- structures, boats, highlight ----------
  cellCenter(idx) { return { x: (idx % this.cols) + 0.5, z: Math.floor(idx / this.cols) + 0.5 }; }
  cellTopY(cx, cy) { const w = this.world; const i = cy * this.cols + cx; return (w.ground[i] + Math.max(0, w.water[i])) * HS; }

  rebuildStructures() {
    const w = this.world, cols = this.cols, rows = this.rows;
    this.structures.clear();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const s = w.struct[i];
        if (s === STRUCT.NONE || s === STRUCT.LOCK) continue;
        const gx = x + 0.5, gz = y + 0.5, gy = w.ground[i] * HS;
        if (s === STRUCT.DOCK) {
          const m = new THREE.Mesh(this.G.dock, this.M.dock);
          m.position.set(gx, gy + 0.17, gz); this.structures.add(m);
        } else if (s === STRUCT.SOURCE) {
          const m = new THREE.Mesh(this.G.source, this.M.source);
          m.position.set(gx, gy + 0.25, gz); this.structures.add(m);
        } else if (s === STRUCT.WALL) {
          const m = new THREE.Mesh(this.G.wall, this.M.wall);
          m.position.set(gx, gy + 0.65, gz); this.structures.add(m);
        }
      }
    }
    for (const L of w.locks) if (L.configured) this._addLock(L);
  }

  _addLock(L) {
    const w = this.world;
    const lc = this.cellCenter(L.cell);
    const lockGroundY = w.ground[L.cell] * HS;
    const axisV = L.axis === 'V';
    // chamber side walls along the channel
    const wall1 = new THREE.Mesh(axisV ? this.G.chamberV : this.G.chamberH, this.M.chamber);
    const wall2 = new THREE.Mesh(axisV ? this.G.chamberV : this.G.chamberH, this.M.chamber);
    const off = 0.45;
    if (axisV) { wall1.position.set(lc.x - off, lockGroundY + 0.35, lc.z); wall2.position.set(lc.x + off, lockGroundY + 0.35, lc.z); }
    else { wall1.position.set(lc.x, lockGroundY + 0.35, lc.z - off); wall2.position.set(lc.x, lockGroundY + 0.35, lc.z + off); }
    this.structures.add(wall1, wall2);
    // two gates
    this._addGate(L, L.hiCell, L.gateHi, axisV, lockGroundY);
    this._addGate(L, L.loCell, L.gateLo, axisV, lockGroundY);
  }

  _addGate(L, neighborCell, openness, axisV, lockGroundY) {
    const lc = this.cellCenter(L.cell), nc = this.cellCenter(neighborCell);
    const cx = (lc.x + nc.x) / 2, cz = (lc.z + nc.z) / 2;
    const hiSurf = this.world.surfaceI(L.hiCell);
    const fullH = Math.max(0.5, (hiSurf - this.world.ground[L.cell] + 0.4) * HS);
    const h = fullH * (1 - openness * 0.9); // gate sinks as it opens
    const m = new THREE.Mesh(axisV ? this.G.gateV : this.G.gateH, this.M.gate);
    m.scale.y = h;
    m.position.set(cx, lockGroundY + h / 2, cz);
    this.structures.add(m);
  }

  rebuildBoats(boatMgr) {
    this.boatsGroup.clear();
    for (const b of boatMgr.boats) {
      const cx = Math.max(0, Math.min(this.cols - 1, Math.round(b.x)));
      const cy = Math.max(0, Math.min(this.rows - 1, Math.round(b.y)));
      const y = this.cellTopY(cx, cy) + 0.04;
      const g = new THREE.Group();
      const hull = new THREE.Mesh(this.G.hull, b.idle ? this.M.hullIdle : this.M.hull);
      g.add(hull);
      const prow = new THREE.Mesh(this.G.prow, b.idle ? this.M.hullIdle : this.M.hull);
      prow.rotation.z = -Math.PI / 2; prow.position.set(0.36, 0, 0); g.add(prow);
      if (b.cargo) { const c = new THREE.Mesh(this.G.cargo, this.M.cargo); c.position.y = 0.16; g.add(c); }
      else { const cab = new THREE.Mesh(this.G.cabin, this.M.cabin); cab.position.set(-0.12, 0.13, 0); g.add(cab); }
      g.position.set(b.x + 0.5, y, b.y + 0.5);
      g.rotation.y = -b.heading;
      this.boatsGroup.add(g);
    }
  }

  rebuildHighlight(view) {
    this.highlightGroup.clear();
    if (!view || view.hoverX < 0) return;
    const r = view.brush;
    const mat = view.valid ? this.M.hlOk : this.M.hlBad;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = view.hoverX + dx, y = view.hoverY + dy;
        if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) continue;
        const m = new THREE.Mesh(this.G.highlight, mat);
        m.position.set(x + 0.5, this.cellTopY(x, y) + 0.12, y + 0.5);
        this.highlightGroup.add(m);
      }
    }
  }

  // ---------- camera ----------
  _initCamera() {
    this.target = new THREE.Vector3(this.cols / 2, 0, this.rows / 2);
    this.radius = Math.max(this.cols, this.rows) * 1.15;
    this.theta = -Math.PI / 4; // azimuth
    this.phi = 0.95;           // polar (from vertical)
    this._applyCamera();
  }

  _applyCamera() {
    const r = this.radius, st = Math.sin(this.phi), ct = Math.cos(this.phi);
    this.camera.position.set(
      this.target.x + r * st * Math.sin(this.theta),
      this.target.y + r * ct,
      this.target.z + r * st * Math.cos(this.theta),
    );
    this.camera.lookAt(this.target);
  }

  _bindCameraControls() {
    const el = this.canvas;
    let dragging = null, lx = 0, ly = 0;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('mousedown', (e) => {
      if (e.button === 2) dragging = 'orbit';
      else if (e.button === 1) { dragging = 'pan'; e.preventDefault(); }
      else return;
      lx = e.clientX; ly = e.clientY;
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
      if (dragging === 'orbit') {
        this.theta -= dx * 0.005;
        this.phi = Math.max(0.15, Math.min(1.45, this.phi - dy * 0.005));
      } else {
        const s = this.radius * 0.0016;
        const fwd = new THREE.Vector3(Math.sin(this.theta), 0, Math.cos(this.theta));
        const right = new THREE.Vector3(Math.cos(this.theta), 0, -Math.sin(this.theta));
        this.target.addScaledVector(right, -dx * s).addScaledVector(fwd, -dy * s);
      }
      this._applyCamera();
    });
    window.addEventListener('mouseup', () => { dragging = null; });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.radius = Math.max(6, Math.min(180, this.radius * (1 + Math.sign(e.deltaY) * 0.1)));
      this._applyCamera();
    }, { passive: false });
  }

  resize() {
    const el = this.canvas;
    const w = el.clientWidth || el.parentElement.clientWidth || 800;
    const h = el.clientHeight || el.parentElement.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- picking (for build tools) ----------
  pickTile(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.terrainMesh, false)[0];
    if (!hit) return { x: -1, y: -1 };
    const gx = Math.floor(hit.point.x), gy = Math.floor(hit.point.z);
    if (gx < 0 || gy < 0 || gx >= this.cols || gy >= this.rows) return { x: -1, y: -1 };
    return { x: gx, y: gy };
  }

  // ---------- per-frame ----------
  draw(boatMgr, view, dt) {
    this.time += dt;
    if (this._terrainDirty) { this.refreshTerrain(); this._terrainDirty = false; }
    this.updateWater();
    this.rebuildStructures();
    this.rebuildBoats(boatMgr);
    this.rebuildHighlight(view);
    this.renderer.render(this.scene, this.camera);
  }

  markTerrainDirty() { this._terrainDirty = true; }
}

window.Canal.Renderer = ThreeRenderer;
