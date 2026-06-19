// ===========================================================================
// LASTLIGHT - weapons.js
// Weapon definitions. Periodic weapons implement cooldown()+fire(); continuous
// weapons (orbit) implement tick(). Damage scales with the player's stats.
// ===========================================================================

// Helper: scaled cooldown given a base value and player attack speed.
function cd(base, player) { return base / Math.max(0.25, player.haste); }

const WEAPONS = {
  // -- Light Bolt: fires homing-leaning bolts at nearest enemies. ----------
  bolt: {
    id: 'bolt', name: 'Light Bolt', icon: '✦', color: '#ffd84d', maxLevel: 8,
    desc(l) {
      return [
        'Fire a bolt of light at the nearest foe.',
        '+1 projectile.', '+25% damage.', 'Bolts pierce +1 enemy.',
        '+1 projectile.', '+30% damage.', 'Bolts pierce +1 enemy.',
        '+2 projectiles. Bolts seek targets.',
      ][l - 1] || 'Maxed.';
    },
    cooldown(l, p) { return cd(0.78 - l * 0.03, p); },
    fire(game, inst) {
      const p = game.player, l = inst.level;
      let count = 1 + (l >= 2 ? 1 : 0) + (l >= 5 ? 1 : 0) + (l >= 8 ? 2 : 0) + p.bonusProj;
      let dmg = 17 * (1 + (l >= 3 ? 0.25 : 0) + (l >= 6 ? 0.30 : 0));
      let pierce = 0 + (l >= 4 ? 1 : 0) + (l >= 7 ? 1 : 0) + p.bonusPierce;
      const seek = l >= 8;
      const targets = game.nearestEnemies(p.x, p.y, count);
      for (let i = 0; i < count; i++) {
        const t = targets[i % Math.max(1, targets.length)];
        let ang = t ? angleTo(p.x, p.y, t.x, t.y) : rand(0, TAU);
        if (count > 1 && !t) ang += (i / count) * TAU;
        else if (count > 1) ang += rand(-0.12, 0.12) * (i);
        game.spawnProjectile({
          x: p.x, y: p.y, angle: ang, speed: 430 * p.projSpeed,
          damage: dmg, radius: 6 * p.area, pierce, life: 1.4,
          color: '#ffe98a', glow: '#ffd84d', seek, kb: 90,
        });
      }
      Audio2.shoot();
    },
  },

  // -- Frost Shard: piercing shards that chill (slow) enemies. -------------
  shard: {
    id: 'shard', name: 'Frost Shard', icon: '❄', color: '#5ad9ff', maxLevel: 8,
    desc(l) {
      return [
        'Hurl a piercing shard that chills foes.',
        '+1 shard.', '+20% damage & stronger chill.', 'Shards pierce +2.',
        '+1 shard.', '+30% damage.', 'Chill also slows attacks.',
        '+2 shards, wider spread.',
      ][l - 1] || 'Maxed.';
    },
    cooldown(l, p) { return cd(1.05 - l * 0.04, p); },
    fire(game, inst) {
      const p = game.player, l = inst.level;
      let count = 1 + (l >= 2 ? 1 : 0) + (l >= 5 ? 1 : 0) + (l >= 8 ? 2 : 0) + p.bonusProj;
      let dmg = 9 * (1 + (l >= 3 ? 0.20 : 0) + (l >= 6 ? 0.30 : 0));
      let pierce = 1 + (l >= 4 ? 2 : 0) + p.bonusPierce;
      const chill = 0.45 - (l >= 3 ? 0.1 : 0);
      const base = game.aimAngle();
      const spread = (l >= 8 ? 0.5 : 0.28);
      for (let i = 0; i < count; i++) {
        const ang = base + (count > 1 ? lerp(-spread, spread, i / (count - 1)) : 0);
        game.spawnProjectile({
          x: p.x, y: p.y, angle: ang, speed: 360 * p.projSpeed,
          damage: dmg, radius: 5 * p.area, pierce, life: 1.6,
          color: '#bff3ff', glow: '#5ad9ff', kb: 50,
          chill, chillDur: 2.2,
        });
      }
      Audio2.shootSoft();
    },
  },

  // -- Flame Aura: continuous burning ring that grows with level. ----------
  flame: {
    id: 'flame', name: 'Flame Aura', icon: '🔥', color: '#ff7a3c', maxLevel: 8,
    continuous: true,
    desc(l) {
      return [
        'A searing aura burns nearby foes.',
        '+25% radius.', '+30% damage.', '+25% radius.',
        '+30% damage.', '+25% radius.', 'Burns leave embers.',
        'Greatly increased size & damage.',
      ][l - 1] || 'Maxed.';
    },
    tick(game, inst, dt) {
      const p = game.player, l = inst.level;
      const radius = (52 + l * 9) * p.area * (l >= 8 ? 1.3 : 1);
      const dps = (14 + l * 5) * (l >= 8 ? 1.4 : 1);
      inst._t = (inst._t || 0) + dt;
      // Damage tick every 0.25s.
      if (inst._t >= 0.25) {
        inst._t = 0;
        const foes = game.enemiesInRadius(p.x, p.y, radius);
        for (const e of foes) {
          game.dealDamage(e, dps * 0.25 * p.might, p.x, p.y, 10);
          if (l >= 7 && chance(0.3)) e.burn = Math.max(e.burn || 0, 1.5);
        }
        if (foes.length) Audio2.hit();
      }
      inst._radius = radius; // cached for rendering
    },
  },

  // -- Orbit Wisps: orbs that circle the player, hitting on contact. -------
  orbit: {
    id: 'orbit', name: 'Orbit Wisps', icon: '◓', color: '#8affc1', maxLevel: 8,
    continuous: true,
    desc(l) {
      return [
        'Wisps orbit you, striking on contact.',
        '+1 wisp.', '+25% damage.', '+1 wisp, wider orbit.',
        '+30% damage.', '+1 wisp.', 'Faster orbit.',
        '+1 wisp & big damage.',
      ][l - 1] || 'Maxed.';
    },
    tick(game, inst, dt) {
      const p = game.player, l = inst.level;
      const n = 1 + (l >= 2 ? 1 : 0) + (l >= 4 ? 1 : 0) + (l >= 6 ? 1 : 0) + (l >= 8 ? 1 : 0) + p.bonusProj;
      const radius = (58 + (l >= 4 ? 22 : 0)) * p.area;
      const dmg = (10 * (1 + (l >= 3 ? 0.25 : 0) + (l >= 5 ? 0.30 : 0)) + (l >= 8 ? 12 : 0)) * p.might;
      const spin = (2.2 + (l >= 7 ? 1.2 : 0)) * p.haste;
      inst._a = (inst._a || 0) + spin * dt;
      inst._orbs = [];
      const hitCooldown = 0.4;
      inst._hit = inst._hit || {};
      for (let i = 0; i < n; i++) {
        const a = inst._a + (i / n) * TAU;
        const ox = p.x + Math.cos(a) * radius;
        const oy = p.y + Math.sin(a) * radius;
        inst._orbs.push({ x: ox, y: oy, r: 11 * p.area });
        const foes = game.enemiesInRadius(ox, oy, 11 * p.area);
        for (const e of foes) {
          const key = e.id;
          if ((inst._hit[key] || 0) <= 0) {
            game.dealDamage(e, dmg, ox, oy, 120);
            inst._hit[key] = hitCooldown;
          }
        }
      }
      for (const k in inst._hit) { inst._hit[k] -= dt; if (inst._hit[k] <= 0) delete inst._hit[k]; }
    },
  },

  // -- Nova: periodic expanding shockwave from the player. -----------------
  nova: {
    id: 'nova', name: 'Nova Burst', icon: '✸', color: '#c98bff', maxLevel: 8,
    desc(l) {
      return [
        'Release an expanding shockwave.',
        '+25% radius.', '+30% damage.', 'Knocks foes back hard.',
        '+30% damage.', '+30% radius.', 'Fires twice.',
        'Massive nova & damage.',
      ][l - 1] || 'Maxed.';
    },
    cooldown(l, p) { return cd(2.6 - l * 0.05, p); },
    fire(game, inst) {
      const p = game.player, l = inst.level;
      const radius = (110 + l * 14) * p.area * (l >= 6 ? 1.3 : 1) * (l >= 8 ? 1.3 : 1);
      const dmg = (24 * (1 + (l >= 3 ? 0.30 : 0) + (l >= 5 ? 0.30 : 0)) + (l >= 8 ? 30 : 0)) * p.might;
      const kb = l >= 4 ? 320 : 160;
      const shots = l >= 7 ? 2 : 1;
      for (let s = 0; s < shots; s++) {
        game.schedule(s * 0.22, () => game.spawnNova(game.player.x, game.player.y, radius, dmg, kb, '#c98bff'));
      }
      Audio2.blip(300, 0.2, 'sawtooth', 0.18, 200);
    },
  },

  // -- Arc Lightning: chains between nearby enemies. -----------------------
  chain: {
    id: 'chain', name: 'Arc Lightning', icon: '⚡', color: '#9ad8ff', maxLevel: 8,
    desc(l) {
      return [
        'Lightning leaps between foes.',
        '+1 jump.', '+25% damage.', '+1 jump.',
        '+30% damage.', '+2 jumps.', 'Strikes twice.',
        'Huge chain & damage.',
      ][l - 1] || 'Maxed.';
    },
    cooldown(l, p) { return cd(1.5 - l * 0.04, p); },
    fire(game, inst) {
      const p = game.player, l = inst.level;
      const jumps = 3 + (l >= 2 ? 1 : 0) + (l >= 4 ? 1 : 0) + (l >= 6 ? 2 : 0) + (l >= 8 ? 3 : 0);
      const dmg = (16 * (1 + (l >= 3 ? 0.25 : 0) + (l >= 5 ? 0.30 : 0))) * p.might;
      const shots = l >= 7 ? 2 : 1;
      const area = p.area;
      for (let s = 0; s < shots; s++) {
        game.schedule(s * 0.12, () => game.castChain(game.player.x, game.player.y, jumps, dmg, 240 * area));
      }
      Audio2.blip(880, 0.12, 'sawtooth', 0.14, -300);
    },
  },

  // -- Spirit Seekers: slow homing orbs that relentlessly chase. -----------
  spirit: {
    id: 'spirit', name: 'Spirit Seekers', icon: '👻', color: '#b6f0ff', maxLevel: 8,
    desc(l) {
      return [
        'Summon a homing spirit.',
        '+1 spirit.', '+25% damage.', '+1 spirit.',
        '+30% damage.', '+1 spirit.', 'Spirits pierce more.',
        '+2 spirits.',
      ][l - 1] || 'Maxed.';
    },
    cooldown(l, p) { return cd(1.6 - l * 0.05, p); },
    fire(game, inst) {
      const p = game.player, l = inst.level;
      const count = 1 + (l >= 2 ? 1 : 0) + (l >= 4 ? 1 : 0) + (l >= 6 ? 1 : 0) + (l >= 8 ? 2 : 0) + p.bonusProj;
      const dmg = (14 * (1 + (l >= 3 ? 0.25 : 0) + (l >= 5 ? 0.30 : 0))) * p.might;
      const pierce = 1 + (l >= 7 ? 2 : 0) + p.bonusPierce;
      for (let i = 0; i < count; i++) {
        const ang = rand(0, TAU);
        game.spawnProjectile({
          x: p.x, y: p.y, angle: ang, speed: 150 * p.projSpeed,
          damage: dmg, radius: 7 * p.area, pierce, life: 4,
          color: '#dffaff', glow: '#b6f0ff', seek: true, seekStrength: 6, kb: 60,
        });
      }
      Audio2.blip(520, 0.1, 'sine', 0.1, 120);
    },
  },

  // -- Whip: melee arcs that sweep alternating sides. ----------------------
  whip: {
    id: 'whip', name: 'Light Whip', icon: '➹', color: '#ffb3e6', maxLevel: 8,
    desc(l) {
      return [
        'Sweep a whip of light to your sides.',
        '+30% damage.', 'Longer reach.', 'Hits both sides.',
        '+30% damage.', 'Wider arc.', 'Adds vertical sweeps.',
        'Huge reach & damage.',
      ][l - 1] || 'Maxed.';
    },
    cooldown(l, p) { return cd(1.1 - l * 0.04, p); },
    fire(game, inst) {
      const p = game.player, l = inst.level;
      const len = (120 + l * 14) * p.area * (l >= 3 ? 1.2 : 1) * (l >= 8 ? 1.3 : 1);
      const dmg = (18 * (1 + (l >= 2 ? 0.30 : 0) + (l >= 5 ? 0.30 : 0))) * p.might;
      const wide = (l >= 6 ? 0.9 : 0.6);
      const face = p.facing >= 0 ? 0 : Math.PI;   // primary sweep follows facing
      const dirs = [face];
      if (l >= 4) dirs.push(face + Math.PI);       // both horizontal sides
      if (l >= 7) { dirs.push(Math.PI / 2); dirs.push(-Math.PI / 2); } // add vertical
      for (const d of dirs) game.spawnWhip(p.x, p.y, d, len, wide, dmg);
      Audio2.blip(420, 0.12, 'triangle', 0.12, -120);
    },
  },

  // -- Whirling Glaive: a blade that flies out and returns, cutting twice. --
  glaive: {
    id: 'glaive', name: 'Whirling Glaive', icon: '🪃', color: '#9affe0', maxLevel: 8,
    desc(l) {
      return [
        'Hurl a blade that returns, cutting both ways.',
        '+1 glaive.', '+25% damage.', 'Longer reach & more pierce.',
        '+1 glaive.', '+30% damage.', 'Glaives pierce everything.',
        '+2 glaives, huge reach.',
      ][l - 1] || 'Maxed.';
    },
    cooldown(l, p) { return cd(1.5 - l * 0.05, p); },
    fire(game, inst) {
      const p = game.player, l = inst.level;
      const count = 1 + (l >= 2 ? 1 : 0) + (l >= 5 ? 1 : 0) + (l >= 8 ? 2 : 0) + p.bonusProj;
      const dmg = (20 * (1 + (l >= 3 ? 0.25 : 0) + (l >= 6 ? 0.30 : 0))) * p.might;
      const pierce = (l >= 7 ? 99 : (l >= 4 ? 3 : 1)) + p.bonusPierce;
      const outT = 0.55 + (l >= 4 ? 0.12 : 0) + (l >= 8 ? 0.18 : 0);
      const base = game.aimAngle();
      for (let i = 0; i < count; i++) {
        const ang = base + (count > 1 ? lerp(-0.45, 0.45, i / (count - 1)) : 0);
        game.spawnProjectile({
          x: p.x, y: p.y, angle: ang, speed: 520 * p.projSpeed,
          damage: dmg, radius: 9 * p.area, pierce, life: 4,
          color: '#dfffff', glow: '#9affe0', kb: 80, boomerang: true, outT,
        });
      }
      Audio2.blip(360, 0.12, 'triangle', 0.13, 140);
    },
  },

  // -- Toxic Flask: lobs flasks that leave lingering corrosive pools. -------
  toxin: {
    id: 'toxin', name: 'Toxic Flask', icon: '☣', color: '#a6e22e', maxLevel: 8,
    desc(l) {
      return [
        'Lob a flask that leaves a corrosive pool.',
        '+20% damage.', 'Bigger pools.', '+1 flask.',
        '+25% damage.', 'Pools linger longer.', 'Pools also slow foes.',
        '+1 flask, deeply caustic.',
      ][l - 1] || 'Maxed.';
    },
    cooldown(l, p) { return cd(1.9 - l * 0.05, p); },
    fire(game, inst) {
      const p = game.player, l = inst.level;
      const count = 1 + (l >= 4 ? 1 : 0) + (l >= 8 ? 1 : 0) + (p.bonusProj > 0 ? 1 : 0);
      const dps = (10 * (1 + (l >= 2 ? 0.20 : 0) + (l >= 5 ? 0.25 : 0))) * p.might;
      const radius = (66 + l * 6) * p.area * (l >= 3 ? 1.2 : 1);
      const life = 3.5 + (l >= 6 ? 2 : 0);
      const slow = l >= 7 ? 0.4 : 0;
      const aim = game.aimAngle();
      for (let i = 0; i < count; i++) {
        const t = game.nearestEnemy(p.x, p.y, 440);
        const tx = t ? t.x + rand(-30, 30) : p.x + Math.cos(aim) * 170 + rand(-30, 30);
        const ty = t ? t.y + rand(-30, 30) : p.y + Math.sin(aim) * 170 + rand(-30, 30);
        game.spawnZone(tx, ty, radius, dps, life, '#a6e22e', slow);
      }
      Audio2.blip(180, 0.18, 'sawtooth', 0.12, -80);
    },
  },

  // -- Prism Cross: rotating beams that fan out around you. -----------------
  prism: {
    id: 'prism', name: 'Prism Cross', icon: '✛', color: '#ff86c8', maxLevel: 8,
    desc(l) {
      return [
        'Fire light in four rotating directions.',
        '+25% damage.', 'Beams pierce +1.', 'Rotates faster.',
        '+30% damage.', '+4 diagonal beams.', 'Beams pierce more.',
        'Blinding prismatic burst.',
      ][l - 1] || 'Maxed.';
    },
    cooldown(l, p) { return cd(1.2 - l * 0.04, p); },
    fire(game, inst) {
      const p = game.player, l = inst.level;
      inst._rot = (inst._rot || 0) + 0.5 + (l >= 4 ? 0.5 : 0);
      const dirs = l >= 6 ? 8 : 4;
      const dmg = (15 * (1 + (l >= 2 ? 0.25 : 0) + (l >= 5 ? 0.30 : 0))) * p.might;
      const pierce = 1 + (l >= 3 ? 1 : 0) + (l >= 7 ? 2 : 0) + p.bonusPierce;
      for (let i = 0; i < dirs; i++) {
        const ang = inst._rot + (i / dirs) * TAU;
        game.spawnProjectile({
          x: p.x, y: p.y, angle: ang, speed: 400 * p.projSpeed,
          damage: dmg, radius: 6 * p.area, pierce, life: 1.2,
          color: '#ffd0ec', glow: '#ff86c8', kb: 60,
        });
      }
      Audio2.blip(680, 0.1, 'square', 0.1, 160);
    },
  },
};

const WEAPON_LIST = Object.values(WEAPONS);
function getWeapon(id) { return WEAPONS[id]; }
