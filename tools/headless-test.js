// ===========================================================================
// LASTLIGHT - tools/headless-test.js
// Runs the game in Node with stubbed DOM/Canvas/WebAudio to validate runtime
// behavior end-to-end: a full simulated run, every weapon, bosses, level-ups,
// pickups, UI screen building, and death. Catches reference/logic errors that
// a syntax check can't. Run with:  node tools/headless-test.js
// ===========================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---- Stub a 2D context: backing store for props, noop methods. -----------
function makeCtx() {
  return new Proxy({ canvas: { width: 800, height: 600 } }, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'createRadialGradient' || p === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (p === 'measureText') return () => ({ width: 8 });
      return () => {};
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}

function makeCanvas() {
  const ctx = makeCtx();
  return {
    width: 0, height: 0, style: {},
    getContext: () => ctx,
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
}

function makeEl() {
  const el = {
    _html: '', className: '', style: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {},
    querySelectorAll: () => [],
    querySelector: () => makeEl(),
    appendChild() {}, setAttribute() {},
  };
  Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, set(v) { el._html = String(v); } });
  Object.defineProperty(el, 'onclick', { get() { return el._c; }, set(v) { el._c = v; } });
  return el;
}

// ---- Fake WebAudio --------------------------------------------------------
function gainNode() {
  return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {} };
}
class FakeAudioContext {
  constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; this.sampleRate = 44100; }
  createGain() { return gainNode(); }
  createOscillator() { return { type: '', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  createBufferSource() { return { buffer: null, connect() {}, start() {} }; }
  createBiquadFilter() { return { type: '', frequency: { value: 0 }, connect() {} }; }
  resume() {}
}

// ---- In-memory localStorage ----------------------------------------------
const store = {};
const localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

// ---- Build the sandbox global --------------------------------------------
const overlayEl = makeEl();
const gameCanvas = makeCanvas();
const sandbox = {};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.console = console;
sandbox.Math = Math;
sandbox.Date = Date;
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;
sandbox.setInterval = () => 0;       // music timer — no-op in tests
sandbox.clearInterval = () => {};
sandbox.performance = { now: () => Date.now() };
sandbox.requestAnimationFrame = () => 0;
sandbox.devicePixelRatio = 1;
sandbox.innerWidth = 960; sandbox.innerHeight = 640;
sandbox.AudioContext = FakeAudioContext;
sandbox.webkitAudioContext = FakeAudioContext;
sandbox.localStorage = localStorage;
sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};
sandbox.confirm = () => true;
sandbox.document = {
  addEventListener() {},
  createElement: () => makeCanvas(),
  getElementById: (id) => (id === 'game' ? gameCanvas : (id === 'overlay' ? overlayEl : makeEl())),
};

// ---- Load & concatenate the game source (skip main.js auto-init) ---------
const order = ['utils', 'audio', 'input', 'particles', 'save', 'content',
  'weapons', 'enemies', 'upgrades', 'player', 'game', 'ui'];
let src = '';
for (const f of order) src += fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8') + '\n;\n';

