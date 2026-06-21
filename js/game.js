// Main game: wires the systems together, runs a fixed-timestep simulation with
// a requestAnimationFrame render loop, and drives the HUD.
(function (Canal) {
  const C = Canal.CONFIG;

  // --- toast notifications ---
  let toastTimer = null;
  Canal.toast = function (msg, kind) {
    const host = document.getElementById('toast');
    if (!host) return;
    const div = document.createElement('div');
    div.className = 'toast-msg ' + (kind || 'info');
    div.textContent = msg;
    host.appendChild(div);
    setTimeout(() => {
      div.style.transition = 'opacity .4s';
      div.style.opacity = '0';
      setTimeout(() => div.remove(), 400);
    }, 2600);
  };

  class Game {
    constructor() {
      this.world = new Canal.World((Math.random() * 1e9) | 0);
      this.economy = new Canal.Economy();
      this.lockMgr = new Canal.LockManager(this.world);
      this.boatMgr = new Canal.BoatManager(this.world, this.economy, this.lockMgr);
      // Large generated landscape (hills, a river to the sea) — dig canals into it.
      this.renderer = new Canal.Renderer(document.getElementById('game'), this.world);
      this.input = new Canal.Input(this);

      this.speed = 1;
      this.prevSpeed = 1;
      this.stepDt = 1 / C.SIM_HZ;
      this.acc = 0;
      this.last = performance.now();
      this.hudTimer = 0;

      this.input.selectTool('inspect');
      this.updateHud();
      this.welcome();
      requestAnimationFrame((t) => this.frame(t));
    }

    welcome() {
      Canal.toast('A river runs from the highlands down to the sea. Dig canals from it.', 'good');
      setTimeout(() => Canal.toast('Dig channels and locks to carry boats across the terrain between docks.', 'info'), 2800);
      this.setHint('Dig from the river or sea, build locks to change level, then link docks with routes.');
    }

    setSpeed(s) {
      this.speed = s;
      if (s > 0) this.prevSpeed = s;
    }

    togglePause() {
      const next = this.speed > 0 ? 0 : this.prevSpeed;
      this.setSpeed(next);
      document.querySelectorAll('.speed-btn').forEach((b) => {
        b.classList.toggle('active', parseInt(b.dataset.speed, 10) === next);
      });
    }

    setHint(text) {
      const el = document.getElementById('hint');
      if (el) el.textContent = text;
    }

    frame(now) {
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (dt > 0.1) dt = 0.1; // avoid huge catch-up after a tab switch

      // Building works even while paused.
      this.input.tickPaint(dt);

      if (this.speed > 0) {
        this.acc += dt * this.speed;
        let steps = 0;
        while (this.acc >= this.stepDt && steps < 8) {
          this.acc -= this.stepDt;
          this.lockMgr.update(this.stepDt);
          Canal.Water.step(this.world);
          this.boatMgr.update(this.stepDt);
          steps++;
        }
      }

      this.renderer.draw(this.boatMgr, this.input.view, dt);

      this.hudTimer += dt;
      if (this.hudTimer >= 0.2) { this.hudTimer = 0; this.updateHud(); }

      requestAnimationFrame((t) => this.frame(t));
    }

    updateHud() {
      document.getElementById('stat-delivered').textContent = this.economy.delivered;
      document.getElementById('stat-boats').textContent = this.boatMgr.boats.length;
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    Canal.game = new Game();
  });
})(window.Canal);
