// ===========================================================================
// LASTLIGHT - enemies.js
// Enemy archetypes + the "Director" that schedules spawns and bosses, scaling
// difficulty smoothly with elapsed time so a run can go indefinitely.
// ===========================================================================

// Base archetypes. `tier` gates when they start appearing (minutes).
const ENEMY_TYPES = {
  drifter: {
    id: 'drifter', name: 'Drifter', tier: 0, color: '#7a6cff',
    hp: 14, speed: 52, radius: 13, damage: 8, xp: 1, ai: 'chase', shape: 'diamond',
  },
  runner: {
    id: 'runner', name: 'Runner', tier: 0.6, color: '#ff5d8f',
    hp: 9, speed: 112, radius: 10, damage: 7, xp: 1, ai: 'chase', shape: 'tri',
  },
  swarm: {
    id: 'swarm', name: 'Mote', tier: 1.2, color: '#ff9d3c',
    hp: 5, speed: 90, radius: 7, damage: 5, xp: 1, ai: 'chase', shape: 'dot',
  },
  brute: {
    id: 'brute', name: 'Brute', tier: 1.8, color: '#ff4d4d',
    hp: 70, speed: 42, radius: 22, damage: 16, xp: 4, ai: 'chase', shape: 'hex',
  },
  shooter: {
    id: 'shooter', name: 'Spitter', tier: 2.5, color: '#46e0a0',
    hp: 26, speed: 46, radius: 13, damage: 9, xp: 3, ai: 'shooter', shape: 'square',
    shootRange: 320, shootCd: 2.2, projSpeed: 220, projDmg: 9,
  },
  charger: {
    id: 'charger', name: 'Charger', tier: 3.2, color: '#ffd84d',
    hp: 40, speed: 60, radius: 15, damage: 18, xp: 4, ai: 'charger', shape: 'arrow',
  },
  splitter: {
    id: 'splitter', name: 'Splitter', tier: 4, color: '#9d6bff',
    hp: 50, speed: 50, radius: 18, damage: 12, xp: 3, ai: 'chase', shape: 'hex',
    splitInto: 'splitling', splitCount: 3,
  },
  splitling: {
    id: 'splitling', name: 'Splitling', tier: 99, color: '#c9a8ff',
    hp: 12, speed: 80, radius: 9, damage: 8, xp: 1, ai: 'chase', shape: 'dot',
  },
  wraith: {
    id: 'wraith', name: 'Wraith', tier: 5, color: '#5ad9ff',
    hp: 110, speed: 70, radius: 16, damage: 20, xp: 6, ai: 'chase', shape: 'tri',
  },
  stalker: {
    id: 'stalker', name: 'Stalker', tier: 2.0, color: '#b07cff',
    hp: 34, speed: 135, radius: 12, damage: 11, xp: 3, ai: 'stalker', shape: 'tri', orbitR: 190,
  },
  bomber: {
    id: 'bomber', name: 'Bomber', tier: 3.5, color: '#ff7a3c',
    hp: 46, speed: 40, radius: 16, damage: 0, xp: 4, ai: 'bomber', shape: 'dot',
    explodes: true, fuseR: 64, burstN: 12, burstSpeed: 210, burstDmg: 13,
  },
  conjurer: {
    id: 'conjurer', name: 'Conjurer', tier: 4.5, color: '#5affd0',
    hp: 86, speed: 50, radius: 16, damage: 11, xp: 6, ai: 'summoner', shape: 'rune',
    // Kites at range and periodically conjures a fan of motes. A priority target:
    // ignore it and the screen fills. summonCd reused as the spawn timer.
    shootCd: 4.0, summonCd: 4.0, summonCount: 3, summonType: 'swarm', keepRange: 280,
  },
  bombardier: {
    id: 'bombardier', name: 'Bombardier', tier: 3.6, color: '#ff8a3c',
    hp: 40, speed: 42, radius: 14, damage: 15, xp: 4, ai: 'lobber', shape: 'square',
    // Kites at range and lobs telegraphed ground strikes at where you stand —
    // keep moving and they fall on empty ground.
    shootRange: 360, shootCd: 3.2, blastR: 78,
  },
  acolyte: {
    id: 'acolyte', name: 'Acolyte', tier: 3.8, color: '#ffce5a',
    hp: 64, speed: 46, radius: 14, damage: 9, xp: 5, ai: 'warder', shape: 'cross',
    // Empowers nearby foes (faster + damage-resistant) via a sustained aura. The
    // more crowded the field, the deadlier it is — so cut it down first.
    auraR: 165,
  },
};

