// ===========================================================================
// LASTLIGHT - tools/determinism-test.js
// Proves the Daily Challenge is fair: a given seed produces the SAME world
// regardless of framerate (render cadence), audio mute, or screen-shake — i.e.
// the seeded gameplay RNG stream is fully isolated from cosmetic randomness.
// Run:  node tools/determinism-test.js
// ===========================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeCtx() {
  return new Proxy({ canvas: {} }, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'createRadialGradient' || p === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (p === 'measureText') return () => ({ width: 8 });
      return () => {};
    }, set(t, p, v) { t[p] = v; return true; },
  });
}
const makeCanvas = () => ({ width: 0, height: 0, style: {}, getContext: () => makeCtx(), addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 640 }) });
const makeEl = () => { const e = { _h: '', className: '', style: {}, classList: { add() {}, remove() {} }, addEventListener() {}, querySelectorAll: () => [], querySelector: () => makeEl() }; Object.defineProperty(e, 'innerHTML', { get() { return e._h; }, set(v) { e._h = '' + v; } }); Object.defineProperty(e, 'onclick', { get() { return e._c; }, set(v) { e._c = v; } }); return e; };
const gn = () => ({ gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {} });
class AC { constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; this.sampleRate = 44100; } createGain() { return gn(); } createOscillator() { return { type: '', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; } createBuffer(c, l) { return { getChannelData: () => new Float32Array(l) }; } createBufferSource() { return { connect() {}, start() {} }; } createBiquadFilter() { return { frequency: {}, connect() {} }; } createDynamicsCompressor() { return { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {} }; } resume() {} }
const store = {};
const sandbox = {};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.console = console; sandbox.Math = Math; sandbox.Date = Date;
sandbox.setTimeout = () => 0; sandbox.clearTimeout = () => {}; sandbox.setInterval = () => 0; sandbox.clearInterval = () => {};
sandbox.performance = { now: () => 0 }; sandbox.requestAnimationFrame = () => 0;
sandbox.devicePixelRatio = 1; sandbox.innerWidth = 960; sandbox.innerHeight = 640;
sandbox.AudioContext = AC; sandbox.webkitAudioContext = AC;
sandbox.localStorage = { getItem: k => k in store ? store[k] : null, setItem: (k, v) => store[k] = '' + v, removeItem: k => delete store[k] };
sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {}; sandbox.confirm = () => true;
const overlay = makeEl(), gameCanvas = makeCanvas();
sandbox.document = { addEventListener() {}, createElement: () => makeCanvas(), getElementById: id => id === 'game' ? gameCanvas : (id === 'overlay' ? overlay : makeEl()) };

const order = ['utils', 'audio', 'input', 'particles', 'save', 'content', 'weapons', 'evolutions', 'synergies', 'enemies', 'upgrades', 'achievements', 'modifiers', 'mutators', 'relics', 'trials', 'player', 'game', 'ui'];
let src = '';
for (const f of order) src += fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8') + '\n;\n';

