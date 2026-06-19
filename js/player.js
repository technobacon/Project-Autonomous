// ===========================================================================
// LASTLIGHT - player.js
// The player: movement, derived-stat recalculation (character + meta + run
// passives), weapon firing, XP/leveling, and damage handling.
// ===========================================================================

class Player {
  constructor(game, character) {
    this.game = game;
    this.char = character;
    this.x = game.world.w / 2;
    this.y = game.world.h / 2;
    this.vx = 0; this.vy = 0;
    this.radius = 14;
    this.facing = 1;          // last horizontal facing for directional weapons
    this.moveDir = { x: 1, y: 0 };

    this.level = 1;
    this.xp = 0;
    this.xpToNext = this.xpForLevel(1);

    this.weapons = [];
    this.passives = {};       // id -> level
    this.maxWeapons = 6;
    this.maxPassives = 6;

    this.invuln = 0;
    this.hitFlash = 0;
    this.revives = 0;
    this.alive = true;
    this._regenAccum = 0;

    this.recalc(true);
    this.addWeapon(character.startWeapon);
  }

  xpForLevel(lvl) { return Math.floor(5 + lvl * 4 + lvl * lvl * 0.55); }

  // Recompute all derived stats from base character, meta upgrades, passives.
  recalc(initHp = false) {
    const base = this.char.stats;
    const m = (id) => { const u = getMeta(id); return u ? u.value(Save.metaLevel(id)) : 0; };
    const pv = (id) => this.passives[id] || 0;

    // Damage / attack-speed / movement multipliers.
    this.might = base.might * (1 + m('might') + pv('power') * 0.10);
    this.haste = base.haste * (1 + m('haste') + pv('haste') * 0.08);
    this.speed = base.speed * (1 + m('swift') + pv('boots') * 0.08);

    this.area = 1 + pv('area') * 0.12;
    this.projSpeed = 1 + pv('velocity') * 0.15;
    this.bonusProj = pv('multishot');
    this.bonusPierce = pv('pierce');

    this.pickupRange = base.pickup * (1 + m('magnet') + pv('magnet') * 0.25);
    this.xpMult = 1 + m('greed') + pv('greed') * 0.12;
    this.shardMult = 1 + m('greed');
    this.crit = pv('crit') * 0.08;
    this.critMult = 2.0;
    this.armor = base.armor + m('armor') + pv('guard');
    this.luck = m('luck') + pv('luck') * 0.06;
    this.regen = m('regen') + pv('regen') * 0.5;

    let newMax = base.maxHp + m('vigor') + pv('vigor') * 20;

    // Run modifier ("omen") effects.
    const mod = this.game.mods || defaultMods();
    this.might *= mod.dmgMul;
    this.haste *= mod.hasteMul;
    this.speed *= mod.speedMul;
    this.area *= mod.areaMul;
    this.projSpeed *= mod.projSpeedMul;
    this.pickupRange *= mod.pickupMul;
    this.xpMult *= mod.xpMul;
    this.shardMult *= mod.shardMul;
    this.crit += mod.critChanceBonus;
    this.critMult += mod.critDmgBonus;
    this.armor += mod.armorBonus;
    this.luck += mod.luckBonus;
    this.regen += (mod.regenBonus || 0);
    newMax = Math.round(newMax * mod.hpMul);

    if (initHp) {
      this.maxHp = newMax; this.hp = newMax;
      this.revives = m('revival') + (mod.reviveBonus || 0);
    } else {
      this.maxHp = newMax;
    }
  }

  hasWeapon(id) { return this.weapons.some(w => w.def.id === id); }
  weapon(id) { return this.weapons.find(w => w.def.id === id); }
  passiveCount() { return Object.keys(this.passives).filter(k => this.passives[k] > 0).length; }

  addWeapon(id) {
    if (this.hasWeapon(id) || this.weapons.length >= this.maxWeapons) return;
    this.weapons.push({ def: getWeapon(id), level: 1, timer: 0 });
    Save.markSeen('weapons', id);
  }

  // Apply a chosen level-up upgrade.
  applyUpgrade(choice) {
    switch (choice.kind) {
      case 'weapon-new': this.addWeapon(choice.id); break;
      case 'weapon-up': { const w = this.weapon(choice.id); if (w) w.level++; break; }
      case 'evolve': {
        const idx = this.weapons.findIndex(w => w.def.id === choice.baseId);
        if (idx >= 0) this.weapons.splice(idx, 1);
        this.weapons.push({ def: getWeapon(choice.id), level: 1, timer: 0 });
        Save.markSeen('weapons', choice.id);
        this.game.onEvolve(choice);
        break;
      }
      case 'passive-new':
      case 'passive-up': {
        const before = this.maxHp;
        this.passives[choice.id] = (this.passives[choice.id] || 0) + 1;
        this.recalc();
        if (choice.id === 'vigor') this.hp = Math.min(this.maxHp, this.hp + (this.maxHp - before) + 20);
        break;
      }
      case 'gold':
        Save.addShards(15);
        this.hp = this.maxHp;
        this.game.toast('+15 shards');
        break;
    }
  }

