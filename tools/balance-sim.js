// ===========================================================================
// LASTLIGHT - tools/balance-sim.js
// Auto-plays the game with a simple "dodge the crowd" AI and a greedy upgrade
// picker, then prints a minute-by-minute timeline. Used to sanity-check the
// difficulty curve (is a competent player rewarded? does it stay survivable?).
// Run:  node tools/balance-sim.js [metaLevel]
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
class AC { constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; this.sampleRate = 44100; } createGain() { return gn(); } createOscillator() { return { type: '', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; } createBuffer(c, l) { return { getChannelData: () => new Float32Array(l) }; } createBufferSource() { return { connect() {}, start() {} }; } createBiquadFilter() { return { frequency: {}, connect() {} }; } resume() {} }
const store = {};
const sandbox = {};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.console = console; sandbox.Math = Math; sandbox.Date = Date;
sandbox.setTimeout = setTimeout; sandbox.clearTimeout = clearTimeout; sandbox.setInterval = () => 0; sandbox.clearInterval = () => {};
sandbox.performance = { now: () => Date.now() }; sandbox.requestAnimationFrame = () => 0;
sandbox.devicePixelRatio = 1; sandbox.innerWidth = 960; sandbox.innerHeight = 640;
sandbox.AudioContext = AC; sandbox.webkitAudioContext = AC;
sandbox.localStorage = { getItem: k => k in store ? store[k] : null, setItem: (k, v) => store[k] = '' + v, removeItem: k => delete store[k] };
sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {}; sandbox.confirm = () => true;
const overlay = makeEl(), gameCanvas = makeCanvas();
sandbox.document = { addEventListener() {}, createElement: () => makeCanvas(), getElementById: id => id === 'game' ? gameCanvas : (id === 'overlay' ? overlay : makeEl()) };

const order = ['utils', 'audio', 'input', 'particles', 'save', 'content', 'weapons', 'evolutions', 'synergies', 'enemies', 'upgrades', 'achievements', 'modifiers', 'relics', 'player', 'game', 'ui'];
let src = '';
for (const f of order) src += fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8') + '\n;\n';

const metaLevel = parseInt(process.argv[2] || '0', 10);
const diffArg = parseInt(process.argv[3] || '0', 10);

