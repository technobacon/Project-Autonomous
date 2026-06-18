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

  startRun(charId) {
    this.game.start(charId);
    this.lastT = performance.now();
  },

  loop(t) {
    const dt = Math.min(0.05, (t - this.lastT) / 1000) || 0;
    this.lastT = t;
    this.game.update(dt);
    this.game.render();
    requestAnimationFrame((tt) => this.loop(tt));
  },
};

window.addEventListener('DOMContentLoaded', () => App.init());