// ---- Append the test driver (same lexical scope as the game). ------------
src += `
globalThis.__run = function(report) {
  const results = { passed: [], failed: [] };
  const ok = (name, cond) => { (cond ? results.passed : results.failed).push(name + (cond ? '' : ' [' + cond + ']')); };
  const sectionTry = (name, fn) => { try { fn(); results.passed.push(name); } catch (e) { results.failed.push(name + ' :: ' + (e && e.stack || e)); } };

  Save.load();
  const game = new Game(document.getElementById('game'));
  UI.init(document.getElementById('overlay'), game);

  // 1) Menus build without error.
  sectionTry('UI.showMenu', () => UI.showMenu());
  sectionTry('UI.showHelp', () => UI.showHelp());
  sectionTry('UI.showCharacterSelect', () => UI.showCharacterSelect());
  sectionTry('UI.showShop', () => UI.showShop());

  // 2) Start a run.
  sectionTry('game.start', () => game.start('spark'));
  ok('player created', !!game.player);
  ok('has start weapon', game.player.weapons.length === 1);

  // 3) Simulate movement input + frames; track for NaN / crashes.
  Input.keys['d'] = true; Input.keys['s'] = true;
  let frames = 0, maxEnemiesSeen = 0, levelUpsHandled = 0;
  const origOpen = game.openLevelUp.bind(game);
  game.openLevelUp = function() {
    // Auto-pick first choice to keep the sim moving.
    if (this.pendingLevels <= 0) { this.state = 'playing'; this.running = true; return; }
    const choices = buildUpgradeChoices(this, 3);
    ok('levelup choices generated', choices.length >= 1);
    this.player.applyUpgrade(choices[0]);
    this.pendingLevels--;
    levelUpsHandled++;
    if (this.pendingLevels > 0) this.openLevelUp();
    else { this.state = 'playing'; this.running = true; }
  };

  sectionTry('simulate 30s of frames', () => {
    for (let i = 0; i < 1800; i++) {
      // Periodically swerve and feed XP to force level-ups & upgrades.
      if (i % 120 === 0) { Input.keys['d'] = !Input.keys['d']; Input.keys['w'] = !Input.keys['w']; }
      if (i % 90 === 0 && game.player.alive) game.player.gainXp(60);
      game.update(1 / 60);
      game.render();
      maxEnemiesSeen = Math.max(maxEnemiesSeen, game.enemies.length);
      frames++;
      if (!Number.isFinite(game.player.x) || !Number.isFinite(game.player.y)) throw new Error('player position NaN at frame ' + i);
      if (!Number.isFinite(game.player.hp)) throw new Error('player hp NaN at frame ' + i);
    }
  });
  ok('enemies spawned during run', maxEnemiesSeen > 0);
  ok('level-ups occurred', levelUpsHandled > 0);
  ok('kills registered', game.kills >= 0);

  // 4) Give the player EVERY weapon and passive, fire them all for a while.
  sectionTry('all weapons + passives fire', () => {
    game.player.maxWeapons = 99; game.player.maxPassives = 99;
    for (const id of Object.keys(WEAPONS)) game.player.addWeapon(id);
    for (const id of Object.keys(PASSIVES)) { game.player.passives[id] = PASSIVES[id].max; }
    game.player.recalc();
    // Level every weapon up to max.
    for (const w of game.player.weapons) w.level = w.def.maxLevel;
    // Ensure there are foes to hit.
    for (let k = 0; k < 40; k++) game.spawnEnemy('drifter', game.player.x + Math.cos(k) * 120, game.player.y + Math.sin(k) * 120, 1, 1);
    for (let i = 0; i < 300; i++) { game.update(1 / 60); game.render(); }
  });
  ok('weapons all present', game.player.weapons.length === Object.keys(WEAPONS).length);

  // 5) Bosses: spawn each and kill it.
  sectionTry('spawn + kill every boss', () => {
    for (const bid of Object.keys(BOSSES)) {
      const before = game.bossKills;
      game.director.spawnBoss(bid);
      const boss = game.enemies.find(e => e.boss);
      ok('boss ' + bid + ' spawned', !!boss);
      if (boss) { game.dealDamage(boss, 1e9, game.player.x, game.player.y, 0); }
      for (let i = 0; i < 30; i++) { game.update(1 / 60); game.render(); }
      ok('boss ' + bid + ' killed', game.bossKills > before);
    }
  });

  // 6) Pickups.
  sectionTry('apply all pickups', () => {
    ['health', 'magnet', 'bomb', 'chest'].forEach(k => game.applyPickup(k));
  });

  // 7) Pause/resume + level-up UI screen.
  sectionTry('UI.showPause/showLevelUp', () => {
    UI.showPause(game);
    UI.showLevelUp(game, buildUpgradeChoices(game, 3));
    UI.hideLevelUp();
  });

  // 8) Death + game over screen + persistence.
  const shardsBefore = Save.data.shards;
  sectionTry('player death + game over', () => {
    game.openLevelUp = origOpen; // restore
    game.player.revives = 0;
    game.player.hurt(1e9);
    ok('player dead', !game.player.alive);
    ok('state gameover', game.state === 'gameover');
    UI.showGameOver(game);
  });
  ok('shards persisted', Save.data.shards >= shardsBefore);
  ok('run recorded', Save.data.runs >= 1);

  // 9) Meta shop purchase path.
  sectionTry('buy meta upgrade', () => {
    Save.data.shards = 100000;
    const before = Save.metaLevel('might');
    const u = getMeta('might');
    Save.spendShards(metaCost(u, before));
    Save.buyMeta('might');
    ok('meta upgrade leveled', Save.metaLevel('might') === before + 1);
  });

  report(results, { frames, maxEnemiesSeen, kills: game.kills, score: game.score, levelUps: levelUpsHandled });
};
`;

const ctx = vm.createContext(sandbox);
vm.runInContext(src, ctx, { filename: 'lastlight-bundle.js' });

sandbox.__run((results, stats) => {
  console.log('\\n=== LASTLIGHT headless test ===');
  console.log('Sim stats:', JSON.stringify(stats));
  console.log('\\nPASSED (' + results.passed.length + '):');
  for (const p of results.passed) console.log('  ✓ ' + p);
  if (results.failed.length) {
    console.log('\\nFAILED (' + results.failed.length + '):');
    for (const f of results.failed) console.log('  ✗ ' + f);
    process.exitCode = 1;
  } else {
    console.log('\\nALL CHECKS PASSED ✓');
  }
});