// ---- Affixes: single-enemy modifiers carried by "elite" foes ---------------
// Data-only table (id/name/color/desc) so UI, help, codex, and tests can
// iterate it. The numeric effects are applied in Game._applyAffix (sim path).
const AFFIXES = {
  swift:    { id: 'swift',    name: 'Swift',        color: '#7affc4', desc: 'Moves far faster.' },
  hardened: { id: 'hardened', name: 'Hardened',     color: '#9ad8ff', desc: 'Resists damage and has extra health.' },
  regen:    { id: 'regen',    name: 'Regenerating', color: '#7affc4', desc: 'Heals over time — burst it down.' },
  volatile: { id: 'volatile', name: 'Volatile',     color: '#ff7a3c', desc: 'Bursts projectiles on death.' },
  arcane:   { id: 'arcane',   name: 'Arcane',       color: '#c98bff', desc: 'Periodically fires bolts at you.' },
  shielded: { id: 'shielded', name: 'Shielded',     color: '#8fd8ff', desc: 'A shield absorbs a burst of damage.' },
  leech:    { id: 'leech',    name: 'Leeching',     color: '#e0405a', desc: 'Heals itself whenever it wounds you.' },
  frenzied: { id: 'frenzied', name: 'Frenzied',     color: '#ff8a3c', desc: 'Grows faster the more it is hurt.' },
  phaser:   { id: 'phaser',   name: 'Phasing',      color: '#b6f0ff', desc: 'Blinks toward you in sudden lunges.' },
  cloven:   { id: 'cloven',   name: 'Cloven',       color: '#9d6bff', desc: 'Bursts into lesser foes when slain.' },
};
const AFFIX_LIST = Object.values(AFFIXES);
function getAffix(id) { return AFFIXES[id]; }

const CHAMPION_NAMES = ['Gorehusk', 'Nightmaw', 'Dreadcoil', 'Voidfang', 'Hollowmark', 'Sablewrath', 'Grimspire', 'Ashmaw'];

