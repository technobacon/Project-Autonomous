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

    // Blink dash: a short, skill-based reposition with brief i-frames, on a
    // recharging charge system. Input-triggered only (never fired by the
    // auto-sim), so it adds agency without affecting the deterministic harnesses.
    // dashCdMax and dashMaxCharges are (re)derived from meta upgrades in recalc.
    this.dashCd = 0;            // time until the next charge regenerates
    this.dashCdMax = 3.5;       // base recharge time (Quickstep meta reduces it)
    this.dashMaxCharges = 1;    // max stored charges (Echo Step meta adds one)
    this.dashCharges = 1;       // current stored charges
    this.dashDist = 155;
    this.dashIFrames = 0.3;
    this._dashFx = 0;           // render-only afterimage timer
    this._dashGhosts = [];      // render-only blink endpoints

    // Mastery cosmetics (set at run start from lifetime rank). Purely visual —
    // never read by the simulation, so they can't affect fairness/determinism.
    this.masteryRank = 0;     // rank index of this hero (0 = Untrained)
    this.masteryTitle = '';   // rank name, shown in the HUD / game over
    this._trail = [];         // recent positions for the cosmetic trail (render-only)

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

    // Blink tuning from the Sanctuary: Quickstep trims the recharge time,
    // Echo Step grants an extra charge. (Capped reduction keeps it sane.)
    this.dashCdMax = 3.5 * (1 - Math.min(0.6, m('blink')));
    this.dashMaxCharges = 1 + m('echo');

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

    // Weapon synergies (set bonuses). A pure function of the current arsenal —
    // no RNG, never persisted — so it's deterministic and Daily-fair. Applied
    // after omens; deliberately excludes max-HP to keep recalc heal-safe.
    this.synergies = (typeof activeSynergies === 'function') ? activeSynergies(this.weapons) : [];
    for (const s of this.synergies) {
      const sm = s.mods;
      if (sm.dmgMul) this.might *= sm.dmgMul;
      if (sm.hasteMul) this.haste *= sm.hasteMul;
      if (sm.speedMul) this.speed *= sm.speedMul;
      if (sm.areaMul) this.area *= sm.areaMul;
      if (sm.projSpeedMul) this.projSpeed *= sm.projSpeedMul;
      if (sm.pickupMul) this.pickupRange *= sm.pickupMul;
      if (sm.xpMul) this.xpMult *= sm.xpMul;
      if (sm.critChanceBonus) this.crit += sm.critChanceBonus;
      if (sm.critDmgBonus) this.critMult += sm.critDmgBonus;
      if (sm.armorBonus) this.armor += sm.armorBonus;
      if (sm.addProj) this.bonusProj += sm.addProj;
      if (sm.addPierce) this.bonusPierce += sm.addPierce;
      if (sm.regenBonus) this.regen += sm.regenBonus;
    }

    if (initHp) {
      this.maxHp = newMax; this.hp = newMax;
      this.revives = m('revival') + (mod.reviveBonus || 0);
      this.dashCharges = this.dashMaxCharges;
    } else {
      this.maxHp = newMax;
      if (this.dashCharges > this.dashMaxCharges) this.dashCharges = this.dashMaxCharges;
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
      case 'weapon-new': {
        const before = this._synergyIdSet();
        this.addWeapon(choice.id);
        this.recalc();                 // a new weapon may complete a synergy
        this._announceNewSynergies(before);
        break;
      }
      case 'weapon-up': { const w = this.weapon(choice.id); if (w) w.level++; break; }
      case 'evolve': {
        const idx = this.weapons.findIndex(w => w.def.id === choice.baseId);
        if (idx >= 0) this.weapons.splice(idx, 1);
        this.weapons.push({ def: getWeapon(choice.id), level: 1, timer: 0 });
        Save.markSeen('weapons', choice.id);
        this.recalc();                 // keep synergy bonuses applied post-evolve
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

  // Currently-active synergy ids (recalc keeps this.synergies fresh).
  _synergyIdSet() { return new Set((this.synergies || []).map(s => s.id)); }

  // Toast any synergy that just became active (cosmetic; toasts aren't part of
  // hashed sim state, so this never affects determinism).
  _announceNewSynergies(beforeSet) {
    for (const s of (this.synergies || [])) {
      if (!beforeSet.has(s.id)) this.game.toast(s.icon + ' ' + s.name + ' synergy!', s.color, 3.4);
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

    // Blink dash. Triggered by Space/Shift on keyboard or a double-tap on touch
    // (queued on the game). Direction follows current/last movement.
    if (this.dashCharges < this.dashMaxCharges) {
      this.dashCd -= dt;
      if (this.dashCd <= 0) {
        this.dashCharges++;
        this.dashCd = this.dashCharges < this.dashMaxCharges ? this.dashCdMax : 0;
      }
    } else {
      this.dashCd = 0;
    }
    if (this._dashFx > 0) this._dashFx -= dt;
    const wantDash = (typeof Input !== 'undefined' && Input.justPressed && Input.justPressed('space', 'shift')) ||
      (this.game._consumeDashRequest && this.game._consumeDashRequest());
    if (wantDash) this.dash();

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

  // Blink: instantly reposition along the move direction, with i-frames. Returns
  // true if it fired (off cooldown + alive). Deterministic given inputs.
  dash() {
    if (!this.alive || this.dashCharges <= 0) return false;
    let dx = this.moveDir.x, dy = this.moveDir.y;
    const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const fromX = this.x, fromY = this.y;
    this.x = clamp(this.x + dx * this.dashDist, this.radius, this.game.world.w - this.radius);
    this.y = clamp(this.y + dy * this.dashDist, this.radius, this.game.world.h - this.radius);
    this.dashCharges--;
    if (this.dashCd <= 0) this.dashCd = this.dashCdMax;   // begin regen if idle
    this.invuln = Math.max(this.invuln, this.dashIFrames);
    this._dashFx = 0.28;
    this._dashGhosts = [{ x: fromX, y: fromY }, { x: this.x, y: this.y }];
    if (typeof Audio2 !== 'undefined' && Audio2.dash) Audio2.dash();
    if (this.game.particles) this.game.particles.burst(fromX, fromY, 12, { color: this.char.color, speed: vrand(60, 180), life: vrand(0.2, 0.5) });
    return true;
  }

  draw(ctx, cam) {
    const x = this.x - cam.x, y = this.y - cam.y;
    ctx.save();

    // Blink afterimage: a fading streak between the two endpoints (render-only).
    if (this._dashFx > 0 && this._dashGhosts.length === 2) {
      const a = this._dashGhosts[0], b = this._dashGhosts[1];
      const f = clamp(this._dashFx / 0.28, 0, 1);
      ctx.save();
      ctx.globalAlpha = f * 0.5;
      ctx.strokeStyle = this.char.color; ctx.lineWidth = this.radius * 1.4;
      ctx.lineCap = 'round'; ctx.shadowBlur = 16; ctx.shadowColor = this.char.color;
      ctx.beginPath(); ctx.moveTo(a.x - cam.x, a.y - cam.y); ctx.lineTo(b.x - cam.x, b.y - cam.y); ctx.stroke();
      ctx.restore();
    }

    // Mastery trail (cosmetic prestige for Veteran+ heroes). Render-only: the
    // position buffer lives outside the simulation and is never hashed.
    if (this.masteryRank >= 3 && (!Save.data || Save.data.trailFx !== false)) {
      const maxLen = this.masteryRank >= 4 ? 20 : 13;
      this._trail.push({ x: this.x, y: this.y });
      if (this._trail.length > maxLen) this._trail.shift();
      for (let i = 0; i < this._trail.length - 1; i++) {
        const t = this._trail[i];
        const f = i / this._trail.length;
        ctx.globalAlpha = f * (this.masteryRank >= 4 ? 0.5 : 0.35);
        ctx.fillStyle = this.char.color;
        ctx.beginPath(); ctx.arc(t.x - cam.x, t.y - cam.y, this.radius * (0.25 + 0.55 * f), 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

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

    // Player body — glowing orb in the character color. High mastery brightens
    // the aura, and an Ascendant hero wears a faint halo ring (cosmetic only).
    const flashing = this.invuln > 0 && Math.floor(this.game.time * 20) % 2 === 0;
    const col = this.hitFlash > 0 ? '#ffffff' : this.char.color;
    if (this.masteryRank >= 5) {
      ctx.globalAlpha = 0.5 + 0.18 * Math.sin(this.game.time * 3);
      ctx.strokeStyle = this.char.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, this.radius + 7, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = flashing ? 0.45 : 1;
    ctx.shadowBlur = 22 + (this.masteryRank >= 4 ? 12 : 0); ctx.shadowColor = this.char.color;
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