src += `
globalThis.__det = function(report) {
  Save.load();
  UI.hideLevelUp = () => {}; UI.showGameOver = () => {};

  // A run that is identical given (seed, inputs), regardless of cosmetic config.
  function runSim(opts) {
    const o = Object.assign({ render: false, renderEvery: 1, mute: false, shakeOff: false, steps: 2400, daily: false }, opts);
    Audio2.muted = o.mute; Audio2.musicMuted = o.mute;
    Save.data.shakeOff = o.shakeOff;
    const game = new Game(document.getElementById('game'));
    UI.init(document.getElementById('overlay'), game);
    UI.showLevelUp = (g, choices) => { g.chooseUpgrade(choices[0]); };
    let step = 0;
    // Deterministic, input-only movement (a pure function of the step index).
    Input.moveVector = () => ({ x: Math.cos(step * 0.13) * 0.8, y: Math.sin(step * 0.17) * 0.8 });
    game.start('spark', 0, o.daily ? { daily: true, date: '2026-06-18' } : { seed: o.seed });
    // Optionally jump the clock forward to exercise a later (hazardous) biome
    // without simulating the full lead-up. Deterministic for a given (seed, warp).
    if (o.warp) game.time = o.warp;
    for (let i = 0; i < o.steps; i++) {
      step = i;
      game.update(1 / 60);
      if (o.render && i % o.renderEvery === 0) game.render();
      if (!game.player.alive) break;
    }
    return hashState(game);
  }

  function hashState(g) {
    let ehp = 0, ex = 0, ey = 0, ew = 0;
    for (const e of g.enemies) { ehp += e.hp; ex += e.x; ey += e.y; ew += e.warded; }
    let hx = 0, hy = 0, hp = '';
    for (const h of g.hazards) { hx += h.x + (h.ang || 0) * 7; hy += h.y; hp += h.phase[0]; }
    let sx = 0, sy = 0, sl = 0; const stypes = [];
    for (const s of g.shrines) { sx += s.x; sy += s.y; sl += s.life; stypes.push(s.type); }
    let bt = 0; for (const b of g.player.buffs) bt += b.t;
    let tx = 0, tl = 0; for (const t of g.turrets) { tx += t.x + t.y; tl += t.life; }
    return [g.time.toFixed(3), g.kills, g.score, g.player.level, g.player.hp.toFixed(3),
      g.player.x.toFixed(3), g.player.y.toFixed(3), g.enemies.length, ehp.toFixed(2),
      ex.toFixed(2), ey.toFixed(2), g.gems.length, g.projectiles.length,
      g.eliteKills, g.championKills, g.enemyProjectiles.length, g.zones.length,
      g.hazards.length, hx.toFixed(2), hy.toFixed(2), hp,
      g.shrines.length, sx.toFixed(2), sy.toFixed(2), sl.toFixed(2), stypes.join(','),
      g.player.buffs.length, bt.toFixed(3), ew.toFixed(2),
      g.turrets.length, tx.toFixed(2), tl.toFixed(2),
      (g.player.synergies || []).map(s => s.id).join(','), g.player.weapons.length].join('|');
  }

  const results = { passed: [], failed: [] };
  const eq = (name, a, b) => { (a === b ? results.passed : results.failed).push(name + (a === b ? '' : '\\n      A=' + a + '\\n      B=' + b)); };
  const ne = (name, a, b) => { (a !== b ? results.passed : results.failed).push(name + (a !== b ? '' : ' (unexpectedly equal)')); };

  const SEED = 12345;
  const base = runSim({ seed: SEED });

  eq('same seed -> identical run', base, runSim({ seed: SEED }));
  eq('render every frame -> identical gameplay', base, runSim({ seed: SEED, render: true, renderEvery: 1 }));
  eq('render every 3rd frame -> identical gameplay', base, runSim({ seed: SEED, render: true, renderEvery: 3 }));
  eq('render every 7th frame -> identical gameplay', base, runSim({ seed: SEED, render: true, renderEvery: 7 }));
  eq('audio muted -> identical gameplay', base, runSim({ seed: SEED, mute: true }));
  eq('audio unmuted -> identical gameplay', base, runSim({ seed: SEED, mute: false }));
  eq('shake off -> identical gameplay', base, runSim({ seed: SEED, shakeOff: true }));
  eq('shake on -> identical gameplay', base, runSim({ seed: SEED, shakeOff: false }));
  eq('worst-case mix -> identical gameplay', base, runSim({ seed: SEED, render: true, renderEvery: 5, mute: true, shakeOff: true }));
  ne('different seed -> different run', base, runSim({ seed: SEED + 1 }));

  // Daily seeds are reproducible for a given date.
  const day = runSim({ daily: true });
  eq('daily same date -> identical run', day, runSim({ daily: true }));

  // Environmental hazards live in the sim path: warping into a hazardous biome
  // (Glacial Rift, ~300s) must reproduce the exact same hazard sequence.
  const haz = runSim({ seed: SEED, warp: 305, steps: 1200 });
  eq('hazards deterministic (same seed, warped biome)', haz, runSim({ seed: SEED, warp: 305, steps: 1200 }));
  ne('hazards differ by seed (warped biome)', haz, runSim({ seed: SEED + 7, warp: 305, steps: 1200 }));

  // The Riftvortex (The Sundering, ~760s) drags the player/foes around — a
  // movement-affecting hazard, so its determinism is worth pinning directly.
  const vor = runSim({ seed: SEED, warp: 760, steps: 1200 });
  eq('vortex hazard deterministic (warped to The Sundering)', vor, runSim({ seed: SEED, warp: 760, steps: 1200 }));
  ne('vortex hazard differs by seed', vor, runSim({ seed: SEED + 7, warp: 760, steps: 1200 }));

  // The Sunfire Sweep (The Corona, ~905s) rotates a damaging beam — its live
  // angle is folded into the hash, so the rake must reproduce exactly per seed.
  const beam = runSim({ seed: SEED, warp: 905, steps: 1200 });
  eq('beam hazard deterministic (warped to The Corona)', beam, runSim({ seed: SEED, warp: 905, steps: 1200 }));
  ne('beam hazard differs by seed', beam, runSim({ seed: SEED + 7, warp: 905, steps: 1200 }));

  report(results);
};
`;

const ctx = vm.createContext(sandbox);
vm.runInContext(src, ctx, { filename: 'det-bundle.js' });
sandbox.__det((r) => {
  console.log('\n=== LASTLIGHT determinism test ===');
  console.log('PASSED (' + r.passed.length + '):');
  for (const p of r.passed) console.log('  ✓ ' + p);
  if (r.failed.length) {
    console.log('\nFAILED (' + r.failed.length + '):');
    for (const f of r.failed) console.log('  ✗ ' + f);
    process.exitCode = 1;
  } else {
    console.log('\nALL DETERMINISM CHECKS PASSED ✓');
  }
});
