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

// soft radial sprite for spray/foam points
function makeSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

// A narrowboat hull: a pointed top-view outline extruded downward.
function makeHull() {
  const s = new THREE.Shape();
  s.moveTo(0.46, 0);
  s.lineTo(0.30, 0.15);
  s.lineTo(-0.36, 0.15);
  s.lineTo(-0.46, 0.06);
  s.lineTo(-0.46, -0.06);
  s.lineTo(-0.36, -0.15);
  s.lineTo(0.30, -0.15);
  s.lineTo(0.46, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: false });
  g.rotateX(Math.PI / 2); // outline flat in XZ, hull extends downward
  g.computeVertexNormals();
  return g;
}

// Additive-blended point particles: spray (kind 0, gravity) and foam (kind 1,
// drifts on the surface). A ring buffer recycles the oldest particles.
class Spray {
  constructor(scene, max) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.ttl = new Float32Array(max);
    this.kind = new Uint8Array(max);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -999;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo = geo;
    const mat = new THREE.PointsMaterial({
      size: 0.5, map: makeSprite(), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, vertexColors: true, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
    this.cursor = 0;
  }

  spawn(x, y, z, vx, vy, vz, ttl, kind) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = ttl; this.ttl[i] = ttl; this.kind[i] = kind;
  }