// Bosses appear on a schedule. They are large, tanky, and drop big rewards.
const BOSSES = {
  warden: {
    id: 'warden', name: 'The Warden', color: '#ff4d6d', boss: true,
    hp: 1000, speed: 46, radius: 44, damage: 26, xp: 60, ai: 'boss_warden', shape: 'star',
    shootCd: 1.4, projSpeed: 200, projDmg: 12,
  },
  colossus: {
    id: 'colossus', name: 'Colossus', color: '#ffd84d', boss: true,
    hp: 2400, speed: 38, radius: 56, damage: 34, xp: 120, ai: 'boss_colossus', shape: 'hex',
    shootCd: 2.0, projSpeed: 180, projDmg: 14,
  },
  maelstrom: {
    id: 'maelstrom', name: 'The Maelstrom', color: '#8a7dff', boss: true,
    hp: 3600, speed: 40, radius: 52, damage: 36, xp: 170, ai: 'boss_maelstrom', shape: 'star',
    // Weaves an ever-rotating spiral of bolts, punctuated by a full ring-nova.
    shootCd: 0.14, projSpeed: 200, projDmg: 12, spinStep: 0.42,
    novaCd: 5.0, novaN: 22, novaSpeed: 150, novaDmg: 14,
  },
  devourer: {
    id: 'devourer', name: 'The Devourer', color: '#c98bff', boss: true,
    hp: 4800, speed: 52, radius: 62, damage: 42, xp: 220, ai: 'boss_warden', shape: 'star',
    shootCd: 1.0, projSpeed: 240, projDmg: 18,
  },
  eclipse: {
    id: 'eclipse', name: 'The Eclipse', color: '#6c7bff', boss: true,
    hp: 4200, speed: 48, radius: 58, damage: 40, xp: 200, ai: 'boss_eclipse', shape: 'star',
    // Alternates a shielded (untouchable, bullet-spraying) phase with an open
    // vulnerable window — wait out the shield, then burst it down.
    shootCd: 1.0, projSpeed: 210, projDmg: 15, shieldDur: 4.0, openDur: 6.0,
  },
  herald: {
    id: 'herald', name: 'The Herald', color: '#7affd0', boss: true,
    hp: 4000, speed: 44, radius: 56, damage: 38, xp: 215, ai: 'boss_herald', shape: 'hex',
    // Invulnerable while its summoned acolytes live — clear the adds to drop the
    // ward and open a fixed damage window. A kill-priority fight, not a timer.
    shootCd: 1.6, projSpeed: 200, projDmg: 16,
    summonCd: 5.0, summonCount: 4, summonType: 'stalker', openDur: 4.0,
  },
  ravager: {
    id: 'ravager', name: 'The Ravager', color: '#ff9d5a', boss: true,
    hp: 4400, speed: 50, radius: 54, damage: 44, xp: 210, ai: 'boss_ravager', shape: 'arrow',
    // Stalks, locks on, telegraphs a line, then dashes across the arena for heavy
    // contact damage and scatters a bolt ring — a dodge fight that punishes
    // standing still. Always vulnerable; the skill check is reading its charge.
    projSpeed: 190, projDmg: 16, dashBurst: 3, recoverDur: 1.6,
  },
};

const BOSS_SCHEDULE = [
  { time: 180, boss: 'warden' },     // 3:00
  { time: 360, boss: 'colossus' },   // 6:00
  { time: 480, boss: 'maelstrom' },  // 8:00
  { time: 600, boss: 'devourer' },   // 10:00
];

// Past the scheduled bosses, the endless rotation cycles the toughest so
// late-game encounters keep varying their mechanics.
const ENDLESS_BOSSES = ['devourer', 'maelstrom', 'eclipse', 'herald', 'ravager'];

class Director {
  constructor(game) {
    this.game = game;
    this.spawnTimer = 0;
    this.bossIndex = 0;
    this.eliteTimer = 18;            // periodic tougher pack
    this.swarmTimer = 35;           // periodic ring rush
    this.champTimer = 75;           // periodic Champion mini-boss event
  }

  // Difficulty multipliers as a function of elapsed minutes.
  hpScale(min) { return 1 + min * 0.34 + min * min * 0.04; }
  // Bosses scale more gently than fodder so a strong build can actually melt
  // them, while they remain a genuine threat.
  bossScale(min) { return 1 + min * 0.20 + min * min * 0.018; }
  dmgScale(min) { return 1 + min * 0.14; }
  // Odds a freshly-spawned fodder enemy is promoted to an elite, ramping with
  // time but capped so the screen never becomes all-elite.
  eliteChance(min) { return clamp(0.02 + min * 0.006, 0.02, 0.10); }
  // Roll a spawned enemy into an elite (single affix). Seeded — sim path only.
  maybeElite(e, min) {
    if (!e || e.boss || e.type.id === 'splitling') return e;
    if (chance(this.eliteChance(min))) this.game.makeElite(e, 1, false);
    return e;
  }
  // Target simultaneous enemy count grows over time, with a hard cap.
  // Enough fodder to fuel level-ups, but gentle enough to survive while weak.
  // Difficulty raises both the population target and the spawn cadence.
  targetCount(min) {
    const sp = (this.game.diff ? this.game.diff.spawn : 1) * (this.game.mods ? this.game.mods.enemyCountMul : 1);
    return Math.min(this.game.maxEnemies, Math.floor((12 + Math.floor(min * 8)) * sp));
  }
  spawnInterval(min) {
    const sp = this.game.diff ? this.game.diff.spawn : 1;
    return Math.max(0.1, (0.9 - min * 0.06) / sp);
  }

