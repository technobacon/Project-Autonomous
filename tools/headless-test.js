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
    ok('AFFIXES table has 6', Object.keys(AFFIXES).length === 6);
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
      ok(b.id + ' hazard well-formed', (h.kind === 'strike' || h.kind === 'field') &&
        Array.isArray(h.every) && Array.isArray(h.radius) && typeof h.warn === 'number' &&
        typeof h.name === 'string' && typeof h.icon === 'string');
    }
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
  sectionTry('expansion: Entrench synergy ties the new weapons in', () => {
    const wi = id => ({ def: getWeapon(id), level: 1, timer: 0 });
    ok('Lance + Caltrops = Entrench', activeSynergies([wi('lance'), wi('caltrops')]).some(s => s.id === 'entrench'));
    ok('evolved forms still count', activeSynergies([wi('sunpiercer'), wi('whip')]).some(s => s.id === 'entrench'));
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