  gainXp(amount) {
    this.xp += amount * this.xpMult;
    let leveled = 0;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.xpToNext = this.xpForLevel(this.level);
      leveled++;
    }
    if (leveled > 0) this.game.onLevelUp(leveled);
  }

  hurt(amount) {
    if (this.invuln > 0 || !this.alive) return;
    const dmg = Math.max(1, amount - this.armor);
    this.hp -= dmg;
    if (this.game.firstHitTime == null) this.game.firstHitTime = this.game.time;
    this.game.damageTaken++;
    this.invuln = 0.6;
    this.hitFlash = 0.3;
    this.game.particles.burst(this.x, this.y, 10, { color: '#ff5d6c', speed: rand(80, 200), life: 0.5 });
    this.game.particles.text(this.x, this.y - 20, '-' + Math.round(dmg), { color: '#ff8090', size: 16 });
    this.game.shake(6, 0.2);
    Audio2.playerHurt();
    if (this.hp <= 0) {
      this.hp = 0;
      if (this.revives > 0) {
        this.revives--;
        this.hp = this.maxHp;
        this.invuln = 2.5;
        this.game.nova(this.x, this.y, 260, 60 * this.might, 400, '#7affc4');
        this.game.toast('✦ Second Wind!');
        Audio2.victory();
      } else {
        this.alive = false;
        this.game.onPlayerDeath();
      }
    }
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  update(dt) {
    if (!this.alive) return;
    // Movement.
    let mv = Input.moveVector();
    // Touch virtual joystick (if active) overrides.
    if (this.game.touch && this.game.touch.active) mv = this.game.touch.vector;
    if (mv.x !== 0 || mv.y !== 0) {
      this.moveDir.x = mv.x; this.moveDir.y = mv.y;
      if (mv.x !== 0) this.facing = mv.x > 0 ? 1 : -1;
    }
    this.x += mv.x * this.speed * dt;
    this.y += mv.y * this.speed * dt;
    // Clamp to world bounds.
    this.x = clamp(this.x, this.radius, this.game.world.w - this.radius);
    this.y = clamp(this.y, this.radius, this.game.world.h - this.radius);

    // Timers.
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;

    // Regen.
    if (this.regen > 0 && this.hp < this.maxHp) {
      this._regenAccum += this.regen * dt;
      if (this._regenAccum >= 1) {
        const h = Math.floor(this._regenAccum);
        this.heal(h); this._regenAccum -= h;
      }
    }

    // Weapons.
    for (const inst of this.weapons) {
      if (inst.def.continuous) {
        inst.def.tick(this.game, inst, dt);
      } else {
        inst.timer -= dt;
        if (inst.timer <= 0) {
          inst.timer += inst.def.cooldown(inst.level, this);
          inst.def.fire(this.game, inst);
        }
      }
    }
  }

  draw(ctx, cam) {
    const x = this.x - cam.x, y = this.y - cam.y;
    ctx.save();

    // Continuous-weapon visuals (base + evolved), drawn under the player.
    for (const inst of this.weapons) {
      // Aura (Flame Aura / Inferno).
      if (inst._radius) {
        const r = inst._radius;
        const col = inst._auraColor || '#ff7a3c';
        const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
        g.addColorStop(0, 'rgba(255,140,60,0.28)');
        g.addColorStop(0.7, 'rgba(255,90,40,0.12)');
        g.addColorStop(1, 'rgba(255,90,40,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        // A faint ring edge tinted to the aura's colour.
        ctx.globalAlpha = 0.25; ctx.strokeStyle = col; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      }
      // Orbiting wisps (Orbit Wisps / Halo).
      if (inst._orbs) {
        const col = inst._orbColor || '#caffe0';
        for (const o of inst._orbs) {
          ctx.shadowBlur = 14; ctx.shadowColor = inst.def.color || '#8affc1';
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(o.x - cam.x, o.y - cam.y, o.r, 0, TAU); ctx.fill();
        }
        ctx.shadowBlur = 0;
      }
    }

    // Player body — glowing orb in the character color.
    const flashing = this.invuln > 0 && Math.floor(this.game.time * 20) % 2 === 0;
    const col = this.hitFlash > 0 ? '#ffffff' : this.char.color;
    ctx.globalAlpha = flashing ? 0.45 : 1;
    ctx.shadowBlur = 22; ctx.shadowColor = this.char.color;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y, this.radius, 0, TAU); ctx.fill();
    // Inner core.
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fffbe6';
    ctx.beginPath(); ctx.arc(x, y, this.radius * 0.45, 0, TAU); ctx.fill();
    // Facing indicator.
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + this.moveDir.x * (this.radius + 6), y + this.moveDir.y * (this.radius + 6));
    ctx.stroke();

    ctx.restore();
  }
}
