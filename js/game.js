// ===========================================================================
// LASTLIGHT - game.js
// The core engine: world, camera, entities, collision, combat resolution,
// spawning helpers, leveling, bosses, and all gameplay rendering + HUD.
// ===========================================================================

// Biomes: the world visibly transforms as a run endures. The active biome is a
// pure function of elapsed time (deterministic — Daily stays fair), driving the
// background palette/nebula tint, a mild spawn bias toward thematic foes (which
// archetypes appear, never the difficulty curve) AND a signature environmental
// hazard (see below). After the list it cycles, so a long run keeps shifting.
//
// Hazards make each stage mechanically distinct, not just a repaint. Every one
// is telegraphed (a warning phase before it bites) so it rewards the same
// move-to-survive instinct the whole game runs on, and every one hurts foes too
// — the world is dangerous to everything, not just the player. Two mechanics:
//   • 'strike' — a telegraphed impact: a warning ring, then a single AoE blast.
//   • 'field'  — a lingering area that damages (and may slow) anything inside.
// The Verge (the opening stage) has none, keeping the first ~2.5 min clean for
// newcomers. Spawn timing/positions use the seeded sim RNG → fully deterministic.
const BIOME_SECONDS = 150; // ~2.5 minutes per biome
const BIOMES = [
  { id: 'verge', name: 'The Verge', base: '#05060d', grid: 'rgba(80,110,200,0.07)', accent: '#9ad8ff',
    nebula: [[88, 120, 255], [150, 90, 255], [120, 160, 255]], bias: {}, hazard: null },
  { id: 'emberwaste', name: 'Emberwaste', base: '#0d0604', grid: 'rgba(200,90,40,0.08)', accent: '#ff9a4d',
    nebula: [[255, 120, 60], [255, 80, 40], [200, 60, 30]], bias: { charger: 1.7, runner: 1.4 },
    hazard: { kind: 'strike', name: 'Emberfall', icon: '☄', warnTip: 'meteors rain — dodge the rings',
      every: [2.4, 3.8], count: [1, 2], radius: [70, 112], warn: 1.15, dmg: 15, color: '#ff7a3c' } },
  { id: 'glacier', name: 'Glacial Rift', base: '#040a0e', grid: 'rgba(90,180,220,0.08)', accent: '#9ff0ff',
    nebula: [[80, 200, 230], [120, 220, 255], [180, 240, 255]], bias: { brute: 1.7, drifter: 1.4 },
    hazard: { kind: 'field', name: 'Frost Fields', icon: '❄', warnTip: 'frost pools slow and bite',
      every: [3.0, 4.4], count: [1, 1], radius: [96, 134], warn: 0.85, dur: 5.0, dot: 7, slow: 0.5, color: '#9fe8ff' } },
  { id: 'hollow', name: 'The Hollows', base: '#080510', grid: 'rgba(150,90,220,0.08)', accent: '#c89bff',
    nebula: [[150, 90, 255], [120, 60, 200], [200, 120, 255]], bias: { wraith: 1.7, stalker: 1.7 },
    hazard: { kind: 'field', name: 'Gloom', icon: '◍', warnTip: 'gloom pools eat the light — keep out',
      every: [2.6, 3.9], count: [1, 2], radius: [80, 118], warn: 0.7, dur: 4.5, dot: 12, slow: 0, color: '#b58bff' } },
  { id: 'bloodmoon', name: 'Bloodmoon', base: '#0e0406', grid: 'rgba(220,60,90,0.09)', accent: '#ff6b8a',
    nebula: [[255, 70, 110], [220, 40, 80], [255, 120, 150]], bias: { bomber: 1.6, swarm: 1.5 },
    hazard: { kind: 'strike', name: 'Bloodstorm', icon: '✷', warnTip: 'a storm of strikes — stay mobile',
      every: [1.5, 2.6], count: [1, 3], radius: [82, 122], warn: 0.95, dmg: 17, color: '#ff5d7a' } },
  { id: 'sundering', name: 'The Sundering', base: '#080611', grid: 'rgba(150,110,230,0.09)', accent: '#caa6ff',
    nebula: [[150, 110, 255], [110, 70, 210], [190, 140, 255]], bias: { stalker: 1.5, wraith: 1.4, charger: 1.3 },
    hazard: { kind: 'vortex', name: 'Riftvortex', icon: '🌀', warnTip: 'vortices drag you inward — fight outward',
      every: [3.4, 5.0], count: [1, 1], radius: [150, 200], warn: 0.9, dur: 4.5, dot: 11, color: '#b07cff' } },
];
function biomeForTime(t) { return BIOMES[Math.floor(Math.max(0, t) / BIOME_SECONDS) % BIOMES.length]; }
function biomeIndexForTime(t) { return Math.floor(Math.max(0, t) / BIOME_SECONDS); }