  update(dt) {
    const g = this.game;
    if (g.mode === 'gauntlet') { this._updateGauntlet(dt); return; }
    const min = g.time / 60;

    // Scheduled bosses.
    if (this.bossIndex < BOSS_SCHEDULE.length && g.time >= BOSS_SCHEDULE[this.bossIndex].time) {
      const entry = BOSS_SCHEDULE[this.bossIndex];
      this.spawnBoss(entry.boss);
      this.bossIndex++;
    }
    // After the schedule, recurring escalating bosses every 3 minutes.
    if (this.bossIndex >= BOSS_SCHEDULE.length) {
      this._endlessBossTimer = (this._endlessBossTimer || 0) + dt;
      if (this._endlessBossTimer >= 180) {
        this._endlessBossTimer = 0;
        const id = ENDLESS_BOSSES[(this._endlessIndex = (this._endlessIndex || 0) + 1) % ENDLESS_BOSSES.length];
        this.spawnBoss(id, 1 + (min - 10) * 0.15);
      }
    }

    // Regular trickle spawns to maintain target population.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && g.enemies.length < this.targetCount(min)) {
      this.spawnTimer = this.spawnInterval(min);
      const batch = 1 + Math.floor(min / 2);
      for (let i = 0; i < batch && g.enemies.length < this.targetCount(min); i++) {
        this.spawnRandom(min);
      }
    }

    // Elite pack: a tight cluster of brutes/chargers.
    this.eliteTimer -= dt;
    if (this.eliteTimer <= 0) {
      this.eliteTimer = Math.max(14, 26 - min);
      this.spawnPack(min);
    }

    // Swarm rush: a full ring closing in.
    this.swarmTimer -= dt;
    if (this.swarmTimer <= 0) {
      this.swarmTimer = Math.max(22, 45 - min * 1.5);
      this.spawnRing(min);
    }