src += `
globalThis.__sim = function(metaLevel, diffIndex, out) {
  Save.load();
  // Apply a uniform meta level to emulate an experienced player's account.
  for (const u of META_UPGRADES) Save.data.meta[u.id] = Math.min(u.max, metaLevel);
  const game = new Game(document.getElementById('game'));
  UI.init(document.getElementById('overlay'), game);
  UI.hideLevelUp = () => {}; UI.showGameOver = () => {};

  // Focused, evolution-seeking picker (drives the REAL openLevelUp so that
  // evolution offers are exercised). Pushes a couple of weapons to max + their
  // paired passives, grabbing any evolution the instant it is offered.
  const passivePref = { power: 9, haste: 8, area: 7, vigor: 7, regen: 6, multishot: 6, guard: 5, crit: 5, magnet: 4, velocity: 3, pierce: 3, greed: 2, boots: 4, luck: 1 };
  let evosTaken = 0;
  UI.showLevelUp = function(g, choices) {
    const pairedPassives = new Set();
    for (const evo of EVOLUTIONS) if (g.player.hasWeapon(evo.base)) pairedPassives.add(evo.passive);
    // Identify the weapon we're funnelling toward max (highest level base).
    let focus = null, focusLvl = -1;
    for (const w of g.player.weapons) if (!w.def.evolved && w.level > focusLvl) { focus = w.def.id; focusLvl = w.level; }
    // Passives required to unlock a PENDING evolution (base already maxed).
    const needPassive = new Set();
    for (const evo of EVOLUTIONS) {
      const w = g.player.weapon(evo.base);
      if (w && w.level >= w.def.maxLevel && (g.player.passives[evo.passive] || 0) < evo.passiveLvl && !g.player.hasWeapon(evo.into))
        needPassive.add(evo.passive);
    }
    const score = (c) => {
      if (c.evolve) return 1000;
      if ((c.kind === 'passive-up' || c.kind === 'passive-new') && needPassive.has(c.id)) return 900;
      if (c.kind === 'weapon-up') return 50 + c.level * 8 + (c.id === focus ? 30 : 0);
      if (c.kind === 'weapon-new') return g.player.weapons.length < 3 ? 30 : 2;
      if (c.kind === 'passive-up' || c.kind === 'passive-new') return (passivePref[c.id] || 0) + (pairedPassives.has(c.id) ? 40 : 0);
      return 1;
    };
    choices = choices.slice().sort((a, b) => score(b) - score(a));
    if (choices[0] && choices[0].evolve) evosTaken++;
    g.chooseUpgrade(choices[0]);
  };

  // Dodge AI: avoid the crowd, drift toward nearby XP when not in danger,
  // and steer back toward the arena center near the walls.
  Input.moveVector = function() {
    const p = game.player; let fx = 0, fy = 0; let threat = 0;
    const near = game.nearestEnemies(p.x, p.y, 10);
    for (const e of near) {
      const dx = p.x - e.x, dy = p.y - e.y; const d = Math.hypot(dx, dy) || 1;
      const w = Math.min(1.6, 240 / d); fx += (dx / d) * w; fy += (dy / d) * w;
      if (d < 160) threat += w;
    }
    // Seek the nearest gem when reasonably safe (real players grab XP).
    if (threat < 1.6) {
      let best = null, bd = 1e9;
      for (const g of game.gems) { const dd = (g.x - p.x) ** 2 + (g.y - p.y) ** 2; if (dd < bd) { bd = dd; best = g; } }
      if (best) { const dx = best.x - p.x, dy = best.y - p.y, d = Math.hypot(dx, dy) || 1; fx += (dx / d) * 1.2; fy += (dy / d) * 1.2; }
    }
    // Bias toward center if near the wall.
    const cx = game.world.w / 2, cy = game.world.h / 2;
    fx += (cx - p.x) / game.world.w * 1.5; fy += (cy - p.y) / game.world.h * 1.5;
    const m = Math.hypot(fx, fy) || 1; return { x: fx / m, y: fy / m };
  };

  game.start('spark', diffIndex);
  const timeline = [];
  let lastMark = 0;
  const dt = 1 / 60;
  const maxT = 900; // simulate up to 15 minutes
  while (game.player.alive && game.time < maxT) {
    game.update(dt);
    if (game.time - lastMark >= 30 || (!game.player.alive)) {
      lastMark = game.time;
      timeline.push({ t: Math.round(game.time), lv: game.player.level, hp: Math.round(game.player.hp), max: game.player.maxHp,
        kills: game.kills, enemies: game.enemies.length, weapons: game.player.weapons.length, bosses: game.bossKills });
    }
  }
  timeline.push({ t: Math.round(game.time), lv: game.player.level, hp: Math.round(game.player.hp), max: game.player.maxHp,
    kills: game.kills, enemies: game.enemies.length, weapons: game.player.weapons.length, bosses: game.bossKills, end: true });
  out({ survived: Math.round(game.time), alive: game.player.alive, kills: game.kills, bosses: game.bossKills,
    level: game.player.level, evosTaken, timeline,
    finalWeapons: game.player.weapons.map(w => w.def.id + ':' + w.level),
    passives: Object.keys(game.player.passives).filter(k => game.player.passives[k] > 0).map(k => k + ':' + game.player.passives[k]) });
};
`;

const ctx = vm.createContext(sandbox);
vm.runInContext(src, ctx, { filename: 'sim-bundle.js' });
sandbox.__sim(metaLevel, diffArg, (r) => {
  console.log(`\n=== LASTLIGHT balance sim (meta ${metaLevel}, difficulty ${diffArg}, dodge-AI) ===`);
  console.log(`Survived ${Math.floor(r.survived / 60)}:${String(r.survived % 60).padStart(2, '0')}  |  level ${r.level}  |  kills ${r.kills}  |  bosses ${r.bosses}  |  evolutions ${r.evosTaken}  |  ${r.alive ? 'SURVIVED to cap' : 'died'}`);
  console.log(`Final build: ${r.finalWeapons.join(', ')}`);
  console.log(`Passives: ${r.passives.join(', ')}`);
  console.log('\n  time   lvl   hp/max      kills  enemies  weps  bosses');
  for (const m of r.timeline) {
    const tt = `${Math.floor(m.t / 60)}:${String(m.t % 60).padStart(2, '0')}`;
    console.log(`  ${tt.padStart(5)}  ${String(m.lv).padStart(3)}   ${String(m.hp).padStart(4)}/${String(m.max).padEnd(4)}   ${String(m.kills).padStart(6)}   ${String(m.enemies).padStart(5)}   ${String(m.weapons).padStart(3)}   ${String(m.bosses).padStart(4)}${m.end ? '  <-- end' : ''}`);
  }
});
