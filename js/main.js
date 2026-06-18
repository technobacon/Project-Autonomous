// ===========================================================================
// LASTLIGHT - main.js
// Bootstrap: wire up systems, the fixed-ish game loop, and global key handling.
// ===========================================================================

const App = {
  game: null,
  canvas: null,
  lastT: 0,
  acc: 0,

  init() {
    Save.load();
    Audio2.muted = Save.data.muted;
    Audio2.musicMuted = Save.data.musicMuted;

    this.canvas = document.getElementById('game');
    Input.init(this.canvas);
    this.game = new Game(this.canvas);
    UI.init(document.getElementById('overlay'), this.game);

    // Global keys: pause and level-up selection.
    window.addEventListener('keydown', (e) => this.onKey(e));

    // Unlock audio on first interaction.
    const unlock = () => { Audio2.resume(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    UI.showMenu();
    requestAnimationFrame((t) => this.loop(t));
  },

  onKey(e) {
    const g = this.game;
    if (g.state === 'playing' && (e.key === 'Escape' || e.key.toLowerCase() === 'p')) {
      e.preventDefault(); g.togglePause();
    } else if (g.state === 'paused' && (e.key === 'Escape' || e.key.toLowerCase() === 'p')) {
      e.preventDefault(); g.togglePause();
    } else if (g.state === 'levelup') {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 9) { e.preventDefault(); UI.pickLevelByIndex(n - 1); }
    }
  },

  startRun(charId, diffIndex = 0, opts = {}) {
    this.game.start(charId, diffIndex, opts);
    this.lastT = performance.now();
    this.acc = 0;
  },

  // Fixed-timestep simulation (consistent speed at any framerate) with a
  // single render per animation frame.
  loop(t) {
    const FIXED = 1 / 60;
    let frame = (t - this.lastT) / 1000;
    if (!Number.isFinite(frame) || frame < 0) frame = 0;
    frame = Math.min(frame, 0.25); // avoid spiral-of-death after a tab stall
    this.lastT = t;
    this.acc += frame;
    let steps = 0;
    while (this.acc >= FIXED && steps < 5) {
      this.game.update(FIXED);
      this.acc -= FIXED;
      steps++;
    }
    if (steps === 5) this.acc = 0; // drop backlog if we fell badly behind
    this.game.render();
    requestAnimationFrame((tt) => this.loop(tt));
  },
};

window.addEventListener('DOMContentLoaded', () => App.init());
