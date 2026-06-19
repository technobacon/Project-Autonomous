// ===========================================================================
// LASTLIGHT - evolutions.js
// Weapon evolutions: max a base weapon AND own its paired passive, and the
// level-up screen offers a transformation into a far more powerful form.
// Evolved weapons are registered into WEAPONS but excluded from normal pools.
// ===========================================================================

// base weapon (at max level) + passive (>= passiveLvl) -> evolved weapon id.
const EVOLUTIONS = [
  { base: 'bolt',   passive: 'multishot', passiveLvl: 2, into: 'starfall' },
  { base: 'shard',  passive: 'velocity',  passiveLvl: 2, into: 'glacier' },
  { base: 'flame',  passive: 'power',     passiveLvl: 2, into: 'inferno' },
  { base: 'orbit',  passive: 'haste',     passiveLvl: 2, into: 'halo' },
  { base: 'nova',   passive: 'area',      passiveLvl: 2, into: 'singularity' },
  { base: 'chain',  passive: 'crit',      passiveLvl: 2, into: 'tempest' },
  { base: 'spirit', passive: 'magnet',    passiveLvl: 2, into: 'reapers' },
  { base: 'whip',   passive: 'pierce',    passiveLvl: 2, into: 'eclipse' },
  { base: 'glaive', passive: 'velocity',  passiveLvl: 2, into: 'ouroboros' },
  { base: 'toxin',  passive: 'area',      passiveLvl: 2, into: 'pandemic' },
  { base: 'prism',  passive: 'multishot', passiveLvl: 2, into: 'spectrum' },
];