  update(dt) {
    const g = 9.0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -999; this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      this.life[i] -= dt;
      if (this.kind[i] === 0) this.vel[i * 3 + 1] -= g * dt; // spray arcs and falls
      else { this.vel[i * 3] *= 0.96; this.vel[i * 3 + 2] *= 0.96; } // foam drifts and slows
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = Math.max(0, this.life[i] / this.ttl[i]);
      const b = f * (this.kind[i] === 0 ? 1.0 : 0.7);
      this.col[i * 3] = b * 0.9; this.col[i * 3 + 1] = b * 0.96; this.col[i * 3 + 2] = b;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

// A decoupled damped-wave field for surface ripples (boat wakes, lock churn).
// Purely visual — read by the water mesh for extra surface height; it never
// touches the gameplay simulation, so it can't destabilise boats or locks.
class RippleField {
  constructor(cols, rows) {
    this.cols = cols; this.rows = rows;
    const n = cols * rows;
    this.h = new Float32Array(n);
    this.v = new Float32Array(n);
  }
  disturb(x, y, amount) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    this.v[y * this.cols + x] += amount;
  }
  step(dt, world) {
    const cols = this.cols, rows = this.rows, h = this.h, v = this.v;
    const sdt = Math.min(dt, 1 / 45);
    const c2 = 5.5;                       // wave speed^2
    const damp = Math.pow(0.93, dt * 60); // velocity damping
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const i = y * cols + x;
        if (world.water[i] < 0.05) { h[i] *= 0.4; v[i] *= 0.4; continue; }
        const lap = h[i - 1] + h[i + 1] + h[i - cols] + h[i + cols] - 4 * h[i];
        v[i] += lap * c2 * sdt;
      }
    }
    for (let i = 0; i < h.length; i++) {
      v[i] *= damp;
      h[i] += v[i] * sdt;
      if (h[i] > 1.6) h[i] = 1.6; else if (h[i] < -1.6) h[i] = -1.6;
    }
  }
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
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xbcd2ea);
    this.scene.fog = new THREE.Fog(0xc4d6ec, 120, 280);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);

    // lighting (tuned for ACES tone mapping)
    this.scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x4a5a3a, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2dc, 2.3);
    sun.position.set(this.cols * 0.55, 85, this.rows * 0.28);
    sun.target.position.set(this.cols / 2, 0, this.rows / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    const span = Math.max(this.cols, this.rows) * 0.62;
    sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span;
    sc.near = 1; sc.far = 280;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.5;
    this.scene.add(sun, sun.target);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.1));
    this.sunDir = sun.position.clone().normalize();
    this._buildSky();

    this.raycaster = new THREE.Raycaster();

    this._cacheGeoMat();
    this._buildTerrain();
    this._buildWater();

    this.structures = new THREE.Group();
    this.boatsGroup = new THREE.Group();
    this.highlightGroup = new THREE.Group();
    this.scene.add(this.structures, this.boatsGroup, this.highlightGroup);
    this.spray = new Spray(this.scene, 1500);
    this.ripple = new RippleField(this.cols, this.rows);

    this._initCamera();
    this._bindCameraControls();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // procedural gradient sky dome (also what the water reflects)
  _buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uSunDir: { value: this.sunDir } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        precision highp float;
        varying vec3 vDir; uniform vec3 uSunDir;
        vec3 skyColor(vec3 d, vec3 sun){
          float t = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(vec3(0.82, 0.88, 0.97), vec3(0.20, 0.45, 0.80), smoothstep(0.0, 0.6, t));
          float sd = max(dot(normalize(d), normalize(sun)), 0.0);
          col += vec3(1.0, 0.92, 0.74) * pow(sd, 220.0) * 1.4;
          col += vec3(1.0, 0.86, 0.62) * pow(sd, 12.0) * 0.18;
          return col;
        }
        void main(){
          gl_FragColor = vec4(skyColor(normalize(vDir), uSunDir), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), mat);
    this.skyDome.frustumCulled = false;
    this.scene.add(this.skyDome);
  }

  // ---------- geometry / material cache ----------
  _cacheGeoMat() {
    this.G = {
      dock: new THREE.BoxGeometry(0.8, 0.35, 0.8),
      source: new THREE.CylinderGeometry(0.28, 0.34, 0.5, 12),
      wall: new THREE.BoxGeometry(0.92, 1.3, 0.92),
      leaf: (() => { const g = new THREE.BoxGeometry(0.9, 1, 0.13); g.translate(0.45, 0, 0); return g; })(),
      gateUnit: (() => { const g = new THREE.BoxGeometry(1, 1, 0.18); g.translate(0.5, 0, 0); return g; })(),
      chamberV: new THREE.BoxGeometry(0.16, 0.7, 1.0),
      chamberH: new THREE.BoxGeometry(1.0, 0.7, 0.16),
      hull: makeHull(),
      cabin: new THREE.BoxGeometry(0.34, 0.17, 0.26),
      roof: new THREE.BoxGeometry(0.36, 0.04, 0.28),
      cargo: new THREE.BoxGeometry(0.24, 0.18, 0.24),
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

  // Blocky terrain: each cell is a flat-topped square with vertical walls down
  // to lower neighbours, so dug channels have crisp, square edges.
  _terrainGeometry() {
    const w = this.world, cols = this.cols, rows = this.rows;
    const BASE = -3;
    const pos = [], col = [], nrm = [];
    const rgb = [0, 0, 0];
    const tri = (a, b, c, cc, n) => {
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      col.push(cc[0], cc[1], cc[2], cc[0], cc[1], cc[2], cc[0], cc[1], cc[2]);
      nrm.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
    };
    const quad = (p0, p1, p2, p3, cc, n) => { tri(p0, p1, p2, cc, n); tri(p0, p2, p3, cc, n); };
    const ng = (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows) ? BASE : w.ground[y * cols + x] * HS;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const g = w.ground[y * cols + x], h = g * HS;
        terrainColor(g, rgb);
        const c = [rgb[0], rgb[1], rgb[2]];
        const wc = [c[0] * 0.7, c[1] * 0.72, c[2] * 0.7]; // darker exposed walls
        // flat top
        quad([x, h, y], [x, h, y + 1], [x + 1, h, y + 1], [x + 1, h, y], c, [0, 1, 0]);
        // vertical walls down to any lower neighbour (or map edge)
        let hn = ng(x + 1, y); if (hn < h - 0.001) quad([x + 1, h, y], [x + 1, h, y + 1], [x + 1, hn, y + 1], [x + 1, hn, y], wc, [1, 0, 0]);
        hn = ng(x - 1, y); if (hn < h - 0.001) quad([x, h, y + 1], [x, h, y], [x, hn, y], [x, hn, y + 1], wc, [-1, 0, 0]);
        hn = ng(x, y + 1); if (hn < h - 0.001) quad([x, h, y + 1], [x + 1, h, y + 1], [x + 1, hn, y + 1], [x, hn, y + 1], wc, [0, 0, 1]);
        hn = ng(x, y - 1); if (hn < h - 0.001) quad([x + 1, h, y], [x, h, y], [x, hn, y], [x + 1, hn, y], wc, [0, 0, -1]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.computeBoundingSphere();
    return geo;
  }

  _buildTerrain() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.0, side: THREE.DoubleSide });
    this.terrainMesh = new THREE.Mesh(this._terrainGeometry(), mat);
    this.terrainMesh.castShadow = true;
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);
  }

  // rebuild when terrain heights change (dig/fill)
  refreshTerrain() {
    const old = this.terrainMesh.geometry;
    this.terrainMesh.geometry = this._terrainGeometry();
    old.dispose();
  }

  // ---------- water ----------
  _buildWater() {
    this.waterGeo = this._gridGeometry();
    const cols = this.cols, rows = this.rows, vw = cols + 1, nv = vw * (rows + 1);
    const pos = this.waterGeo.attributes.position.array;
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) { const k = (j * vw + i) * 3; pos[k] = i; pos[k + 1] = 0; pos[k + 2] = j; }
    }
    // per-vertex flow direction and foam amount, fed to the shader each frame
    this.waterGeo.setAttribute('aFlow', new THREE.BufferAttribute(new Float32Array(nv * 2), 2));
    this.waterGeo.setAttribute('aFoam', new THREE.BufferAttribute(new Float32Array(nv), 1));
    this.waterGeo.setAttribute('aWet', new THREE.BufferAttribute(new Float32Array(nv), 1));
    this.waterGeo.computeBoundingSphere();

    const sun = this.sunDir;
    this.waterMat = new THREE.ShaderMaterial({
      transparent: true, side: THREE.DoubleSide, depthWrite: true,
      uniforms: { uTime: { value: 0 }, uSunDir: { value: sun } },
      vertexShader: `
        attribute vec3 color;
        attribute vec2 aFlow;
        attribute float aFoam;
        attribute float aWet;
        varying vec3 vTint; varying vec2 vFlow; varying float vFoam; varying float vWet; varying vec3 vWorld;
        void main() {
          vTint = color; vFlow = aFlow; vFoam = aFoam; vWet = aWet;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        precision highp float;
        uniform float uTime; uniform vec3 uSunDir;
        varying vec3 vTint; varying vec2 vFlow; varying float vFoam; varying float vWet; varying vec3 vWorld;
        vec3 skyColor(vec3 d, vec3 sun){
          float t = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(vec3(0.82, 0.88, 0.97), vec3(0.20, 0.45, 0.80), smoothstep(0.0, 0.6, t));
          float sd = max(dot(normalize(d), normalize(sun)), 0.0);
          col += vec3(1.0, 0.92, 0.74) * pow(sd, 220.0) * 1.4;
          col += vec3(1.0, 0.86, 0.62) * pow(sd, 12.0) * 0.18;
          return col;
        }
        void main() {
          float sp = length(vFlow);
          vec2 dir = sp > 0.0015 ? vFlow / sp : vec2(0.7071, 0.7071);
          vec2 perp = vec2(-dir.y, dir.x);
          vec2 p = vWorld.xz;
          float scroll = uTime * (0.7 + sp * 4.0);          // ripples travel downstream
          float a1 = dot(p, dir) * 2.0 - scroll;
          float a2 = dot(p, dir) * 4.3 - scroll * 1.7;
          float a3 = dot(p, perp) * 3.0 - uTime * 1.1;
          float h = 0.5 * sin(a1) + 0.25 * sin(a2) + 0.15 * sin(a3);
          vec2 grad = 0.5 * cos(a1) * 2.0 * dir + 0.25 * cos(a2) * 4.3 * dir + 0.15 * cos(a3) * 3.0 * perp;
          vec3 N = normalize(vec3(-grad.x * 0.08, 1.0, -grad.y * 0.08));
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 L = normalize(uSunDir);
          float diff = clamp(dot(N, L), 0.0, 1.0);
          vec3 Hh = normalize(L + V);
          float spec = pow(clamp(dot(N, Hh), 0.0, 1.0), 180.0);
          float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
          vec3 refl = skyColor(reflect(-V, N), L);   // reflect the procedural sky
          vec3 col = vTint * (0.45 + 0.55 * diff);
          col = mix(col, refl, clamp(fres * 0.65 + 0.06, 0.0, 1.0));
          col += vec3(1.0, 0.96, 0.86) * spec * 1.3; // tight sun glint
          float crest = smoothstep(0.35, 0.85, h * 0.5 + 0.5);
          float foam = clamp(vFoam, 0.0, 1.0) * crest;
          col = mix(col, vec3(0.92, 0.96, 1.0), foam * 0.65);
          float alpha = clamp(0.85 + fres * 0.12 + foam * 0.25, 0.0, 1.0);
          alpha *= smoothstep(0.05, 0.45, vWet); // soft shoreline; hide dry edges
          if (alpha < 0.02) discard;
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.waterMesh = new THREE.Mesh(this.waterGeo, this.waterMat);
    this.waterMesh.renderOrder = 1;
    this.scene.add(this.waterMesh);
  }

  updateWater() {
    const w = this.world, cols = this.cols, rows = this.rows, vw = cols + 1;
    const pos = this.waterGeo.attributes.position.array;
    const col = this.waterGeo.attributes.color.array;
    const flow = this.waterGeo.attributes.aFlow.array;
    const foam = this.waterGeo.attributes.aFoam.array;
    const wetA = this.waterGeo.attributes.aWet.array;
    const shallow = [0.22, 0.55, 0.88], deep = [0.06, 0.28, 0.62];
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        let depth = 0, surfSum = 0, surfN = 0, gSum = 0, gN = 0, fx = 0, fy = 0, spd = 0, rip = 0;
        for (const [ci, cj] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) {
          if (ci < 0 || cj < 0 || ci >= cols || cj >= rows) continue;
          const id = cj * cols + ci;
          gSum += w.ground[id]; gN++; rip += this.ripple.h[id];
          const d = w.water[id];
          if (d > depth) depth = d;
          if (d > 0.04) { surfSum += w.ground[id] + d; surfN++; fx += w.vx[id]; fy += w.vy[id]; spd += Math.hypot(w.vx[id], w.vy[id]); }
        }
        const k = (j * vw + i) * 3, k2 = (j * vw + i) * 2, k1 = j * vw + i;
        const gAvg = gN ? gSum / gN : 0;
        const wetness = gN ? surfN / gN : 0;
        if (surfN) {
          const surf = surfSum / surfN;
          // blend the water surface down to terrain on dry sides so the mesh
          // meets the shoreline instead of stretching up steep dug walls
          pos[k + 1] = (gAvg * (1 - wetness) + surf * wetness) * HS + (rip / gN) * 0.18 * wetness;
          const dn = Math.min(depth / 3, 1);
          col[k] = shallow[0] + (deep[0] - shallow[0]) * dn;
          col[k + 1] = shallow[1] + (deep[1] - shallow[1]) * dn;
          col[k + 2] = shallow[2] + (deep[2] - shallow[2]) * dn;
          flow[k2] = fx / surfN; flow[k2 + 1] = fy / surfN;
          foam[k1] = Math.min(1, Math.max(0, ((spd / surfN) - 0.12) * 3.0));
        } else {
          pos[k + 1] = gAvg * HS; // dry: sit on terrain (faded out by aWet=0)
          col[k] = deep[0]; col[k + 1] = deep[1]; col[k + 2] = deep[2];
          flow[k2] = 0; flow[k2 + 1] = 0; foam[k1] = 0;
        }
        wetA[k1] = wetness;
      }
    }
    this.waterGeo.attributes.position.needsUpdate = true;
    this.waterGeo.attributes.color.needsUpdate = true;
    this.waterGeo.attributes.aFlow.needsUpdate = true;
    this.waterGeo.attributes.aFoam.needsUpdate = true;
    this.waterGeo.attributes.aWet.needsUpdate = true;
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
        let m = null;
        if (s === STRUCT.DOCK) { m = new THREE.Mesh(this.G.dock, this.M.dock); m.position.set(gx, gy + 0.17, gz); }
        else if (s === STRUCT.SOURCE) { m = new THREE.Mesh(this.G.source, this.M.source); m.position.set(gx, gy + 0.25, gz); }
        else if (s === STRUCT.WALL) { m = new THREE.Mesh(this.G.wall, this.M.wall); m.position.set(gx, gy + 0.65, gz); }
        if (m) { m.castShadow = true; m.receiveShadow = true; this.structures.add(m); }
      }
    }
    for (const L of w.locks) if (L.configured) this._addLock(L);
  }

  _addLock(L) {
    this._addWideGate(L, L.hiCells, L.gateHi);
    this._addWideGate(L, L.loCells, L.gateLo);
  }

  // Mitre gates: two leaves hinged at the two banks, meeting in the middle when
  // closed and swinging apart as the gate opens, spanning the full channel.
  _addWideGate(L, sideCells, openness) {
    const cols = this.cols, w = this.world, cells = L.cells;
    let dx = 0, dz = 0; // direction from chamber to this pound (one cell)
    for (let k = 0; k < cells.length; k++) {
      if (sideCells[k] >= 0) { dx = (sideCells[k] % cols) - (cells[k] % cols); dz = ((sideCells[k] / cols) | 0) - ((cells[k] / cols) | 0); break; }
    }
    const c0 = cells[0], cN = cells[cells.length - 1];
    const ax = c0 % cols + 0.5, az = (c0 / cols | 0) + 0.5;
    const bx = cN % cols + 0.5, bz = (cN / cols | 0) + 0.5;
    const spanLen = Math.hypot(bx - ax, bz - az);
    const ux = spanLen > 0 ? (bx - ax) / spanLen : 1, uz = spanLen > 0 ? (bz - az) / spanLen : 0;
    const width = cells.length, half = width / 2;
    const fcx = (ax + bx) / 2 + dx * 0.5, fcz = (az + bz) / 2 + dz * 0.5; // gate face centre
    const floorY = w.ground[c0] * HS;
    let hiSurf = w.ground[c0];
    for (const c of L.hiCells) if (c >= 0) hiSurf = Math.max(hiSurf, w.ground[c] + w.water[c]);
    const h = Math.max(0.6, (hiSurf - w.ground[c0] + 0.5) * HS);
    const base = Math.atan2(-uz, ux), swing = openness * 1.15;
    const leaf = (hx, hz, ang) => {
      const m = new THREE.Mesh(this.G.gateUnit, this.M.gate);
      m.castShadow = true;
      m.position.set(hx, floorY + h / 2, hz);
      m.scale.set(half, h, 1);
      m.rotation.y = ang;
      this.structures.add(m);
    };
    leaf(fcx - ux * half, fcz - uz * half, base + swing);            // hinged at one bank
    leaf(fcx + ux * half, fcz + uz * half, base + Math.PI - swing);  // hinged at the other
  }

  rebuildBoats(boatMgr) {
    this.boatsGroup.clear();
    for (const b of boatMgr.boats) {
      const cx = Math.max(0, Math.min(this.cols - 1, Math.round(b.x)));
      const cy = Math.max(0, Math.min(this.rows - 1, Math.round(b.y)));
      const y = this.cellTopY(cx, cy);
      // per-boat hull colour (recreated only when its idle state flips)
      if (!b._hullMat || b._hullIdle !== b.idle) {
        const col = b.idle ? new THREE.Color(0x8a4a4a) : new THREE.Color().setHSL(b.tint || 0.1, 0.55, 0.42);
        b._hullMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.55 });
        b._hullIdle = b.idle;
      }
      const g = new THREE.Group();
      const hull = new THREE.Mesh(this.G.hull, b._hullMat); hull.castShadow = true; g.add(hull);
      const cabin = new THREE.Mesh(this.G.cabin, this.M.cabin); cabin.position.set(-0.06, 0.12, 0); cabin.castShadow = true; g.add(cabin);
      const roof = new THREE.Mesh(this.G.roof, this.M.dockPost); roof.position.set(-0.06, 0.22, 0); g.add(roof);
      if (b.cargo) { const c = new THREE.Mesh(this.G.cargo, this.M.cargo); c.position.set(0.2, 0.12, 0); c.castShadow = true; g.add(c); }
      g.position.set(b.x + 0.5, y + 0.02, b.y + 0.5);
      g.rotation.y = -b.heading;
      this.boatsGroup.add(g);
    }
  }

  rebuildHighlight(view) {
    this.highlightGroup.clear();
    if (!view) return;
    const mat = view.valid ? this.M.hlOk : this.M.hlBad;
    const add = (x, y) => {
      if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
      const m = new THREE.Mesh(this.G.highlight, mat);
      m.position.set(x + 0.5, this.cellTopY(x, y) + 0.12, y + 0.5);
      this.highlightGroup.add(m);
    };
    if (view.lineCells) { for (const c of view.lineCells) add(c.x, c.y); return; }
    if (view.hoverX < 0) return;
    const r = view.brush;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) add(view.hoverX + dx, view.hoverY + dy);
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
    // rebuild the (blocky) terrain mesh at most ~12x/s so big dig edits stay smooth
    if (this._terrainDirty && this.time - (this._lastTerrain || 0) > 0.08) {
      this.refreshTerrain(); this._terrainDirty = false; this._lastTerrain = this.time;
    }
    this.stepRipple(dt, boatMgr);
    this.updateWater();
    this.waterMat.uniforms.uTime.value = this.time;
    this.rebuildStructures();
    this.rebuildBoats(boatMgr);
    this.rebuildHighlight(view);
    this.emitParticles(dt, boatMgr);
    this.spray.update(dt);
    this.skyDome.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  // feed boat wakes and lock churn into the ripple field, then advance it
  stepRipple(dt, boatMgr) {
    const w = this.world;
    for (const b of boatMgr.boats) {
      if (b.idle || b.phase === 'dwell') continue;
      // a moving hull pushes water down at the bow and trails a wake behind
      this.ripple.disturb(b.x, b.y, -0.05);
      this.ripple.disturb(b.x - Math.cos(b.heading), b.y - Math.sin(b.heading), 0.03);
    }
    for (const L of w.locks) {
      if (L.configured && (L.state === 'filling' || L.state === 'emptying')) {
        this.ripple.disturb(L.cell % this.cols, (L.cell / this.cols) | 0, (Math.random() - 0.5) * 0.5);
      }
    }
    this.ripple.step(dt, w);
  }

  // spray at active lock chambers, mist at the spring, foam on fast water,
  // and a foam trail behind each moving boat
  emitParticles(dt, boatMgr) {
    const w = this.world, S = this.spray;
    for (const b of boatMgr.boats) {
      if (b.idle || b.phase === 'dwell') continue;
      if (Math.random() < 0.6) {
        const bx = b.x + 0.5 - Math.cos(b.heading) * 0.45;
        const bz = b.y + 0.5 - Math.sin(b.heading) * 0.45;
        const cx = Math.max(0, Math.min(this.cols - 1, Math.round(b.x)));
        const cy = Math.max(0, Math.min(this.rows - 1, Math.round(b.y)));
        S.spawn(bx + (Math.random() - 0.5) * 0.3, this.cellTopY(cx, cy) + 0.04, bz + (Math.random() - 0.5) * 0.3,
          (Math.random() - 0.5) * 0.3, 0.05, (Math.random() - 0.5) * 0.3, 0.7 + Math.random() * 0.5, 1);
      }
    }
    for (const L of w.locks) {
      if (!L.configured) continue;
      if (L.state === 'filling' || L.state === 'emptying') {
        const c = this.cellCenter(L.cell), surf = w.surfaceI(L.cell) * HS;
        for (let n = 0; n < 3; n++) {
          S.spawn(c.x + (Math.random() - 0.5) * 0.7, surf + 0.05, c.z + (Math.random() - 0.5) * 0.7,
            (Math.random() - 0.5) * 1.2, 1.5 + Math.random() * 1.8, (Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 0.5, 0);
        }
      }
    }
    for (const s of w.sources) {
      if (Math.random() < 0.3) {
        const i = w.idx(s.x, s.y), surf = (w.ground[i] + w.water[i]) * HS;
        S.spawn(s.x + 0.5 + (Math.random() - 0.5) * 0.6, surf + 0.05, s.y + 0.5 + (Math.random() - 0.5) * 0.6,
          (Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.6, 0.8 + Math.random() * 0.6, 0);
      }
    }
    let budget = 10;
    for (let k = 0; k < 36 && budget > 0; k++) {
      const x = (Math.random() * this.cols) | 0, y = (Math.random() * this.rows) | 0, i = y * this.cols + x;
      if (w.water[i] < C.MIN_DRAFT) continue;
      const sp = Math.hypot(w.vx[i], w.vy[i]);
      if (sp < 0.13) continue;
      const surf = (w.ground[i] + w.water[i]) * HS;
      S.spawn(x + 0.5 + (Math.random() - 0.5) * 0.8, surf + 0.03, y + 0.5 + (Math.random() - 0.5) * 0.8,
        w.vx[i] * 1.2, 0.1, w.vy[i] * 1.2, 1.0 + Math.random(), 1);
      budget--;
    }
  }

  markTerrainDirty() { this._terrainDirty = true; }
}

window.Canal.Renderer = ThreeRenderer;
