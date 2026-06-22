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
  createDynamicsCompressor() { return { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 }, connect() {} }; }
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
  'weapons', 'evolutions', 'synergies', 'enemies', 'upgrades', 'achievements', 'modifiers', 'mutators', 'relics', 'trials', 'player', 'game', 'ui'];
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

  sectionTry('weapon: Void Rift pulls foes in, then implodes', () => {
    ok('Void Rift in the normal pool', !!WEAPONS.rift && WEAPON_LIST.some(w => w.id === 'rift'));
    ok('Event Horizon is an evolved (pool-excluded) form', !!WEAPONS.horizon && WEAPONS.horizon.evolved && !WEAPON_LIST.some(w => w.id === 'horizon'));
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 31 });
    const cx = g.player.x + 300, cy = g.player.y;
    const z = g.spawnZone(cx, cy, 160, 8, 0.4, '#b98bff', 0, { pull: 200, burst: 999, burstR: 160, burstColor: '#caa6ff' });
    const e = g.spawnEnemy('drifter', cx + 150, cy, 1, 1); e.speed = 0; e.hp = 1e6; e.maxHp = 1e6;
    const d0 = dist(e.x, e.y, cx, cy);
    g.buildGrid();
    for (let i = 0; i < 12; i++) { g.updateZones(1 / 60); g.buildGrid(); }
    ok('rift reels foes toward the core', dist(e.x, e.y, cx, cy) < d0 - 1e-6);
    const hp0 = e.hp;
    for (let i = 0; i < 40; i++) { g.updateZones(1 / 60); g.buildGrid(); }
    ok('the implosion detonated for damage', e.hp < hp0);
    ok('the rift is gone after collapse', !g.zones.includes(z));
    ok('plain zones still carry no pull/burst', (() => { const g2 = new Game(document.getElementById('game')); g2.start('spark', 0); const zz = g2.spawnZone(0, 0, 50, 5, 1, '#fff'); return !zz.pull && !zz.burst; })());
  });
  sectionTry('weapon: Void Rift powers the Collapse synergy + evolves to Event Horizon', () => {
    const set = SYNERGIES.find(s => s.id === 'collapse');
    ok('Collapse synergy registered with rift', !!set && set.members.includes('rift'));
    ok('rift + magnet -> horizon evolution registered', EVOLUTIONS.some(e => e.base === 'rift' && e.into === 'horizon'));
  });

  sectionTry('weapon: Glint ricochets between foes; evolves to Refraction', () => {
    ok('Glint in the normal pool', !!WEAPONS.glint && WEAPON_LIST.some(w => w.id === 'glint'));
    ok('Scintilla is an evolved (pool-excluded) form', !!WEAPONS.scintilla && WEAPONS.scintilla.evolved && !WEAPON_LIST.some(w => w.id === 'scintilla'));
    ok('Glint + pierce -> Scintilla evolution registered', EVOLUTIONS.some(e => e.base === 'glint' && e.into === 'scintilla'));
    ok('Cascade synergy = Glint + Arc', !!getSynergy('cascade') && getSynergy('cascade').members.includes('glint') && getSynergy('cascade').members.includes('chain'));
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 7 });
    const px = g.player.x, py = g.player.y;
    // Three foes strung out to the right; a bouncer should carom A -> B -> C.
    const a = g.spawnEnemy('drifter', px + 40, py, 1, 1);
    const b = g.spawnEnemy('drifter', px + 120, py, 1, 1);
    const c = g.spawnEnemy('drifter', px + 200, py, 1, 1);
    for (const e of [a, b, c]) { e.speed = 0; e.hp = 1e6; e.maxHp = 1e6; }
    const hp0 = [a.hp, b.hp, c.hp];
    g.spawnProjectile({ x: px, y: py, angle: 0, speed: 540, damage: 50, radius: 6, pierce: 0, life: 2, color: '#fff', bounce: 3, bounceRange: 260 });
    g.buildGrid();
    for (let i = 0; i < 60; i++) { g.updateProjectiles(1 / 60); g.buildGrid(); }
    ok('first foe was struck', a.hp < hp0[0]);
    ok('ricochet carried to the second foe', b.hp < hp0[1]);
    ok('ricochet carried to the third foe', c.hp < hp0[2]);
    ok('the ricochet counter advanced', g.ricochets >= 2);
    // A plain (bounce:0) shot must NOT chain to a second foe.
    const g2 = new Game(document.getElementById('game')); g2.start('spark', 0, { seed: 7 });
    const qx = g2.player.x, qy = g2.player.y;
    const a2 = g2.spawnEnemy('drifter', qx + 40, qy, 1, 1);
    const b2 = g2.spawnEnemy('drifter', qx + 120, qy, 1, 1);
    for (const e of [a2, b2]) { e.speed = 0; e.hp = 1e6; e.maxHp = 1e6; }
    const b2hp = b2.hp;
    g2.spawnProjectile({ x: qx, y: qy, angle: 0, speed: 540, damage: 50, radius: 6, pierce: 0, life: 2, color: '#fff' });
    g2.buildGrid();
    for (let i = 0; i < 60; i++) { g2.updateProjectiles(1 / 60); g2.buildGrid(); }
    ok('a non-ricochet shot does not chain to a second foe', a2.hp < 1e6 && b2.hp === b2hp);
  });

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

  sectionTry('boss: Eclipse alternates a shield phase + open window', () => {
    ok('eclipse registered + in the endless rotation + gauntlet', !!BOSSES.eclipse && BOSSES.eclipse.ai === 'boss_eclipse' && ENDLESS_BOSSES.includes('eclipse'));
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 22 });
    g.player.invuln = 1e9; const origMove = Input.moveVector; Input.moveVector = () => ({ x: 0, y: 0 });
    g.director.spawnBoss('eclipse');
    const boss = g.enemies.find(e => e.boss);
    ok('eclipse opens vulnerable', boss.type.id === 'eclipse' && boss.shieldPhase === false);
    // Vulnerable: damage lands.
    const hp0 = boss.hp; g.dealDamage(boss, 500, g.player.x, g.player.y, 0);
    ok('damage lands while open', boss.hp < hp0);
    // Force the shield phase: damage is fully blocked.
    boss.shieldPhase = true; boss.phaseT = 1.5; boss.shootTimer = 0.05;
    const hp1 = boss.hp; g.dealDamage(boss, 5000, g.player.x, g.player.y, 0);
    ok('shielded phase blocks all damage', boss.hp === hp1);
    // It sprays bolts while shielded, then cycles back to open.
    let sawShots = false; const pc0 = g.enemyProjectiles.length;
    for (let i = 0; i < 60 * 3; i++) { g.update(1 / 60); if (g.enemyProjectiles.length > pc0) sawShots = true; if (!boss.shieldPhase) break; }
    Input.moveVector = origMove;
    ok('eclipse fires while shielded then reopens', sawShots && boss.shieldPhase === false);
  });
  sectionTry('boss: Herald is warded while its acolytes live', () => {
    ok('herald registered + endless + gauntlet', !!BOSSES.herald && BOSSES.herald.ai === 'boss_herald' && ENDLESS_BOSSES.includes('herald'));
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 61 });
    g.player.invuln = 1e9; g.player.weapons = []; const origMove = Input.moveVector; Input.moveVector = () => ({ x: 0, y: 0 });
    g.director.spawnBoss('herald');
    const boss = g.enemies.find(e => e.boss);
    ok('herald spawned', !!boss && boss.type.id === 'herald');
    // Let it raise its first ward.
    for (let i = 0; i < 90; i++) g.update(1 / 60);
    const minions = g.enemies.filter(e => e.heraldMinion && e.hp > 0);
    ok('the Herald summons acolytes', minions.length > 0);
    ok('the Herald is warded (shielded) while acolytes live', boss.shieldPhase === true);
    const hp0 = boss.hp; g.dealDamage(boss, 1e6, g.player.x, g.player.y, 0);
    ok('a warded Herald takes no damage', boss.hp === hp0);
    // Slay every acolyte; the ward drops and a damage window opens.
    for (const m of g.enemies) if (m.heraldMinion) m.hp = 0;
    for (let i = 0; i < 3; i++) g.update(1 / 60);
    ok('the ward drops once the acolytes are gone', boss.shieldPhase === false);
    const hp1 = boss.hp; g.dealDamage(boss, 500, g.player.x, g.player.y, 0);
    Input.moveVector = origMove;
    ok('the exposed Herald takes damage', boss.hp < hp1);
  });
  sectionTry('boss: Maelstrom weaves a spiral + ring-nova', () => {
    ok('maelstrom registered + scheduled', !!BOSSES.maelstrom && BOSSES.maelstrom.ai === 'boss_maelstrom' &&
      BOSS_SCHEDULE.some(s => s.boss === 'maelstrom') && ENDLESS_BOSSES.includes('maelstrom'));
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 21 });
    g.player.invuln = 1e9; const origMove = Input.moveVector; Input.moveVector = () => ({ x: 0, y: 0 });
    g.director.spawnBoss('maelstrom');
    const boss = g.enemies.find(e => e.boss);
    ok('maelstrom spawned as a boss', !!boss && boss.type.id === 'maelstrom');
    const spin0 = boss.spin;
    let maxBurst = 0, prev = g.enemyProjectiles.length;
    for (let i = 0; i < 60 * 7; i++) {
      const before = g.enemyProjectiles.length;
      g.update(1 / 60);
      const made = g.enemyProjectiles.length - before;
      if (made > maxBurst) maxBurst = made;   // the ring-nova is the biggest burst
    }
    ok('spiral angle advanced', boss.spin > spin0);
    ok('it fired a large ring-nova burst', maxBurst >= 16);
    ok('player + boss state stay finite', Number.isFinite(g.player.hp) && Number.isFinite(boss.x));
    // Reproducible on a seed: identical spin after identical scripted time.
    const g2 = new Game(document.getElementById('game')); g2.start('spark', 0, { seed: 21 });
    g2.player.invuln = 1e9; g2.director.spawnBoss('maelstrom');
    const b2 = g2.enemies.find(e => e.boss);
    for (let i = 0; i < 60 * 7; i++) g2.update(1 / 60);
    Input.moveVector = origMove;
    ok('spiral is reproducible on a seed', Math.abs(boss.spin - b2.spin) < 1e-9);
  });

  sectionTry('boss: The Ravager telegraphs then dashes across the arena', () => {
    ok('ravager registered + in endless rotation + gauntlet', !!BOSSES.ravager && BOSSES.ravager.ai === 'boss_ravager' &&
      ENDLESS_BOSSES.includes('ravager'));
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 19 });
    g.player.invuln = 1e9; const origMove = Input.moveVector; Input.moveVector = () => ({ x: 0, y: 0 });
    g.director.spawnBoss('ravager');
    const e = g.enemies.find(en => en.boss);
    ok('ravager spawned as a boss', !!e && e.type.id === 'ravager');
    e.x = g.player.x + 200; e.y = g.player.y; e.hp = 1e9; e.maxHp = 1e9;
    let sawTelegraph = false, sawDash = false, maxDashStep = 0;
    let lx = e.x, ly = e.y;
    for (let i = 0; i < 60 * 5; i++) {
      g.update(1 / 60);
      if (e.state === 1) sawTelegraph = true;
      if (e.state === 2) { sawDash = true; maxDashStep = Math.max(maxDashStep, dist(e.x, e.y, lx, ly)); }
      lx = e.x; ly = e.y;
    }
    ok('the Ravager telegraphs a charge', sawTelegraph);
    ok('the Ravager dashes', sawDash);
    ok('a dash frame covers far more ground than a stalk frame', maxDashStep > 4);
    ok('player + boss state stay finite', Number.isFinite(g.player.hp) && Number.isFinite(e.x) && Number.isFinite(e.y));
    // Reproducible on a seed: identical boss position after identical scripted time.
    const g2 = new Game(document.getElementById('game')); g2.start('spark', 0, { seed: 19 });
    g2.player.invuln = 1e9; g2.director.spawnBoss('ravager');
    const e2 = g2.enemies.find(en => en.boss); e2.x = g2.player.x + 200; e2.y = g2.player.y; e2.hp = 1e9; e2.maxHp = 1e9;
    for (let i = 0; i < 60 * 5; i++) g2.update(1 / 60);
    Input.moveVector = origMove;
    ok('the Ravager is reproducible on a seed', Math.abs(e.x - e2.x) < 1e-6 && Math.abs(e.y - e2.y) < 1e-6);
  });

  // 6) Pickups.
  sectionTry('apply all pickups', () => {
    ['health', 'magnet', 'bomb', 'chest', 'warp'].forEach(k => game.applyPickup(k));
  });
  sectionTry('pickups: Time Warp slows every foe, then wears off', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 88 });
    const e = g.spawnEnemy('runner', g.player.x + 400, g.player.y, 1, 1); e.speed = 200;
    g.buildGrid();
    // Baseline: how far a runner advances in 30 frames with no warp.
    const bx = e.x; for (let i = 0; i < 30; i++) { g.updateEnemies(1 / 60); g.buildGrid(); }
    const moved0 = Math.abs(e.x - bx);
    // Reset position; apply Time Warp and measure again — it should crawl.
    e.x = g.player.x + 400; e.y = g.player.y; g.applyPickup('warp');
    ok('time-warp timer armed', g._timeWarpT > 0);
    const wx = e.x; for (let i = 0; i < 30; i++) { g.updateEnemies(1 / 60); g.buildGrid(); }
    ok('foes move far less under Time Warp', Math.abs(e.x - wx) < moved0 * 0.6);
    // Run it out; speed returns to normal.
    for (let i = 0; i < 60 * 5; i++) g.updateEnemies(1 / 60);
    ok('Time Warp expires', g._timeWarpT <= 0);
  });
  sectionTry('passives: Bloodstone heals on kill', () => {
    ok('Bloodstone passive registered', !!PASSIVES.bloodstone);
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 93, noRelics: true });
    g.player.passives.bloodstone = 4; g.player.recalc();
    ok('lifesteal derived from the passive', g.player.lifesteal > 0);
    g.player.hp = g.player.maxHp * 0.5; const hp0 = g.player.hp;
    const e = g.spawnEnemy('drifter', g.player.x + 300, g.player.y, 1, 1);
    g.killEnemy(e);
    ok('a kill heals a Bloodstone build', g.player.hp > hp0);
  });
  sectionTry('passives: Bramble Thorns reflects contact damage on any hero', () => {
    ok('Bramble passive registered', !!PASSIVES.bramble);
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 94, noRelics: true });
    ok('no thorns without the passive', g.player.thorns === 0);
    g.player.passives.bramble = 4; g.player.recalc();
    ok('thorns derived from the passive', g.player.thorns >= 0.40 - 1e-9);
    const f = g.spawnEnemy('brute', g.player.x, g.player.y, 1, 1); f.hp = 1e6; f.maxHp = 1e6; f.damage = 20; f.x = g.player.x; f.y = g.player.y; g.player.invuln = 0; g.buildGrid();
    const hp0 = f.hp; g.updateEnemies(1 / 60);
    ok('a Bramble build reflects contact damage', f.hp < hp0);
  });
  sectionTry('pickups: Overdrive grants a timed all-offense surge', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 91 });
    const m0 = g.player.might, h0 = g.player.haste;
    g.applyPickup('overdrive');
    ok('overdrive boosts damage + attack speed', g.player.might > m0 + 1e-9 && g.player.haste > h0 + 1e-9 && g.player.hasBuff('overdrive'));
    for (let i = 0; i < 60 * 9; i++) g.player.update(1 / 60);   // past the 8s window
    ok('overdrive wears off', !g.player.hasBuff('overdrive') && Math.abs(g.player.might - m0) < 1e-4);
    // Champions reliably drop one.
    const g2 = new Game(document.getElementById('game')); g2.start('spark', 0, { seed: 92 });
    const c = g2.spawnEnemy('brute', g2.player.x + 80, g2.player.y, 1, 1); g2.makeChampion(c, 2);
    g2.killEnemy(c);
    ok('a champion drops an Overdrive', g2.pickups.some(k => k.kind === 'overdrive'));
  });

  // 5b) Blink dash: skill reposition with i-frames + cooldown.
  sectionTry('dash: blinks, grants i-frames, then goes on cooldown', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 31 });
    const p = g.player;
    p.moveDir = { x: 1, y: 0 };
    const x0 = p.x;
    const fired = p.dash();
    ok('dash fired off cooldown', fired === true);
    ok('it moved roughly the blink distance', Math.abs((p.x - x0) - p.dashDist) < 1e-6 && p.dashCd > 0);
    ok('it granted i-frames', p.invuln >= p.dashIFrames - 1e-9);
    ok('a second dash is blocked while cooling down', p.dash() === false);
    // Cooldown ticks down through update and then it can fire again.
    for (let i = 0; i < Math.ceil(p.dashCdMax * 60) + 2; i++) g.update(1 / 60);
    ok('cooldown recovers', p.dashCd <= 0 && p.dash() === true);
  });
  sectionTry('dash: clamps to the world + obeys direction', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 32 });
    const p = g.player;
    p.x = g.world.w - 10; p.y = 500; p.moveDir = { x: 1, y: 0 }; p.dashCd = 0;
    p.dash();
    ok('blink never leaves the world bounds', p.x <= g.world.w - p.radius + 1e-6 && p.x >= p.radius);
    // Diagonal blink keeps total displacement at the blink distance.
    const g2 = new Game(document.getElementById('game')); g2.start('spark', 0, { seed: 32 });
    const q = g2.player; q.x = 1000; q.y = 1000; q.moveDir = { x: 1, y: 1 }; q.dashCd = 0;
    const ox = q.x, oy = q.y; q.dash();
    ok('diagonal blink uses normalized distance', Math.abs(Math.hypot(q.x - ox, q.y - oy) - q.dashDist) < 1e-6);
  });
  sectionTry('dash: input + touch queue trigger it; harness sim never does', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 33 });
    const p = g.player; p.moveDir = { x: 0, y: -1 }; p.dashCd = 0;
    const y0 = p.y;
    Input.pressed['space'] = true;     // simulate a keypress this frame
    g.update(1 / 60);
    ok('Space triggers a blink in update', p.y < y0 && p.dashCd > 0);
    // Touch double-tap path: the queued request is consumed once.
    g._dashReq = true;
    ok('queued request consumed once', g._consumeDashRequest() === true && g._consumeDashRequest() === false);
    // The auto-sim (no input) must never dash on its own — cooldown stays full.
    const g3 = new Game(document.getElementById('game')); g3.start('spark', 0, { seed: 34 });
    Input.pressed = {};
    for (let i = 0; i < 120; i++) g3.update(1 / 60);
    ok('no phantom dashes without input', g3.player.dashCd === 0 && g3.player.dashCharges === g3.player.dashMaxCharges);
  });
  sectionTry('dash: Sanctuary upgrades tune cooldown + charges', () => {
    const l0 = { blink: Save.metaLevel('blink'), echo: Save.metaLevel('echo') };
    ok('Quickstep + Echo Step meta defined', !!getMeta('blink') && !!getMeta('echo'));
    Save.data.meta.blink = 0; Save.data.meta.echo = 0;
    const a = new Game(document.getElementById('game')); a.start('spark', 0, { seed: 35 });
    const baseCd = a.player.dashCdMax;
    ok('defaults: one charge, 3.5s recharge', a.player.dashMaxCharges === 1 && Math.abs(baseCd - 3.5) < 1e-9);
    Save.data.meta.blink = 5; Save.data.meta.echo = 1;
    const b = new Game(document.getElementById('game')); b.start('spark', 0, { seed: 35 });
    ok('Quickstep shortens the recharge', b.player.dashCdMax < baseCd - 1e-9);
    ok('Echo Step grants a second charge', b.player.dashMaxCharges === 2 && b.player.dashCharges === 2);
    b.player.moveDir = { x: 1, y: 0 };
    ok('two charges allow back-to-back blinks', b.player.dash() === true && b.player.dash() === true && b.player.dash() === false);
    Save.data.meta.blink = l0.blink; Save.data.meta.echo = l0.echo;
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
    game.player.invuln = 0;      // clear any active i-frames so the hit lands
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
  sectionTry('meta: Expanse (area) + Precision (crit) apply at run start', () => {
    ok('new metas defined', !!getMeta('expanse') && !!getMeta('precision'));
    Save.data.meta.expanse = 0; Save.data.meta.precision = 0;
    const base = new Game(document.getElementById('game')); base.start('spark', 0, { noRelics: true });
    const a0 = base.player.area, c0 = base.player.crit;
    Save.data.meta.expanse = 5; Save.data.meta.precision = 5;
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { noRelics: true });
    ok('Expanse raises area', g.player.area > a0 + 1e-9);
    ok('Precision raises crit', g.player.crit > c0 + 1e-9);
    Save.data.meta.expanse = 0; Save.data.meta.precision = 0;
  });

  // 10) Weapon evolution: every evolution pair must resolve and apply.
  sectionTry('all evolutions resolve + apply', () => {
    ok('evolved weapons registered', Object.keys(EVOLVED_WEAPONS).every(id => !!getWeapon(id)));
    for (const evo of EVOLUTIONS) {
      const g = new Game(document.getElementById('game'));
      UI.init(document.getElementById('overlay'), g);
      g.start('spark', 0);
      // Clear the starting weapon, grant the base maxed + paired passive.
      g.player.weapons = [];
      g.player.addWeapon(evo.base);
      g.player.weapon(evo.base).level = getWeapon(evo.base).maxLevel;
      g.player.passives[evo.passive] = evo.passiveLvl;
      const avail = availableEvolutions(g.player).map(e => e.into);
      ok('evolution available: ' + evo.into, avail.includes(evo.into));
      g.player.applyUpgrade({ kind: 'evolve', id: evo.into, baseId: evo.base });
      ok('evolved into ' + evo.into, g.player.hasWeapon(evo.into) && !g.player.hasWeapon(evo.base));
      // Fire the evolved weapon against foes for a bit.
      for (let k = 0; k < 24; k++) g.spawnEnemy('drifter', g.player.x + Math.cos(k) * 100, g.player.y + Math.sin(k) * 100, 1, 1);
      for (let i = 0; i < 120; i++) { g.update(1 / 60); g.render(); }
      ok('evolvedThisRun flag ' + evo.into, g.evolvedThisRun === true);
    }
  });

  // 11) Achievements unlock + reward + secret character gate.
  sectionTry('achievements unlock & reward', () => {
    Save.data.achievements = {};
    const g = new Game(document.getElementById('game'));
    g.start('spark', 0);
    g.time = 901; g.kills = 600; g.bossKills = 3; g.player.level = 31;
    const shardsBefore = Save.data.shards;
    const newly = Achievements.check(g);
    const ids = newly.map(a => a.id);
    ok('eternal unlocked', Save.hasAchievement('eternal'));
    ok('slayer unlocked', Save.hasAchievement('slayer'));
    ok('boss_slayer unlocked', Save.hasAchievement('boss_slayer'));
    ok('power unlocked', Save.hasAchievement('power'));
    ok('achievement shards rewarded', Save.data.shards > shardsBefore);
    ok('secret char Void unlockable', getCharacter('void').secret && Save.hasAchievement('eternal'));
    // Long-haul milestone achievements use the run context directly.
    const g2 = new Game(document.getElementById('game')); g2.start('spark', 0);
    g2.time = 1201; g2.score = 260000; g2.player.level = 41;
    const ctx = Achievements.context(g2);
    ok('marathon/legend/ace fire on a huge run', getAchievement('marathon').check(ctx) && getAchievement('legend').check(ctx) && getAchievement('ace').check(ctx));
    // Content-mastery goals read the new run counters.
    const g3 = new Game(document.getElementById('game')); g3.start('spark', 0);
    g3.executes = 100; g3.riftsOpened = 60; g3.reflectedDamage = 3000; g3.ricochets = 1200;
    const c3 = Achievements.context(g3);
    ok('Harvester/Riftborn/Unbroken fire on their counters', getAchievement('harvester').check(c3) && getAchievement('riftborn').check(c3) && getAchievement('unbroken').check(c3));
    ok('Ricochet/Pinball fire on the bounce counter', getAchievement('ricochet').check(c3) && getAchievement('pinball').check(c3));
    const g4 = new Game(document.getElementById('game')); g4.start('spark', 0);
    const c4 = Achievements.context(g4);
    ok('content goals stay locked at zero', !getAchievement('harvester').check(c4) && !getAchievement('riftborn').check(c4) && !getAchievement('unbroken').check(c4) && !getAchievement('ricochet').check(c4));
  });
  sectionTry('counters: execute / rift / thorns increment in the sim', () => {
    // Reaper execute increments the run counter.
    const gr = new Game(document.getElementById('game')); gr.start('reaper', 0, { seed: 51, noRelics: true });
    gr.player.crit = 0; gr.player.weapons = [];
    const e = gr.spawnEnemy('brute', gr.player.x + 300, gr.player.y, 1, 1); e.hp = e.maxHp * 0.1;
    gr.dealDamage(e, 1, gr.player.x, gr.player.y, 0);
    ok('execute counter ticked', gr.executes >= 1);
    // Opening a pull/burst rift increments riftsOpened; a plain zone does not.
    const gz = new Game(document.getElementById('game')); gz.start('spark', 0, { seed: 52 });
    gz.spawnZone(100, 100, 80, 5, 1, '#fff');
    ok('plain zone does not count as a rift', gz.riftsOpened === 0);
    gz.spawnZone(100, 100, 80, 5, 1, '#b98bff', 0, { pull: 100, burst: 50 });
    ok('a rift cast counts', gz.riftsOpened === 1);
    // Sentinel thorns accrues reflected damage on a connecting hit.
    const gs = new Game(document.getElementById('game')); gs.start('sentinel', 0, { seed: 53, noRelics: true });
    const f = gs.spawnEnemy('brute', gs.player.x, gs.player.y, 1, 1); f.hp = 1e6; f.maxHp = 1e6; f.damage = 20; f.x = gs.player.x; f.y = gs.player.y; gs.player.invuln = 0; gs.buildGrid();
    gs.updateEnemies(1 / 60);
    ok('reflected-damage counter accrues', gs.reflectedDamage > 0);
  });
  sectionTry('boss log: per-type kills tracked + boss achievements', () => {
    Save.data.bossLog = {}; Save.data.achievements = {};
    ok('apex + nemesis achievements defined', !!getAchievement('apex') && !!getAchievement('nemesis'));
    ok('fresh log: nothing slain', Save.bossTypesSlain() === 0 && Save.bossKillsOf('warden') === 0);
    Save.recordBossKill('warden'); Save.recordBossKill('warden');
    ok('recordBossKill tallies per type', Save.bossKillsOf('warden') === 2 && Save.bossTypesSlain() === 1);
    // Killing a boss in-game logs it.
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 41 });
    g.director.spawnBoss('colossus');
    const boss = g.enemies.find(e => e.boss);
    g.dealDamage(boss, 1e9, g.player.x, g.player.y, 0);
    for (let i = 0; i < 20 && g.enemies.some(e => e.boss); i++) g.update(1 / 60);
    ok('a slain boss is logged by type', Save.bossKillsOf('colossus') >= 1);
    // Apex: slay one of every boss type => unlocked.
    for (const id of Object.keys(BOSSES)) Save.recordBossKill(id);
    ok('all boss types slain', Save.bossTypesSlain() === Object.keys(BOSSES).length);
    const ctx = Achievements.context(null);
    ok('Apex Predator met with all types', getAchievement('apex').check(ctx) === true);
    // Nemesis: 25 lifetime boss kills.
    Save.data.bossKills = 25;
    ok('Nemesis met at 25 lifetime bosses', getAchievement('nemesis').check(Achievements.context(null)) === true);
    Save.data.bossLog = {}; Save.data.achievements = {}; Save.data.bossKills = 0;
  });

  // 12) Difficulty scaling applies to spawned enemies.
  sectionTry('difficulty scaling', () => {
    const gN = new Game(document.getElementById('game')); gN.start('spark', 0);
    const eN = gN.spawnEnemy('drifter', 100, 100, 1, 1);
    const gH = new Game(document.getElementById('game')); gH.start('spark', 2);
    const eH = gH.spawnEnemy('drifter', 100, 100, 1, 1);
    ok('nightmare HP > normal HP', eH.maxHp > eN.maxHp);
    ok('nightmare DMG > normal DMG', eH.damage > eN.damage);
    ok('diff index set', gH.diffIndex === 2);
  });

  // 13) New menu screens build without error.
  sectionTry('UI.showAchievements/showCodex/charSelect', () => {
    Save.data.maxDifficulty = 3;            // exercise difficulty buttons
    Save.markSeen('enemies', 'drifter'); Save.markSeen('weapons', 'bolt');
    UI.showAchievements();
    UI.showCodex();
    UI.showCharacterSelect();
    const gOver = new Game(document.getElementById('game')); gOver.start('spark', 1);
    gOver.lastNewAchievements = [getAchievement('survivor')];
    gOver.lastUnlockedDiff = DIFFICULTIES[2];
    gOver.player.invuln = 0; gOver.player.revives = 0; gOver.player.hurt(1e9);
    UI.showGameOver(gOver);
  });

  // 14) Fixed-timestep stability: a stutter must not explode the sim.
  sectionTry('big-dt clamp stable', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0);
    g.update(0.05); g.update(0.05); // engine clamps internally
    ok('time advanced sanely', g.time > 0 && Number.isFinite(g.player.x));
  });

  // 15) Run modifiers ("omens"): every omen applies + a run plays cleanly.
  sectionTry('every omen applies + run is stable', () => {
    // Baseline (no omen) stats for comparison.
    const g0 = new Game(document.getElementById('game')); g0.start('spark', 0);
    const baseHp = g0.player.maxHp, baseMight = g0.player.might;
    for (const mo of MODIFIER_LIST) {
      const g = new Game(document.getElementById('game'));
      UI.init(document.getElementById('overlay'), g);
      g.start('spark', 0, { omen: mo.id });
      ok('omen set: ' + mo.id, g.omen && g.omen.id === mo.id);
      // Run a short burst with foes present — must not crash / NaN.
      for (let k = 0; k < 30; k++) g.spawnEnemy('drifter', g.player.x + Math.cos(k) * 90, g.player.y + Math.sin(k) * 90, 1, 1);
      for (let i = 0; i < 120; i++) { g.update(1 / 60); g.render(); }
      ok('omen run finite: ' + mo.id, Number.isFinite(g.player.x) && Number.isFinite(g.player.hp));
    }
    // Spot-check a couple of concrete effects.
    const gg = new Game(document.getElementById('game')); gg.start('spark', 0, { omen: 'glass' });
    ok('glass cannon halves HP', gg.player.maxHp < baseHp && gg.player.might > baseMight);
    const gv = new Game(document.getElementById('game')); gv.start('spark', 0, { omen: 'vampire' });
    gv.player.hp = 1; gv.spawnEnemy('drifter', gv.player.x, gv.player.y, 1, 1);
    const before = gv.player.hp;
    gv.killEnemy(gv.enemies[0]);
    ok('vampiric heals on kill', gv.player.hp > before);
    // Channel-driven omens (Volley / Lancet / Thornward) actually move the stats.
    const gp = new Game(document.getElementById('game')); gp.start('spark', 0, { omen: 'volley' });
    ok('Volley adds a projectile', gp.player.bonusProj === g0.player.bonusProj + 1);
    const gl = new Game(document.getElementById('game')); gl.start('spark', 0, { omen: 'lancet' });
    ok('Lancet adds pierce', gl.player.bonusPierce === g0.player.bonusPierce + 2);
    const gt = new Game(document.getElementById('game')); gt.start('spark', 0, { omen: 'thornward' });
    ok('Thornward grants thorns to any hero', gt.player.thorns >= 0.40 - 1e-9);
  });
  sectionTry('omen draft builds + omen achievement', () => {
    ok('draftOmens returns 3 distinct', new Set(draftOmens(3).map(o => o.id)).size === 3);
    Save.data.achievements = {};
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { omen: 'frenzy' });
    g.time = 301;
    Achievements.check(g);
    ok('omened achievement unlocks', Save.hasAchievement('omened'));
    UI.showOmenDraft('spark', 0);   // builds without error
  });

  // 11.4) Elites, affixes, champions, new foes (v8).
  sectionTry('elites: data + new archetypes registered', () => {
    ok('stalker archetype', !!ENEMY_TYPES.stalker && ENEMY_TYPES.stalker.ai === 'stalker');
    ok('bomber archetype', !!ENEMY_TYPES.bomber && ENEMY_TYPES.bomber.ai === 'bomber' && ENEMY_TYPES.bomber.explodes === true);
    ok('conjurer archetype', !!ENEMY_TYPES.conjurer && ENEMY_TYPES.conjurer.ai === 'summoner' &&
      ENEMY_TYPES.conjurer.summonCount > 0 && ENEMY_TYPES.conjurer.summonType === 'swarm');
    ok('acolyte archetype', !!ENEMY_TYPES.acolyte && ENEMY_TYPES.acolyte.ai === 'warder' && ENEMY_TYPES.acolyte.auraR > 0);
    ok('bombardier archetype', !!ENEMY_TYPES.bombardier && ENEMY_TYPES.bombardier.ai === 'lobber' && ENEMY_TYPES.bombardier.blastR > 0);
    ok('AFFIXES table has 11', Object.keys(AFFIXES).length === 11 && !!getAffix('cloven') && !!getAffix('searing'));
  });
  sectionTry('elites: Searing lays a damaging ground trail', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 64 });
    const e = g.spawnEnemy('brute', g.player.x + 300, g.player.y, 1, 1);
    g._applyAffix(e, 'searing'); ok('searing flag set', e.searing === true);
    // Run the enemy update enough for the drop timer to elapse; it should leave a field hazard.
    g.player.invuln = 1e9; const origMove = Input.moveVector; Input.moveVector = () => ({ x: 0, y: 0 });
    let sawField = false;
    for (let i = 0; i < 60 * 3; i++) { g.update(1 / 60); if (g.hazards.some(h => h.kind === 'field')) sawField = true; }
    ok('searing dropped a field hazard', sawField);
    Input.moveVector = origMove;
    // The trail hurts the player standing in it (hazard path, not the weapon-zone path).
    // Use a fresh, durable foe with weapons cleared so it survives to drop a patch.
    g.player.weapons = []; g.hazards.length = 0;
    const e2 = g.spawnEnemy('brute', g.player.x, g.player.y, 1, 1); e2.hp = 1e6; e2.maxHp = 1e6;
    g._applyAffix(e2, 'searing'); e2.searTimer = 0; e2.x = g.player.x; e2.y = g.player.y;
    g.buildGrid();
    g.updateEnemies(1 / 60);
    const h = g.hazards.find(z => z.kind === 'field');
    ok('a fresh scorch patch exists on the player', !!h);
    if (h) { h.phase = 'active'; h.t = 0; }
    const hp0 = g.player.hp;
    for (let i = 0; i < 30; i++) { g.player.invuln = 0; g.updateHazards(1 / 60); }
    ok('standing on the scorch costs health', g.player.hp < hp0);
  });
  sectionTry('elites: Cloven bursts into lesser foes on death', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 96 });
    const e = g.spawnEnemy('brute', g.player.x + 300, g.player.y, 1, 1);
    g._applyAffix(e, 'cloven'); ok('cloven flag set', e.cloven === true);
    const motes0 = g.enemies.filter(o => o.type.id === 'swarm').length;
    g.killEnemy(e);
    ok('slaying a Cloven elite spawns motes', g.enemies.filter(o => o.type.id === 'swarm').length >= motes0 + 2);
    // A plain foe spawns nothing on death (killEnemy doesn't splice — the loop does).
    const g2 = new Game(document.getElementById('game')); g2.start('spark', 0, { seed: 97 });
    const p = g2.spawnEnemy('brute', g2.player.x + 300, g2.player.y, 1, 1);
    const m0 = g2.enemies.length;
    g2.killEnemy(p);
    ok('a plain foe does not split', g2.enemies.length === m0 && !g2.enemies.some(o => o.type.id === 'swarm'));
  });
  sectionTry('enemies: bombardier lobs telegraphed ground strikes', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 63 });
    g.player.weapons = []; g.player.invuln = 1e9;
    const origMove = Input.moveVector; Input.moveVector = () => ({ x: 0, y: 0 });
    g.spawnEnemy('bombardier', g.player.x + 300, g.player.y, 1, 1);
    let sawStrike = false;
    for (let i = 0; i < 60 * 6; i++) { g.update(1 / 60); if (g.hazards.some(h => h.kind === 'strike')) sawStrike = true; }
    Input.moveVector = origMove;
    ok('bombardier created a telegraphed strike hazard', sawStrike);
    ok('state stays finite under bombardment', Number.isFinite(g.player.x) && Number.isFinite(g.player.hp));
  });
  sectionTry('enemies: acolyte wards nearby foes (faster + tougher)', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 61 });
    g.player.weapons = []; g.player.crit = 0; g.player.x = 200; g.player.y = 200;
    const ac = g.spawnEnemy('acolyte', 1500, 1500, 1, 1);
    const d = g.spawnEnemy('drifter', 1500 + 30, 1500 + 30, 1, 1);   // inside the aura
    for (let i = 0; i < 6; i++) g.update(1 / 60);
    ok('a foe inside the aura is warded', d.warded > 0);
    // A warded foe takes less damage than an identical unwarded one.
    const dhp = d.hp; g.dealDamage(d, 20, d.x, d.y, 0); const wardedLoss = dhp - d.hp;
    const u = g.spawnEnemy('drifter', 200, 2400, 1, 1); u.warded = 0;   // far from the acolyte
    const uhp = u.hp; g.dealDamage(u, 20, u.x, u.y, 0); const plainLoss = uhp - u.hp;
    ok('warded foe resists damage', wardedLoss > 0 && wardedLoss < plainLoss - 1e-9);
    // The ward decays once a foe leaves the aura (isolate: no acolyte nearby).
    const lone = g.spawnEnemy('drifter', 200, 2600, 1, 1); lone.warded = 0.5;
    const w0 = lone.warded; for (let i = 0; i < 6; i++) g.update(1 / 60);
    ok('ward decays away from the aura', lone.dead || lone.warded < w0);
  });
  sectionTry('enemies: conjurer summons motes (deterministic, capped)', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 11 });
    g.player.weapons = [];            // don't let our own fire delete the spawns
    const origMove = Input.moveVector;
    g.player.invuln = 1e9; Input.moveVector = () => ({ x: 0, y: 0 });
    const c = g.spawnEnemy('conjurer', g.player.x + 400, g.player.y, 1, 1);
    const id = c.id;
    const motes0 = g.enemies.filter(e => e.type.id === 'swarm').length;
    let cast = false;
    for (let i = 0; i < 60 * 6; i++) { g.update(1 / 60); if (g.enemies.some(e => e.id === id && e.castFx > 0)) cast = true; }
    const motes1 = g.enemies.filter(e => e.type.id === 'swarm').length;
    ok('conjurer raised new motes', motes1 > motes0);
    ok('summon telegraph fired', cast);
    ok('motes never exceed the hard cap', g.enemies.length <= g.maxEnemies);
    // Deterministic: same seed + same scripted inputs => identical mote count.
    const g2 = new Game(document.getElementById('game')); g2.start('spark', 0, { seed: 11 });
    g2.player.weapons = []; g2.player.invuln = 1e9;
    g2.spawnEnemy('conjurer', g2.player.x + 400, g2.player.y, 1, 1);
    for (let i = 0; i < 60 * 6; i++) g2.update(1 / 60);
    const motes2 = g2.enemies.filter(e => e.type.id === 'swarm').length;
    Input.moveVector = origMove;
    ok('summoning is reproducible on a seed', motes1 === motes2);
  });
  sectionTry('elites: makeElite scales + assigns affix', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 3 });
    const e = g.spawnEnemy('drifter', g.player.x + 120, g.player.y, 1, 1);
    const baseHp = e.maxHp, baseDmg = e.damage, baseXp = e.xp;
    g.makeElite(e, 1, false);
    ok('elite flagged', e.elite === true);
    ok('elite has 1 affix', e.affixes.length === 1);
    ok('elite hp scaled up', e.maxHp > baseHp && e.hp === e.maxHp);
    ok('elite damage + xp scaled', e.damage > baseDmg && e.xp > baseXp);
  });
  sectionTry('elites: hardened resists, shield absorbs', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 4 });
    g.player.crit = 0; // remove crit variance for exact arithmetic
    const e = g.spawnEnemy('brute', g.player.x + 80, g.player.y, 1, 1);
    g._applyAffix(e, 'hardened'); e.maxHp = e.hp;
    const hp0 = e.hp; g.dealDamage(e, 100, g.player.x, g.player.y, 0);
    ok('hardened reduces damage taken', (hp0 - e.hp) < 100 && (hp0 - e.hp) > 0);
    const s = g.spawnEnemy('brute', g.player.x + 80, g.player.y, 1, 1);
    g._applyAffix(s, 'shielded'); const shp = s.hp, shield = s.shield;
    g.dealDamage(s, shield * 0.5, g.player.x, g.player.y, 0);
    ok('shield absorbs (hp intact)', s.hp === shp && s.shield < shield);
    g.dealDamage(s, shield, g.player.x, g.player.y, 0);
    ok('hp drops once shield is gone', s.hp < shp);
  });
  sectionTry('elites: regen heals, volatile bursts, arcane fires', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 5 });
    g.player.weapons = []; // isolate affix behavior from the player's own damage
    const r = g.spawnEnemy('brute', g.player.x + 300, g.player.y, 1, 1);
    g._applyAffix(r, 'regen'); r.hp = r.maxHp * 0.5; const h0 = r.hp;
    for (let i = 0; i < 90; i++) g.update(1 / 60);
    ok('regen healed over time', r.hp > h0);
    const v = g.spawnEnemy('brute', g.player.x + 80, g.player.y, 1, 1);
    g._applyAffix(v, 'volatile'); const proj0 = g.enemyProjectiles.length;
    g.killEnemy(v);
    ok('volatile burst on death', g.enemyProjectiles.length > proj0);
    // Arcane: freeze a dummy at range (and the player) so its purple bolt is
    // observable in flight rather than being absorbed on the same frame.
    const a = g.spawnEnemy('brute', g.player.x + 220, g.player.y, 1, 1);
    a.speed = 0; g._applyAffix(a, 'arcane');
    const savedMV = Input.moveVector; Input.moveVector = () => ({ x: 0, y: 0 });
    let fired = false;
    for (let i = 0; i < 60 * 4 && !fired; i++) { g.player.invuln = 9999; g.update(1 / 60); if (g.enemyProjectiles.some(pr => pr.color === '#c98bff')) fired = true; }
    Input.moveVector = savedMV;
    ok('arcane fires bolts', fired);
  });
  sectionTry('elites: leech heals, frenzied speeds, phaser blinks', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 81 });
    g.player.weapons = [];
    // Leech: a connecting hit heals the attacker; an i-framed hit does not.
    const lz = g.spawnEnemy('brute', g.player.x, g.player.y, 1, 1);
    g._applyAffix(lz, 'leech'); lz.hp = lz.maxHp * 0.5; const lh0 = lz.hp;
    g.player.invuln = 0; g.update(1 / 60);
    ok('leech healed on a connecting hit', lz.hp > lh0);
    // Frenzied: a badly wounded one outruns a healthy copy over the same time.
    const a = g.spawnEnemy('drifter', g.player.x + 600, g.player.y, 1, 1); g._applyAffix(a, 'frenzied'); a.hp = a.maxHp * 0.1;
    const b = g.spawnEnemy('drifter', g.player.x + 600, g.player.y + 4, 1, 1); g._applyAffix(b, 'frenzied'); b.hp = b.maxHp;
    const aD0 = dist(a.x, a.y, g.player.x, g.player.y), bD0 = dist(b.x, b.y, g.player.x, g.player.y);
    for (let i = 0; i < 30; i++) g.update(1 / 60);
    ok('frenzied (wounded) closes faster', (aD0 - dist(a.x, a.y, g.player.x, g.player.y)) > (bD0 - dist(b.x, b.y, g.player.x, g.player.y)));
    // Phaser: lunges toward the player when its timer fires.
    const ph = g.spawnEnemy('drifter', g.player.x + 500, g.player.y, 1, 1); ph.speed = 0; g._applyAffix(ph, 'phaser'); ph.phaseT = 0.01;
    const pd0 = dist(ph.x, ph.y, g.player.x, g.player.y);
    g.player.invuln = 1e9; for (let i = 0; i < 4; i++) g.update(1 / 60);
    ok('phaser blinked closer', dist(ph.x, ph.y, g.player.x, g.player.y) < pd0 - 80);
  });
  sectionTry('elites: bomber detonates safely in the update loop', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 6 });
    const b = g.spawnEnemy('bomber', g.player.x + 40, g.player.y, 1, 1);
    const id = b.id; const proj0 = g.enemyProjectiles.length;
    let gone = false;
    for (let i = 0; i < 60 * 3 && !gone; i++) { g.update(1 / 60); if (!g.enemies.some(en => en.id === id)) gone = true; }
    ok('bomber detonated + removed', gone);
    ok('bomber burst projectiles', g.enemyProjectiles.length > proj0);
    ok('player state finite after bomber', Number.isFinite(g.player.hp) && Number.isFinite(g.player.x));
  });
  sectionTry('elites: champion event + rewards + achievements', () => {
    Save.data.achievements = {};
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 7 });
    const e = g.spawnEnemy('brute', g.player.x + 200, g.player.y, 1, 1);
    g.makeChampion(e, 2);
    ok('champion flagged (not boss)', e.champion === true && e.boss === false);
    ok('champion has 2 affixes + name', e.affixes.length === 2 && !!e.eliteName);
    const pickups0 = g.pickups.length;
    g.dealDamage(e, 1e9, g.player.x, g.player.y, 0);
    ok('championKills incremented', g.championKills === 1);
    ok('champion dropped a chest', g.pickups.some(k => k.kind === 'chest'));
    // Elite kill counter.
    const el = g.spawnEnemy('drifter', g.player.x + 60, g.player.y, 1, 1); g.makeElite(el, 1, false);
    const ek0 = g.eliteKills; g.dealDamage(el, 1e9, g.player.x, g.player.y, 0);
    ok('eliteKills incremented', g.eliteKills === ek0 + 1);
    g.eliteKills = 25; g.championKills = 1; Achievements.check(g);
    ok('elite_hunter unlocks', Save.hasAchievement('elite_hunter'));
    ok('champion_slayer unlocks', Save.hasAchievement('champion_slayer'));
  });

  // 11.45) Relics (v9): unlock/equip loadout + effects fold into game.mods.
  sectionTry('relics: registry + slot ramp', () => {
    ok('RELIC_LIST non-empty', RELIC_LIST.length >= 12 && !!getRelic('glass_lens'));
    ok('slot ramp 2/3/4 capped', relicSlots(0) === 2 && relicSlots(4) === 3 && relicSlots(8) === 4 && relicSlots(99) === 4);
  });
  sectionTry('relics: applyRelics folds into mods', () => {
    const m = defaultMods(); applyRelics(m, ['glass_lens', 'titan_heart']);
    ok('glass lens raises damage', Math.abs(m.dmgMul - 1.25) < 1e-9);
    ok('relics stack hp mults', Math.abs(m.hpMul - (0.85 * 1.30)) < 1e-9);
    const m2 = defaultMods(); applyRelics(m2, ['phoenix_feather', 'mending_root']);
    ok('phoenix adds revive', m2.reviveBonus === 1);
    ok('mending adds regen', Math.abs(m2.regenBonus - 1.0) < 1e-9);
  });
  sectionTry('relics: Bramble Mail (thorns) + Split Sigil (projectiles)', () => {
    ok('both relics registered', !!getRelic('bramble_mail') && !!getRelic('split_sigil'));
    const m = defaultMods(); applyRelics(m, ['bramble_mail', 'split_sigil']);
    ok('thorns + projectile fold into mods', m.thornsBonus >= 0.30 - 1e-9 && m.addProj >= 1);
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 91, noRelics: true });
    const bonus0 = g.player.bonusProj;
    g.relics = ['bramble_mail', 'split_sigil']; g.mods = applyRelics(defaultMods(), g.relics);
    g.player.recalc();
    ok('Split Sigil adds a projectile', g.player.bonusProj === bonus0 + 1);
    ok('Bramble Mail grants thorns to a plain hero', g.player.thorns >= 0.30 - 1e-9);
    // Relic thorns reflects in the contact path (no hero perk needed).
    const f = g.spawnEnemy('brute', g.player.x, g.player.y, 1, 1); f.hp = 1e6; f.maxHp = 1e6; f.damage = 20; f.x = g.player.x; f.y = g.player.y; g.player.invuln = 0; g.buildGrid();
    const hp0 = f.hp; g.updateEnemies(1 / 60);
    ok('relic thorns wounds an attacker', f.hp < hp0);
  });
  sectionTry('relics: Piercers Eye (pierce/ricochet) + Swift Quiver (proj speed)', () => {
    ok('both relics registered', !!getRelic('piercer_eye') && !!getRelic('swift_quiver'));
    const m = defaultMods(); applyRelics(m, ['piercer_eye', 'swift_quiver']);
    ok('pierce + projectile-speed fold into mods', m.addPierce >= 1 && Math.abs(m.projSpeedMul - 1.20) < 1e-9);
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 73, noRelics: true });
    const pierce0 = g.player.bonusPierce, ps0 = g.player.projSpeed;
    g.relics = ['piercer_eye', 'swift_quiver']; g.mods = applyRelics(defaultMods(), g.relics);
    g.player.recalc();
    ok('Piercers Eye adds pierce (which Glint spends as a ricochet)', g.player.bonusPierce === pierce0 + 1);
    ok('Swift Quiver speeds projectiles', g.player.projSpeed > ps0 + 1e-9);
  });
  sectionTry('relics: save unlock/equip + slot cap', () => {
    Save.data.relics = {}; Save.data.equipped = [];
    ['glass_lens', 'titan_heart', 'chrono_core', 'feathercharm', 'magnetar'].forEach(id => Save.unlockRelic(id));
    ok('5 relics -> 3 slots', Save.relicSlotCount() === 3);
    Save.toggleEquip('glass_lens'); Save.toggleEquip('titan_heart'); Save.toggleEquip('chrono_core');
    ok('3 equipped', Save.equippedRelics().length === 3);
    Save.toggleEquip('feathercharm');
    ok('cannot exceed slots', !Save.isEquipped('feathercharm') && Save.equippedRelics().length === 3);
    Save.toggleEquip('glass_lens');
    ok('unequip frees a slot', Save.equippedRelics().length === 2 && !Save.isEquipped('glass_lens'));
  });
  sectionTry('relics: applied at run start, daily ignores them', () => {
    Save.data.relics = {}; Save.data.equipped = [];
    const g0 = new Game(document.getElementById('game')); g0.start('spark', 0, { seed: 2 });
    const baseMax = g0.player.maxHp;
    Save.unlockRelic('titan_heart'); Save.toggleEquip('titan_heart');
    const g1 = new Game(document.getElementById('game')); g1.start('spark', 0, { seed: 2 });
    ok('titan heart raises maxHp', g1.player.maxHp > baseMax);
    ok('relic active in run', g1.relics.indexOf('titan_heart') >= 0);
    Save.unlockRelic('phoenix_feather'); Save.toggleEquip('phoenix_feather');
    const g2 = new Game(document.getElementById('game')); g2.start('spark', 0, { seed: 2 });
    ok('phoenix grants a revive', g2.player.revives >= 1);
    const gd = new Game(document.getElementById('game')); gd.start('spark', 0, { daily: true, date: '2026-06-18' });
    ok('daily ignores relics', gd.relics.length === 0);
  });
  sectionTry('relics: achievements (hunter + attuned)', () => {
    Save.data.achievements = {}; Save.data.relics = {}; Save.data.equipped = [];
    ['glass_lens', 'titan_heart', 'chrono_core', 'feathercharm', 'magnetar', 'wide_eye'].forEach(id => Save.unlockRelic(id));
    Achievements.check(new Game(document.getElementById('game')));
    ok('relic_hunter unlocks at 6', Save.hasAchievement('relic_hunter'));
    Save.toggleEquip('glass_lens'); Save.toggleEquip('titan_heart'); Save.toggleEquip('chrono_core');
    Achievements.check(new Game(document.getElementById('game')));
    ok('attuned unlocks on full loadout', Save.hasAchievement('attuned'));
    // Clean up so equipped relics don't leak into later sections.
    Save.data.relics = {}; Save.data.equipped = [];
  });
  sectionTry('relics: synergy-aware relics scale with active synergies', () => {
    ok('synergy relics registered', ['resonance', 'harmonics', 'confluence'].every(id => {
      const r = getRelic(id); return r && typeof r.synergyMods === 'function';
    }));
    // Pure-function checks (threshold + per-synergy scaling).
    ok('harmonics scales per synergy', (() => { const h = getRelic('harmonics').synergyMods(2); return Math.abs(h.hasteMul - 1.10) < 1e-9 && Math.abs(h.speedMul - 1.08) < 1e-9; })());
    ok('confluence dormant under 3', Object.keys(getRelic('confluence').synergyMods(2)).length === 0);
    ok('confluence fires at 3+', (() => { const c = getRelic('confluence').synergyMods(3); return Math.abs(c.dmgMul - 1.20) < 1e-9 && c.armorBonus === 2; })());
    // Integration: the bonus flows through recalc off the live arsenal.
    Save.data.relics = {}; Save.data.equipped = [];
    const mkWild = (g) => { g.player.weapons = []; g.player.addWeapon('flame'); g.player.addWeapon('toxin'); g.player.recalc(true); };
    const base = new Game(document.getElementById('game')); base.start('spark', 0, { seed: 7, noRelics: true });
    mkWild(base);
    ok('one synergy active (Wildfire)', base.player.synergies.length === 1);
    const baseMight = base.player.might;
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 7, noRelics: true });
    g.relics = ['resonance'];
    mkWild(g);
    ok('Resonance adds +8% damage per synergy', Math.abs(g.player.might - baseMight * 1.08) < 1e-4);
    // No synergies => synergy relics are inert (×1.00).
    const g2 = new Game(document.getElementById('game')); g2.start('spark', 0, { seed: 7, noRelics: true });
    g2.relics = ['resonance']; g2.player.weapons = []; g2.player.recalc(true);
    const plainMight = (new Game(document.getElementById('game')));
    plainMight.start('spark', 0, { seed: 7, noRelics: true }); plainMight.player.weapons = []; plainMight.player.recalc(true);
    ok('Resonance inert with no synergies', Math.abs(g2.player.might - plainMight.player.might) < 1e-9);
  });

  // 11.6) Run History / Chronicle (v10): snapshots, cap, and the screen.
  sectionTry('history: snapshot captures run shape', () => {
    Save.data.history = [];
    const g = new Game(document.getElementById('game'));
    g.start('comet', 1, { seed: 7, omen: 'glass' });
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    const snap = g.runSnapshot(123);
    ok('snapshot char + mode', snap.char === 'comet' && snap.mode === 'survival');
    ok('snapshot records difficulty', snap.diff === 1 && typeof snap.diffName === 'string');
    ok('snapshot captures the omen', snap.omen === 'glass');
    ok('snapshot lists weapons w/ icon+level', snap.weapons.length >= 1 && !!snap.weapons[0].icon && snap.weapons[0].level >= 1);
    ok('snapshot carries shards earned + timestamp', snap.shards === 123 && snap.t > 0);
  });
  sectionTry('history: recordHistory orders newest-first and caps', () => {
    Save.data.history = [];
    for (let i = 0; i < Save.HISTORY_CAP + 5; i++) Save.recordHistory({ t: i, score: i, mode: 'survival', weapons: [] });
    ok('history capped at HISTORY_CAP', Save.data.history.length === Save.HISTORY_CAP);
    ok('newest run is first', Save.data.history[0].score === Save.HISTORY_CAP + 4);
  });
  sectionTry('history: a real game-over writes a snapshot', () => {
    Save.data.history = [];
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 3 });
    for (let i = 0; i < 30; i++) g.update(1 / 60);
    g.player.invuln = 0; g.player.revives = 0; g.player.hurt(1e9);
    ok('game over appended a run', Save.data.history.length === 1 && Save.data.history[0].char === 'spark');
  });
  sectionTry('history: daily mode tags correctly', () => {
    const gd = new Game(document.getElementById('game')); gd.start('spark', 0, { daily: true, date: '2026-01-01' });
    ok('daily snapshot tagged daily', gd.runSnapshot(0).mode === 'daily');
  });
  sectionTry('UI.showHistory renders (empty + populated)', () => {
    Save.data.history = [];
    UI.showHistory();
    Save.recordHistory({ t: Date.now(), mode: 'gauntlet', char: 'spark', charName: 'Spark', charColor: '#fff', diff: 2, diffName: 'Nightmare', diffColor: '#f00', time: 200, score: 5000, kills: 300, bosses: 4, level: 22, rounds: 6, relics: ['glass_lens'], omenIcon: '☠', omenColor: '#f00', weapons: [{ icon: '✦', color: '#fff', level: 8, evo: true }], shards: 99 });
    UI.showHistory();
    Save.data.history = [];
  });

  // 11.7) Audio pass (v11): limiter, new combat SFX, adaptive/boss music.
  sectionTry('audio: limiter + new combat SFX build cleanly', () => {
    Audio2.enabled = true; Audio2.muted = false; Audio2.musicMuted = false;
    Audio2.init();
    ok('master chain + limiter built', !!Audio2.master && !!Audio2.sfxGain && !!Audio2.musicGain && !!Audio2.limiter);
    Audio2.crit(); Audio2.eliteDie(); Audio2.championWarn(); Audio2.enemyDie();
    ok('new SFX callable without throwing', true);
  });
  sectionTry('audio: gate throttles repeated sounds', () => {
    Audio2._gates = {};
    const a = Audio2._gate('t', 1e6), b = Audio2._gate('t', 1e6);
    ok('first allowed, immediate repeat blocked', a === true && b === false);
  });
  sectionTry('audio: intensity & boss mode drive tempo', () => {
    Audio2.setBossMode(false); Audio2.setIntensity(0);
    const calm = Audio2._targetInterval();
    Audio2.setIntensity(1);
    const fast = Audio2._targetInterval();
    ok('higher intensity => faster tempo', fast < calm);
    Audio2.setBossMode(true);
    ok('boss mode flagged + tempo not slower', Audio2._bossMode === true && Audio2._targetInterval() <= fast);
    Audio2.setBossMode(false);
  });
  sectionTry('audio: music starts and stops cleanly', () => {
    Audio2.startMusic(0);
    ok('music started', Audio2._started === true);
    Audio2.setIntensity(0.8);      // exercise retempo + volume swell
    Audio2.stopMusic();
    ok('music stopped + boss reset', Audio2._started === false && Audio2._bossMode === false);
  });
  sectionTry('audio: a live Champion flips boss music', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 9 });
    Audio2.setBossMode(false);
    const c = g.spawnEnemy('brute', g.player.x + 200, g.player.y, 5, 1);
    g.makeChampion(c, 1);
    g.update(1 / 60);
    ok('boss mode engaged while a Champion lives', Audio2._bossMode === true);
  });

  // 11.8) Biomes (v12): time-driven stage progression + spawn bias.
  sectionTry('biomes: registry + time mapping', () => {
    ok('biome list non-empty', Array.isArray(BIOMES) && BIOMES.length >= 3);
    ok('t=0 is first biome', biomeIndexForTime(0) === 0 && biomeForTime(0) === BIOMES[0]);
    ok('crosses at BIOME_SECONDS', biomeIndexForTime(BIOME_SECONDS - 1) === 0 && biomeIndexForTime(BIOME_SECONDS + 1) === 1);
    ok('cycles past the list', biomeForTime(BIOME_SECONDS * BIOMES.length + 1) === BIOMES[0]);
  });
  sectionTry('biomes: updateBiome transitions + announces', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 4 });
    ok('starts in biome 0', g.biomeIndex === 0);
    g.toasts = []; g.time = BIOME_SECONDS + 0.1;
    g.updateBiome(0.1);
    ok('advanced to biome 1', g.biomeIndex === 1 && g.biome === BIOMES[1]);
    ok('transition flashed + toasted', g._biomeFlash > 0 && g.toasts.length >= 1);
  });
  sectionTry('biomes: spawn bias steers pickType (deterministic)', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 12 });
    g.biome = { id: 'test', name: 'T', base: '#000', grid: '#111', accent: '#fff', nebula: [[1, 2, 3]], bias: { drifter: 1000 } };
    let drifters = 0;
    for (let i = 0; i < 60; i++) if (g.director.pickType(1).id === 'drifter') drifters++;
    ok('heavy bias makes the favored foe dominate', drifters >= 45);
  });
  sectionTry('biomes: replay retints + render survives a flash', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 1 });
    g._biomeFlash = 1; g.biome = BIOMES[2];
    g.render();
    ok('render with biome flash stays finite', Number.isFinite(g.player.x));
  });

  // 11.9) Onboarding (v13): first-run intro, coaching tips, save plumbing.
  sectionTry('onboarding: save tips + resetTutorial', () => {
    Save.resetTutorial();
    ok('reset clears intro + tips', Save.data.seenIntro === false && Object.keys(Save.data.tips).length === 0);
    Save.markTip('demo'); ok('markTip/tipSeen round-trip', Save.tipSeen('demo'));
  });
  sectionTry('onboarding: intro screen renders', () => {
    const g = new Game(document.getElementById('game'));
    UI.init(document.getElementById('overlay'), g);
    UI.showIntro(() => {});
    ok('intro shows the Begin action', /Begin/.test(UI.root.innerHTML) && /automatically/.test(UI.root.innerHTML));
  });
  sectionTry('onboarding: coaching fires once, survival-only', () => {
    Save.data.tips = {};
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 1 });
    ok('coaching active on a fresh survival run', g._coaching === true);
    g.toasts = []; g.time = 2; g.coachUpdate();
    ok('move tip shown + recorded', g.toasts.some(t => /Move with/.test(t.msg)) && Save.tipSeen('move'));
    g.coachUpdate();
    ok('move tip not repeated', g.toasts.filter(t => /Move with/.test(t.msg)).length === 1);
    const gd = new Game(document.getElementById('game')); gd.start('spark', 0, { daily: true, date: '2026-01-02' });
    ok('no coaching in Daily', gd._coaching === false);
  });
  sectionTry('onboarding: first level-up coaches the build loop', () => {
    Save.data.tips = {};
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 2 });
    UI.init(document.getElementById('overlay'), g);
    const ch = buildUpgradeChoices(g, 3);
    UI.showLevelUp(g, ch);
    ok('first level-up shows coach line + marks tip', /Stack/.test(UI.root.innerHTML) && Save.tipSeen('levelup'));
    UI.showLevelUp(g, ch);
    ok('coach line not shown again', !/Stack/.test(UI.root.innerHTML));
    Save.data.tips = {}; Save.data.seenIntro = true; // tidy for later sections
  });

  // 11.10) Biome hazards (v14): telegraphed strikes + lingering fields.
  sectionTry('hazards: registry shape per biome', () => {
    const verge = BIOMES.find(b => b.id === 'verge');
    ok('the opening Verge has no hazard', !verge.hazard);
    for (const b of BIOMES.filter(x => x.hazard)) {
      const h = b.hazard;
      const sized = h.kind === 'beam' ? (typeof h.len === 'number' && typeof h.width === 'number') : Array.isArray(h.radius);
      ok(b.id + ' hazard well-formed', (h.kind === 'strike' || h.kind === 'field' || h.kind === 'vortex' || h.kind === 'beam' || h.kind === 'hunter' || h.kind === 'gale') &&
        Array.isArray(h.every) && sized && typeof h.warn === 'number' &&
        typeof h.name === 'string' && typeof h.icon === 'string');
    }
    ok('a sixth biome (The Sundering) with a vortex exists', (() => {
      const s = BIOMES.find(b => b.id === 'sundering'); return s && s.hazard && s.hazard.kind === 'vortex' && BIOMES.length >= 6;
    })());
    ok('a seventh biome (The Corona) with a sweeping beam exists', (() => {
      const c = BIOMES.find(b => b.id === 'corona');
      return c && c.hazard && c.hazard.kind === 'beam' && Array.isArray(c.hazard.spin) && BIOMES.length >= 7;
    })());
    ok('an eighth biome (Duskmoor) with a hunting wisp exists', (() => {
      const d = BIOMES.find(b => b.id === 'duskmoor');
      return d && d.hazard && d.hazard.kind === 'hunter' && typeof d.hazard.speed === 'number' && BIOMES.length >= 8;
    })());
    ok('a ninth biome (Stormveil) with a gale current exists', (() => {
      const s = BIOMES.find(b => b.id === 'stormveil');
      return s && s.hazard && s.hazard.kind === 'gale' && typeof s.hazard.push === 'number' && BIOMES.length >= 9;
    })());
  });
  sectionTry('hazards: Galewinds shove the player along a fixed current', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 33 });
    const hz = BIOMES.find(b => b.id === 'stormveil').hazard;
    g.spawnHazard(hz);
    const h = g.hazards[0];
    ok('gale spawns with a push + wind direction', h.kind === 'gale' && h.push > 0 && Number.isFinite(h.windAng));
    h.phase = 'active'; h.t = 0;
    // Pin the player at the centre; the current should displace them along windAng.
    g.player.x = h.x; g.player.y = h.y; g.player.invuln = 1e9;
    const cw = Math.cos(h.windAng), sw = Math.sin(h.windAng);
    for (let i = 0; i < 30; i++) g.updateHazards(1 / 60);
    const moved = (g.player.x - h.x) * cw + (g.player.y - h.y) * sw; // displacement along the wind
    ok('the current pushed the player downwind', moved > 1);
    // A foe inside the band is shoved the same way (deterministic, pure geometry).
    const g2 = new Game(document.getElementById('game')); g2.start('spark', 0, { seed: 33 });
    g2.spawnHazard(hz); const h2 = g2.hazards[0]; h2.phase = 'active'; h2.t = 0;
    const e = g2.spawnEnemy('drifter', h2.x, h2.y, 1, 1); e.speed = 0; g2.buildGrid();
    const ex0 = e.x, ey0 = e.y;
    for (let i = 0; i < 30; i++) { g2.updateHazards(1 / 60); g2.buildGrid(); }
    const eMoved = (e.x - ex0) * Math.cos(h2.windAng) + (e.y - ey0) * Math.sin(h2.windAng);
    ok('foes are carried downwind too', eMoved > 1);
    // Outside the band: no push (escapable by leaving the current).
    const g3 = new Game(document.getElementById('game')); g3.start('spark', 0, { seed: 33 });
    g3.spawnHazard(hz); const h3 = g3.hazards[0]; h3.phase = 'active'; h3.t = 0;
    g3.player.x = h3.x + h3.r + 200; g3.player.y = h3.y; g3.player.invuln = 1e9;
    const ox = g3.player.x, oy = g3.player.y;
    for (let i = 0; i < 30; i++) g3.updateHazards(1 / 60);
    ok('outside the current the player is not pushed', Math.abs(g3.player.x - ox) < 1e-9 && Math.abs(g3.player.y - oy) < 1e-9);
  });
  sectionTry('hazards: the Wisplight homes in on the player', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 26 });
    const hz = BIOMES.find(b => b.id === 'duskmoor').hazard;
    g.spawnHazard(hz);
    const h = g.hazards[0];
    ok('hunter spawns away from the player with a speed', h.kind === 'hunter' && h.speed > 0 && dist(h.x, h.y, g.player.x, g.player.y) > 100);
    h.phase = 'active'; h.t = 0;
    const d0 = dist(h.x, h.y, g.player.x, g.player.y);
    for (let i = 0; i < 60; i++) g.updateHazards(1 / 60);
    ok('the wisp closes on the player', dist(h.x, h.y, g.player.x, g.player.y) < d0 - 1e-6);
    // Standing in it drains health; stepping away from a slower wisp is safe-ish.
    g.player.x = h.x; g.player.y = h.y; g.player.invuln = 0; const hp0 = g.player.hp;
    for (let i = 0; i < 20; i++) { g.player.x = h.x; g.player.y = h.y; g.player.invuln = 0; g.updateHazards(1 / 60); }
    ok('contact with the wisp costs health', g.player.hp < hp0);
  });
  sectionTry('hazards: the Sunfire Sweep rakes a rotating beam', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 23 });
    const hz = BIOMES.find(b => b.id === 'corona').hazard;
    g.spawnHazard(hz);
    const h = g.hazards[0];
    ok('beam spawns with a pivot, length, width + spin', h.kind === 'beam' && h.len > 0 && h.width > 0 && h.spin !== 0);
    const ang0 = h.ang;
    h.phase = 'active'; h.t = 0;
    // A point planted directly under the beam takes damage; one well off the ray does not.
    const onx = h.x + Math.cos(h.ang) * h.len * 0.5, ony = h.y + Math.sin(h.ang) * h.len * 0.5;
    ok('a point on the beam reads as a hit', g._beamHit(h, onx, ony));
    ok('a point off the beam reads as a miss', !g._beamHit(h, h.x + Math.cos(h.ang + 1.2) * h.len * 0.5, h.y + Math.sin(h.ang + 1.2) * h.len * 0.5));
    ok('behind the pivot is never hit', !g._beamHit(h, h.x - Math.cos(h.ang) * 50, h.y - Math.sin(h.ang) * 50));
    ok('beyond the reach is never hit', !g._beamHit(h, h.x + Math.cos(h.ang) * (h.len + 80), h.y + Math.sin(h.ang) * (h.len + 80)));
    // Standing in the swath drains health; the beam rotates as it advances.
    g.player.x = onx; g.player.y = ony; const hp0 = g.player.hp;
    for (let i = 0; i < 30; i++) g.updateHazards(1 / 60);
    ok('the beam sweep rotated', Math.abs(g.hazards.length ? g.hazards[0].ang - ang0 : h.ang - ang0) > 1e-3 || h.ang !== ang0);
    ok('standing in the beam costs health', g.player.hp < hp0);
  });
  sectionTry('hazards: stepping off the beam path avoids it', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 24 });
    const hz = BIOMES.find(b => b.id === 'corona').hazard;
    g.spawnHazard(hz);
    const h = g.hazards[0]; h.phase = 'active'; h.t = 0; h.spin = 0;  // freeze the sweep to test pure avoidance
    g.player.x = h.x - Math.cos(h.ang) * 60; g.player.y = h.y - Math.sin(h.ang) * 60; // behind the pivot, off the ray
    const hp0 = g.player.hp;
    for (let i = 0; i < 30; i++) g.updateHazards(1 / 60);
    ok('out of the beam path takes no damage', g.player.hp === hp0);
  });
  sectionTry('hazards: the Riftvortex drags player + foes inward', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 17 });
    const hz = BIOMES.find(b => b.id === 'sundering').hazard;
    g.spawnHazard(hz);
    const h = g.hazards[0]; h.phase = 'active'; h.t = 0;   // skip the telegraph
    // Place player and a foe out near the rim; the pull should reel them in.
    g.player.x = h.x + h.r * 0.8; g.player.y = h.y; const pd0 = dist(g.player.x, g.player.y, h.x, h.y);
    const e = g.spawnEnemy('drifter', h.x + h.r * 0.8, h.y + 4, 1, 1); e.speed = 0; const ed0 = dist(e.x, e.y, h.x, h.y);
    g.buildGrid();
    for (let i = 0; i < 30; i++) { g.updateHazards(1 / 60); g.buildGrid(); }
    ok('vortex pulls the player toward the eye', dist(g.player.x, g.player.y, h.x, h.y) < pd0 - 1e-6);
    ok('vortex pulls foes harder than the player', (ed0 - dist(e.x, e.y, h.x, h.y)) > (pd0 - dist(g.player.x, g.player.y, h.x, h.y)));
  });
  sectionTry('hazards: none spawn in the Verge', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 3 });
    for (let i = 0; i < 60 * 30; i++) g.update(1 / 60); // 30s, all within the Verge
    ok('no hazards while in the calm opening stage', g.hazards.length === 0 && g.biome.id === 'verge');
  });
  sectionTry('hazards: a strike telegraphs then detonates AoE', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 5 });
    const hz = BIOMES.find(b => b.id === 'emberwaste').hazard;
    g.spawnHazard(hz);
    const h = g.hazards[0];
    ok('begins in the warning phase', h.phase === 'warn' && h.dmg > 0);
    const e = g.spawnEnemy('brute', h.x, h.y, 6, 1); const ehp = e.hp;
    g.player.x = h.x; g.player.y = h.y; g.player.invuln = 0; const php = g.player.hp;
    g.buildGrid();
    g.updateHazards(hz.warn + 0.02); // cross the telegraph -> detonate
    ok('strike resolved (player + foe both hit)', g.player.hp < php && e.hp < ehp);
    ok('strike leaves the warn phase', h.phase === 'fade');
  });
  sectionTry('hazards: a field lingers, damaging + slowing inside', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 6 });
    const hz = BIOMES.find(b => b.id === 'glacier').hazard;
    g.spawnHazard(hz);
    const h = g.hazards[0];
    g.updateHazards(hz.warn + 0.01); // warn -> active
    ok('field becomes active after the warning', h.phase === 'active');
    const e = g.spawnEnemy('drifter', h.x, h.y, 6, 1); const ehp = e.hp;
    g.player.x = h.x; g.player.y = h.y; g.player.invuln = 0; const php = g.player.hp;
    g.buildGrid();
    g.updateHazards(0.26); // one damage tick
    ok('field ticks damage to player + foe', g.player.hp < php && e.hp < ehp);
    ok('field slows foes inside it', e.slowAmount >= hz.slow - 1e-9 && e.slowTimer > 0);
  });
  sectionTry('hazards: dodging out of a strike avoids all damage', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 7 });
    const hz = BIOMES.find(b => b.id === 'bloodmoon').hazard;
    g.spawnHazard(hz);
    const h = g.hazards[0];
    g.player.x = h.x + h.r + 400; g.player.y = h.y; g.player.invuln = 0; const php = g.player.hp;
    g.buildGrid();
    g.updateHazards(hz.warn + 0.02);
    ok('a player clear of the ring takes no hit', g.player.hp === php);
  });
  sectionTry('hazards: entering a hazardous biome arms + warns', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 8 });
    g.toasts = []; g.time = BIOME_SECONDS + 0.1; g.updateBiome(0.1); // -> Emberwaste
    ok('hazard timer armed on entry', g._hazardTimer > 0);
    ok('a hazard warning toast is shown', g.toasts.some(t => /Emberfall/.test(t.msg)));
  });
  sectionTry('hazards: live run inside a hazard biome stays finite', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 9 });
    g.time = BIOME_SECONDS * 4 + 1; // deep into a hazardous (Bloodmoon) stage
    let spawned = false;
    for (let i = 0; i < 60 * 12; i++) { g.update(1 / 60); if (g.hazards.length) spawned = true; if (!g.player.alive) break; }
    ok('hazards actually spawn in a hazardous biome', spawned);
    ok('render survives with hazards present', (g.render(), Number.isFinite(g.player.x)));
  });

  // 11.10b) Shrines (v28): risk/reward altars + the timed-buff system.
  sectionTry('shrines: registry shape + lookup', () => {
    ok('shrine types well-formed', SHRINE_TYPES.length >= 3 && SHRINE_TYPES.every(s =>
      s.id && s.name && s.icon && s.color && typeof s.invoke === 'function'));
    ok('getShrineType resolves + misses', !!getShrineType('power') && getShrineType('nope') === null);
  });
  sectionTry('shrines: stepping on one grants the boon + a consequence', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 51 });
    g.player.hp = g.player.maxHp * 0.4; const hp0 = g.player.hp;
    const foes0 = g.enemies.length;
    g.shrines.push({ type: 'vigor', color: '#7affc4', icon: '❤', x: g.player.x, y: g.player.y, radius: 24, t: 0, life: 26 });
    g.updateShrines(1 / 60);
    ok('Vigor shrine healed on touch', g.player.hp > hp0);
    ok('shrine consumed once used', g.shrines.length === 0);
    ok('consequence summoned foes', g.enemies.length > foes0);
  });
  sectionTry('shrines: Thorns shrine grants a timed reflect buff', () => {
    ok('thorns shrine registered', !!getShrineType('thorns') && SHRINE_TYPES.length >= 6);
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 57 });
    ok('no thorns before invoking', g.player.thorns === 0);
    g.shrines.push({ type: 'thorns', color: '#9fd86a', icon: '🌵', x: g.player.x, y: g.player.y, radius: 24, t: 0, life: 26 });
    g.updateShrines(1 / 60);
    ok('Thorns shrine grants the reflect buff', g.player.hasBuff('shrine_thorns') && g.player.thorns >= 0.80 - 1e-9);
    // It reflects in contact while the buff is up.
    const f = g.spawnEnemy('brute', g.player.x, g.player.y, 1, 1); f.hp = 1e6; f.maxHp = 1e6; f.damage = 20; f.x = g.player.x; f.y = g.player.y; g.player.invuln = 0; g.buildGrid();
    const hp0 = f.hp; g.updateEnemies(1 / 60);
    ok('the shrine thorns reflect at attackers', f.hp < hp0);
  });
  sectionTry('shrines: Barrage shrine grants a timed projectile buff', () => {
    ok('barrage shrine registered', !!getShrineType('barrage') && SHRINE_TYPES.length >= 7);
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 61 });
    const proj0 = g.player.bonusProj, pierce0 = g.player.bonusPierce;
    g.shrines.push({ type: 'barrage', color: '#9ad8ff', icon: '🎆', x: g.player.x, y: g.player.y, radius: 24, t: 0, life: 26 });
    g.updateShrines(1 / 60);
    ok('Barrage shrine grants +projectiles & +pierce', g.player.hasBuff('shrine_barrage') &&
      g.player.bonusProj >= proj0 + 2 && g.player.bonusPierce >= pierce0 + 1);
    ok('the barrage summons its elite-pack consequence', g.enemies.length > 0);
  });
  sectionTry('shrines: new types (Swiftness buff, Wrath blast) + Pilgrim relic', () => {
    ok('five shrine types incl. swiftness + wrath', SHRINE_TYPES.length >= 5 && !!getShrineType('swiftness') && !!getShrineType('wrath'));
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 53 });
    // Swiftness grants a move/haste buff on touch.
    g.shrines.push({ type: 'swiftness', color: '#8affc1', icon: '👟', x: g.player.x, y: g.player.y, radius: 24, t: 0, life: 26 });
    g.updateShrines(1 / 60);
    ok('Swiftness shrine buffs speed', g.player.hasBuff('shrine_swift'));
    // Wrath blasts nearby foes.
    const g2 = new Game(document.getElementById('game')); g2.start('spark', 0, { seed: 54 });
    const e = g2.spawnEnemy('brute', g2.player.x + 40, g2.player.y, 1, 1); const ehp = e.hp;
    g2.buildGrid();
    g2.shrines.push({ type: 'wrath', color: '#ff5d6c', icon: '⚔', x: g2.player.x, y: g2.player.y, radius: 24, t: 0, life: 26 });
    g2.updateShrines(1 / 60);
    ok('Wrath shrine blasts nearby foes', e.hp < ehp);
    // Pilgrim's Charm: heals on shrine use.
    const g3 = new Game(document.getElementById('game')); g3.start('spark', 0, { seed: 55, noRelics: true });
    g3.relics = ['pilgrim']; g3.player.hp = g3.player.maxHp * 0.5; const hp0 = g3.player.hp;
    g3.shrines.push({ type: 'fortune', color: '#ffe14d', icon: '💰', x: g3.player.x, y: g3.player.y, radius: 24, t: 0, life: 26 });
    g3._shrineTimer = 999; g3.updateShrines(1 / 60);
    ok('Pilgrim heals on a shrine touch', g3.player.hp > hp0);
    // Pilgrim shortens the cadence when the next shrine arms.
    g3.shrines = []; g3._shrineTimer = -1; g3.updateShrines(1 / 60);
    ok('Pilgrim re-arms a shorter shrine timer', g3.shrines.length === 1 && g3._shrineTimer < 34);
  });
  sectionTry('shrines: Power grants a timed damage buff that expires', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 52 });
    const m0 = g.player.might;
    g.player.addBuff('shrine_power', { dmgMul: 1.5 }, 0.5);
    ok('buff boosts damage + is active', Math.abs(g.player.might - m0 * 1.5) < 1e-4 && g.player.hasBuff('shrine_power'));
    for (let i = 0; i < 40; i++) g.player.update(1 / 60);   // tick past 0.5s
    ok('buff expires + damage restored', !g.player.hasBuff('shrine_power') && Math.abs(g.player.might - m0) < 1e-4);
  });
  sectionTry('shrines: none in Gauntlet or Trials', () => {
    Save.data.trials = { kindling: true };
    const gg = new Game(document.getElementById('game')); gg.start('spark', 0, { mode: 'gauntlet' });
    gg._shrineTimer = -1; gg.updateShrines(0.1);
    ok('no shrine spawns in Gauntlet', gg.shrines.length === 0);
    const gt = new Game(document.getElementById('game')); gt.start('spark', 0, { trial: 'kindling' });
    gt._shrineTimer = -1; gt.updateShrines(0.1);
    ok('no shrine spawns in a Trial', gt.shrines.length === 0);
    Save.data.trials = {};
  });

  // 11.11) Lifetime Mastery (v15): per-hero / per-weapon totals, ranks, goals.
  sectionTry('mastery: ranks climb with points', () => {
    ok('rank ladder is ordered', MASTERY_RANKS.length >= 4 && MASTERY_RANKS[0].min === 0 && MASTERY_RANKS[1].min > 0);
    ok('zero points = lowest rank', masteryRank(0).index === 0);
    ok('huge points = top rank', masteryRank(1e9).index === MASTERY_RANKS.length - 1 && masteryRank(1e9).prog === 1);
    const r = masteryRank(MASTERY_RANKS[1].min);
    ok('crossing a threshold advances + resets progress', r.index === 1 && r.prog >= 0 && r.prog < 1);
    ok('char points reward kills/time/bosses/runs', charMasteryPoints({ kills: 100, time: 200, bosses: 2, runs: 3 }) === 100 + 100 + 80 + 60);
  });
  sectionTry('mastery: recordMastery accumulates per hero + weapon', () => {
    Save.data.mastery = { chars: {}, weapons: {} };
    Save.recordMastery({ char: 'ember', kills: 50, time: 120, bosses: 1, score: 9000, weapons: [{ id: 'flame', level: 8, evo: true }, { id: 'bolt', level: 4, evo: false }] });
    Save.recordMastery({ char: 'ember', kills: 30, time: 80, bosses: 0, score: 4000, weapons: [{ id: 'flame', level: 6, evo: false }] });
    const c = Save.charStats('ember');
    ok('hero totals sum across runs', c.runs === 2 && c.kills === 80 && c.time === 200 && c.bosses === 1);
    ok('hero best score keeps the max', c.bestScore === 9000 && c.bestTime === 120);
    const fw = Save.weaponStats('flame');
    ok('weapon use + evolutions + maxLevel tracked', fw.runs === 2 && fw.evolved === 1 && fw.maxLevel === 8);
    ok('a second weapon is tracked independently', Save.weaponStats('bolt').runs === 1);
  });
  sectionTry('mastery: a real game-over folds into mastery', () => {
    Save.data.mastery = { chars: {}, weapons: {} };
    const g = new Game(document.getElementById('game')); g.start('frost', 0, { seed: 21 });
    for (let i = 0; i < 60 * 6; i++) g.update(1 / 60);
    g.kills = 40; g.player.invuln = 0; g.player.revives = 0; g.player.hurt(1e9);
    const c = Save.charStats('frost');
    ok('death recorded a run for the played hero', c && c.runs === 1);
    ok('snapshot carried weapon ids into mastery', Object.keys(Save.data.mastery.weapons).length >= 1);
  });
  sectionTry('mastery: ranks gate the new achievements', () => {
    Save.data.mastery = { chars: {}, weapons: {} };
    Save.data.achievements = {};
    const ctxLow = Achievements.context(null);
    ok('no mastery => topCharMastery 0', ctxLow.topCharMastery === 0);
    Save.data.mastery.chars.spark = { runs: 99, kills: 99999, time: 99999, bosses: 99, bestTime: 0, bestScore: 0 };
    const ctxHigh = Achievements.context(null);
    ok('deep mastery lifts topCharMastery to Master+', ctxHigh.topCharMastery >= 4);
    ok('Adept + Grandmaster achievements exist', !!getAchievement('adept') && !!getAchievement('grandmaster'));
    ok('Grandmaster check passes at Master rank', getAchievement('grandmaster').check(ctxHigh) === true);
    Save.data.mastery = { chars: {}, weapons: {} }; Save.data.achievements = {};
  });
  sectionTry('mastery: screen renders empty and populated', () => {
    const g = new Game(document.getElementById('game'));
    UI.init(document.getElementById('overlay'), g);
    Save.data.mastery = { chars: {}, weapons: {} };
    UI.showMastery();
    ok('empty state prompts a first run', /begin earning mastery/i.test(UI.root.innerHTML));
    Save.recordMastery({ char: 'spark', kills: 200, time: 300, bosses: 2, score: 5000, weapons: [{ id: 'bolt', level: 8, evo: true }] });
    UI.showMastery();
    ok('populated screen shows ranks + weapons', /Heroes/.test(UI.root.innerHTML) && /Weapons/.test(UI.root.innerHTML) && /mast-fill/.test(UI.root.innerHTML));
    Save.data.mastery = { chars: {}, weapons: {} };
  });

  // 11.12) Weapon synergies (v16): set bonuses from owned weapon archetypes.
  const wi = id => ({ def: getWeapon(id), level: 1, timer: 0 });
  sectionTry('synergies: registry shape + detection', () => {
    ok('synergy list non-empty + well-formed', SYNERGIES.length >= 4 && SYNERGIES.every(s =>
      s.id && s.name && s.icon && s.color && Array.isArray(s.members) && s.need >= 2 && s.mods));
    ok('no synergy with zero/one weapon', activeSynergies([]).length === 0 && activeSynergies([wi('flame')]).length === 0);
    const w = activeSynergies([wi('flame'), wi('toxin')]);
    ok('Flame + Toxin = Wildfire', w.length === 1 && w[0].id === 'wildfire');
    const r = activeSynergies([wi('nova'), wi('chain')]);
    ok('any-2-of-3 set activates (Refraction)', r.some(s => s.id === 'refraction'));
  });
  sectionTry('synergies: new sets tie in the newer weapons', () => {
    const wi = id => ({ def: getWeapon(id), level: 1, timer: 0 });
    ok('Garrison = Sentry + Caltrops', activeSynergies([wi('sentry'), wi('caltrops')]).some(s => s.id === 'garrison'));
    ok('Fusillade = Sentry + Bolt', activeSynergies([wi('sentry'), wi('bolt')]).some(s => s.id === 'fusillade'));
    ok('Bladestorm = Whip + Glaive', activeSynergies([wi('whip'), wi('glaive')]).some(s => s.id === 'bladestorm'));
    ok('Permafrost = Frost Shard + Caltrops', activeSynergies([wi('shard'), wi('caltrops')]).some(s => s.id === 'permafrost'));
    ok('Bladestorm counts evolved forms too', activeSynergies([wi('eclipse'), wi('ouroboros')]).some(s => s.id === 'bladestorm'));
    ok('at least 12 synergies now', SYNERGIES.length >= 12);
  });
  sectionTry('synergies: evolved forms count as their base', () => {
    const a = activeSynergies([wi('inferno'), wi('toxin')]); // inferno = evolved flame
    ok('evolved Flame (Inferno) still triggers Wildfire', a.some(s => s.id === 'wildfire'));
    ok('weaponBaseId maps evolved -> base', weaponBaseId('inferno') === 'flame' && weaponBaseId('bolt') === 'bolt');
  });
  sectionTry('synergies: recalc applies the stat bonuses', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 1 });
    const p = g.player;
    p.weapons = [wi('bolt')]; p.recalc(); const baseMight = p.might, baseProj = p.bonusProj;
    p.weapons = [wi('flame'), wi('toxin')]; p.recalc();
    ok('Wildfire active + raises damage ~15%', p.synergies.some(s => s.id === 'wildfire') && Math.abs(p.might - baseMight * 1.15) < 1e-6);
    p.weapons = [wi('spirit'), wi('glaive')]; p.recalc();
    ok('Wild Hunt grants +1 projectile', p.synergies.some(s => s.id === 'wildhunt') && p.bonusProj === baseProj + 1);
    p.weapons = [wi('chain'), wi('bolt')]; p.recalc();
    ok('Stormcaller raises attack speed', p.synergies.some(s => s.id === 'stormcaller'));
  });
  sectionTry('synergies: completing a set announces once', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 2 });
    const p = g.player;
    p.weapons = [wi('flame')]; p.recalc(); g.toasts = [];
    p.applyUpgrade({ kind: 'weapon-new', id: 'toxin' });
    ok('adding the partner toasts the synergy', g.toasts.some(t => /Wildfire/.test(t.msg)));
    ok('synergy now reported active', p.synergies.some(s => s.id === 'wildfire'));
  });
  sectionTry('synergies: pure function of arsenal (deterministic)', () => {
    const set1 = activeSynergies([wi('prism'), wi('nova'), wi('chain')]).map(s => s.id).sort().join();
    const set2 = activeSynergies([wi('chain'), wi('nova'), wi('prism')]).map(s => s.id).sort().join();
    ok('order-independent, no RNG', set1 === set2 && set1.length > 0);
  });
  sectionTry('synergies: Codex + Help surface them', () => {
    const g = new Game(document.getElementById('game'));
    UI.init(document.getElementById('overlay'), g);
    UI.showCodex();
    ok('Codex lists the Synergies section', /Synergies/.test(UI.root.innerHTML) && /Wildfire/.test(UI.root.innerHTML));
    UI.showHelp();
    ok('Help explains synergies', /Synergies/.test(UI.root.innerHTML));
  });
  sectionTry('synergies: shown on the pause screen when active', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 3 });
    UI.init(document.getElementById('overlay'), g);
    g.player.weapons = [wi('flame'), wi('toxin')]; g.player.recalc();
    g.state = 'paused'; UI.showPause(g);
    ok('pause panel shows active synergy', /Synergies/.test(UI.root.innerHTML) && /Wildfire/.test(UI.root.innerHTML));
  });

  // 11.13) Trials of Light (v17): fixed-rule challenge runs + win conditions.
  sectionTry('trials: registry shape + goal helpers', () => {
    ok('trial list non-empty + well-formed', TRIALS.length >= 4 && TRIALS.every(t =>
      t.id && t.name && t.icon && t.color && t.char && t.mods && t.win &&
      ['survive', 'kills', 'score', 'bosses'].includes(t.win.type) && t.win.value > 0 && t.reward > 0));
    const k = getTrial('kindling');
    ok('goal text reads naturally', /Survive/.test(trialGoalText(k)));
    ok('getTrial resolves + misses cleanly', getTrial('kindling') === k && getTrial('nope') === null);
  });
  sectionTry("trials: Warden's End — boss-count objective + chain tail", () => {
    const t = getTrial('wardens_end');
    ok("Warden's End registered as a Sentinel boss trial", !!t && t.win.type === 'bosses' && t.char === 'sentinel');
    ok('goal + progress text use boss wording', /Fell/.test(trialGoalText(t)) && trialProgressText(t, { time: 0, kills: 0, score: 0, bossKills: 1 }).includes('/'));
    ok('locked until annihilation is cleared', !trialUnlocked(t, () => false));
    ok('opens once annihilation is done', trialUnlocked(t, id => id === 'annihilation'));
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 7 }); g.trial = t;
    g.bossKills = 3; ok('objective unmet at 3 bosses', !trialGoalMet(t, g));
    g.bossKills = 4; ok('objective met at 4 bosses', trialGoalMet(t, g) && trialCurrent(t, g) === 4);
  });
  sectionTry('trials: Eventide — the Pyre capstone beyond Wardens End', () => {
    const t = getTrial('eventide');
    ok('Eventide registered as a Pyre Abyss score trial', !!t && t.win.type === 'score' && t.char === 'pyre' && t.diff === 3);
    ok('it carries the berserk/frail twist', t.mods.berserk === true && Math.abs(t.mods.hpMul - 0.6) < 1e-9);
    ok('locked until Wardens End is cleared', !trialUnlocked(t, () => false));
    ok('opens once Wardens End is done', trialUnlocked(t, id => id === 'wardens_end'));
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 5 }); g.trial = t;
    g.score = 179999; ok('objective unmet below target', !trialGoalMet(t, g));
    g.score = 180000; ok('objective met at target', trialGoalMet(t, g));
  });
  sectionTry('trials: start forces config, ignores omens & relics', () => {
    Save.data.relics = { volatile: true }; Save.data.equipped = ['volatile'];
    Save.data.trials = { kindling: true };   // unlock Glass (req: kindling)
    const g = new Game(document.getElementById('game'));
    g.start('spark', 0, { trial: 'glass' });
    ok('trial set on the game', g.trial && g.trial.id === 'glass');
    ok('omens + relics disabled', g.omen === null && g.relics.length === 0);
    ok('rule twist folded into mods', Math.abs(g.mods.dmgMul - 2.0) < 1e-9 && Math.abs(g.mods.hpMul - 0.25) < 1e-9);
    // Compare against a clean (no-trial, no-relic) baseline so meta levels cancel.
    Save.data.equipped = [];
    const base = new Game(document.getElementById('game')); base.start('spark', 0, {});
    ok('twist reaches the player', Math.abs(g.player.might - base.player.might * 2.0) < 1e-4);
    Save.data.relics = {}; Save.data.equipped = [];
  });
  sectionTry('trials: meeting the objective wins the run', () => {
    Save.data.trials = {}; Save.data.tips = { move: true, shards: true, dodge: true, pause: true, levelup: true };
    const sh = Save.data.shards;
    const g = new Game(document.getElementById('game'));
    g.start('spark', 0, { trial: 'kindling' });
    ok('not won at the start', !trialGoalMet(g.trial, g) && !g.trialWon);
    g.time = g.trial.win.value;   // on the threshold; next tick crosses it
    g.update(1 / 60);
    ok('crossing the goal triggers victory', g.trialWon === true && g.state === 'gameover');
    ok('clear is persisted + rewarded', Save.isTrialDone('kindling') && Save.data.shards >= sh + g.trial.reward);
    Save.data.trials = {};
  });
  sectionTry('trials: a kills objective is detected', () => {
    Save.data.trials = { kindling: true };   // unlock Swarm (req: kindling)
    const g = new Game(document.getElementById('game'));
    g.start('spark', 0, { trial: 'swarm' });
    ok('kills objective starts unmet', !trialGoalMet(g.trial, g));
    g.kills = g.trial.win.value;
    ok('reaching the kill count meets it', trialGoalMet(g.trial, g) && trialCurrent(g.trial, g) === g.kills);
  });
  sectionTry('trials: failing records the run but no clear', () => {
    Save.data.trials = { kindling: true, glass: true };   // unlock Tortoise (req: glass)
    const runs0 = Save.data.runs, bt0 = Save.data.bestTime;
    const g = new Game(document.getElementById('game'));
    g.start('spark', 0, { trial: 'tortoise' });
    g.time = 30; g.kills = 12;
    g.player.invuln = 0; g.player.revives = 0; g.player.hurt(1e9);
    ok('death did not complete the trial', !Save.isTrialDone('tortoise') && !g.trialWon);
    ok('run counted but best-time untouched', Save.data.runs === runs0 + 1 && Save.data.bestTime === bt0);
    ok('chronicle tags it as a trial', Save.data.history[0] && Save.data.history[0].mode === 'trial');
    Save.data.trials = {};
  });
  sectionTry('trials: achievements gate on completion', () => {
    Save.data.trials = {}; Save.data.achievements = {};
    ok('Trialist + Trial Master defined', !!getAchievement('trialist') && !!getAchievement('trialmaster'));
    const ctx0 = Achievements.context(null);
    ok('none done => trialsDone 0', ctx0.trialsDone === 0 && ctx0.trialsTotal === TRIALS.length);
    for (const t of TRIALS) Save.completeTrial(t.id);
    const ctx1 = Achievements.context(null);
    ok('all done satisfies Trial Master', getAchievement('trialmaster').check(ctx1) === true);
    Save.data.trials = {}; Save.data.achievements = {};
  });
  sectionTry('trials: screens render (list + victory)', () => {
    const g = new Game(document.getElementById('game'));
    UI.init(document.getElementById('overlay'), g);
    Save.data.trials = {};
    UI.showTrials();
    ok('Trials screen lists challenges', /Trials of Light/.test(UI.root.innerHTML) && /Glass Gauntlet/.test(UI.root.innerHTML) && /Begin/.test(UI.root.innerHTML));
    g.start('spark', 0, { trial: 'kindling' }); g.trialWon = true; g.lastTrialFirst = true; g.lastEarned = 50;
    UI.showGameOver(g);
    ok('victory screen frames a win', /Trial Complete/.test(UI.root.innerHTML));
    Save.data.trials = {};
  });
  sectionTry('trials: the chain extends to a post-capstone finale', () => {
    ok('Relentless branches off Tortoise', getTrial('relentless') && getTrial('relentless').req.indexOf('tortoise') >= 0);
    ok('Annihilation is gated behind the Ascendant capstone', getTrial('annihilation') && getTrial('annihilation').req.indexOf('ascendant') >= 0);
    const upTo = id => ['kindling', 'glass', 'swarm', 'tortoise', 'bloodlust'].includes(id);
    ok('finale stays locked until the capstone falls', !trialUnlocked(getTrial('annihilation'), upTo));
    const withAsc = id => upTo(id) || id === 'ascendant';
    ok('finale opens once Ascendant is cleared', trialUnlocked(getTrial('annihilation'), withAsc));
  });
  sectionTry('trials: unlock chain gates progression', () => {
    // Every trial declares a req list; the opener is the only thing open at zero.
    ok('all trials declare req array', TRIALS.every(t => Array.isArray(t.req)));
    ok('exactly one opener (no prerequisites)', TRIALS.filter(t => t.req.length === 0).length === 1);
    ok('all reqs reference real trials', TRIALS.every(t => t.req.every(id => !!getTrial(id))));
    // Pure predicate form: nothing cleared => only the opener is unlocked.
    const none = () => false;
    ok('locked until prereqs met', !trialUnlocked(getTrial('glass'), none) &&
      !trialUnlocked(getTrial('ascendant'), none) && trialUnlocked(getTrial('kindling'), none));
    ok('lockedBy names the blocker', trialLockedBy(getTrial('glass'), none).join() === 'Kindling');
    // Capstone needs BOTH branches; one alone is not enough.
    const onlyTortoise = id => id === 'kindling' || id === 'glass' || id === 'tortoise';
    ok('capstone needs both branches', !trialUnlocked(getTrial('ascendant'), onlyTortoise));
    const both = id => ['kindling', 'glass', 'swarm', 'tortoise', 'bloodlust'].includes(id);
    ok('capstone opens when both met', trialUnlocked(getTrial('ascendant'), both));
    // Live against the Save book: clearing the opener unlocks its children.
    Save.data.trials = {};
    ok('Save view: children locked at start', trialUnlocked(getTrial('kindling')) &&
      !trialUnlocked(getTrial('glass')) && !trialUnlocked(getTrial('swarm')));
    Save.completeTrial('kindling');
    ok('clearing opener unlocks its branch', trialUnlocked(getTrial('glass')) && trialUnlocked(getTrial('swarm')) &&
      !trialUnlocked(getTrial('tortoise')));
    // Engine guard: a locked trial cannot be force-started, it degrades to survival.
    Save.data.trials = {};
    const g = new Game(document.getElementById('game'));
    g.start('spark', 0, { trial: 'ascendant' });
    ok('locked trial refused at start', g.trial === null && g.mode === 'survival');
    // UI reflects the lock with a disabled control.
    UI.showTrials();
    ok('locked card shows a lock + disabled button', /🔒/.test(UI.root.innerHTML) && /disabled/.test(UI.root.innerHTML));
    Save.data.trials = {};
  });

  // 11.14) Custom Run / mutators (v18): free-stacked rule twists + reward scale.
  sectionTry('mutators: registry shape + boons/banes', () => {
    ok('mutator list well-formed', MUTATOR_LIST.length >= 8 && MUTATOR_LIST.every(m =>
      m.id && m.name && m.icon && m.color && typeof m.weight === 'number' && typeof m.apply === 'function' && m.desc));
    ok('has both boons and banes', MUTATOR_LIST.some(m => m.weight < 0) && MUTATOR_LIST.some(m => m.weight > 0));
    ok('getMutator resolves + misses', getMutator('overpower') && getMutator('nope') === null);
  });
  sectionTry('mutators: fold into mods (stacking multiplies)', () => {
    const m1 = buildMutatorMods(['overpower', 'horde']);
    ok('distinct channels apply', Math.abs(m1.dmgMul - 1.45) < 1e-9 && Math.abs(m1.enemyCountMul - 1.5) < 1e-9);
    const m2 = buildMutatorMods(['overpower', 'glass']);
    ok('same channel stacks multiplicatively', Math.abs(m2.dmgMul - 1.45 * 1.6) < 1e-9 && Math.abs(m2.hpMul - 0.55) < 1e-9);
    ok('empty selection = neutral mods', buildMutatorMods([]).dmgMul === 1 && buildMutatorMods([]).enemyCountMul === 1);
    // Channel-driven boons fold their new channels in.
    const m3 = buildMutatorMods(['volley', 'piercer', 'thornplate']);
    ok('volley/piercer/thornplate fold in', m3.addProj >= 1 && m3.addPierce >= 2 && m3.thornsBonus >= 0.40 - 1e-9);
    const gc = new Game(document.getElementById('game')); gc.start('spark', 0, { mode: 'custom', mutators: ['volley', 'thornplate'], seed: 5 });
    ok('custom run applies the channel boons', gc.player.bonusProj >= 1 && gc.player.thorns >= 0.40 - 1e-9);
  });
  sectionTry('mutators: reward scales with self-imposed difficulty', () => {
    ok('empty run pays normal', mutatorRewardMul([]) === 1);
    ok('banes raise the payout', mutatorScore(['onslaught', 'horde', 'brutes']) === 7 && mutatorRewardMul(['onslaught', 'horde', 'brutes']) > 1);
    ok('boons lower the payout (floored)', mutatorRewardMul(['overpower', 'titan', 'fleet']) < 1 && mutatorRewardMul(['overpower', 'titan', 'fleet']) >= 0.25);
  });
  sectionTry('mutators: start builds a custom run', () => {
    Save.data.relics = { glass_lens: true }; Save.data.equipped = ['glass_lens'];
    const g = new Game(document.getElementById('game'));
    g.start('spark', 0, { mode: 'custom', mutators: ['glass', 'horde'], seed: 5 });
    ok('flagged custom, survival underneath', g.customRun === true && g.mode === 'survival');
    ok('omens + relics off', g.omen === null && g.relics.length === 0);
    ok('mutator mods folded in', Math.abs(g.mods.dmgMul - 1.6) < 1e-9 && Math.abs(g.mods.enemyCountMul - 1.5) < 1e-9);
    ok('reward multiplier captured', Math.abs(g.mutatorRewardMul - mutatorRewardMul(['glass', 'horde'])) < 1e-9);
    Save.data.relics = {}; Save.data.equipped = [];
  });
  sectionTry('mutators: same seed + set is deterministic', () => {
    const a = new Game(document.getElementById('game')); a.start('spark', 0, { mode: 'custom', mutators: ['glass', 'brutes'], seed: 77 });
    const b = new Game(document.getElementById('game')); b.start('spark', 0, { mode: 'custom', mutators: ['glass', 'brutes'], seed: 77 });
    ok('identical derived stats', a.player.maxHp === b.player.maxHp && Math.abs(a.player.might - b.player.might) < 1e-9);
  });
  sectionTry('mutators: custom death records aside from standard records', () => {
    const bt0 = Save.data.bestTime, bs0 = Save.data.bestScore, runs0 = Save.data.runs, sh0 = Save.data.shards;
    const g = new Game(document.getElementById('game'));
    g.start('spark', 0, { mode: 'custom', mutators: ['onslaught', 'horde'], seed: 9 });
    g.time = 5000; g.score = 999999; g.kills = 40; // would smash records if it counted
    g.player.invuln = 0; g.player.revives = 0; g.player.hurt(1e9);
    ok('best time/score untouched by custom', Save.data.bestTime === bt0 && Save.data.bestScore === bs0);
    ok('run + shards still counted', Save.data.runs === runs0 + 1 && Save.data.shards > sh0);
    ok('chronicle tags it custom + lists mutators', Save.data.history[0].mode === 'custom' && Save.data.history[0].mutators.length === 2);
  });
  sectionTry('mutators: screens render + toggle state', () => {
    const g = new Game(document.getElementById('game'));
    UI.init(document.getElementById('overlay'), g);
    UI._mutators = [];
    UI.showMutators();
    ok('custom screen lists mutators', /Custom Run/.test(UI.root.innerHTML) && /Onslaught/.test(UI.root.innerHTML) && /Choose Hero/.test(UI.root.innerHTML));
    g.start('spark', 0, { mode: 'custom', mutators: ['glass', 'horde'], seed: 1 });
    UI.showGameOver(g);
    ok('game-over shows the custom chip', /Custom/.test(UI.root.innerHTML));
    UI._mutators = [];
  });
  sectionTry('mutators: system twists reshape shrine/hazard/champion cadence', () => {
    // Unlike the stat-channel mutators, these three reach into whole systems via
    // new cadence channels (neutral = 1 everywhere they are not set).
    const nd = defaultMods();
    ok('cadence channels default neutral', nd.shrineRateMul === 1 && nd.hazardRateMul === 1 && nd.champRateMul === 1);
    const sm = buildMutatorMods(['pilgrimage', 'upheaval', 'warband']);
    ok('each system mutator sets its channel', sm.shrineRateMul > 1 && sm.hazardRateMul > 1 && sm.champRateMul > 1);

    // Pilgrimage: shrines re-arm faster than the un-twisted minimum of 34s.
    const gp = new Game(document.getElementById('game'));
    gp.start('spark', 0, { mode: 'custom', mutators: ['pilgrimage'], seed: 4 });
    ok('custom run carries the shrine channel', gp.mods.shrineRateMul > 1);
    gp.shrines.length = 0; gp._shrineTimer = 0;
    gp.updateShrines(0.001);                  // fires the re-arm and spawns a shrine
    ok('pilgrimage shortens shrine cadence', gp._shrineTimer > 0 && gp._shrineTimer < 34);
    ok('a shrine actually appeared', gp.shrines.length === 1);

    // Upheaval: hazards re-arm inside the scaled band for the active biome.
    const gh = new Game(document.getElementById('game'));
    gh.start('spark', 0, { mode: 'custom', mutators: ['upheaval'], seed: 4 });
    gh.biome = BIOMES.find(b => b.hazard);    // a biome that actually has a hazard
    const hz = gh.biome.hazard, H = gh.mods.hazardRateMul;
    gh.hazards.length = 0; gh._hazardTimer = 0; gh.player.alive = true;
    gh.updateHazards(0.001);                  // fires the re-arm (before spawnHazard draws)
    ok('upheaval re-arm sits in the scaled band',
      gh._hazardTimer <= hz.every[1] / H + 1e-6 && gh._hazardTimer >= hz.every[0] / H - 1e-6);
    ok('the scaled band is strictly faster', hz.every[1] / H < hz.every[1]);

    // Warband: the Champion event arms sooner and re-arms on a halved cadence.
    const gc = new Game(document.getElementById('game'));
    gc.start('spark', 0, { mode: 'custom', mutators: ['warband'], seed: 4 });
    ok('warband arms champions sooner',
      gc.director.champTimer < 75 && Math.abs(gc.director.champTimer - 75 / gc.mods.champRateMul) < 1e-9);
    gc.time = 0; gc.enemies.length = 0; gc.director.champTimer = 0;
    gc.director.update(0.001);                // fires a champion re-arm at minute 0
    ok('warband halves champion cadence', Math.abs(gc.director.champTimer - 110 / gc.mods.champRateMul) < 1e-6);

    // A plain run leaves every cadence untouched.
    const gn2 = new Game(document.getElementById('game'));
    gn2.start('spark', 0, { seed: 4 });
    ok('plain run leaves cadence neutral',
      gn2.mods.shrineRateMul === 1 && gn2.mods.hazardRateMul === 1 && gn2.director.champRateMul === 1);
  });

  // 11.15) Mastery rewards (v19): rank-gated titles, trail + halo (cosmetic).
  sectionTry('mastery rewards: run reflects the hero rank', () => {
    Save.data.mastery = { chars: {}, weapons: {} };
    Save.data.mastery.chars.spark = { runs: 99, kills: 99999, time: 99999, bosses: 99, bestTime: 0, bestScore: 0 };
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 1 });
    ok('player carries the mastery rank/title', g.player.masteryRank >= 4 && /\\w/.test(g.player.masteryTitle));
    Save.data.mastery = { chars: {}, weapons: {} };
    const g2 = new Game(document.getElementById('game')); g2.start('spark', 0, { seed: 1 });
    ok('a fresh hero starts Untrained (no trail)', g2.player.masteryRank === 0);
  });
  sectionTry('mastery rewards: trail renders + respects the toggle', () => {
    Save.data.mastery = { chars: {}, weapons: {} };
    Save.data.mastery.chars.spark = { runs: 99, kills: 99999, time: 99999, bosses: 99, bestTime: 0, bestScore: 0 };
    Save.data.trailFx = true;
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 2 });
    g.player._trail = []; for (let i = 0; i < 6; i++) { g.player.x += 5; g.render(); }
    ok('high-rank hero leaves a trail', g.player._trail.length > 0);
    Save.data.trailFx = false; g.player._trail = [];
    for (let i = 0; i < 6; i++) { g.player.x += 5; g.render(); }
    ok('the Trail toggle suppresses it', g.player._trail.length === 0);
    Save.data.trailFx = true; Save.data.mastery = { chars: {}, weapons: {} };
  });
  sectionTry('mastery rewards: surfaced on char-select + game over', () => {
    Save.data.mastery = { chars: {}, weapons: {} };
    Save.data.mastery.chars.spark = { runs: 99, kills: 99999, time: 99999, bosses: 99, bestTime: 0, bestScore: 0 };
    const g = new Game(document.getElementById('game'));
    UI.init(document.getElementById('overlay'), g);
    UI.showCharacterSelect('survival');
    ok('character screen shows the rank badge', /🎖/.test(UI.root.innerHTML) && /char-mastery/.test(UI.root.innerHTML));
    g.start('spark', 0, { seed: 3 });
    UI.showGameOver(g);
    ok('game over shows the hero title', /go-hero/.test(UI.root.innerHTML) && /Spark/.test(UI.root.innerHTML));
    Save.data.mastery = { chars: {}, weapons: {} };
  });
  sectionTry('mastery rewards: trail option default + persistence', () => {
    ok('trail FX on by default', Save.defaults().trailFx === true);
    const prev = Save.data.trailFx;
    Save.data.trailFx = false; Save.save(); Save.load();
    ok('toggle persists across load', Save.data.trailFx === false);
    Save.data.trailFx = prev === false ? false : true; Save.save();
  });
  sectionTry('accessibility: reduced-flash damps shake + full-screen FX', () => {
    ok('reduced flash off by default', Save.defaults().reducedFlash === false);
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 71 });
    // Off: shake registers and the flash multiplier is full.
    Save.data.shakeOff = false; Save.data.reducedFlash = false;
    g.shake_.mag = 0; g.shake(12, 0.3);
    ok('shake registers when flash is normal', g.shake_.mag > 0);
    ok('flash multiplier is full when off', g._flashMul() === 1);
    // On: shake is fully suppressed and the multiplier drops below 1.
    Save.data.reducedFlash = true; g.shake_.mag = 0; g.shake(12, 0.3);
    ok('reduced-flash suppresses shake', g.shake_.mag === 0);
    ok('reduced-flash lowers the flash multiplier', g._flashMul() < 1);
    // It is render-only — the world still advances + renders finite either way.
    for (let i = 0; i < 60; i++) { g.update(1 / 60); g.render(); }
    ok('render stays finite with reduced flash on', Number.isFinite(g.player.x) && Number.isFinite(g.player.y));
    // Persists across a save/load round-trip.
    Save.save(); Save.load();
    ok('reduced-flash toggle persists', Save.data.reducedFlash === true);
    Save.data.reducedFlash = false; Save.save();
  });
  sectionTry('HUD: off-screen boss/champion edge indicator', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 81 });
    const cam = { x: 0, y: 0 }, W = g.view.w, H = g.view.h;
    ok('on-screen target needs no arrow', g.edgeIndicator(W / 2, H / 2, cam) === null);
    const ind = g.edgeIndicator(W + 800, H / 2, cam);
    ok('off-screen target yields an arrow', !!ind && Number.isFinite(ind.x) && Number.isFinite(ind.y));
    ok('arrow clamps within the view', ind.x >= 0 && ind.x <= W && ind.y >= 0 && ind.y <= H);
    ok('arrow points toward the target', Math.abs(ind.angle) < 0.5);
    // The render path draws indicators for an off-screen boss without error.
    g.director.spawnBoss('warden');
    const boss = g.enemies.find(e => e.boss); boss.x = g.player.x + 5000; boss.y = g.player.y + 5000;
    g.render();
    ok('render survives with an off-screen boss', Number.isFinite(g.player.x));
  });

  // 11.3) New content (v7): glaive (boomerang), toxin (zones), prism, Comet.
  sectionTry('content: new weapons + evolutions registered', () => {
    for (const id of ['glaive', 'toxin', 'prism']) ok('base weapon ' + id, !!getWeapon(id) && WEAPON_LIST.some(w => w.id === id));
    for (const id of ['ouroboros', 'pandemic', 'spectrum']) ok('evolved weapon ' + id, !!getWeapon(id) && getWeapon(id).evolved);
    ok('Comet character exists', CHARACTERS.some(c => c.id === 'comet') && getCharacter('comet').startWeapon === 'glaive');
  });
  sectionTry('content: glaive boomerang returns', () => {
    const g = new Game(document.getElementById('game')); g.start('comet', 0, { seed: 11 });
    g.spawnEnemy('drifter', g.player.x + 160, g.player.y, 1, 1);
    let sawReturn = false, sawProj = false;
    for (let i = 0; i < 60 * 8; i++) {
      g.update(1 / 60);
      if (g.projectiles.some(pr => pr.boomerang)) sawProj = true;
      if (g.projectiles.some(pr => pr.boomerang && pr.returning)) sawReturn = true;
    }
    ok('glaive spawned a boomerang', sawProj);
    ok('boomerang entered return phase', sawReturn);
  });
  sectionTry('content: toxin leaves damaging pools', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 5 });
    g.player.weapons = []; g.player.addWeapon('toxin');
    const e = g.spawnEnemy('brute', g.player.x + 60, g.player.y, 30, 1);
    const hp0 = e.hp;
    let sawZone = false;
    for (let i = 0; i < 60 * 4; i++) { g.update(1 / 60); if (g.zones.length > 0) sawZone = true; }
    ok('toxin created a zone', sawZone);
    ok('zone damaged a foe', e.dead || e.hp < hp0);
  });
  sectionTry('content: roster achievement scales to all standard chars', () => {
    Save.data.achievements = {};
    for (const c of CHARACTERS) if (!c.secret) Save.unlock(c.id);
    Achievements.check(new Game(document.getElementById('game')));
    ok('roster unlocks with all standard chars', Save.hasAchievement('roster'));
  });

  // 11.16) Content expansion (v20): Lance, Caltrops, evolutions, Astra, Entrench.
  sectionTry('expansion: new weapons registered + in the pool', () => {
    for (const id of ['lance', 'caltrops']) ok('base weapon ' + id, !!getWeapon(id) && WEAPON_LIST.some(w => w.id === id) && !getWeapon(id).evolved);
    for (const id of ['sunpiercer', 'thornfield']) ok('evolved weapon ' + id, !!getWeapon(id) && getWeapon(id).evolved && !WEAPON_LIST.some(w => w.id === id));
    ok('evolution table wired', EVOLUTIONS.some(e => e.into === 'sunpiercer' && e.base === 'lance') && EVOLUTIONS.some(e => e.into === 'thornfield' && e.base === 'caltrops'));
  });
  sectionTry('expansion: Lance fires a piercing line', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 31 });
    g.player.weapons = [{ def: getWeapon('lance'), level: 5, timer: 0 }];
    g.projectiles = [];
    let sawLance = false, maxPierce = 0;
    for (let i = 0; i < 180; i++) {
      g.update(1 / 60);
      for (const pr of g.projectiles) { sawLance = true; maxPierce = Math.max(maxPierce, pr.maxHits); }
    }
    ok('lance launched projectiles', sawLance);
    ok('lances pierce several foes', maxPierce >= 4);
  });
  sectionTry('expansion: Caltrops scatter damaging zones', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 32 });
    g.player.weapons = [{ def: getWeapon('caltrops'), level: 5, timer: 0 }];
    g.zones = [];
    for (let i = 0; i < 200; i++) g.update(1 / 60);
    ok('caltrops created ground zones', g.zones.length > 0);
  });
  sectionTry('expansion: evolutions resolve for the new weapons', () => {
    const g = new Game(document.getElementById('game')); g.start('astra', 0, { seed: 33 });
    const p = g.player;
    p.weapons = [{ def: getWeapon('lance'), level: getWeapon('lance').maxLevel, timer: 0 }];
    p.passives.pierce = 2;
    const evos = availableEvolutions(p);
    ok('Lance offers Sunpiercer when paired with Pierce', evos.some(e => e.into === 'sunpiercer'));
    p.applyUpgrade({ kind: 'evolve', baseId: 'lance', id: 'sunpiercer' });
    ok('evolve swaps in Sunpiercer', p.hasWeapon('sunpiercer') && !p.hasWeapon('lance'));
  });
  sectionTry('expansion: Astra hero is purchasable + lance-armed', () => {
    const a = getCharacter('astra');
    ok('Astra exists, lance start, buyable', a && a.id === 'astra' && a.startWeapon === 'lance' && a.cost > 0 && !a.secret);
    const g = new Game(document.getElementById('game')); g.start('astra', 0, { seed: 34 });
    ok('Astra starts wielding the Lance', g.player.hasWeapon('lance'));
  });
  sectionTry('expansion: Reaper hero crits + executes', () => {
    const r = getCharacter('reaper');
    ok('Reaper exists, glaive start, buyable, has perk', r && r.id === 'reaper' && r.startWeapon === 'glaive' && r.cost > 0 && !r.secret && r.perk && r.perk.execute > 0);
    Save.data.relics = {}; Save.data.equipped = [];
    const base = new Game(document.getElementById('game')); base.start('spark', 0, { seed: 38, noRelics: true });
    const g = new Game(document.getElementById('game')); g.start('reaper', 0, { seed: 38, noRelics: true });
    ok('perk raises crit chance + crit damage', g.player.crit > base.player.crit + 1e-9 && g.player.critMult > base.player.critMult + 1e-9);
    // Execute: a tiny hit finishes a non-boss foe under the threshold.
    g.player.crit = 0; g.player.weapons = [];
    const e = g.spawnEnemy('brute', g.player.x + 300, g.player.y, 1, 1); e.hp = e.maxHp * 0.1;
    g.dealDamage(e, 1, g.player.x, g.player.y, 0);
    ok('Reaper executes a low-health foe', e.dead);
    // A boss is immune to execute.
    base.player.crit = 0;
    const b = g.spawnEnemy('warden', g.player.x + 300, g.player.y, 1, 1, BOSSES.warden); b.boss = true; b.hp = b.maxHp * 0.05;
    g.dealDamage(b, 1, g.player.x, g.player.y, 0);
    ok('bosses are immune to execute', !b.dead);
    // A plain hero never executes.
    const e2 = base.spawnEnemy('brute', base.player.x + 300, base.player.y, 1, 1); e2.hp = e2.maxHp * 0.1;
    base.dealDamage(e2, 1, base.player.x, base.player.y, 0);
    ok('a non-Reaper hero does not execute', !e2.dead);
  });
  sectionTry('expansion: Sentinel hero reflects contact damage (thorns)', () => {
    const bw = getCharacter('sentinel');
    ok('Sentinel exists, buyable, has a thorns perk', bw && bw.id === 'sentinel' && bw.cost > 0 && !bw.secret && bw.perk && bw.perk.thorns > 0);
    Save.data.relics = {}; Save.data.equipped = [];
    const base = new Game(document.getElementById('game')); base.start('spark', 0, { seed: 41, noRelics: true });
    const g = new Game(document.getElementById('game')); g.start('sentinel', 0, { seed: 41, noRelics: true });
    ok('Sentinel is tankier than a baseline hero', g.player.maxHp > base.player.maxHp && g.player.armor > base.player.armor);
    // A foe touching the Sentinel takes reflected damage; touching a plain hero does not.
    const place = (gm) => { const e = gm.spawnEnemy('brute', gm.player.x, gm.player.y, 1, 1); e.hp = 1e6; e.maxHp = 1e6; e.damage = 20; e.x = gm.player.x; e.y = gm.player.y; gm.player.invuln = 0; gm.buildGrid(); return e; };
    const eb = place(g); const hp0 = eb.hp;
    g.updateEnemies(1 / 60);
    ok('a foe striking the Sentinel is wounded by thorns', eb.hp < hp0);
    const ep = place(base); const php0 = ep.hp;
    base.updateEnemies(1 / 60);
    ok('a foe striking a plain hero takes no thorns', ep.hp === php0);
  });
  sectionTry('expansion: Pyre hero detonates slain foes (death blast)', () => {
    const py = getCharacter('pyre');
    ok('Pyre exists, buyable, has a deathBlast perk', py && py.id === 'pyre' && py.cost > 0 && !py.secret && py.perk && py.perk.deathBlast);
    const g = new Game(document.getElementById('game')); g.start('pyre', 0, { seed: 44, noRelics: true });
    g.time = 120; // let the blast scale up a little
    // A victim with a neighbour just inside the blast radius.
    const victim = g.spawnEnemy('brute', g.player.x + 400, g.player.y, 1, 1);
    const near = g.spawnEnemy('drifter', victim.x + 40, victim.y, 1, 1); near.hp = 1e6; near.maxHp = 1e6;
    const far = g.spawnEnemy('drifter', victim.x + 600, victim.y, 1, 1); far.hp = 1e6; far.maxHp = 1e6;
    g.buildGrid();
    const nh0 = near.hp, fh0 = far.hp;
    g.killEnemy(victim);
    ok('a foe in the blast is hurt', near.hp < nh0);
    ok('a foe out of range is untouched', far.hp === fh0);
    // A plain hero produces no death blast.
    const g2 = new Game(document.getElementById('game')); g2.start('spark', 0, { seed: 44, noRelics: true });
    const v2 = g2.spawnEnemy('brute', g2.player.x + 400, g2.player.y, 1, 1);
    const n2 = g2.spawnEnemy('drifter', v2.x + 40, v2.y, 1, 1); n2.hp = 1e6; n2.maxHp = 1e6;
    g2.buildGrid(); const n2h0 = n2.hp;
    g2.killEnemy(v2);
    ok('a plain hero does not detonate foes', n2.hp === n2h0);
  });
  sectionTry('expansion: Flux hero is built around the Blink', () => {
    const f = getCharacter('flux');
    ok('Flux exists, spirit start, buyable, has a perk', f && f.id === 'flux' && f.startWeapon === 'spirit' && f.cost > 0 && !f.secret && !!f.perk);
    Save.data.meta.echo = 0; Save.data.meta.blink = 0;
    const base = new Game(document.getElementById('game')); base.start('spark', 0, { seed: 36 });
    const g = new Game(document.getElementById('game')); g.start('flux', 0, { seed: 36 });
    ok('Flux starts with the seekers', g.player.hasWeapon('spirit'));
    ok('perk grants an extra Blink charge', g.player.dashMaxCharges === base.player.dashMaxCharges + 1);
    ok('perk shortens the recharge', g.player.dashCdMax < base.player.dashCdMax - 1e-9);
    // Blink empowers Flux (a damage surge); Spark's blink does not.
    const m0 = g.player.might; g.player.moveDir = { x: 1, y: 0 };
    g.player.dash();
    ok('blink grants Flux a damage surge', g.player.hasBuff('flux_surge') && g.player.might > m0 + 1e-9);
    base.player.moveDir = { x: 1, y: 0 }; const bm0 = base.player.might; base.player.dash();
    ok('a plain hero gets no surge', !base.player.hasBuff('flux_surge') && Math.abs(base.player.might - bm0) < 1e-9);
  });
  sectionTry('expansion: Meteor lobs delayed AoE strikes', () => {
    ok('meteor in pool, cataclysm evolved + wired', !!getWeapon('meteor') && WEAPON_LIST.some(w => w.id === 'meteor') &&
      !!getWeapon('cataclysm') && getWeapon('cataclysm').evolved && EVOLUTIONS.some(e => e.base === 'meteor' && e.into === 'cataclysm'));
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 73 });
    g.player.weapons = [{ def: getWeapon('meteor'), level: 5, timer: 0 }];
    g.player.x = 1300; g.player.y = 1300; g.player.invuln = 1e9;
    const e = g.spawnEnemy('brute', 1300 + 120, 1300, 8, 1); const ehp = e.hp;
    const origMove = Input.moveVector; Input.moveVector = () => ({ x: 0, y: 0 });
    let scheduledSeen = false;
    for (let i = 0; i < 180; i++) { g.update(1 / 60); if (g.scheduled.length) scheduledSeen = true; }
    Input.moveVector = origMove;
    ok('meteor schedules delayed strikes', scheduledSeen);
    ok('a meteor strike damages a nearby foe', e.dead || e.hp < ehp);
  });
  sectionTry('expansion: Forge hero is the turret specialist', () => {
    const f = getCharacter('forge');
    ok('Forge exists, sentry start, buyable, has turret perk', f && f.id === 'forge' && f.startWeapon === 'sentry' && f.cost > 0 && !f.secret && f.perk && f.perk.turret);
    const base = new Game(document.getElementById('game')); base.start('spark', 0, { seed: 37 });
    const g = new Game(document.getElementById('game')); g.start('forge', 0, { seed: 37 });
    ok('Forge starts with the Sentry', g.player.hasWeapon('sentry'));
    const opts = { x: 100, y: 100, dmg: 10, life: 5, fireCd: 0.6, cap: 1, range: 200, projSpeed: 400 };
    base.deployTurret({ ...opts }); g.deployTurret({ ...opts });
    const bt = base.turrets[0], ft = g.turrets[0];
    ok('Forge turrets hit harder + last longer', ft.dmg > bt.dmg + 1e-9 && ft.maxLife > bt.maxLife + 1e-9);
    // Cap bonus: deploy several; Forge keeps one more than the base cap.
    for (let i = 0; i < 4; i++) { base.deployTurret({ ...opts }); g.deployTurret({ ...opts }); }
    ok('Forge keeps one extra turret', g.turrets.length === base.turrets.length + 1);
  });
  sectionTry('expansion: Entrench synergy ties the new weapons in', () => {
    const wi = id => ({ def: getWeapon(id), level: 1, timer: 0 });
    ok('Lance + Caltrops = Entrench', activeSynergies([wi('lance'), wi('caltrops')]).some(s => s.id === 'entrench'));
    ok('evolved forms still count', activeSynergies([wi('sunpiercer'), wi('whip')]).some(s => s.id === 'entrench'));
  });
  sectionTry('expansion: Sentry deploys turrets that fire at foes', () => {
    ok('sentry in pool, arsenal evolved + wired', !!getWeapon('sentry') && WEAPON_LIST.some(w => w.id === 'sentry') &&
      !!getWeapon('arsenal') && getWeapon('arsenal').evolved && EVOLUTIONS.some(e => e.base === 'sentry' && e.into === 'arsenal'));
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 71 });
    g.player.weapons = [{ def: getWeapon('sentry'), level: 4, timer: 0 }];
    g.player.x = 1300; g.player.y = 1300;
    g.spawnEnemy('brute', 1300 + 120, 1300, 1, 1);   // a target in range, but not on top
    g.projectiles = []; g.turrets = [];
    let sawTurret = false, sawShot = false;
    for (let i = 0; i < 240; i++) { g.update(1 / 60); if (g.turrets.length) sawTurret = true; if (g.projectiles.length) sawShot = true; }
    ok('a turret was deployed', sawTurret);
    ok('the turret fired at a foe', sawShot);
    ok('active turrets respect the cap', g.turrets.length <= 2);
  });
  sectionTry('expansion: turrets expire + cap retires the oldest', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 72 });
    for (let i = 0; i < 4; i++) g.deployTurret({ x: 100 + i, y: 100, dmg: 5, life: 0.3, fireCd: 0.5, cap: 2, range: 200, projSpeed: 400 });
    ok('cap keeps only the newest', g.turrets.length === 2 && g.turrets[g.turrets.length - 1].x === 103);
    for (let i = 0; i < 30; i++) g.updateTurrets(1 / 60);   // past their 0.3s life
    ok('turrets expire after their lifetime', g.turrets.length === 0);
  });
  sectionTry('expansion: Votary snowballs Devotion from each Shrine claimed', () => {
    const v = getCharacter('votary');
    ok('Votary exists, buyable, has a shrineDevotion perk',
      v && v.id === 'votary' && v.cost > 0 && !v.secret && v.perk && v.perk.shrineDevotion);
    // Claim a Fortune shrine (gems + elite pack, but NO stat buff of its own) so
    // the only change to might/speed/hp is the Devotion perk itself.
    const claimFortune = (g) => {
      g.shrines.push({ type: 'fortune', color: '#ffe14d', icon: '💰', x: g.player.x, y: g.player.y, radius: 24, t: 0, life: 26 });
      g.updateShrines(1 / 60);
    };
    const g = new Game(document.getElementById('game')); g.start('votary', 0, { seed: 88, noRelics: true });
    const might0 = g.player.might, speed0 = g.player.speed;
    ok('starts with no Devotion', g.player.devotion === 0);
    g.player.hp = g.player.maxHp * 0.5; const hp0 = g.player.hp;
    claimFortune(g);
    ok('a claim grants one Devotion stack', g.player.devotion === 1);
    ok('one stack raises might about 7%', Math.abs(g.player.might / might0 - 1.07) < 1e-6);
    ok('one stack raises speed about 3%', Math.abs(g.player.speed / speed0 - 1.03) < 1e-6);
    ok('the claim heals the Votary', g.player.hp >= hp0 + g.player.maxHp * 0.14 - 1e-6);
    claimFortune(g);
    ok('Devotion stacks multiply', g.player.devotion === 2 && Math.abs(g.player.might / might0 - 1.14) < 1e-6);
    // A plain hero gains nothing from a shrine claim (no perk).
    const g2 = new Game(document.getElementById('game')); g2.start('spark', 0, { seed: 88, noRelics: true });
    const m2 = g2.player.might;
    claimFortune(g2);
    ok('a plain hero never accrues Devotion', g2.player.devotion === 0 && Math.abs(g2.player.might - m2) < 1e-9);
    // Devotion math is pure: identical claims yield identical stats (Daily-fair).
    const ga = new Game(document.getElementById('game')); ga.start('votary', 0, { seed: 90, noRelics: true });
    const gb = new Game(document.getElementById('game')); gb.start('votary', 0, { seed: 90, noRelics: true });
    for (let i = 0; i < 3; i++) { claimFortune(ga); claimFortune(gb); }
    ok('repeated identical claims are deterministic',
      ga.player.devotion === 3 && ga.player.devotion === gb.player.devotion && Math.abs(ga.player.might - gb.player.might) < 1e-9);
  });

  // 11.5) Gauntlet (boss-rush) mode (v6).
  // Auto-resolve a fresh game's level-up screens (the opening Gauntlet picks
  // arrive during start(), so this must be installed before start()).
  const autoPick = (gm) => {
    gm.openLevelUp = function () {
      if (this.pendingLevels <= 0) { this.state = 'playing'; this.running = true; return; }
      const ch = buildUpgradeChoices(this, 3);
      this.player.applyUpgrade(ch[0]);
      this.pendingLevels--;
      if (this.pendingLevels > 0) this.openLevelUp();
      else { this.state = 'playing'; this.running = true; }
    };
  };
  sectionTry('gauntlet: boss-rush flow', () => {
    const g = new Game(document.getElementById('game'));
    autoPick(g);
    g.start('spark', 0, { mode: 'gauntlet' });
    ok('mode is gauntlet', g.mode === 'gauntlet');
    ok('opening picks resolved (playing)', g.state === 'playing');
    // Arm the player so bosses die quickly, and keep them alive for the test.
    g.player.maxWeapons = 99;
    for (const id of Object.keys(WEAPONS)) g.player.addWeapon(id);
    for (const w of g.player.weapons) w.level = w.def.maxLevel;
    g.player.passives.power = PASSIVES.power.max; g.player.recalc();
    let sawBoss = false;
    for (let i = 0; i < 60 * 60 && g.gauntletCleared < 2; i++) {
      g.player.invuln = 9999; // immortal for the duration of the harness
      g.update(1 / 60);
      if (g.enemies.some(e => e.boss)) sawBoss = true;
      for (const e of g.enemies) if (e.boss) g.dealDamage(e, 1e7, g.player.x, g.player.y, 0);
    }
    ok('gauntlet spawned a boss', sawBoss);
    ok('gauntlet cleared >= 2 rounds', g.gauntletCleared >= 2);
    ok('round counter advanced', g.gauntletRound >= g.gauntletCleared);
  });
  sectionTry('gauntlet: records + achievement', () => {
    const r = Save.recordGauntlet(3, 1000);
    ok('recordGauntlet stores a best', Save.data.gauntletBest.rounds >= 3 && r.best.rounds >= 3);
    ok('gauntletBest default present', typeof Save.defaults().gauntletBest.rounds === 'number');
    Save.data.achievements = {};
    const g = new Game(document.getElementById('game')); autoPick(g); g.start('spark', 0, { mode: 'gauntlet' });
    g.gauntletCleared = 5;
    Achievements.check(g);
    ok('gladiator unlocks at 5 rounds', Save.hasAchievement('gladiator'));
    g.gauntletCleared = 10; Achievements.check(g);
    ok('champion unlocks at 10 rounds', Save.hasAchievement('champion'));
  });

  // 12) Visual / game-feel polish (v5): nebula, projectile trails, tiered
  //     damage numbers (+ their cap), and the option toggle.
  sectionTry('polish: background nebula built', () => {
    const g = new Game(document.getElementById('game'));
    ok('nebula blobs exist', Array.isArray(g.nebula) && g.nebula.length > 0);
    ok('camLead exists', g.camLead && typeof g.camLead.x === 'number');
  });
  sectionTry('polish: projectile trails populate + render', () => {
    Save.data.dmgNumbers = true;
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 7 });
    for (let k = 0; k < 24; k++) g.spawnEnemy('drifter', g.player.x + Math.cos(k) * 90, g.player.y + Math.sin(k) * 90, 1, 1);
    let sawTrail = false, sawText = false;
    for (let i = 0; i < 120; i++) {
      g.update(1 / 60); g.render();
      if (g.projectiles.some(pr => pr.trail && pr.trail.length >= 4)) sawTrail = true;
      if (g.particles.texts.length > 0) sawText = true;
    }
    ok('a projectile carries a motion trail', sawTrail);
    ok('damage numbers produced floating text', sawText);
  });
  sectionTry('polish: damage-number toggle suppresses text', () => {
    Save.data.dmgNumbers = false;
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 9 });
    const e = g.spawnEnemy('brute', g.player.x + 30, g.player.y, 6, 1);
    g.particles.texts.length = 0;
    g.dealDamage(e, 20, g.player.x, g.player.y, 0);
    ok('no damage text when toggle off', g.particles.texts.length === 0);
    Save.data.dmgNumbers = true;
    g.dealDamage(e, 20, g.player.x, g.player.y, 0);
    ok('damage text when toggle on', g.particles.texts.length > 0);
  });
  sectionTry('polish: floating-text cap holds', () => {
    const ps = new Particles();
    for (let i = 0; i < ps.maxTexts + 200; i++) ps.text(0, 0, '' + i, {});
    ok('text count capped at maxTexts', ps.texts.length <= ps.maxTexts);
  });
  sectionTry('polish: hurt flash + render stay finite', () => {
    const g = new Game(document.getElementById('game')); g.start('spark', 0, { seed: 3 });
    g.player.invuln = 0; g.player.hurt(5);
    ok('hitFlash set after hurt', g.player.hitFlash > 0);
    g.render(); // exercises _drawHurtFlash + nebula + trails
    ok('player finite after flashed render', Number.isFinite(g.player.x) && Number.isFinite(g.player.hp));
  });
  ok('dmgNumbers default is on', Save.defaults().dmgNumbers === true);

  report(results, { frames, maxEnemiesSeen, kills: game.kills, score: game.score, levelUps: levelUpsHandled,
    evolutions: EVOLUTIONS.length, achievements: ACHIEVEMENTS.length, omens: MODIFIER_LIST.length });
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
