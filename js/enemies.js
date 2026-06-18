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
};

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
  devourer: {
    id: 'devourer', name: 'The Devourer', color: '#c98bff', boss: true,
    hp: 4800, speed: 52, radius: 62, damage: 42, xp: 220, ai: 'boss_warden', shape: 'star',
    shootCd: 1.0, projSpeed: 240, projDmg: 18,
  },
};

const BOSS_SCHEDULE = [
  { time: 180, boss: 'warden' },     // 3:00
  { time: 360, boss: 'colossus' },   // 6:00
  { time: 600, boss: 'devourer' },   // 10:00
];

class Director {
  constructor(game) {
    this.game = game;
    this.spawnTimer = 0;
    this.bossIndex = 0;
    this.eliteTimer = 18;            // periodic tougher pack
    this.swarmTimer = 35;           // periodic ring rush
  }

  // Difficulty multipliers as a function of elapsed minutes.
  hpScale(min) { return 1 + min * 0.34 + min * min * 0.04; }
  // Bosses scale more gently than fodder so a strong build can actually melt
  // them, while they remain a genuine threat.
  bossScale(min) { return 1 + min * 0.20 + min * min * 0.018; }
  dmgScale(min) { return 1 + min * 0.14; }
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
        this.spawnBoss('devourer', 1 + (min - 10) * 0.15);
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
  }

  availableTypes(min) {
    return Object.values(ENEMY_TYPES).filter(t => t.tier <= min && t.id !== 'splitling');
  }

  pickType(min) {
    const avail = this.availableTypes(min);
    // Bias toward newer (higher-tier) enemies as time goes on.
    return weightedPick(avail, t => 1 + t.tier);
  }

  spawnRandom(min) {
    const type = this.pickType(min);
    const pos = this.game.offscreenPoint();
    this.game.spawnEnemy(type.id, pos.x, pos.y, this.hpScale(min), this.dmgScale(min));
  }

  spawnPack(min) {
    const type = chance(0.5) && min >= 1.8 ? ENEMY_TYPES.brute : (min >= 3.2 ? ENEMY_TYPES.charger : ENEMY_TYPES.drifter);
    const center = this.game.offscreenPoint();
    const n = 3 + Math.floor(min / 2);
    for (let i = 0; i < n; i++) {
      this.game.spawnEnemy(type.id, center.x + rand(-50, 50), center.y + rand(-50, 50),
        this.hpScale(min) * 1.15, this.dmgScale(min));
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