    // Champion: a periodic two-affix elite mini-boss (survival only; this branch
    // is never reached in gauntlet mode). Only one champion lives at a time.
    this.champTimer -= dt;
    if (this.champTimer <= 0 && !g.enemies.some(e => e.champion)) {
      this.champTimer = Math.max(55, 110 - min * 3);
      this.spawnChampion(min);
    }
  }

  availableTypes(min) {
    return Object.values(ENEMY_TYPES).filter(t => t.tier <= min && t.id !== 'splitling');
  }

  pickType(min) {
    const avail = this.availableTypes(min);
    // Bias toward newer (higher-tier) enemies as time goes on, plus the active
    // biome's thematic lean (which archetypes appear — not the difficulty).
    const bias = (this.game.biome && this.game.biome.bias) || null;
    return weightedPick(avail, t => (1 + t.tier) * (bias && bias[t.id] ? bias[t.id] : 1));
  }

  spawnRandom(min) {
    const type = this.pickType(min);
    const pos = this.game.offscreenPoint();
    const e = this.game.spawnEnemy(type.id, pos.x, pos.y, this.hpScale(min), this.dmgScale(min));
    this.maybeElite(e, min);
  }

  spawnPack(min) {
    const type = chance(0.5) && min >= 1.8 ? ENEMY_TYPES.brute : (min >= 3.2 ? ENEMY_TYPES.charger : ENEMY_TYPES.drifter);
    const center = this.game.offscreenPoint();
    const n = 3 + Math.floor(min / 2);
    for (let i = 0; i < n; i++) {
      const e = this.game.spawnEnemy(type.id, center.x + rand(-50, 50), center.y + rand(-50, 50),
        this.hpScale(min) * 1.15, this.dmgScale(min));
      // The pack is led by a guaranteed elite; the rest may roll one too.
      if (i === 0) this.game.makeElite(e, 1, false); else this.maybeElite(e, min);
    }
    this.game.toast('⚠ Elite pack incoming');
  }

  spawnRing(min) {
    const type = min >= 1.2 ? ENEMY_TYPES.swarm : ENEMY_TYPES.drifter;
    const n = 14 + Math.floor(min * 3);
    const r = Math.max(this.game.view.w, this.game.view.h) * 0.62;
    const cx = this.game.player.x, cy = this.game.player.y;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      this.game.spawnEnemy(type.id, cx + Math.cos(a) * r, cy + Math.sin(a) * r,
        this.hpScale(min) * 0.9, this.dmgScale(min));
    }
  }

  // ---- Gauntlet (boss-rush) mode ----------------------------------------
  // Back-to-back boss rounds with escalating scale and light add pressure to
  // keep the player levelling. Endless: it ends only when the player falls.
  _updateGauntlet(dt) {
    const g = this.game;
    if (this.gState === undefined) { this.gState = 'intermission'; this.gTimer = 3.0; this.round = 0; this.addTimer = 0; g.gauntletRound = 0; }

    if (this.gState === 'intermission') {
      this.gTimer -= dt;
      if (this.gTimer <= 0) {
        this.round++; g.gauntletRound = this.round;
        this._spawnGauntletRound(this.round);
        this.gState = 'fight';
      }
    } else { // fight
      // Occasional adds (capped) so the player keeps gaining XP between hits.
      this.addTimer -= dt;
      if (this.addTimer <= 0 && g.enemies.length < 55) {
        this.addTimer = Math.max(0.6, 2.0 - this.round * 0.07);
        const pseudoMin = Math.min(8, 0.6 + this.round * 0.5);
        const batch = 1 + Math.floor(this.round / 3);
        for (let i = 0; i < batch && g.enemies.length < 55; i++) {
          const type = this.pickType(pseudoMin);
          const pos = g.offscreenPoint();
          g.spawnEnemy(type.id, pos.x, pos.y, this.hpScale(pseudoMin) * 0.8, this.dmgScale(pseudoMin));
        }
      }
      // Round is cleared once every boss is down.
      if (!g.enemies.some(e => e.boss)) {
        this.gState = 'intermission';
        this.gTimer = 3.5;
        g.gauntletCleared = this.round;
        g.player.heal(g.player.maxHp * 0.25); // breather reward
        g.toast('✦ Round ' + this.round + ' cleared!');
      }
    }
  }

  _spawnGauntletRound(round) {
    const keys = ['warden', 'colossus', 'maelstrom', 'devourer', 'eclipse', 'herald', 'ravager'];
    const count = round >= 6 ? 2 : 1;        // double bosses in later rounds
    const scale = 1 + (round - 1) * 0.5;     // escalating boss HP
    const dmg = 1 + (round - 1) * 0.12;
    for (let i = 0; i < count; i++) {
      const id = keys[(round - 1 + i) % keys.length];
      const def = BOSSES[id];
      const pos = this.game.offscreenPoint(0.9);
      const e = this.game.spawnEnemy(id, pos.x, pos.y, scale, dmg, def);
      if (e) { e.boss = true; this.game.onBossSpawn(e); }
    }
    this.game.toast('☠ Round ' + round + ' — survive!');
  }

  // A Champion: a beefy, named, two-affix elite that drops a chest. Picks a
  // sturdy non-splitter base so elite scaling never multiplies split counts.
  spawnChampion(min) {
    const pool = [ENEMY_TYPES.brute, ENEMY_TYPES.charger, ENEMY_TYPES.wraith, ENEMY_TYPES.stalker]
      .filter(t => t.tier <= min + 1);
    const type = (pool.length ? pick(pool) : ENEMY_TYPES.brute);
    const pos = this.game.offscreenPoint(0.85);
    const e = this.game.spawnEnemy(type.id, pos.x, pos.y, this.hpScale(min), this.dmgScale(min));
    if (e) this.game.makeChampion(e, min);
  }

  spawnBoss(id, mult = 1) {
    const min = this.game.time / 60;
    const def = BOSSES[id];
    const pos = this.game.offscreenPoint(0.9);
    const e = this.game.spawnEnemy(id, pos.x, pos.y, this.bossScale(min) * mult, this.dmgScale(min), def);
    if (e) {
      e.boss = true;
      this.game.onBossSpawn(e);
    }
  }
}