// Evolved weapon definitions (maxLevel 1; power scales with player stats).
const EVOLVED_WEAPONS = {
  starfall: {
    id: 'starfall', name: 'Starfall', icon: '✺', color: '#ffe14d', maxLevel: 1, evolved: true,
    desc() { return 'EVOLVED: a relentless storm of homing starlight.'; },
    cooldown(l, p) { return cd(0.42, p); },
    fire(game, inst) {
      const p = game.player;
      const count = 9 + p.bonusProj;
      const dmg = 24 * p.might;
      const targets = game.nearestEnemies(p.x, p.y, count);
      for (let i = 0; i < count; i++) {
        const t = targets[i % Math.max(1, targets.length)];
        const ang = t ? angleTo(p.x, p.y, t.x, t.y) + rand(-0.3, 0.3) : (i / count) * TAU;
        game.spawnProjectile({
          x: p.x, y: p.y, angle: ang, speed: 470 * p.projSpeed,
          damage: dmg, radius: 7 * p.area, pierce: 3 + p.bonusPierce, life: 1.6,
          color: '#fff4b0', glow: '#ffe14d', seek: true, seekStrength: 10, kb: 90,
        });
      }
      Audio2.shoot();
    },
  },

  glacier: {
    id: 'glacier', name: 'Glacier', icon: '❅', color: '#7fe9ff', maxLevel: 1, evolved: true,
    desc() { return 'EVOLVED: a deep-freezing barrage that pierces all.'; },
    cooldown(l, p) { return cd(0.8, p); },
    fire(game, inst) {
      const p = game.player;
      const count = 5 + p.bonusProj;
      const dmg = 28 * p.might;
      const base = game.aimAngle();
      for (let i = 0; i < count; i++) {
        const ang = base + (count > 1 ? lerp(-0.5, 0.5, i / (count - 1)) : 0);
        game.spawnProjectile({
          x: p.x, y: p.y, angle: ang, speed: 430 * p.projSpeed,
          damage: dmg, radius: 9 * p.area, pierce: 8 + p.bonusPierce, life: 1.8,
          color: '#dffbff', glow: '#7fe9ff', kb: 70, chill: 0.72, chillDur: 3.2,
        });
      }
      Audio2.shootSoft();
    },
  },

  inferno: {
    id: 'inferno', name: 'Inferno', icon: '☄', color: '#ff5a2c', maxLevel: 1, evolved: true,
    continuous: true,
    desc() { return 'EVOLVED: an all-consuming firestorm that erupts.'; },
    tick(game, inst, dt) {
      const p = game.player;
      const radius = 120 * p.area;
      const dps = 56;
      inst._t = (inst._t || 0) + dt;
      inst._novaT = (inst._novaT || 0) + dt;
      if (inst._t >= 0.2) {
        inst._t = 0;
        const foes = game.enemiesInRadius(p.x, p.y, radius);
        for (const e of foes) { game.dealDamage(e, dps * 0.2 * p.might, p.x, p.y, 12); e.burn = Math.max(e.burn || 0, 2); }
        if (foes.length) Audio2.hit();
      }
      if (inst._novaT >= 2.4) {
        inst._novaT = 0;
        game.nova(p.x, p.y, radius * 1.5, 40 * p.might, 260, '#ff5a2c');
      }
      inst._radius = radius * 1.25;
      inst._auraColor = '#ff5a2c';
    },
  },

  halo: {
    id: 'halo', name: 'Halo', icon: '◉', color: '#cae1ff', maxLevel: 1, evolved: true,
    continuous: true,
    desc() { return 'EVOLVED: a brilliant ring of swift, searing wisps.'; },
    tick(game, inst, dt) {
      const p = game.player;
      const n = 7 + p.bonusProj;
      const radius = 96 * p.area;
      const dmg = 22 * p.might;
      const spin = 3.6 * p.haste;
      inst._a = (inst._a || 0) + spin * dt;
      inst._orbs = []; inst._orbColor = '#dff0ff';
      inst._hit = inst._hit || {};
      for (let i = 0; i < n; i++) {
        const a = inst._a + (i / n) * TAU;
        const ox = p.x + Math.cos(a) * radius, oy = p.y + Math.sin(a) * radius;
        inst._orbs.push({ x: ox, y: oy, r: 13 * p.area });
        for (const e of game.enemiesInRadius(ox, oy, 13 * p.area)) {
          if ((inst._hit[e.id] || 0) <= 0) { game.dealDamage(e, dmg, ox, oy, 120); inst._hit[e.id] = 0.3; }
        }
      }
      for (const k in inst._hit) { inst._hit[k] -= dt; if (inst._hit[k] <= 0) delete inst._hit[k]; }
    },
  },

  singularity: {
    id: 'singularity', name: 'Singularity', icon: '⊛', color: '#d59bff', maxLevel: 1, evolved: true,
    desc() { return 'EVOLVED: collapses foes inward, then detonates.'; },
    cooldown(l, p) { return cd(2.2, p); },
    fire(game, inst) {
      const p = game.player;
      // Pull nearby foes inward.
      for (const e of game.enemiesInRadius(p.x, p.y, 320 * p.area)) {
        if (e.boss) continue;
        const a = angleTo(e.x, e.y, p.x, p.y);
        e.vx += Math.cos(a) * 220; e.vy += Math.sin(a) * 220;
      }
      game.nova(p.x, p.y, 240 * p.area, 70 * p.might, 380, '#d59bff');
      game.shake(8, 0.25);
      Audio2.blip(220, 0.3, 'sawtooth', 0.2, 160);
    },
  },

  tempest: {
    id: 'tempest', name: 'Tempest', icon: '🌩', color: '#bfe6ff', maxLevel: 1, evolved: true,
    desc() { return 'EVOLVED: a storm that arcs through the whole horde.'; },
    cooldown(l, p) { return cd(1.0, p); },
    fire(game, inst) {
      const p = game.player;
      const dmg = 30 * p.might;
      const area = p.area;
      for (let s = 0; s < 3; s++) {
        game.schedule(s * 0.09, () => game.castChain(game.player.x, game.player.y, 18, dmg, 300 * area));
      }
      Audio2.blip(900, 0.14, 'sawtooth', 0.16, -320);
    },
  },

  reapers: {
    id: 'reapers', name: 'Reaper Swarm', icon: '☠', color: '#cfe0ff', maxLevel: 1, evolved: true,
    desc() { return 'EVOLVED: a swarm of relentless, piercing reapers.'; },
    cooldown(l, p) { return cd(1.1, p); },
    fire(game, inst) {
      const p = game.player;
      const count = 6 + p.bonusProj;
      const dmg = 24 * p.might;
      for (let i = 0; i < count; i++) {
        game.spawnProjectile({
          x: p.x, y: p.y, angle: rand(0, TAU), speed: 200 * p.projSpeed,
          damage: dmg, radius: 9 * p.area, pierce: 3 + p.bonusPierce, life: 5,
          color: '#eef4ff', glow: '#cfe0ff', seek: true, seekStrength: 8, kb: 70,
        });
      }
      Audio2.blip(520, 0.12, 'sine', 0.12, 120);
    },
  },

  eclipse: {
    id: 'eclipse', name: 'Eclipse Blade', icon: '🌑', color: '#ffb0f0', maxLevel: 1, evolved: true,
    desc() { return 'EVOLVED: encircling blades sweep all around you.'; },
    cooldown(l, p) { return cd(0.85, p); },
    fire(game, inst) {
      const p = game.player;
      const len = 190 * p.area;
      const dmg = 30 * p.might;
      // Four quadrant sweeps cover the full circle.
      for (let q = 0; q < 4; q++) game.spawnWhip(p.x, p.y, q * (Math.PI / 2), len, Math.PI / 4 + 0.12, dmg);
      Audio2.blip(420, 0.13, 'triangle', 0.13, -120);
    },
  },

  ouroboros: {
    id: 'ouroboros', name: 'Ouroboros', icon: '➿', color: '#7dffd0', maxLevel: 1, evolved: true,
    desc() { return 'EVOLVED: an eternal ring of returning blades.'; },
    cooldown(l, p) { return cd(0.9, p); },
    fire(game, inst) {
      const p = game.player;
      const count = 8 + p.bonusProj;
      const dmg = 30 * p.might;
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * TAU;
        game.spawnProjectile({
          x: p.x, y: p.y, angle: ang, speed: 560 * p.projSpeed,
          damage: dmg, radius: 11 * p.area, pierce: 99, life: 5,
          color: '#ccfff0', glow: '#7dffd0', kb: 90, boomerang: true, outT: 0.7,
        });
      }
      Audio2.blip(360, 0.14, 'triangle', 0.14, 160);
    },
  },

  pandemic: {
    id: 'pandemic', name: 'Pandemic', icon: '🦠', color: '#b6ff3c', maxLevel: 1, evolved: true,
    desc() { return 'EVOLVED: a creeping plague that engulfs the field.'; },
    cooldown(l, p) { return cd(1.4, p); },
    fire(game, inst) {
      const p = game.player;
      const dps = 26 * p.might;
      const r = 130 * p.area;
      game.spawnZone(p.x, p.y, r, dps, 4, '#b6ff3c', 0.5);
      for (const e of game.nearestEnemies(p.x, p.y, 3)) game.spawnZone(e.x, e.y, r * 0.8, dps, 4, '#b6ff3c', 0.5);
      Audio2.blip(160, 0.2, 'sawtooth', 0.12, -60);
    },
  },

  spectrum: {
    id: 'spectrum', name: 'Spectrum', icon: '🌈', color: '#ff6bd6', maxLevel: 1, evolved: true,
    desc() { return 'EVOLVED: a rotating storm of prismatic beams.'; },
    cooldown(l, p) { return cd(0.7, p); },
    fire(game, inst) {
      const p = game.player;
      inst._rot = (inst._rot || 0) + 0.6;
      const dirs = 12;
      const dmg = 22 * p.might;
      const pierce = 4 + p.bonusPierce;
      const cols = ['#ff6b6b', '#ffd84d', '#7affc4', '#5ad9ff', '#c98bff', '#ff86c8'];
      for (let i = 0; i < dirs; i++) {
        const ang = inst._rot + (i / dirs) * TAU;
        const col = cols[i % cols.length];
        game.spawnProjectile({
          x: p.x, y: p.y, angle: ang, speed: 430 * p.projSpeed,
          damage: dmg, radius: 6 * p.area, pierce, life: 1.3,
          color: col, glow: col, kb: 60,
        });
      }
      Audio2.blip(720, 0.1, 'square', 0.1, 180);
    },
  },
};

// Register evolved weapons so getWeapon() and the HUD can find them. They are
// intentionally NOT added to WEAPON_LIST, so they never appear in normal pools.
Object.assign(WEAPONS, EVOLVED_WEAPONS);

// Which evolutions are available to the player right now?
function availableEvolutions(player) {
  const out = [];
  for (const evo of EVOLUTIONS) {
    const w = player.weapon(evo.base);
    if (!w || w.level < w.def.maxLevel) continue;
    if ((player.passives[evo.passive] || 0) < evo.passiveLvl) continue;
    if (player.hasWeapon(evo.into)) continue;
    out.push(evo);
  }
  return out;
}