// Shrines: periodic in-world altars that offer a deliberate RISK / REWARD gamble.
// Touch one and it grants a strong boon AND triggers an immediate consequence,
// so the decision is whether the detour (into fresh danger) is worth it. The
// spawn timing, position, type and the spawned threat all use the seeded sim RNG,
// so Shrines are fully deterministic and the Daily stays fair. `invoke(game)`
// runs the boon+consequence; helper effects (heal/buff/elite pack) already exist.
const SHRINE_TYPES = [
  { id: 'power', name: 'Shrine of Power', icon: '🔥', color: '#ff8a3c',
    desc: '+50% damage for 18s — but an elite pack answers the call.',
    invoke(g) {
      g.player.addBuff('shrine_power', { dmgMul: 1.5 }, 18);
      g.spawnShrinePack(3, true);
      g.toast('🔥 Power surges through you!');
    } },
  { id: 'vigor', name: 'Shrine of Vigor', icon: '❤', color: '#7affc4',
    desc: 'Heal 45% of max health — but a ring of foes closes in.',
    invoke(g) {
      g.player.heal(g.player.maxHp * 0.45);
      g.director.spawnRing(g.time / 60);
      g.toast('❤ Vigor floods your light!');
    } },
  { id: 'fortune', name: 'Shrine of Fortune', icon: '💰', color: '#ffe14d',
    desc: 'A shower of light shards — but elites are drawn to the gleam.',
    invoke(g) {
      const min = g.time / 60;
      for (let i = 0; i < 14; i++) g.spawnGem(g.player.x + rand(-60, 60), g.player.y + rand(-60, 60), 2 + Math.floor(min));
      g.spawnShrinePack(2, false);
      g.toast('💰 Fortune favors the bold!');
    } },
];
function getShrineType(id) { return SHRINE_TYPES.find(s => s.id === id) || null; }

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.view = { w: 800, h: 600 };
    this.world = { w: 2600, h: 2600 };
    this.cam = { x: 0, y: 0, sx: 0, sy: 0 }; // sx/sy = shake offset
    this.camLead = { x: 0, y: 0 };           // smoothed look-ahead offset
    this.maxEnemies = 340;

    this.running = false;
    this.state = 'idle'; // idle | playing | levelup | paused | gameover
    this._eid = 1;

    this.reset();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Touch joystick state (mobile).
    this.touch = { active: false, vector: { x: 0, y: 0 }, ox: 0, oy: 0 };
    this._dashReq = false;       // queued Blink request (touch double-tap)
    this._lastTouchStart = 0;
    this._initTouch();

    // Pre-render the starfield to an offscreen canvas (parallax background).
    this._buildStars();
    // Procedural drifting nebula clouds (cosmetic; never touches the seeded RNG).
    this._buildNebula();
  }

  reset() {
    this.player = null;
    this.enemies = [];
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.gems = [];
    this.novas = [];
    this.chains = [];
    this.whips = [];
    this.zones = [];           // lingering ground effects (poison pools, etc.)
    this.turrets = [];         // deployed Sentry/Arsenal turrets (auto-firing allies)
    this.pickups = [];
    this.particles = new Particles();
    this.grid = new Map();
    this.time = 0;
    this.kills = 0;
    this.bossKills = 0;
    this.eliteKills = 0;
    this.championKills = 0;
    this.score = 0;
    this.shake_ = { mag: 0, t: 0 };
    this.toasts = [];
    this.biomeIndex = 0;          // which biome stage we're in (time-driven)
    this.biome = BIOMES[0];       // current biome (palette + spawn bias + hazard)
    this._biomeFlash = 0;         // cosmetic transition wash (decays)
    this.hazards = [];            // active environmental hazards (seeded; in-sim)
    this._hazardTimer = 0;        // countdown to the next hazard spawn (seeded)
    this.shrines = [];            // active risk/reward altars (seeded; in-sim)
    this._shrineTimer = 0;        // countdown to the next shrine (armed after seeding)
    this._coaching = false;       // first-run coaching tips active?
    this.activeBoss = null;
    this.pendingLevels = 0;
    this.scheduled = [];       // sim-time delayed actions {t, fn}
    this.seed = 0;
    this.daily = false;
    this.dailyDate = null;
    this.mode = 'survival';    // 'survival' | 'gauntlet' (boss rush)
    this.trial = null;         // active Trial definition (challenge run), or null
    this.trialWon = false;
    this.customRun = false;    // a player-crafted run with stacked mutators?
    this.mutators = [];        // active mutator ids (custom run)
    this.mutatorRewardMul = 1; // shard payout scale from self-imposed difficulty
    this.gauntletRound = 0;    // round currently in progress
    this.gauntletCleared = 0;  // highest round fully cleared
    this.mods = defaultMods(); // run modifier ("omen") effects
    this.omen = null;
    this.relics = [];          // equipped relic ids active this run
    // Run-tracking for achievements / scoring.
    this.damageTaken = 0;
    this.firstHitTime = null;
    this.evolvedThisRun = false;
    this.maxWeaponsHeld = 0;
    this.diffIndex = 0;
    this.diff = getDifficulty(0);
    if (this.stars) this._buildNebula(); // retint sky to the opening biome on replay
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.view.w = w; this.view.h = h;
  }

  _buildStars() {
    const c = document.createElement('canvas');
    c.width = 1400; c.height = 1400;
    const x = c.getContext('2d');
    for (let i = 0; i < 420; i++) {
      const a = vrand(0.15, 0.7), r = vrand(0.4, 1.6);
      x.globalAlpha = a;
      x.fillStyle = Math.random() < 0.15 ? '#9ad8ff' : (Math.random() < 0.2 ? '#ffd84d' : '#ffffff');
      x.beginPath();
      x.arc(vrand(0, c.width), vrand(0, c.height), r, 0, TAU);
      x.fill();
    }
    this.stars = c;
  }

  _buildNebula() {
    // A handful of big soft colour blobs that drift slowly behind the stars.
    // Positions/tints use vrand (cosmetic) so they never affect determinism.
    // Tinted by the active biome so the sky matches the current stage.
    const palette = (this.biome && this.biome.nebula) ||
      [[88, 120, 255], [150, 90, 255], [60, 200, 220], [255, 90, 150], [120, 160, 255]];
    this.nebula = [];
    for (let i = 0; i < 7; i++) {
      const c = palette[Math.floor(vrand(0, palette.length)) % palette.length];
      this.nebula.push({
        x: vrand(0, 2200), y: vrand(0, 2200),
        r: vrand(260, 520),
        col: c,
        a: vrand(0.05, 0.12),
        dx: vrand(-7, 7), dy: vrand(-7, 7),     // slow drift (px/s)
        ph: vrand(0, TAU), sp: vrand(0.05, 0.16), // gentle breathing
      });
    }
  }

  // ---- Lifecycle --------------------------------------------------------
  start(charId, diffIndex = 0, opts = {}) {
    this.reset();
    // Seed the deterministic gameplay RNG. Daily runs share a date-based seed
    // (everyone faces the same world); normal runs get a fresh random seed.
    this.daily = !!opts.daily;
    this.trial = (opts.trial && typeof getTrial === 'function') ? getTrial(opts.trial) : null;
    // Guard the unlock chain: a locked Trial can't be entered (defends against a
    // stale UI launching one out of order). Falls back to a normal survival run.
    if (this.trial && typeof trialUnlocked === 'function' && !trialUnlocked(this.trial)) this.trial = null;
    this.trialWon = false;
    this.customRun = opts.mode === 'custom' && !this.trial && !this.daily;
    this.mutators = (this.customRun && Array.isArray(opts.mutators)) ? opts.mutators.slice() : [];
    this.mutatorRewardMul = 1;
    // Custom runs are survival under the hood (bosses, biomes, hazards all apply)
    // — the mutators are the only twist, so keep the underlying mode 'survival'.
    this.mode = opts.mode === 'gauntlet' ? 'gauntlet' : 'survival';
    if (this.daily) {
      this.dailyDate = opts.date || dailyDateString();
      this.seed = hashStr('lastlight-daily-' + this.dailyDate);
    } else {
      this.seed = (opts.seed != null ? opts.seed : (Date.now() ^ Math.floor(Math.random() * 0xffffffff))) >>> 0;
    }
    RNG.seed(this.seed);
    // Arm the first Shrine now that the RNG is seeded (deterministic per seed).
    this._shrineTimer = rand(26, 40);
    // Build the run modifiers. A Trial forces its own rule twist and ignores
    // omens AND relics, so each is a fixed, comparable challenge. Otherwise the
    // drafted omen and equipped relics fold into the same pipeline (the Daily
    // ignores relics so its leaderboard stays fair).
    if (this.trial) {
      this.omen = null;
      this.mods = defaultMods();
      Object.assign(this.mods, this.trial.mods || {});
      this.relics = [];
      diffIndex = this.trial.diff || 0;
    } else if (this.customRun) {
      // Free-stacked mutators are the whole modifier story; omens & relics off.
      this.omen = null;
      this.mods = buildMutatorMods(this.mutators);
      this.relics = [];
      this.mutatorRewardMul = mutatorRewardMul(this.mutators);
    } else {
      this.omen = getModifier(opts.omen);
      this.mods = buildMods(opts.omen);
      this.relics = (this.daily || opts.noRelics) ? [] : Save.equippedRelics();
      applyRelics(this.mods, this.relics);
    }
    this.diffIndex = clamp(diffIndex, 0, DIFFICULTIES.length - 1);
    this.diff = getDifficulty(this.diffIndex);
    const char = getCharacter(charId);
    this.player = new Player(this, char);
    // Mastery cosmetics: reflect this hero's lifetime rank (visual prestige only).
    if (typeof masteryRank === 'function') {
      const rk = masteryRank(charMasteryPoints(Save.charStats(char.id)));
      this.player.masteryRank = rk.index;
      this.player.masteryTitle = rk.name;
    }
    this.cam.x = this.player.x - this.view.w / 2;
    this.cam.y = this.player.y - this.view.h / 2;
    this.director = new Director(this);
    this.running = true;
    this.state = 'playing';
    // Coach a brand-new player through the basics in standard Survival only,
    // and only until the core tips have all been seen once.
    this._coaching = !this.daily && !this.trial && !this.customRun && this.mode === 'survival' &&
      !(Save.tipSeen('move') && Save.tipSeen('shards') && Save.tipSeen('dodge') &&
        Save.tipSeen('blink') && Save.tipSeen('pause') && Save.tipSeen('levelup'));
    Audio2.resume();
    Audio2.startMusic(0);
    if (this.trial) {
      this.toast(this.trial.icon + ' ' + this.trial.name + ' — ' + trialGoalText(this.trial), this.trial.color, 3.6);
    } else if (this.customRun) {
      this.toast('🧪 Custom Run — ' + this.mutators.length + ' mutator' + (this.mutators.length === 1 ? '' : 's') + ' · ×' + this.mutatorRewardMul.toFixed(2) + ' shards', '#c9a8ff', 3.4);
    } else if (this.mode === 'gauntlet') {
      this.toast('⚔ GAUNTLET — endless bosses await.');
      this.onLevelUp(3); // opening picks so you arrive armed for the first boss
    } else {
      this.toast(this.daily ? 'Daily Challenge — ' + this.dailyDate
        : (this.diffIndex > 0 ? this.diff.name + ' — survive.' : 'Survive.'));
    }
  }

  // ---- Spatial grid (for radius queries) --------------------------------
  _cellKey(cx, cy) { return cx + ',' + cy; }
  buildGrid() {
    this.grid.clear();
    const cs = 90; this._cs = cs;
    for (const e of this.enemies) {
      const cx = (e.x / cs) | 0, cy = (e.y / cs) | 0;
      const k = this._cellKey(cx, cy);
      let cell = this.grid.get(k);
      if (!cell) { cell = []; this.grid.set(k, cell); }
      cell.push(e);
    }
  }

  enemiesInRadius(x, y, r) {
    const cs = this._cs || 90;
    const out = [];
    const minx = ((x - r) / cs) | 0, maxx = ((x + r) / cs) | 0;
    const miny = ((y - r) / cs) | 0, maxy = ((y + r) / cs) | 0;
    for (let cx = minx; cx <= maxx; cx++) {
      for (let cy = miny; cy <= maxy; cy++) {
        const cell = this.grid.get(this._cellKey(cx, cy));
        if (!cell) continue;
        for (const e of cell) {
          if (e.dead) continue;
          const rr = r + e.radius;
          if (dist2(x, y, e.x, e.y) <= rr * rr) out.push(e);
        }
      }
    }
    return out;
  }

  nearestEnemy(x, y, maxDist = Infinity) {
    let best = null, bd = maxDist * maxDist;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = dist2(x, y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  nearestEnemies(x, y, count) {
    // Small count — collect and partial-sort.
    const arr = [];
    for (const e of this.enemies) {
      if (e.dead) continue;
      arr.push({ e, d: dist2(x, y, e.x, e.y) });
    }
    arr.sort((a, b) => a.d - b.d);
    return arr.slice(0, count).map(o => o.e);
  }

  aimAngle() {
    const t = this.nearestEnemy(this.player.x, this.player.y);
    if (t) return angleTo(this.player.x, this.player.y, t.x, t.y);
    return Math.atan2(this.player.moveDir.y, this.player.moveDir.x);
  }

  offscreenPoint(distMul = 0.62) {
    // A point just outside the visible area, around the player.
    const r = Math.max(this.view.w, this.view.h) * distMul + rand(40, 160);
    const a = rand(0, TAU);
    let x = this.player.x + Math.cos(a) * r;
    let y = this.player.y + Math.sin(a) * r;
    x = clamp(x, 20, this.world.w - 20);
    y = clamp(y, 20, this.world.h - 20);
    return { x, y };
  }

  // ---- Spawning ---------------------------------------------------------
  spawnEnemy(typeId, x, y, hpScale = 1, dmgScale = 1, defOverride = null) {
    if (this.enemies.length >= this.maxEnemies && !defOverride) return null;
    const def = defOverride || ENEMY_TYPES[typeId] || BOSSES[typeId];
    if (!def) return null;
    const d = this.diff, mo = this.mods;
    const hp = def.hp * hpScale * d.hp * mo.enemyHpMul;
    const e = {
      id: this._eid++, type: def, x, y, vx: 0, vy: 0,
      hp, maxHp: hp, speed: def.speed * d.speed * mo.enemySpeedMul, radius: def.radius,
      damage: def.damage * dmgScale * d.dmg * mo.enemyDmgMul, xp: def.xp, color: def.color, shape: def.shape,
      ai: def.ai, flash: 0, slowAmount: 0, slowTimer: 0, burn: 0, dead: false,
      boss: !!def.boss, shootTimer: rand(0.3, (def.shootCd || 2)), state: 0, stateT: 0,
      spawnT: 0,
      // Elite / affix state (inert by default; uniform shape keeps the hot loops fast).
      elite: false, champion: false, affixes: [], eliteName: null, auraColor: null,
      dmgResist: 0, regen: 0, shield: 0, shieldMax: 0,
      arcane: false, affixShootTimer: 0, volatile: !!def.explodes, fuse: 0,
      leech: false, frenzied: false, phaser: false, phaseT: 0,
      castFx: 0,   // render-only conjure telegraph (summoner archetype)
      spin: 0, novaT: 0,   // boss spiral angle + nova cadence (Maelstrom)
      warded: 0,   // remaining "empowered by an Acolyte" buff time (sim state)
    };
    this.enemies.push(e);
    Save.markSeen('enemies', def.id);
    return e;
  }

  // ---- Elites & affixes -------------------------------------------------
  // Promote an enemy to an elite: scale it up, then layer on affixes. Scaling
  // is applied BEFORE affixes so affix multipliers (e.g. Hardened) compose on
  // top, and composes ON TOP of difficulty/omen multipliers already baked into
  // the base stats. Uses seeded RNG only (called from the sim/spawn path).
  makeElite(e, affixCount = 1, isChampion = false) {
    if (!e || e.boss) return e;
    e.elite = true;
    const s = isChampion ? 3.4 : 1.7;
    e.maxHp *= s; e.hp = e.maxHp;
    e.radius *= isChampion ? 1.9 : 1.35;
    e.damage *= isChampion ? 2.0 : 1.4;
    e.xp = Math.ceil(e.xp * (isChampion ? 8 : 3));
    const ids = shuffle(Object.keys(AFFIXES)).slice(0, affixCount);
    for (const id of ids) { e.affixes.push(AFFIXES[id]); this._applyAffix(e, id); }
    e.auraColor = isChampion ? '#ffd84d' : (e.affixes[0] ? e.affixes[0].color : '#ffd84d');
    e.maxHp = e.hp; // re-sync so the health bar reads full after all multipliers
    return e;
  }

  makeChampion(e, min = 0) {
    if (!e) return e;
    e.champion = true; e.boss = false; // champions are NOT bosses (own bar/rewards)
    this.makeElite(e, 2, true);
    e.eliteName = pick(CHAMPION_NAMES);
    Audio2.championWarn();
    this.shake(10, 0.5);
    this.toast('☠ ' + e.eliteName + ' — a Champion rises!');
    return e;
  }

  _applyAffix(e, id) {
    switch (id) {
      case 'swift':    e.speed *= 1.6; break;
      case 'hardened': e.dmgResist = 0.5; e.hp *= 1.6; e.maxHp = e.hp; break;
      case 'regen':    e.regen = e.maxHp * 0.04; break;
      case 'volatile': e.volatile = true; break;
      case 'arcane':   e.arcane = true; e.affixShootTimer = rand(0.6, 1.4); break;
      case 'shielded': e.shield = e.maxHp * 0.6; e.shieldMax = e.shield; break;
      case 'leech':    e.leech = true; break;
      case 'frenzied': e.frenzied = true; break;
      case 'phaser':   e.phaser = true; e.phaseT = rand(1.6, 2.8); break;
    }
  }

  spawnProjectile(o) {
    this.projectiles.push({
      x: o.x, y: o.y,
      vx: Math.cos(o.angle) * o.speed, vy: Math.sin(o.angle) * o.speed,
      speed: o.speed, angle: o.angle,
      damage: o.damage, radius: o.radius || 6,
      hitsLeft: (o.pierce || 0) + 1, maxHits: (o.pierce || 0) + 1, life: o.life || 1.5,
      color: o.color || '#fff', glow: o.glow || o.color || '#fff',
      seek: !!o.seek, seekStrength: o.seekStrength || 9,
      kb: o.kb || 60, chill: o.chill || 0, chillDur: o.chillDur || 0,
      burn: o.burn || 0, hit: null, trail: [],
      boomerang: !!o.boomerang, outT: o.outT || 0.5, bt: 0, returning: false,
    });
  }

  spawnEnemyProjectile(x, y, angle, speed, damage, color = '#ff6b8a') {
    this.enemyProjectiles.push({
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      radius: 7, damage, life: 5, color,
    });
  }

  spawnGem(x, y, value) {
    const a = rand(0, TAU), s = rand(40, 120);
    this.gems.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, value, t: 0, attract: false });
  }

  spawnPickup(x, y, kind) {
    this.pickups.push({ x, y, kind, t: 0, vx: rand(-30, 30), vy: rand(-30, 30) });
  }

  nova(x, y, maxR, dmg, kb, color) {
    this.novas.push({ x, y, r: 0, maxR, dmg, kb, color, speed: maxR / 0.35, hit: new Set() });
    this.shake(5, 0.18);
  }
  spawnNova(x, y, maxR, dmg, kb, color) { this.nova(x, y, maxR, dmg, kb, color); }

  // Lingering ground effect (poison pool). Ticks damage to all foes inside.
  spawnZone(x, y, r, dps, life, color = '#a6e22e', slow = 0) {
    this.zones.push({ x, y, r, dps, life, maxLife: life, color, slow, t: 0, tick: 0 });
  }

  castChain(x, y, jumps, dmg, range) {
    const hitIds = new Set();
    let fromX = x, fromY = y;
    const segs = [];
    for (let i = 0; i < jumps; i++) {
      let best = null, bd = range * range;
      for (const e of this.enemies) {
        if (e.dead || hitIds.has(e.id)) continue;
        const d = dist2(fromX, fromY, e.x, e.y);
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) break;
      hitIds.add(best.id);
      this.dealDamage(best, dmg, fromX, fromY, 40);
      segs.push({ x1: fromX, y1: fromY, x2: best.x, y2: best.y });
      this.particles.burst(best.x, best.y, 5, { color: '#cfeaff', speed: rand(60, 140), life: 0.3 });
      fromX = best.x; fromY = best.y;
    }
    if (segs.length) this.chains.push({ segs, life: 0.18, maxLife: 0.18 });
  }

  spawnWhip(x, y, dir, len, wide, dmg) {
    const w = { x, y, dir, len, wide, life: 0.18, maxLife: 0.18 };
    this.whips.push(w);
    // Instant damage to enemies inside the arc.
    const cands = this.enemiesInRadius(x, y, len);
    for (const e of cands) {
      const a = angleTo(x, y, e.x, e.y);
      let da = Math.abs(((a - dir + Math.PI * 3) % TAU) - Math.PI);
      if (da <= wide) this.dealDamage(e, dmg, x, y, 160);
    }
  }

  // ---- Combat resolution ------------------------------------------------
  dealDamage(e, amount, fromX, fromY, kb = 0, silent = false) {
    if (e.dead) return;
    const crit = chance(this.player.crit);
    let dmg = amount * (crit ? this.player.critMult : 1);
    // Berserker omen: bonus damage scaling with the player's missing health.
    if (this.mods.berserk) dmg *= 1 + (1 - this.player.hp / this.player.maxHp);
    // Affixes: Hardened resists, Shielded absorbs a burst before health is hit.
    if (e.dmgResist) dmg *= (1 - e.dmgResist);
    if (e.warded > 0) dmg *= 0.75;   // Acolyte's ward softens incoming damage

    if (e.shield > 0 && dmg > 0) {
      const absorbed = Math.min(e.shield, dmg);
      e.shield -= absorbed; dmg -= absorbed;
    }
    e.hp -= dmg;
    e.flash = 0.08;
    const a = angleTo(fromX, fromY, e.x, e.y);
    // DoT / zone ticks pass silent=true so they don't flood the screen with
    // numbers and flashes (they hit many foes many times per second).
    this.particles.spray(e.x, e.y, a, silent ? 1 : (crit ? 8 : 4), 0.6, { color: e.color, speed: rand(60, 160), life: 0.4 });
    if (!silent) {
      if (crit) Audio2.crit(); // rewarding ping (self-throttled in Audio2)
      // Bright impact flash at the point of contact (cosmetic — no seeded RNG).
      this.particles.spawn(e.x, e.y, { color: crit ? '#fff36b' : '#ffffff',
        size: crit ? 6 : 3.5, life: 0.12, speed: 0, angle: 0, drag: 0, glow: true });
    }
    // Tiered floating damage numbers (bigger/hotter as the hit gets stronger).
    if (!silent && Save.data && Save.data.dmgNumbers) {
      const r = Math.round(dmg);
      let col = '#dfe9ff', size = 12;
      if (crit) { col = '#fff36b'; size = 18; }
      else if (r >= 120) { col = '#ff9d3c'; size = 16; }
      else if (r >= 45) { col = '#ffe14d'; size = 14; }
      this.particles.text(e.x + vrand(-5, 5), e.y - e.radius - 2, r + (crit ? '!' : ''),
        { color: col, size, vx: vrand(-20, 20), vy: vrand(-62, -38), pop: crit ? 1.25 : 1 });
    }
    if (kb > 0) {
      const massFactor = e.boss ? 0.06 : clamp(16 / e.radius, 0.3, 1.4);
      e.vx += Math.cos(a) * kb * massFactor;
      e.vy += Math.sin(a) * kb * massFactor;
    }
    if (e.hp <= 0) this.killEnemy(e);
  }

  killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    this.kills++;
    this.score += Math.round(10 + e.xp * 5 + (e.boss ? 500 : 0));
    // Vampiric omen: heal a little on each kill.
    if (this.mods.lifesteal && this.player.alive) this.player.heal(1 + this.player.maxHp * this.mods.lifesteal);

    // Volatile (affix / Bomber type): erupt a ring of projectiles. Only touches
    // enemyProjectiles, so it is safe to call from inside the updateEnemies loop.
    if (e.volatile) {
      const n = e.type.burstN || 10;
      const base = rand(0, TAU);
      const bdmg = e.type.burstDmg || Math.max(8, e.damage * 0.6);
      for (let k = 0; k < n; k++) this.spawnEnemyProjectile(e.x, e.y, base + (k / n) * TAU, e.type.burstSpeed || 200, bdmg, '#ff8a3c');
      this.particles.burst(e.x, e.y, 18, { color: '#ff7a3c', speed: rand(120, 300), life: rand(0.4, 0.8) });
      Audio2.blip(120, 0.18, 'sawtooth', 0.16, -120);
    }

    // XP gems — bosses & champions shower the player with them.
    if (e.boss) {
      this.bossKills++;
      Save.recordBossKill(e.type.id);   // lifetime per-boss-type tally
      this.activeBoss = null;
      Audio2.bossDie();
      this.shake(16, 0.6);
      this.particles.burst(e.x, e.y, 60, { color: e.color, speed: rand(120, 360), life: rand(0.5, 1.1), size: rand(2, 5) });
      const gemCount = Math.min(40, 12 + Math.floor(e.xp / 6));
      for (let i = 0; i < gemCount; i++) this.spawnGem(e.x + rand(-40, 40), e.y + rand(-40, 40), Math.ceil(e.xp / gemCount));
      this.spawnPickup(e.x, e.y, 'health');
      this.spawnPickup(e.x + 30, e.y, 'chest');
      this.toast('✦ ' + e.type.name + ' destroyed!');
    } else if (e.champion) {
      this.championKills++;
      Audio2.bossDie();
      this.shake(12, 0.4);
      this.particles.burst(e.x, e.y, 36, { color: e.auraColor || e.color, speed: rand(120, 320), life: rand(0.5, 1.0), size: rand(2, 4) });
      const gc = Math.min(24, 8 + Math.floor(e.xp / 8));
      for (let i = 0; i < gc; i++) this.spawnGem(e.x + rand(-34, 34), e.y + rand(-34, 34), Math.ceil(e.xp / gc));
      this.spawnPickup(e.x, e.y, 'chest');
      this.spawnPickup(e.x + 26, e.y, 'health');
      this.toast('✦ ' + (e.eliteName || 'Champion') + ' slain!');
    } else {
      if (e.elite) Audio2.eliteDie(); else Audio2.enemyDie();
      this.particles.burst(e.x, e.y, e.radius > 18 ? 14 : 7, { color: e.color, speed: rand(60, 220), life: rand(0.3, 0.6) });
      this.spawnGem(e.x, e.y, e.xp);
      // Elites drop a little extra loot.
      if (e.elite) {
        this.eliteKills++;
        for (let i = 0; i < 3; i++) this.spawnGem(e.x + rand(-26, 26), e.y + rand(-26, 26), Math.max(1, Math.ceil(e.xp / 4)));
        if (chance(0.25)) this.spawnPickup(e.x, e.y, 'health');
      }
      // Rare drops.
      if (chance(0.012)) this.spawnPickup(e.x, e.y, 'health');
      if (chance(0.006)) this.spawnPickup(e.x, e.y, 'magnet');
      if (chance(0.004)) this.spawnPickup(e.x, e.y, 'bomb');
    }

    // Splitter spawns children (inheriting the current difficulty scale).
    if (e.type.splitInto) {
      const scale = this.director ? this.director.hpScale(this.time / 60) * 0.6 : 1;
      for (let i = 0; i < (e.type.splitCount || 3); i++) {
        const child = this.spawnEnemy(e.type.splitInto, e.x + rand(-15, 15), e.y + rand(-15, 15), scale, 1);
        if (child) { child.vx = rand(-120, 120); child.vy = rand(-120, 120); }
      }
    }
  }

  // ---- Player event hooks ----------------------------------------------
  onLevelUp(levels) {
    this.pendingLevels += levels;
    Audio2.levelUp();
    this.particles.ring(this.player.x, this.player.y, 24, { color: '#fff36b', speed: 200, life: 0.6 });
    if (this.state === 'playing') this.openLevelUp();
  }

  openLevelUp() {
    if (this.pendingLevels <= 0) { this.state = 'playing'; return; }
    this.state = 'levelup';
    this.running = false;
    // 4 choices if lucky or the Abundance omen is active, otherwise 3.
    const luckBonus = (this.mods.extraChoice || chance(this.player.luck)) ? 4 : 3;

    // Evolutions take priority — they appear as special golden cards.
    const evos = availableEvolutions(this.player);
    const evoChoices = evos.map(evo => {
      const def = getWeapon(evo.into);
      return { kind: 'evolve', id: evo.into, baseId: evo.base, name: def.name,
        icon: def.icon, color: def.color, desc: def.desc(1), level: 1, isNew: false, evolve: true };
    });
    const targetN = Math.min(4, Math.max(luckBonus, evoChoices.length));
    let choices = evoChoices.slice(0, 4);
    if (choices.length < targetN) {
      const normal = buildUpgradeChoices(this, targetN - choices.length);
      choices = choices.concat(normal);
    }
    UI.showLevelUp(this, choices);
  }

  chooseUpgrade(choice) {
    this.player.applyUpgrade(choice);
    Audio2.uiSelect();
    this.maxWeaponsHeld = Math.max(this.maxWeaponsHeld, this.player.weapons.length);
    this.announce(Achievements.check(this));
    this.pendingLevels--;
    if (this.pendingLevels > 0) {
      this.openLevelUp();
    } else {
      this.state = 'playing';
      this.running = true;
      UI.hideLevelUp();
    }
  }

  onEvolve(choice) {
    this.evolvedThisRun = true;
    Save.data.evolutionsMade = (Save.data.evolutionsMade || 0) + 1;
    Save.save();
    this.shake(12, 0.4);
    this.particles.ring(this.player.x, this.player.y, 40, { color: choice.color, speed: 320, life: 0.9, size: 4 });
    this.nova(this.player.x, this.player.y, 220, 40 * this.player.might, 260, choice.color);
    this.toast('🧬 EVOLVED: ' + choice.name + '!');
    Audio2.victory();
  }

  // Toast + sound for any newly-unlocked achievements.
  announce(newly) {
    if (!newly || !newly.length) return;
    for (const a of newly) {
      this.toast('🏆 ' + a.name + (a.reward ? '  (+' + a.reward + '✦)' : ''));
    }
    Audio2.levelUp();
  }

  onBossSpawn(e) {
    this.activeBoss = e;
    // Stagger the Maelstrom's first ring-nova so it doesn't fire on arrival.
    e.spin = 0; e.novaT = (e.type.novaCd || 5) * 0.7;
    Audio2.bossWarn();
    this.shake(10, 0.5);
    this.toast('☠ ' + e.type.name + ' approaches!');
  }

  // Advance the biome stage. The index is a pure function of elapsed time, so
  // it's identical for a given seed regardless of framerate (determinism-safe).
  // Crossing into a new stage retints the sky and announces it — all cosmetic.
  updateBiome(dt) {
    if (this._biomeFlash > 0) this._biomeFlash = Math.max(0, this._biomeFlash - dt);
    const idx = biomeIndexForTime(this.time);
    if (idx === this.biomeIndex) return;
    const first = this.time <= 0;
    this.biomeIndex = idx;
    this.biome = BIOMES[idx % BIOMES.length];
    this._buildNebula();           // cosmetic retint (vrand only)
    // Grace period before the new stage's hazard begins (seeded for fairness),
    // so entering a biome never lands an instant unavoidable hit.
    this._hazardTimer = this.biome.hazard ? rand(2.0, 3.5) : 0;
    if (!first) {
      this._biomeFlash = 1;
      this.toast('❖ Entering ' + this.biome.name);
      Audio2.biomeShift();
      const hz = this.biome.hazard;
      if (hz) this.toast(hz.icon + ' ' + hz.name + ' — ' + hz.warnTip, hz.color, 4.0);
    }
  }

  // Build a compact, display-ready record of this run for the chronicle.
  runSnapshot(earned) {
    const p = this.player;
    const weapons = (p && p.weapons ? p.weapons : []).map(w => ({
      id: w.def.id, icon: w.def.icon, color: w.def.color, level: w.level,
      evo: !!(typeof EVOLVED_WEAPONS !== 'undefined' && EVOLVED_WEAPONS[w.def.id]),
    }));
    return {
      t: Date.now(),
      mode: this.trial ? 'trial' : (this.customRun ? 'custom' : (this.daily ? 'daily' : this.mode)),
      trialId: this.trial ? this.trial.id : null,
      trialName: this.trial ? this.trial.name : null,
      trialWon: !!this.trialWon,
      mutators: (this.mutators || []).slice(),
      char: p && p.char ? p.char.id : 'spark',
      charName: p && p.char ? p.char.name : 'Spark',
      charColor: p && p.char ? p.char.color : '#ffd84d',
      diff: this.diffIndex,
      diffName: this.diff ? this.diff.name : 'Normal',
      diffColor: this.diff ? this.diff.color : '#7affc4',
      time: this.time,
      score: this.score,
      kills: this.kills,
      bosses: this.bossKills,
      level: p ? p.level : 1,
      rounds: this.gauntletCleared || 0,
      dailyDate: this.daily ? this.dailyDate : null,
      omen: this.omen ? this.omen.id : null,
      omenIcon: this.omen ? this.omen.icon : null,
      omenColor: this.omen ? this.omen.color : null,
      relics: (this.relics || []).slice(),
      weapons,
      shards: earned || 0,
    };
  }

  onPlayerDeath() {
    this.running = false;
    this.state = 'gameover';
    Audio2.stopMusic();
    Audio2.gameOver();
    this.shake(20, 0.8);
    this.particles.burst(this.player.x, this.player.y, 70, { color: this.player.char.color, speed: rand(100, 400), life: rand(0.6, 1.3) });

    // Compute shards earned and persist progression (difficulty boosts reward).
    // Gauntlet pays out by rounds cleared; survival by time + slaughter.
    let earned = this.mode === 'gauntlet'
      ? Math.floor((this.gauntletCleared * 45 + this.kills * 0.2 + this.bossKills * 12)
        * this.player.shardMult * this.diff.reward)
      : Math.floor((this.time / 8 + this.kills * 0.25 + this.bossKills * 30)
        * this.player.shardMult * this.diff.reward);
    // Custom runs scale payout by self-imposed difficulty (harder = more).
    if (this.customRun) earned = Math.floor(earned * this.mutatorRewardMul);
    Save.addShards(earned);
    // Trials and Custom runs keep their own books (no best-time/score pollution
    // of standard records) but still feed run/kill totals and the chronicle.
    if (this.trial || this.customRun) Save.recordSideRun(this.kills, this.bossKills);
    else Save.recordRun(this.time, this.score, this.kills, this.bossKills);
    if (this.mode === 'gauntlet') this.lastGauntlet = Save.recordGauntlet(this.gauntletCleared, this.score);
    const snap = this.runSnapshot(earned);
    Save.recordHistory(snap);
    Save.recordMastery(snap); // lifetime per-character / per-weapon totals

    // Ascension: surviving the unlock threshold opens the next difficulty.
    const next = DIFFICULTIES[this.diffIndex + 1];
    let unlockedDiff = null;
    if (next && this.time >= next.unlockAt && Save.data.maxDifficulty < this.diffIndex + 1) {
      Save.unlockDifficulty(this.diffIndex + 1);
      unlockedDiff = next;
    }

    // Daily Challenge best (per date).
    if (this.daily) this.lastDaily = Save.recordDaily(this.dailyDate, this.time, this.score);

    // Achievements (some reward extra shards on top).
    const newly = Achievements.check(this);
    this.lastEarned = earned;
    this.lastNewAchievements = newly;
    this.lastUnlockedDiff = unlockedDiff;
    setTimeout(() => UI.showGameOver(this), 900);
  }

  // A Trial's objective was met — end the run in victory.
  trialVictory() {
    this.running = false;
    this.state = 'gameover';
    this.trialWon = true;
    Audio2.stopMusic();
    Audio2.victory();
    const p = this.player;
    this.particles.burst(p.x, p.y, 80, { color: this.trial.color, speed: rand(120, 460), life: rand(0.6, 1.4) });
    this.shake(10, 0.5);

    // First clear pays full; replays pay a small bounty.
    const first = !Save.isTrialDone(this.trial.id);
    const reward = first ? this.trial.reward : Math.max(10, Math.round(this.trial.reward * 0.25));
    Save.completeTrial(this.trial.id);
    Save.addShards(reward);
    Save.recordSideRun(this.kills, this.bossKills);
    const snap = this.runSnapshot(reward);
    Save.recordHistory(snap);
    Save.recordMastery(snap);

    const newly = Achievements.check(this);
    this.lastEarned = reward;
    this.lastTrialFirst = first;
    this.lastNewAchievements = newly;
    this.lastUnlockedDiff = null;
    this.lastGauntlet = null;
    setTimeout(() => UI.showGameOver(this), 700);
  }

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused'; this.running = false; UI.showPause(this);
    } else if (this.state === 'paused') {
      this.state = 'playing'; this.running = true; UI.hidePause();
    }
  }

  quitToMenu() {
    this.running = false;
    this.state = 'idle';
    Audio2.stopMusic();
    UI.showMenu();
  }

  shake(mag, t) {
    if (Save.data && Save.data.shakeOff) return;
    if (mag > this.shake_.mag) { this.shake_.mag = mag; this.shake_.t = t; this.shake_.max = t; }
  }

  // Run a function after `delay` seconds of SIMULATION time (deterministic,
  // pauses with the game — unlike setTimeout).
  schedule(delay, fn) { this.scheduled.push({ t: delay, fn }); }
  _runScheduled(dt) {
    for (let i = this.scheduled.length - 1; i >= 0; i--) {
      const s = this.scheduled[i];
      s.t -= dt;
      if (s.t <= 0) { this.scheduled.splice(i, 1); try { s.fn(); } catch (e) {} }
    }
  }
  toast(msg, color = '#ffe9a8', life = 2.6) { this.toasts.push({ msg, life, color }); if (this.toasts.length > 3) this.toasts.shift(); }

  // One-time coaching tip (shown once ever, only in standard Survival). Purely
  // a cosmetic toast + a persisted flag — never touches the simulation.
  coach(id, msg) {
    if (!this._coaching || Save.tipSeen(id)) return;
    Save.markTip(id);
    this.toast('➤ ' + msg, '#9ff0ff', 4.4);
  }

  // Drip-feed the basics to a new player as situations arise. Cosmetic-only;
  // self-disables once the core tips have all been seen.
  coachUpdate() {
    if (!this._coaching) return;
    if (this.time > 1.2) this.coach('move', 'Move with WASD or arrows — your light fights on its own.');
    if (this.gems.length > 0) this.coach('shards', 'Gather light shards to fill the XP bar and level up.');
    if (this.damageTaken > 0) this.coach('dodge', 'The dark hurts on contact — keep moving to stay alive.');
    if (this.time > 10) this.coach('blink', 'Press Space or Shift to Blink — a quick dash with brief invulnerability.');
    if (this.time > 24) this.coach('pause', 'Pause anytime with Esc or P.');
    if (Save.tipSeen('move') && Save.tipSeen('shards') && Save.tipSeen('dodge') &&
        Save.tipSeen('blink') && Save.tipSeen('pause') && Save.tipSeen('levelup')) this._coaching = false;
  }

  // ---- Update -----------------------------------------------------------
  update(dt) {
    if (!this.running || this.state !== 'playing') return;
    dt = Math.min(dt, 0.05); // clamp huge frame gaps
    this.time += dt;

    this.updateBiome(dt);      // advance the stage before spawns read its bias
    this.coachUpdate();        // first-run coaching (cosmetic toasts only)
    this._runScheduled(dt);    // fire any due delayed effects first
    this.buildGrid();          // grid first, so weapon queries see current foes
    this.player.update(dt);
    this.director.update(dt);
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updateEnemyProjectiles(dt);
    this.updateNovas(dt);
    this.updateZones(dt);
    this.updateTurrets(dt);
    this.updateHazards(dt);
    this.updateShrines(dt);
    this.updateGems(dt);
    this.updatePickups(dt);
    this.particles.update(dt);

    // Transient FX timers.
    for (let i = this.chains.length - 1; i >= 0; i--) { this.chains[i].life -= dt; if (this.chains[i].life <= 0) this.chains.splice(i, 1); }
    for (let i = this.whips.length - 1; i >= 0; i--) { this.whips[i].life -= dt; if (this.whips[i].life <= 0) this.whips.splice(i, 1); }
    for (let i = this.toasts.length - 1; i >= 0; i--) { this.toasts[i].life -= dt; if (this.toasts[i].life <= 0) this.toasts.splice(i, 1); }

    // Camera follow with a gentle look-ahead toward the direction of travel,
    // smoothed so quick direction changes don't snap. (Cosmetic — the camera is
    // never part of the simulation state.)
    const lead = 52;
    const k = Math.min(1, 3.5 * dt);
    this.camLead.x += (this.player.moveDir.x * lead - this.camLead.x) * k;
    this.camLead.y += (this.player.moveDir.y * lead - this.camLead.y) * k;
    this.cam.x = clamp(this.player.x + this.camLead.x - this.view.w / 2, 0, Math.max(0, this.world.w - this.view.w));
    this.cam.y = clamp(this.player.y + this.camLead.y - this.view.h / 2, 0, Math.max(0, this.world.h - this.view.h));
    if (this.shake_.t > 0) {
      this.shake_.t -= dt;
      const k = this.shake_.mag * (this.shake_.t / this.shake_.max);
      this.cam.sx = vrand(-k, k); this.cam.sy = vrand(-k, k);
      if (this.shake_.t <= 0) { this.shake_.mag = 0; this.cam.sx = this.cam.sy = 0; }
    }

    // Adaptive music: intensity scales with time, boss/champion presence and
    // how crowded the field is; a boss or Champion flips the darker arrangement.
    const champ = this.enemies.some(e => e.champion);
    const bossish = !!this.activeBoss || champ;
    Audio2.setBossMode(bossish);
    const dens = clamp(this.enemies.length / 140, 0, 0.2);
    Audio2.setIntensity(clamp(this.time / 360 + (this.activeBoss ? 0.45 : 0) + (champ ? 0.2 : 0) + dens, 0, 1));

    // Trial victory: the objective met ends the run in triumph.
    if (this.trial && this.state === 'playing' && trialGoalMet(this.trial, this)) this.trialVictory();
  }

  updateEnemies(dt) {
    const p = this.player;
    const cs = this._cs || 90;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) { this.enemies.splice(i, 1); continue; }
      e.spawnT += dt;
      if (e.flash > 0) e.flash -= dt;
      if (e.slowTimer > 0) { e.slowTimer -= dt; if (e.slowTimer <= 0) e.slowAmount = 0; }

      // Burn DoT.
      if (e.burn > 0) {
        e.burn -= dt;
        e.hp -= 8 * dt;
        if (chance(0.3)) this.particles.spawn(e.x + rand(-6, 6), e.y + rand(-6, 6), { color: '#ff8a3c', speed: 20, life: 0.3, size: 2 });
        if (e.hp <= 0) { this.killEnemy(e); this.enemies.splice(i, 1); continue; }
      }

      // Regenerating affix: heal over time (no RNG — arithmetic only).
      if (e.regen && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.regen * dt);

      // Knockback velocity decay.
      e.x += e.vx * dt; e.y += e.vy * dt;
      e.vx *= (1 - Math.min(1, 8 * dt)); e.vy *= (1 - Math.min(1, 8 * dt));

      // Acolyte ward: empowered foes move faster (and resist damage, in dealDamage).
      if (e.warded > 0) e.warded -= dt;
      const ward = e.warded > 0 ? 1.28 : 1;
      // Frenzied affix: the more wounded it is, the faster it moves.
      const frenzy = e.frenzied ? 1 + (1 - e.hp / e.maxHp) * 0.6 : 1;
      const slow = 1 - e.slowAmount;
      const spd = e.speed * slow * ward * frenzy;

      // AI movement.
      this._enemyAI(e, dt, spd);

      // The Bomber (and anything that self-destructs in its AI) calls killEnemy
      // from inside this loop; remove it now so it doesn't deal a bonus frame of
      // contact damage. Mirrors the burn-death branch above.
      if (e.dead) { this.enemies.splice(i, 1); continue; }

      // Light separation to avoid total overlap (keeps a "crowd" feel).
      this._separate(e, cs);

      // Keep within world.
      e.x = clamp(e.x, -200, this.world.w + 200);
      e.y = clamp(e.y, -200, this.world.h + 200);

      // Contact damage to player.
      if (p.alive) {
        const rr = e.radius + p.radius;
        if (dist2(e.x, e.y, p.x, p.y) <= rr * rr) {
          const lands = p.invuln <= 0;   // a hit actually connects (not i-framed)
          p.hurt(e.damage);
          // Leeching affix: a connecting hit heals the attacker.
          if (lands && e.leech && !e.dead) e.hp = Math.min(e.maxHp, e.hp + e.damage * 1.5);
        }
      }
    }
  }

  _enemyAI(e, dt, spd) {
    const p = this.player;
    const ang = angleTo(e.x, e.y, p.x, p.y);
    // Arcane affix: fire aimed bolts regardless of base AI (timer-driven; no RNG).
    if (e.arcane) {
      e.affixShootTimer -= dt;
      if (e.affixShootTimer <= 0) {
        e.affixShootTimer = 2.2;
        this.spawnEnemyProjectile(e.x, e.y, ang, 240, Math.max(6, e.damage * 0.6), '#c98bff');
      }
    }
    // Phasing affix: periodic sudden lunges toward the player (seeded cadence;
    // the blink distance is bounded so it never lands directly on you).
    if (e.phaser) {
      e.phaseT -= dt;
      if (e.phaseT <= 0) {
        e.phaseT = rand(2.0, 3.2);
        const d = dist(e.x, e.y, p.x, p.y);
        const hop = Math.min(150, Math.max(0, d - 60));
        e.x += Math.cos(ang) * hop; e.y += Math.sin(ang) * hop;
        e.flash = 0.12;
        this.particles.burst(e.x, e.y, 8, { color: '#b6f0ff', speed: vrand(60, 160), life: vrand(0.2, 0.4) });
      }
    }
    switch (e.ai) {
      case 'shooter': {
        const d = dist(e.x, e.y, p.x, p.y);
        const range = e.type.shootRange || 320;
        if (d > range) { e.x += Math.cos(ang) * spd * dt; e.y += Math.sin(ang) * spd * dt; }
        else if (d < range * 0.6) { e.x -= Math.cos(ang) * spd * dt; e.y -= Math.sin(ang) * spd * dt; }
        e.shootTimer -= dt;
        if (e.shootTimer <= 0 && d < range * 1.2) {
          e.shootTimer = e.type.shootCd || 2;
          this.spawnEnemyProjectile(e.x, e.y, ang, e.type.projSpeed || 220, e.type.projDmg || 9, '#46e0a0');
        }
        break;
      }
      case 'charger': {
        e.stateT -= dt;
        if (e.state === 0) { // approach
          e.x += Math.cos(ang) * spd * dt; e.y += Math.sin(ang) * spd * dt;
          if (dist2(e.x, e.y, p.x, p.y) < 240 * 240 && e.stateT <= 0) {
            e.state = 1; e.stateT = 0.5; e.chargeAng = ang; // telegraph
          }
        } else if (e.state === 1) { // telegraph (stand)
          if (e.stateT <= 0) { e.state = 2; e.stateT = 0.6; }
        } else { // dash
          e.x += Math.cos(e.chargeAng) * spd * 4.5 * dt;
          e.y += Math.sin(e.chargeAng) * spd * 4.5 * dt;
          if (e.stateT <= 0) { e.state = 0; e.stateT = rand(0.8, 1.4); }
        }
        break;
      }
      case 'boss_warden': {
        e.x += Math.cos(ang) * spd * dt; e.y += Math.sin(ang) * spd * dt;
        e.shootTimer -= dt;
        if (e.shootTimer <= 0) {
          e.shootTimer = e.type.shootCd || 1.4;
          const n = 12; const base = rand(0, TAU);
          for (let k = 0; k < n; k++) this.spawnEnemyProjectile(e.x, e.y, base + (k / n) * TAU, e.type.projSpeed, e.type.projDmg, '#ff6b8a');
        }
        break;
      }
      case 'boss_colossus': {
        e.x += Math.cos(ang) * spd * dt; e.y += Math.sin(ang) * spd * dt;
        e.shootTimer -= dt;
        if (e.shootTimer <= 0) {
          e.shootTimer = e.type.shootCd || 2;
          // Spawn adds + aimed shots.
          for (let k = -1; k <= 1; k++) this.spawnEnemyProjectile(e.x, e.y, ang + k * 0.25, e.type.projSpeed, e.type.projDmg, '#ffd84d');
          if (this.enemies.length < this.maxEnemies - 4) {
            for (let k = 0; k < 3; k++) {
              const c = this.spawnEnemy('runner', e.x + rand(-30, 30), e.y + rand(-30, 30), 1 + this.time / 120, 1);
            }
          }
        }
        break;
      }
      case 'boss_maelstrom': {
        // Drifts in slowly while weaving an ever-rotating spiral of bolts, then
        // periodically unleashes a full ring-nova to weave through. Deterministic:
        // the spiral angle advances by a fixed step and timers are dt-driven.
        e.x += Math.cos(ang) * spd * dt; e.y += Math.sin(ang) * spd * dt;
        e.shootTimer -= dt;
        if (e.shootTimer <= 0) {
          e.shootTimer = e.type.shootCd || 0.14;
          e.spin += e.type.spinStep || 0.42;
          const arms = 2;
          for (let k = 0; k < arms; k++) {
            this.spawnEnemyProjectile(e.x, e.y, e.spin + (k / arms) * TAU, e.type.projSpeed || 200, e.type.projDmg || 12, '#b6a8ff');
          }
        }
        e.novaT -= dt;
        if (e.novaT <= 0) {
          e.novaT = e.type.novaCd || 5;
          const n = e.type.novaN || 22;
          const base = e.spin * 0.5;   // deterministic ring offset
          for (let k = 0; k < n; k++) this.spawnEnemyProjectile(e.x, e.y, base + (k / n) * TAU, e.type.novaSpeed || 150, e.type.novaDmg || 14, '#d8c0ff');
          this.shake(6, 0.3);
        }
        break;
      }
      case 'warder': {
        // Acolyte: drift toward the fray and bathe nearby foes in an empowering
        // aura (refreshes their `warded` timer). Uses the spatial grid so it's
        // cheap, and only distance checks — fully deterministic, no RNG.
        e.x += Math.cos(ang) * spd * dt; e.y += Math.sin(ang) * spd * dt;
        const auraR = e.type.auraR || 160, ar2 = auraR * auraR;
        const cs = this._cs || 90, span = Math.ceil(auraR / cs);
        const cx = (e.x / cs) | 0, cy = (e.y / cs) | 0;
        for (let gx = cx - span; gx <= cx + span; gx++) {
          for (let gy = cy - span; gy <= cy + span; gy++) {
            const cell = this.grid.get(this._cellKey(gx, gy));
            if (!cell) continue;
            for (const o of cell) {
              if (o === e || o.dead || o.boss) continue;
              if (dist2(o.x, o.y, e.x, e.y) <= ar2) o.warded = Math.max(o.warded, 0.35);
            }
          }
        }
        break;
      }
      case 'stalker': {
        // Harass: hold a preferred orbit radius and strafe around the player.
        const d = dist(e.x, e.y, p.x, p.y);
        const orbitR = e.type.orbitR || 190;
        const radial = d > orbitR * 1.15 ? 1 : (d < orbitR * 0.85 ? -0.7 : 0);
        const dir = (e.id % 2) ? 1 : -1; // deterministic strafe direction
        const tang = ang + Math.PI / 2 * dir;
        let mx = Math.cos(ang) * radial + Math.cos(tang) * 0.9;
        let my = Math.sin(ang) * radial + Math.sin(tang) * 0.9;
        const m = Math.hypot(mx, my) || 1;
        e.x += (mx / m) * spd * dt; e.y += (my / m) * spd * dt;
        break;
      }
      case 'summoner': {
        // Conjurer: hold a stand-off distance and conjure fans of motes. It
        // backs off when crowded and drifts in when too far, so it lingers at
        // the edge of the fight — kill it fast or be buried. Placement is on
        // fixed angles (no RNG), so summoning is fully deterministic.
        const d = dist(e.x, e.y, p.x, p.y);
        const keep = e.type.keepRange || 280;
        if (d < keep * 0.85) { e.x -= Math.cos(ang) * spd * dt; e.y -= Math.sin(ang) * spd * dt; }
        else if (d > keep * 1.25) { e.x += Math.cos(ang) * spd * dt; e.y += Math.sin(ang) * spd * dt; }
        if (e.castFx > 0) e.castFx -= dt;   // render-only telegraph timer
        e.shootTimer -= dt;
        if (e.shootTimer <= 0) {
          e.shootTimer = e.type.summonCd || 4.0;
          const n = e.type.summonCount || 3;
          const st = e.type.summonType || 'swarm';
          const sc = 1 + this.time / 120;
          let summoned = 0;
          for (let k = 0; k < n && this.enemies.length < this.maxEnemies; k++) {
            const a = (k / n) * TAU + e.spawnT;
            if (this.spawnEnemy(st, e.x + Math.cos(a) * 28, e.y + Math.sin(a) * 28, sc, 1)) summoned++;
          }
          if (summoned > 0) { e.castFx = 0.45; Audio2.conjure(); }
        }
        break;
      }
      case 'bomber': {
        // Slow approach, then detonate (its volatile flag handles the burst).
        e.x += Math.cos(ang) * spd * dt; e.y += Math.sin(ang) * spd * dt;
        const fuseR = e.type.fuseR || 64;
        if (dist2(e.x, e.y, p.x, p.y) < fuseR * fuseR) {
          e.fuse += dt;
          if (e.fuse >= 0.45) this.killEnemy(e); // detonate (removed by loop guard)
        } else if (e.fuse > 0) {
          e.fuse = Math.max(0, e.fuse - dt * 0.5);
        }
        break;
      }
      default: // chase
        e.x += Math.cos(ang) * spd * dt;
        e.y += Math.sin(ang) * spd * dt;
    }
  }

  _separate(e, cs) {
    // Push away from a few nearby enemies so they don't perfectly stack.
    const cx = (e.x / cs) | 0, cy = (e.y / cs) | 0;
    let pushed = 0;
    for (let gx = cx - 1; gx <= cx + 1 && pushed < 6; gx++) {
      for (let gy = cy - 1; gy <= cy + 1 && pushed < 6; gy++) {
        const cell = this.grid.get(this._cellKey(gx, gy));
        if (!cell) continue;
        for (const o of cell) {
          if (o === e || o.dead) continue;
          const minD = e.radius + o.radius;
          const dx = e.x - o.x, dy = e.y - o.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > 0 && d2 < minD * minD) {
            const d = Math.sqrt(d2);
            const push = (minD - d) * 0.5;
            const nx = dx / d, ny = dy / d;
            e.x += nx * push; e.y += ny * push;
            pushed++;
            if (pushed >= 6) break;
          }
        }
      }
    }
  }

  updateProjectiles(dt) {
    const margin = 80;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt;
      // Boomerang: fly out, decelerate, then home back to the player, re-arming
      // its hits so it cuts the crowd a second time on the return.
      if (pr.boomerang) {
        const pl = this.player;
        pr.bt += dt;
        if (!pr.returning) {
          pr.vx *= (1 - 1.7 * dt); pr.vy *= (1 - 1.7 * dt);
          if (pr.bt >= pr.outT) pr.returning = true;
        } else {
          const a = angleTo(pr.x, pr.y, pl.x, pl.y);
          const sp = pr.speed * 1.15;
          pr.vx = Math.cos(a) * sp; pr.vy = Math.sin(a) * sp;
          if (!pr._recharged) { if (pr.hit) pr.hit.clear(); pr.hitsLeft = pr.maxHits; pr._recharged = true; }
          if (dist2(pr.x, pr.y, pl.x, pl.y) < (pl.radius + 12) * (pl.radius + 12)) { this.projectiles.splice(i, 1); continue; }
        }
      }
      // Homing.
      if (pr.seek) {
        const t = this.nearestEnemy(pr.x, pr.y, 480);
        if (t) {
          const target = angleTo(pr.x, pr.y, t.x, t.y);
          let cur = Math.atan2(pr.vy, pr.vx);
          let diff = ((target - cur + Math.PI * 3) % TAU) - Math.PI;
          cur += clamp(diff, -pr.seekStrength * dt, pr.seekStrength * dt);
          pr.vx = Math.cos(cur) * pr.speed; pr.vy = Math.sin(cur) * pr.speed;
        }
      }
      pr.x += pr.vx * dt; pr.y += pr.vy * dt;

      // Record a short motion trail (cosmetic; flat [x,y,…] ring buffer).
      if (pr.trail) {
        pr.trail.push(pr.x, pr.y);
        if (pr.trail.length > 12) pr.trail.splice(0, pr.trail.length - 12);
      }

      if (pr.life <= 0 ||
          (!pr.boomerang && (pr.x < -margin || pr.y < -margin ||
          pr.x > this.world.w + margin || pr.y > this.world.h + margin))) {
        this.projectiles.splice(i, 1); continue;
      }

      // Collision with enemies.
      const cands = this.enemiesInRadius(pr.x, pr.y, pr.radius);
      if (cands.length) {
        if (!pr.hit) pr.hit = new Set();
        for (const e of cands) {
          if (pr.hit.has(e.id)) continue;
          pr.hit.add(e.id);
          this.dealDamage(e, pr.damage, pr.x, pr.y, pr.kb);
          if (pr.chill && !e.dead) { e.slowAmount = Math.max(e.slowAmount, pr.chill); e.slowTimer = pr.chillDur; }
          if (pr.burn && !e.dead) e.burn = Math.max(e.burn, pr.burn);
          pr.hitsLeft--;
          if (pr.hitsLeft <= 0) break;
        }
        if (pr.hitsLeft <= 0) { this.projectiles.splice(i, 1); continue; }
      }
    }
  }

  updateEnemyProjectiles(dt) {
    const p = this.player;
    for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
      const pr = this.enemyProjectiles[i];
      pr.life -= dt;
      pr.x += pr.vx * dt; pr.y += pr.vy * dt;
      if (pr.life <= 0) { this.enemyProjectiles.splice(i, 1); continue; }
      if (p.alive) {
        const rr = pr.radius + p.radius;
        if (dist2(pr.x, pr.y, p.x, p.y) <= rr * rr) {
          p.hurt(pr.damage);
          this.enemyProjectiles.splice(i, 1);
        }
      }
    }
  }

  updateNovas(dt) {
    for (let i = this.novas.length - 1; i >= 0; i--) {
      const n = this.novas[i];
      n.r += n.speed * dt;
      const cands = this.enemiesInRadius(n.x, n.y, n.r);
      for (const e of cands) {
        if (n.hit.has(e.id)) continue;
        if (dist2(n.x, n.y, e.x, e.y) <= n.r * n.r) {
          n.hit.add(e.id);
          this.dealDamage(e, n.dmg, n.x, n.y, n.kb);
        }
      }
      if (n.r >= n.maxR) this.novas.splice(i, 1);
    }
  }

  updateZones(dt) {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.life -= dt; z.t += dt; z.tick -= dt;
      if (z.tick <= 0) {
        z.tick = 0.25;
        const foes = this.enemiesInRadius(z.x, z.y, z.r);
        for (const e of foes) {
          this.dealDamage(e, z.dps * 0.25, z.x, z.y, 0, true); // silent tick
          if (z.slow > 0 && !e.dead) { e.slowAmount = Math.max(e.slowAmount, z.slow); e.slowTimer = Math.max(e.slowTimer, 0.5); }
        }
      }
      if (z.life <= 0) this.zones.splice(i, 1);
    }
  }

  // ---- Sentry turrets (deployed auto-firing allies) ---------------------
  deployTurret(opts) {
    const t = {
      x: opts.x, y: opts.y, life: opts.life, maxLife: opts.life,
      dmg: opts.dmg, fireCd: Math.max(0.12, opts.fireCd), fireT: 0.15,
      range: opts.range, range2: opts.range * opts.range, projSpeed: opts.projSpeed,
      pierce: opts.pierce || 0, color: opts.color || '#7fe0b0', flash: 0, t: 0,
    };
    this.turrets.push(t);
    // Honour the per-weapon active-turret cap: retire the oldest beyond it.
    const cap = Math.max(1, opts.cap || 1);
    while (this.turrets.length > cap) this.turrets.shift();
  }

  updateTurrets(dt) {
    for (let i = this.turrets.length - 1; i >= 0; i--) {
      const t = this.turrets[i];
      t.life -= dt; t.t += dt;
      if (t.flash > 0) t.flash -= dt;
      t.fireT -= dt;
      if (t.fireT <= 0) {
        const target = this.nearestEnemy(t.x, t.y);
        if (target && dist2(target.x, target.y, t.x, t.y) <= t.range2) {
          t.fireT = t.fireCd; t.flash = 0.08;
          this.spawnProjectile({
            x: t.x, y: t.y, angle: angleTo(t.x, t.y, target.x, target.y),
            speed: t.projSpeed, damage: t.dmg, radius: 5, pierce: t.pierce,
            life: 1.2, color: t.color, glow: true,
          });
        } else {
          t.fireT = 0.12; // no target in range — re-check soon
        }
      }
      if (t.life <= 0) this.turrets.splice(i, 1);
    }
  }

  _drawTurrets(ctx, cam) {
    for (const t of this.turrets) {
      const x = t.x - cam.x, y = t.y - cam.y;
      if (x < -40 || y < -40 || x > this.view.w + 40 || y > this.view.h + 40) continue;
      const fade = t.life < 1.2 ? clamp(t.life / 1.2, 0.2, 1) : 1;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.shadowBlur = t.flash > 0 ? 16 : 8; ctx.shadowColor = t.color;
      ctx.fillStyle = t.flash > 0 ? '#ffffff' : t.color;
      // A small turret: base diamond + a pulsing core.
      const r = 10;
      ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = fade * 0.5; ctx.beginPath(); ctx.arc(x, y, r * 0.5, 0, TAU); ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.restore();
    }
  }

  // ---- Environmental hazards -------------------------------------------
  // Drive the current biome's signature hazard. Spawn cadence and positions
  // come from the seeded sim RNG (rand/randInt), so a seed reproduces the exact
  // same sequence of strikes — Daily and replays stay perfectly fair.
  updateHazards(dt) {
    const hz = this.biome && this.biome.hazard;
    if (hz && this.player && this.player.alive) {
      this._hazardTimer -= dt;
      if (this._hazardTimer <= 0) {
        this._hazardTimer = rand(hz.every[0], hz.every[1]);
        const n = hz.count ? randInt(hz.count[0], hz.count[1]) : 1;
        for (let k = 0; k < n; k++) this.spawnHazard(hz);
      }
    }
    // Advance every live hazard regardless of biome, so one mid-flight when the
    // stage changes still resolves cleanly.
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.t += dt;
      if (h.phase === 'warn') {
        if (h.t >= h.warn) {
          h.t = 0;
          if (h.kind === 'strike') { this._detonateStrike(h); h.phase = 'fade'; }
          else { h.phase = 'active'; }
        }
      } else if (h.phase === 'active') {
        // Lingering field: tick damage/slow to anything standing inside. The
        // Riftvortex additionally drags everything toward its core each frame.
        if (h.kind === 'vortex') {
          this._vortexPull(h, dt);
          h.tick -= dt;
          if (h.tick <= 0) { h.tick = 0.25; this._vortexTick(h); }
        } else {
          h.tick -= dt;
          if (h.tick <= 0) { h.tick = 0.25; this._fieldTick(h); }
        }
        if (h.t >= h.dur) { h.phase = 'fade'; h.t = 0; }
      } else { // 'fade' — brief visual settle, then gone.
        if (h.t >= h.fade) this.hazards.splice(i, 1);
      }
    }
  }

  spawnHazard(hz) {
    // Aim near the player (a band around them) so hazards are relevant but
    // always dodgeable. Strikes can land where the player stands — that's the
    // point: keep moving. Clamped to the world.
    const ang = rand(0, TAU);
    const dist = rand(0, 300);
    const r = rand(hz.radius[0], hz.radius[1]);
    const x = clamp(this.player.x + Math.cos(ang) * dist, 40, this.world.w - 40);
    const y = clamp(this.player.y + Math.sin(ang) * dist, 40, this.world.h - 40);
    this.hazards.push({
      kind: hz.kind, x, y, r, color: hz.color,
      dmg: hz.dmg || 0, dot: hz.dot || 0, slow: hz.slow || 0,
      warn: hz.warn, dur: hz.dur || 0, fade: hz.kind === 'strike' ? 0.35 : 0.5,
      phase: 'warn', t: 0, tick: 0,
    });
  }

  _detonateStrike(h) {
    // One-shot AoE: hits the player and every foe in range. Telegraphed, so a
    // standing player has had ~1s of warning to clear out.
    const p = this.player;
    if (p.alive && dist2(h.x, h.y, p.x, p.y) <= h.r * h.r) p.hurt(h.dmg);
    for (const e of this.enemiesInRadius(h.x, h.y, h.r)) {
      this.dealDamage(e, h.dmg * 1.5, h.x, h.y, 180, true);
    }
    this.nova(h.x, h.y, h.r, 0, 0, h.color); // cosmetic shock ring (0 dmg; also shakes)
    Audio2.hazardHit();
    this.particles.burst(h.x, h.y, 14, { color: h.color, speed: rand(120, 300), life: 0.5 });
  }

  _fieldTick(h) {
    const p = this.player;
    if (p.alive && dist2(h.x, h.y, p.x, p.y) <= h.r * h.r) p.hurt(h.dot * 0.25);
    for (const e of this.enemiesInRadius(h.x, h.y, h.r)) {
      this.dealDamage(e, h.dot * 0.25, h.x, h.y, 0, true);
      if (h.slow > 0 && !e.dead) { e.slowAmount = Math.max(e.slowAmount, h.slow); e.slowTimer = Math.max(e.slowTimer, 0.5); }
    }
  }

  // Riftvortex pull: drags the player gently and foes strongly toward the core
  // each frame (a pure function of positions — deterministic, no RNG). The pull
  // is escapable by moving outward, and it bunches the horde for easy AoE.
  _vortexPull(h, dt) {
    const p = this.player, pr2 = h.r * h.r;
    if (p.alive) {
      const d2 = dist2(h.x, h.y, p.x, p.y);
      if (d2 < pr2 && d2 > 1) {
        const a = angleTo(p.x, p.y, h.x, h.y);
        const f = 1 - Math.sqrt(d2) / h.r;
        const pull = 78 * f * dt;
        p.x = clamp(p.x + Math.cos(a) * pull, p.radius, this.world.w - p.radius);
        p.y = clamp(p.y + Math.sin(a) * pull, p.radius, this.world.h - p.radius);
      }
    }
    for (const e of this.enemiesInRadius(h.x, h.y, h.r)) {
      if (e.boss) continue;
      const d = dist(e.x, e.y, h.x, h.y) || 1;
      const a = angleTo(e.x, e.y, h.x, h.y);
      const f = 1 - d / h.r;
      const pull = 165 * f * dt;
      e.x += Math.cos(a) * pull; e.y += Math.sin(a) * pull;
    }
  }

  // Damaging core at the vortex centre (smaller than the pull radius, so the
  // outer field only tugs — reaching the eye is what hurts).
  _vortexTick(h) {
    const p = this.player, coreR = h.r * 0.45;
    if (p.alive && dist2(h.x, h.y, p.x, p.y) <= coreR * coreR) p.hurt(h.dot * 0.25);
    for (const e of this.enemiesInRadius(h.x, h.y, coreR)) this.dealDamage(e, h.dot * 0.25, h.x, h.y, 0, true);
  }

  // ---- Shrines (risk/reward altars) -------------------------------------
  updateShrines(dt) {
    // Gauntlet is pure boss-rush, and Trials are fixed challenges — no shrines.
    const allowed = this.mode !== 'gauntlet' && !this.trial;
    if (allowed) {
      this._shrineTimer -= dt;
      if (this._shrineTimer <= 0 && this.shrines.length === 0) {
        this._shrineTimer = rand(34, 52);
        this.spawnShrine();
      }
    }
    const p = this.player;
    for (let i = this.shrines.length - 1; i >= 0; i--) {
      const s = this.shrines[i];
      s.t += dt; s.life -= dt;
      // Activated when the player steps onto it.
      const rr = p.radius + s.radius;
      if (p.alive && dist2(s.x, s.y, p.x, p.y) <= rr * rr) {
        const def = getShrineType(s.type);
        if (def) def.invoke(this);
        this.particles.ring(s.x, s.y, 30, { color: s.color, speed: 240, life: 0.7, size: 4 });
        if (Audio2.shrine) Audio2.shrine();
        this.shrines.splice(i, 1);
        continue;
      }
      if (s.life <= 0) this.shrines.splice(i, 1);   // faded unused
    }
  }

  spawnShrine() {
    const type = pick(SHRINE_TYPES);
    // Place at mid-range from the player so reaching it is a real decision.
    const a = rand(0, TAU), r = rand(300, 460);
    const x = clamp(this.player.x + Math.cos(a) * r, 60, this.world.w - 60);
    const y = clamp(this.player.y + Math.sin(a) * r, 60, this.world.h - 60);
    this.shrines.push({ type: type.id, color: type.color, icon: type.icon, x, y, radius: 24, t: 0, life: 26 });
    this.toast(type.icon + ' A ' + type.name + ' appears — claim it?');
  }

  // A clustered elite pack drawn to the shrine's caller (the consequence).
  spawnShrinePack(n, leadElite) {
    const min = this.time / 60;
    const c = this.offscreenPoint(0.7);
    const base = min >= 3.2 ? 'charger' : (min >= 1.8 ? 'brute' : 'drifter');
    for (let i = 0; i < n; i++) {
      const e = this.spawnEnemy(base, c.x + rand(-40, 40), c.y + rand(-40, 40),
        this.director.hpScale(min) * 1.1, this.director.dmgScale(min));
      if (!e) continue;
      if (i === 0 && leadElite) this.makeElite(e, 1, false); else if (chance(0.4)) this.makeElite(e, 1, false);
    }
  }

  _drawShrines(ctx, cam) {
    for (const s of this.shrines) {
      const x = s.x - cam.x, y = s.y - cam.y;
      if (x < -60 || y < -60 || x > this.view.w + 60 || y > this.view.h + 60) continue;
      const pulse = 1 + Math.sin(this.time * 3 + s.x) * 0.12;
      const fade = s.life < 4 ? clamp(s.life / 4, 0.2, 1) : 1;   // dim as it expires
      ctx.save();
      ctx.globalAlpha = 0.85 * fade;
      // Glowing ground halo.
      const g = ctx.createRadialGradient(x, y, 2, x, y, s.radius * 2.4 * pulse);
      g.addColorStop(0, s.color); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.22 * fade; ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, s.radius * 2.4 * pulse, 0, TAU); ctx.fill();
      // Diamond altar.
      ctx.globalAlpha = fade;
      ctx.strokeStyle = s.color; ctx.lineWidth = 2.5; ctx.shadowBlur = 16; ctx.shadowColor = s.color;
      const r = s.radius * pulse;
      ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.stroke();
      ctx.shadowBlur = 0;
      // Icon.
      ctx.globalAlpha = fade; ctx.font = '18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(s.icon, x, y + 1);
      ctx.restore();
    }
  }

  updateGems(dt) {
    const p = this.player;
    const range = p.pickupRange;
    const range2 = range * range;
    for (let i = this.gems.length - 1; i >= 0; i--) {
      const g = this.gems[i];
      g.t += dt;
      const d2 = dist2(g.x, g.y, p.x, p.y);
      if (g.attract || d2 < range2) {
        g.attract = true;
        const a = angleTo(g.x, g.y, p.x, p.y);
        const pull = lerp(260, 620, clamp(1 - Math.sqrt(d2) / range, 0, 1));
        g.x += Math.cos(a) * pull * dt;
        g.y += Math.sin(a) * pull * dt;
      } else {
        g.x += g.vx * dt; g.y += g.vy * dt;
        g.vx *= (1 - 2 * dt); g.vy *= (1 - 2 * dt);
      }
      // Collected.
      if (d2 < (p.radius + 8) * (p.radius + 8)) {
        p.gainXp(g.value);
        this.particles.spawn(p.x, p.y, { color: '#bff3ff', speed: 0, life: 0.2 });
        Audio2.pickup();
        this.gems.splice(i, 1);
      }
    }
  }

  updatePickups(dt) {
    const p = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      k.t += dt;
      k.x += k.vx * dt; k.y += k.vy * dt; k.vx *= 0.94; k.vy *= 0.94;
      const rr = p.radius + 16;
      if (dist2(k.x, k.y, p.x, p.y) <= rr * rr) {
        this.applyPickup(k.kind);
        this.pickups.splice(i, 1);
      }
    }
  }

  applyPickup(kind) {
    const p = this.player;
    switch (kind) {
      case 'health':
        p.heal(Math.max(20, p.maxHp * 0.3));
        this.particles.text(p.x, p.y - 24, '+HP', { color: '#7affc4', size: 18 });
        Audio2.pickupBig(); this.toast('Health restored');
        break;
      case 'magnet':
        for (const g of this.gems) g.attract = true;
        Audio2.pickupBig(); this.toast('All XP drawn in');
        break;
      case 'bomb': {
        Audio2.bossDie(); this.shake(14, 0.5);
        this.nova(p.x, p.y, 600, 9999, 300, '#ffd84d');
        this.toast('💥 Cataclysm!');
        break;
      }
      case 'chest': {
        // Bonus levels.
        const n = randInt(1, 3);
        this.pendingLevels += n;
        Audio2.levelUp();
        this.toast('Treasure! +' + n + ' levels');
        this.openLevelUp();
        break;
      }
    }
  }

  // ---- Render -----------------------------------------------------------
  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const cam = { x: this.cam.x + this.cam.sx, y: this.cam.y + this.cam.sy };

    // Background (tinted by the active biome).
    ctx.fillStyle = (this.biome && this.biome.base) || '#05060d';
    ctx.fillRect(0, 0, this.view.w, this.view.h);
    this._drawBackground(ctx, cam);

    if (this.player) {
      this._drawWorldBounds(ctx, cam);
      this._drawHazards(ctx, cam);
      this._drawShrines(ctx, cam);
      this._drawZones(ctx, cam);
      this._drawTurrets(ctx, cam);
      this._drawGems(ctx, cam);
      this._drawPickups(ctx, cam);
      this.particles.draw(ctx, cam);
      this._drawWhips(ctx, cam);
      this._drawEnemies(ctx, cam);
      this._drawEnemyProjectiles(ctx, cam);
      this.player.draw(ctx, cam);
      this._drawProjectiles(ctx, cam);
      this._drawNovas(ctx, cam);
      this._drawChains(ctx, cam);
      this.particles.drawText(ctx, cam);
      this._drawVignette(ctx);
      this._drawHurtFlash(ctx);
      this._drawHUD(ctx);
    }
  }

  _drawBackground(ctx, cam) {
    // Drifting nebula clouds (deep parallax, additive glow). Animated by the
    // simulation clock so it stays perfectly deterministic.
    if (this.nebula) {
      const t = this.time;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const n of this.nebula) {
        const nx = (n.x + n.dx * t) - cam.x * 0.12;
        const ny = (n.y + n.dy * t) - cam.y * 0.12;
        const breathe = 1 + Math.sin(n.ph + t * n.sp) * 0.12;
        const r = n.r * breathe;
        // Skip blobs fully off-screen (cheap cull).
        if (nx + r < 0 || ny + r < 0 || nx - r > this.view.w || ny - r > this.view.h) continue;
        const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, r);
        const [cr, cg, cb] = n.col;
        g.addColorStop(0, `rgba(${cr},${cg},${cb},${n.a})`);
        g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(nx, ny, r, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    // Parallax starfield (tiled).
    const s = this.stars;
    const px = -(cam.x * 0.3) % s.width;
    const py = -(cam.y * 0.3) % s.height;
    ctx.globalAlpha = 0.9;
    for (let x = px - s.width; x < this.view.w; x += s.width) {
      for (let y = py - s.height; y < this.view.h; y += s.height) {
        ctx.drawImage(s, x, y);
      }
    }
    ctx.globalAlpha = 1;

    // Subtle grid (biome-tinted).
    ctx.strokeStyle = (this.biome && this.biome.grid) || 'rgba(80,110,200,0.07)';
    ctx.lineWidth = 1;
    const gs = 80;
    const ox = -(cam.x % gs), oy = -(cam.y % gs);
    ctx.beginPath();
    for (let x = ox; x < this.view.w; x += gs) { ctx.moveTo(x, 0); ctx.lineTo(x, this.view.h); }
    for (let y = oy; y < this.view.h; y += gs) { ctx.moveTo(0, y); ctx.lineTo(this.view.w, y); }
    ctx.stroke();

    // A brief full-screen wash when crossing into a new biome.
    if (this._biomeFlash > 0 && this.biome) {
      const [r, g, b] = this.biome.nebula[0];
      ctx.fillStyle = `rgba(${r},${g},${b},${0.18 * this._biomeFlash})`;
      ctx.fillRect(0, 0, this.view.w, this.view.h);
    }
  }

  _drawWorldBounds(ctx, cam) {
    ctx.strokeStyle = 'rgba(120,150,255,0.35)';
    ctx.lineWidth = 4;
    ctx.shadowBlur = 16; ctx.shadowColor = 'rgba(120,150,255,0.6)';
    ctx.strokeRect(-cam.x, -cam.y, this.world.w, this.world.h);
    ctx.shadowBlur = 0;
  }

  _shapePath(ctx, e, x, y) {
    const r = e.radius;
    ctx.beginPath();
    switch (e.shape) {
      case 'diamond':
        ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); break;
      case 'tri':
        ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.9, y + r * 0.7); ctx.lineTo(x - r * 0.9, y + r * 0.7); ctx.closePath(); break;
      case 'square':
        ctx.rect(x - r, y - r, r * 2, r * 2); break;
      case 'hex': {
        for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + e.spawnT * 0.4; const fn = k === 0 ? 'moveTo' : 'lineTo'; ctx[fn](x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); break;
      }
      case 'arrow':
        ctx.moveTo(x + r, y); ctx.lineTo(x - r, y - r * 0.8); ctx.lineTo(x - r * 0.4, y); ctx.lineTo(x - r, y + r * 0.8); ctx.closePath(); break;
      case 'cross': {
        // A plus / banner glyph — reads as a support unit.
        const a2 = r * 0.42;
        ctx.moveTo(x - a2, y - r); ctx.lineTo(x + a2, y - r); ctx.lineTo(x + a2, y - a2);
        ctx.lineTo(x + r, y - a2); ctx.lineTo(x + r, y + a2); ctx.lineTo(x + a2, y + a2);
        ctx.lineTo(x + a2, y + r); ctx.lineTo(x - a2, y + r); ctx.lineTo(x - a2, y + a2);
        ctx.lineTo(x - r, y + a2); ctx.lineTo(x - r, y - a2); ctx.lineTo(x - a2, y - a2);
        ctx.closePath(); break;
      }
      case 'rune': {
        // Slowly-rotating pentagram-like ring — reads as an arcane caster.
        const pts = 5;
        for (let k = 0; k < pts; k++) {
          const a = k / pts * TAU - Math.PI / 2 + e.spawnT * 0.5;
          const fn = k === 0 ? 'moveTo' : 'lineTo';
          ctx[fn](x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        ctx.closePath(); break;
      }
      case 'star': {
        const sp = 10;
        for (let k = 0; k < sp; k++) { const rr = k % 2 ? r * 0.5 : r; const a = k / sp * TAU + e.spawnT * 0.3; const fn = k === 0 ? 'moveTo' : 'lineTo'; ctx[fn](x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); break;
      }
      default:
        ctx.arc(x, y, r, 0, TAU);
    }
  }

  _drawEnemies(ctx, cam) {
    ctx.save();
    for (const e of this.enemies) {
      if (e.dead) continue;
      const x = e.x - cam.x, y = e.y - cam.y;
      if (x < -60 || y < -60 || x > this.view.w + 60 || y > this.view.h + 60) continue;
      // Spawn-in pop.
      const sc = e.spawnT < 0.25 ? clamp(e.spawnT / 0.25, 0.2, 1) : 1;
      ctx.save();
      ctx.translate(x, y); ctx.scale(sc, sc); ctx.translate(-x, -y);

      ctx.shadowBlur = e.boss ? 26 : 10;
      ctx.shadowColor = e.color;
      // Charger / Bomber telegraph flash.
      let fill = e.color;
      if (e.flash > 0) fill = '#ffffff';
      else if (e.ai === 'charger' && e.state === 1) fill = (Math.floor(this.time * 20) % 2 ? '#fff' : e.color);
      else if (e.fuse > 0) fill = (Math.floor(this.time * 24) % 2 ? '#fff' : e.color);
      else if (e.slowAmount > 0) fill = '#9fe9ff';
      ctx.fillStyle = fill;
      this._shapePath(ctx, e, x, y); ctx.fill();
      // Burn overlay.
      if (e.burn > 0) { ctx.shadowColor = '#ff7a3c'; ctx.fillStyle = 'rgba(255,130,60,0.5)'; this._shapePath(ctx, e, x, y); ctx.fill(); }
      ctx.restore();

      // Elite aura ring (pulsing, time-driven — render-only).
      if (e.elite) {
        const pulse = 1 + Math.sin(this.time * 4 + e.id) * 0.08;
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = e.auraColor || '#ffd84d';
        ctx.lineWidth = e.champion ? 3.5 : 2.2;
        ctx.shadowBlur = e.champion ? 22 : 14; ctx.shadowColor = e.auraColor || '#ffd84d';
        ctx.beginPath(); ctx.arc(x, y, (e.radius + 6) * pulse, 0, TAU); ctx.stroke();
        ctx.restore();
      }
      // Acolyte aura (a soft empowering field) + a warded glow on buffed foes.
      if (e.ai === 'warder') {
        const auraR = (e.type.auraR || 160);
        const pulse = 1 + Math.sin(this.time * 2.4 + e.id) * 0.06;
        ctx.save();
        const ag = ctx.createRadialGradient(x, y, auraR * 0.2, x, y, auraR * pulse);
        ag.addColorStop(0, 'rgba(255,206,90,0.12)');
        ag.addColorStop(1, 'rgba(255,206,90,0)');
        ctx.fillStyle = ag;
        ctx.beginPath(); ctx.arc(x, y, auraR * pulse, 0, TAU); ctx.fill();
        ctx.restore();
      } else if (e.warded > 0) {
        ctx.save();
        ctx.globalAlpha = 0.5; ctx.strokeStyle = '#ffce5a'; ctx.lineWidth = 1.6;
        ctx.shadowBlur = 8; ctx.shadowColor = '#ffce5a';
        ctx.beginPath(); ctx.arc(x, y, e.radius + 3, 0, TAU); ctx.stroke();
        ctx.restore();
      }
      // Conjure burst: an expanding ring the instant a Conjurer summons (render-only).
      if (e.castFx > 0) {
        const t = 1 - e.castFx / 0.45;
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.7;
        ctx.strokeStyle = e.color; ctx.lineWidth = 2.4;
        ctx.shadowBlur = 16; ctx.shadowColor = e.color;
        ctx.beginPath(); ctx.arc(x, y, e.radius + 4 + t * 34, 0, TAU); ctx.stroke();
        ctx.restore();
      }
      // Shield ring (arc length = remaining shield fraction).
      if (e.shield > 0 && e.shieldMax > 0) {
        ctx.save();
        ctx.globalAlpha = 0.8; ctx.strokeStyle = '#8fd8ff'; ctx.lineWidth = 3;
        ctx.shadowBlur = 10; ctx.shadowColor = '#8fd8ff';
        const frac = clamp(e.shield / e.shieldMax, 0, 1);
        ctx.beginPath(); ctx.arc(x, y, e.radius + 11, -Math.PI / 2, -Math.PI / 2 + frac * TAU); ctx.stroke();
        ctx.restore();
      }

      // Health bars: bosses, champions, and (smaller) ordinary elites.
      if (e.boss || e.champion || e.elite) {
        const bw = (e.boss || e.champion) ? 76 : 44, bh = (e.boss || e.champion) ? 6 : 4;
        const by = y - e.radius - 16;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - bw / 2, by, bw, bh);
        ctx.fillStyle = e.champion ? '#ffd84d' : '#ff5d6c';
        ctx.fillRect(x - bw / 2, by, bw * clamp(e.hp / e.maxHp, 0, 1), bh);
        if (e.champion && e.eliteName) {
          ctx.save();
          ctx.font = 'bold 12px "Segoe UI", system-ui, sans-serif';
          ctx.fillStyle = '#ffe9a8'; ctx.textAlign = 'center'; ctx.shadowBlur = 4; ctx.shadowColor = '#000';
          ctx.fillText('☠ ' + e.eliteName, x, by - 6);
          ctx.restore();
        }
      }
    }
    ctx.restore();
  }

  _drawProjectiles(ctx, cam) {
    ctx.save();
    ctx.lineCap = 'round';
    for (const pr of this.projectiles) {
      const x = pr.x - cam.x, y = pr.y - cam.y;
      // Comet trail — a tapering, fading streak behind the projectile head.
      const tr = pr.trail;
      if (tr && tr.length >= 4) {
        const pts = tr.length / 2;
        ctx.shadowBlur = 0;
        for (let k = 0; k < pts - 1; k++) {
          const f = k / (pts - 1);            // 0 = oldest, 1 = newest
          ctx.globalAlpha = f * 0.5;
          ctx.strokeStyle = pr.glow;
          ctx.lineWidth = pr.radius * (0.3 + f * 1.1);
          ctx.beginPath();
          ctx.moveTo(tr[k * 2] - cam.x, tr[k * 2 + 1] - cam.y);
          ctx.lineTo(tr[k * 2 + 2] - cam.x, tr[k * 2 + 3] - cam.y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      ctx.shadowBlur = 12; ctx.shadowColor = pr.glow;
      ctx.fillStyle = pr.color;
      ctx.beginPath(); ctx.arc(x, y, pr.radius, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  _drawEnemyProjectiles(ctx, cam) {
    ctx.save();
    for (const pr of this.enemyProjectiles) {
      const x = pr.x - cam.x, y = pr.y - cam.y;
      ctx.shadowBlur = 10; ctx.shadowColor = pr.color;
      ctx.fillStyle = pr.color;
      ctx.beginPath(); ctx.arc(x, y, pr.radius, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  _drawNovas(ctx, cam) {
    ctx.save();
    for (const n of this.novas) {
      const a = clamp(1 - n.r / n.maxR, 0, 1);
      ctx.globalAlpha = a * 0.8;
      ctx.strokeStyle = n.color;
      ctx.lineWidth = 6 * a + 2;
      ctx.shadowBlur = 20; ctx.shadowColor = n.color;
      ctx.beginPath(); ctx.arc(n.x - cam.x, n.y - cam.y, n.r, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  _drawHazards(ctx, cam) {
    ctx.save();
    for (const h of this.hazards) {
      const x = h.x - cam.x, y = h.y - cam.y;
      if (x < -h.r - 20 || y < -h.r - 20 || x > this.view.w + h.r + 20 || y > this.view.h + h.r + 20) continue;
      if (h.phase === 'warn') {
        // Telegraph: a brightening boundary ring plus a closing "incoming" ring
        // that converges on the impact point as the warning runs out.
        const prog = clamp(h.t / h.warn, 0, 1);
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 14);
        ctx.globalAlpha = 0.25 + 0.45 * prog;
        ctx.fillStyle = h.color + '22';
        ctx.beginPath(); ctx.arc(x, y, h.r, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.5 + 0.5 * prog;
        ctx.strokeStyle = h.color;
        ctx.lineWidth = 2 + 2 * pulse;
        ctx.beginPath(); ctx.arc(x, y, h.r, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 0.7 * (1 - prog) + 0.3;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, h.r * (1 - prog * 0.85), 0, TAU); ctx.stroke();
      } else {
        // Active field / settling strike: soft radial body, fading out.
        const a = h.phase === 'fade' ? clamp(1 - h.t / h.fade, 0, 1)
          : clamp(1 - (h.t / h.dur) * 0.5, 0.4, 1);
        const r = h.r * (1 + Math.sin(h.t * 4) * 0.05);
        const g = ctx.createRadialGradient(x, y, r * 0.12, x, y, r);
        g.addColorStop(0, h.color + '77');
        g.addColorStop(0.65, h.color + '2a');
        g.addColorStop(1, h.color + '00');
        ctx.globalAlpha = 0.5 + 0.4 * a;
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.4 * a;
        ctx.strokeStyle = h.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
        // Riftvortex: rotating spiral arms convey the inward drag.
        if (h.kind === 'vortex') {
          ctx.globalAlpha = 0.5 * a;
          ctx.lineWidth = 2;
          for (let k = 0; k < 3; k++) {
            const base = this.time * 2.2 + k * (TAU / 3);
            ctx.beginPath();
            for (let s = 0; s <= 1.001; s += 0.1) {
              const rad = r * s, ang = base + s * 5.5;
              const px = x + Math.cos(ang) * rad, py = y + Math.sin(ang) * rad;
              if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.stroke();
          }
        }
      }
    }
    ctx.restore();
  }

  _drawZones(ctx, cam) {
    ctx.save();
    for (const z of this.zones) {
      const x = z.x - cam.x, y = z.y - cam.y;
      if (x < -z.r || y < -z.r || x > this.view.w + z.r || y > this.view.h + z.r) continue;
      const a = clamp(z.life / z.maxLife, 0, 1);
      const r = z.r * (1 + Math.sin(z.t * 5) * 0.06);
      const g = ctx.createRadialGradient(x, y, r * 0.15, x, y, r);
      g.addColorStop(0, z.color + '66');
      g.addColorStop(0.7, z.color + '22');
      g.addColorStop(1, z.color + '00');
      ctx.globalAlpha = 0.45 + 0.45 * a;
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      // A few drifting bubbles for life (driven by the sim clock, not RNG).
      ctx.globalAlpha = a * 0.5; ctx.fillStyle = z.color;
      for (let k = 0; k < 3; k++) {
        const ang = z.t * 1.5 + k * 2.1, rr = r * 0.55;
        ctx.beginPath(); ctx.arc(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr, 2.5, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }

  _drawChains(ctx, cam) {
    ctx.save();
    for (const c of this.chains) {
      const a = c.life / c.maxLife;
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#cfeaff';
      ctx.lineWidth = 2 + a * 2;
      ctx.shadowBlur = 14; ctx.shadowColor = '#9ad8ff';
      ctx.beginPath();
      for (const s of c.segs) {
        // Jagged lightning between points.
        ctx.moveTo(s.x1 - cam.x, s.y1 - cam.y);
        const steps = 4;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const jx = lerp(s.x1, s.x2, t) + (i < steps ? vrand(-8, 8) : 0);
          const jy = lerp(s.y1, s.y2, t) + (i < steps ? vrand(-8, 8) : 0);
          ctx.lineTo(jx - cam.x, jy - cam.y);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawWhips(ctx, cam) {
    ctx.save();
    for (const w of this.whips) {
      const a = w.life / w.maxLife;
      ctx.globalAlpha = a * 0.8;
      ctx.fillStyle = '#ffb3e6';
      ctx.shadowBlur = 16; ctx.shadowColor = '#ffb3e6';
      ctx.beginPath();
      ctx.moveTo(w.x - cam.x, w.y - cam.y);
      ctx.arc(w.x - cam.x, w.y - cam.y, w.len, w.dir - w.wide, w.dir + w.wide);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  _drawGems(ctx, cam) {
    ctx.save();
    for (const g of this.gems) {
      const x = g.x - cam.x, y = g.y - cam.y;
      if (x < -20 || y < -20 || x > this.view.w + 20 || y > this.view.h + 20) continue;
      const col = g.value >= 6 ? '#ffd84d' : (g.value >= 3 ? '#c98bff' : '#5ad9ff');
      ctx.shadowBlur = 8; ctx.shadowColor = col;
      ctx.fillStyle = col;
      const s = 3 + Math.min(4, g.value);
      const pulse = 1 + Math.sin(g.t * 6) * 0.12;
      ctx.beginPath();
      ctx.moveTo(x, y - s * pulse); ctx.lineTo(x + s * pulse, y); ctx.lineTo(x, y + s * pulse); ctx.lineTo(x - s * pulse, y);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  _drawPickups(ctx, cam) {
    ctx.save();
    const icons = { health: '✚', magnet: '🧲', bomb: '💣', chest: '🎁' };
    const cols = { health: '#7affc4', magnet: '#ffb3e6', bomb: '#ffd84d', chest: '#ffe14d' };
    for (const k of this.pickups) {
      const x = k.x - cam.x, y = k.y - cam.y;
      const bob = Math.sin(k.t * 4) * 3;
      ctx.shadowBlur = 14; ctx.shadowColor = cols[k.kind] || '#fff';
      ctx.fillStyle = cols[k.kind] || '#fff';
      ctx.beginPath(); ctx.arc(x, y + bob, 11, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(icons[k.kind] || '?', x, y + bob);
    }
    ctx.restore();
  }

  _drawVignette(ctx) {
    const g = ctx.createRadialGradient(this.view.w / 2, this.view.h / 2, this.view.h * 0.3,
      this.view.w / 2, this.view.h / 2, this.view.h * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.view.w, this.view.h);
    // Low-health red pulse.
    if (this.player && this.player.hp / this.player.maxHp < 0.3) {
      const a = 0.25 + Math.sin(this.time * 6) * 0.1;
      const g2 = ctx.createRadialGradient(this.view.w / 2, this.view.h / 2, this.view.h * 0.35,
        this.view.w / 2, this.view.h / 2, this.view.h * 0.8);
      g2.addColorStop(0, 'rgba(255,0,40,0)');
      g2.addColorStop(1, `rgba(255,0,40,${a})`);
      ctx.fillStyle = g2; ctx.fillRect(0, 0, this.view.w, this.view.h);
    }
  }

  _drawHurtFlash(ctx) {
    // A quick red edge-flash the instant the player takes a hit (render-only,
    // driven by the sim-side hitFlash timer so it can't desync the world).
    const p = this.player;
    if (!p || p.hitFlash <= 0) return;
    const a = clamp(p.hitFlash / 0.3, 0, 1);
    const g = ctx.createRadialGradient(this.view.w / 2, this.view.h / 2, this.view.h * 0.25,
      this.view.w / 2, this.view.h / 2, this.view.h * 0.72);
    g.addColorStop(0, 'rgba(255,40,70,0)');
    g.addColorStop(1, `rgba(255,40,70,${0.5 * a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.view.w, this.view.h);
  }

  _drawHUD(ctx) {
    const p = this.player;
    const W = this.view.w;
    ctx.save();
    ctx.textBaseline = 'top';

    // XP bar (top, full width).
    const xpFrac = clamp(p.xp / p.xpToNext, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(0, 0, W, 8);
    ctx.fillStyle = '#5ad9ff'; ctx.shadowBlur = 8; ctx.shadowColor = '#5ad9ff';
    ctx.fillRect(0, 0, W * xpFrac, 8); ctx.shadowBlur = 0;

    // Level badge.
    ctx.font = 'bold 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#cfe6ff'; ctx.textAlign = 'left';
    ctx.fillText('LV ' + p.level, 12, 16);

    // Timer (center top).
    ctx.font = 'bold 26px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff'; ctx.shadowBlur = 6; ctx.shadowColor = '#000';
    ctx.fillText(formatTime(this.time), W / 2, 16);
    ctx.shadowBlur = 0;
    // Current biome name beneath the timer (hidden while a boss banner shows).
    if (this.biome && !this.activeBoss) {
      ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = this.biome.accent;
      ctx.globalAlpha = 0.85;
      ctx.fillText('❖ ' + this.biome.name, W / 2, 46);
      ctx.globalAlpha = 1;
    }
    // Trial objective + progress (under the biome line).
    if (this.trial) {
      ctx.font = 'bold 12px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = this.trial.color; ctx.shadowBlur = 4; ctx.shadowColor = '#000';
      ctx.fillText(this.trial.icon + ' ' + trialGoalText(this.trial) + '  ·  ' + trialProgressText(this.trial, this), W / 2, this.activeBoss ? 64 : 62);
      ctx.shadowBlur = 0;
    } else if (this.customRun && this.mutators.length) {
      ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#c9a8ff'; ctx.shadowBlur = 4; ctx.shadowColor = '#000';
      ctx.fillText('🧪 Custom · ' + this.mutators.length + ' mutators · ×' + this.mutatorRewardMul.toFixed(2), W / 2, this.activeBoss ? 64 : 62);
      ctx.shadowBlur = 0;
    }

    // Kills + score (right top).
    ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#9fb4d6';
    ctx.fillText('☠ ' + formatNum(this.kills) + '   ✦ ' + formatNum(this.score), W - 12, 16);

    // Health bar (above player-ish, bottom-left HUD block).
    const hbX = 12, hbY = 40, hbW = 220, hbH = 16;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(hbX, hbY, hbW, hbH);
    const hpFrac = clamp(p.hp / p.maxHp, 0, 1);
    ctx.fillStyle = hpFrac > 0.5 ? '#7affc4' : (hpFrac > 0.25 ? '#ffd84d' : '#ff5d6c');
    ctx.shadowBlur = 8; ctx.shadowColor = ctx.fillStyle;
    ctx.fillRect(hbX, hbY, hbW * hpFrac, hbH); ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.strokeRect(hbX, hbY, hbW, hbH);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(Math.ceil(p.hp) + ' / ' + p.maxHp, hbX + 6, hbY + hbH / 2 + 1);
    if (p.revives > 0) ctx.fillText('  ♻×' + p.revives, hbX + hbW + 6, hbY + hbH / 2 + 1);

    // Blink-dash readiness pill (top-right, under kills/score). Fills as the
    // next charge recharges; a dot per stored charge glows cyan when ready.
    const dbW = 96, dbH = 9, dbX = W - 12 - dbW, dbY = 36;
    const ready = p.dashCharges > 0;
    const full = p.dashCharges >= p.dashMaxCharges;
    const frac = full ? 1 : clamp(1 - p.dashCd / p.dashCdMax, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(dbX, dbY, dbW, dbH);
    ctx.fillStyle = ready ? '#5ad9ff' : 'rgba(90,217,255,0.45)';
    if (ready) { ctx.shadowBlur = 8; ctx.shadowColor = '#5ad9ff'; }
    ctx.fillRect(dbX, dbY, dbW * frac, dbH); ctx.shadowBlur = 0;
    ctx.fillStyle = ready ? '#cfeeff' : '#789'; ctx.font = 'bold 8px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('⟫ BLINK', dbX + 5, dbY + dbH / 2 + 1);
    // Charge dots (only when more than one charge is possible).
    if (p.dashMaxCharges > 1) {
      for (let k = 0; k < p.dashMaxCharges; k++) {
        const cxk = dbX + dbW - 6 - k * 9;
        const lit = k < p.dashCharges;
        ctx.beginPath(); ctx.arc(cxk, dbY + dbH / 2, 2.6, 0, TAU);
        ctx.fillStyle = lit ? '#9beaff' : 'rgba(255,255,255,0.22)'; ctx.fill();
      }
    }
    ctx.textBaseline = 'top';

    // Weapon icons row.
    ctx.textBaseline = 'top';
    let wx = 12; const wy = 64;
    for (const w of p.weapons) {
      const evo = w.def.evolved;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(wx, wy, 30, 30);
      ctx.strokeStyle = w.def.color; ctx.lineWidth = evo ? 2.5 : 2; ctx.strokeRect(wx, wy, 30, 30);
      if (evo) { ctx.shadowBlur = 8; ctx.shadowColor = w.def.color; }
      ctx.fillStyle = w.def.color; ctx.font = '16px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(w.def.icon, wx + 15, wy + 7);
      ctx.shadowBlur = 0;
      // Level (or a star for evolved weapons).
      ctx.fillStyle = evo ? '#ffd84d' : '#fff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(evo ? '★' : ('L' + w.level), wx + 28, wy + 21);
      wx += 34;
    }

    // Active synergy chips (set bonuses), tucked beneath the weapon row.
    const syn = (p.synergies && p.synergies.length) ? p.synergies : null;
    if (syn) {
      let sx = 12; const sy = wy + 36;
      ctx.font = 'bold 12px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for (const s of syn) {
        const label = s.icon + ' ' + s.name;
        const w = ctx.measureText(label).width + 14;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(sx, sy, w, 20);
        ctx.strokeStyle = s.color; ctx.lineWidth = 1.5; ctx.strokeRect(sx, sy, w, 20);
        ctx.fillStyle = s.color;
        ctx.fillText(label, sx + 7, sy + 11);
        sx += w + 6;
      }
      ctx.textBaseline = 'top';
    }

    // Gauntlet round indicator.
    if (this.mode === 'gauntlet') {
      ctx.textAlign = 'center'; ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#ffd84d'; ctx.shadowBlur = 6; ctx.shadowColor = '#000';
      ctx.fillText('⚔ ROUND ' + Math.max(1, this.gauntletRound), W / 2, 48);
      ctx.shadowBlur = 0;
    }

    // Boss banner.
    if (this.activeBoss && !this.activeBoss.dead) {
      ctx.textAlign = 'center'; ctx.font = 'bold 16px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#ff6b8a';
      ctx.fillText('☠ ' + this.activeBoss.type.name, W / 2, this.mode === 'gauntlet' ? 68 : 48);
    }

    // Toasts (center-ish).
    ctx.textAlign = 'center';
    let ty = this.view.h - 120;
    for (const t of this.toasts) {
      ctx.globalAlpha = clamp(t.life, 0, 1);
      ctx.font = 'bold 18px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = t.color || '#ffe9a8'; ctx.shadowBlur = 6; ctx.shadowColor = '#000';
      ctx.fillText(t.msg, W / 2, ty);
      ctx.shadowBlur = 0;
      ty -= 26;
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Consume a queued Blink request (from a touch double-tap). One-shot.
  _consumeDashRequest() { if (this._dashReq) { this._dashReq = false; return true; } return false; }

  // ---- Touch joystick ---------------------------------------------------
  _initTouch() {
    const canvas = this.canvas;
    const onStart = (e) => {
      if (this.state !== 'playing') return;
      const t = e.touches[0]; if (!t) return;
      // Double-tap to Blink (within 300ms of the previous tap start).
      const now = Date.now();
      if (now - this._lastTouchStart < 300) this._dashReq = true;
      this._lastTouchStart = now;
      const r = canvas.getBoundingClientRect();
      this.touch.active = true;
      this.touch.ox = t.clientX - r.left; this.touch.oy = t.clientY - r.top;
      this.touch.vector = { x: 0, y: 0 };
    };
    const onMove = (e) => {
      if (!this.touch.active) return;
      const t = e.touches[0]; if (!t) return;
      const r = canvas.getBoundingClientRect();
      let dx = (t.clientX - r.left) - this.touch.ox;
      let dy = (t.clientY - r.top) - this.touch.oy;
      const len = Math.hypot(dx, dy) || 1;
      const max = 60;
      const m = Math.min(len, max) / max;
      this.touch.vector = { x: (dx / len) * m, y: (dy / len) * m };
    };
    const onEnd = () => { this.touch.active = false; this.touch.vector = { x: 0, y: 0 }; };
    canvas.addEventListener('touchstart', onStart, { passive: true });
    canvas.addEventListener('touchmove', onMove, { passive: true });
    canvas.addEventListener('touchend', onEnd, { passive: true });
  }
}
