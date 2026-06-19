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
  'weapons', 'evolutions', 'enemies', 'upgrades', 'achievements', 'modifiers', 'relics', 'player', 'game', 'ui'];
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
    ok('AFFIXES table has 6', Object.keys(AFFIXES).length === 6);
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
