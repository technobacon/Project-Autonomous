// ===========================================================================
// LASTLIGHT - game.js
// The core engine: world, camera, entities, collision, combat resolution,
// spawning helpers, leveling, bosses, and all gameplay rendering + HUD.
// ===========================================================================

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.view = { w: 800, h: 600 };
    this.world = { w: 2600, h: 2600 };
    this.cam = { x: 0, y: 0, sx: 0, sy: 0 }; // sx/sy = shake offset
    this.maxEnemies = 340;

    this.running = false;
    this.state = 'idle'; // idle | playing | levelup | paused | gameover
    this._eid = 1;

    this.reset();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Touch joystick state (mobile).
    this.touch = { active: false, vector: { x: 0, y: 0 }, ox: 0, oy: 0 };
    this._initTouch();

    // Pre-render the starfield to an offscreen canvas (parallax background).
    this._buildStars();
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
    this.pickups = [];
    this.particles = new Particles();
    this.grid = new Map();
    this.time = 0;
    this.kills = 0;
    this.bossKills = 0;
    this.score = 0;
    this.shake_ = { mag: 0, t: 0 };
    this.toasts = [];
    this.activeBoss = null;
    this.pendingLevels = 0;
    // Run-tracking for achievements / scoring.
    this.damageTaken = 0;
    this.firstHitTime = null;
    this.evolvedThisRun = false;
    this.maxWeaponsHeld = 0;
    this.diffIndex = 0;
    this.diff = getDifficulty(0);
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
      const a = rand(0.15, 0.7), r = rand(0.4, 1.6);
      x.globalAlpha = a;
      x.fillStyle = chance(0.15) ? '#9ad8ff' : (chance(0.2) ? '#ffd84d' : '#ffffff');
      x.beginPath();
      x.arc(rand(0, c.width), rand(0, c.height), r, 0, TAU);
      x.fill();
    }
    this.stars = c;
  }

  // ---- Lifecycle --------------------------------------------------------
  start(charId, diffIndex = 0) {
    this.reset();
    this.diffIndex = clamp(diffIndex, 0, DIFFICULTIES.length - 1);
    this.diff = getDifficulty(this.diffIndex);
    const char = getCharacter(charId);
    this.player = new Player(this, char);
    this.cam.x = this.player.x - this.view.w / 2;
    this.cam.y = this.player.y - this.view.h / 2;
    this.director = new Director(this);
    this.running = true;
    this.state = 'playing';
    Audio2.resume();
    Audio2.startMusic(0);
    this.toast(this.diffIndex > 0 ? this.diff.name + ' — survive.' : 'Survive.');
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
    const d = this.diff;
    const hp = def.hp * hpScale * d.hp;
    const e = {
      id: this._eid++, type: def, x, y, vx: 0, vy: 0,
      hp, maxHp: hp, speed: def.speed * d.speed, radius: def.radius,
      damage: def.damage * dmgScale * d.dmg, xp: def.xp, color: def.color, shape: def.shape,
      ai: def.ai, flash: 0, slowAmount: 0, slowTimer: 0, burn: 0, dead: false,
      boss: !!def.boss, shootTimer: rand(0.3, (def.shootCd || 2)), state: 0, stateT: 0,
      spawnT: 0,
    };
    this.enemies.push(e);
    Save.markSeen('enemies', def.id);
    return e;
  }

  spawnProjectile(o) {
    this.projectiles.push({
      x: o.x, y: o.y,
      vx: Math.cos(o.angle) * o.speed, vy: Math.sin(o.angle) * o.speed,
      speed: o.speed, angle: o.angle,
      damage: o.damage, radius: o.radius || 6,
      hitsLeft: (o.pierce || 0) + 1, life: o.life || 1.5,
      color: o.color || '#fff', glow: o.glow || o.color || '#fff',
      seek: !!o.seek, seekStrength: o.seekStrength || 9,
      kb: o.kb || 60, chill: o.chill || 0, chillDur: o.chillDur || 0,
      burn: o.burn || 0, hit: null, trail: [],
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
  dealDamage(e, amount, fromX, fromY, kb = 0) {
    if (e.dead) return;
    const crit = chance(this.player.crit);
    let dmg = amount * (crit ? this.player.critMult : 1);
    e.hp -= dmg;
    e.flash = 0.08;
    const a = angleTo(fromX, fromY, e.x, e.y);
    this.particles.spray(e.x, e.y, a, crit ? 8 : 4, 0.6, { color: e.color, speed: rand(60, 160), life: 0.4 });
    if (crit) this.particles.text(e.x, e.y - e.radius, Math.round(dmg) + '!', { color: '#fff36b', size: 15 });
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

    // XP gems — bosses shower the player with them.
    if (e.boss) {
      this.bossKills++;
      this.activeBoss = null;
      Audio2.bossDie();
      this.shake(16, 0.6);
      this.particles.burst(e.x, e.y, 60, { color: e.color, speed: rand(120, 360), life: rand(0.5, 1.1), size: rand(2, 5) });
      const gemCount = Math.min(40, 12 + Math.floor(e.xp / 6));
      for (let i = 0; i < gemCount; i++) this.spawnGem(e.x + rand(-40, 40), e.y + rand(-40, 40), Math.ceil(e.xp / gemCount));
      this.spawnPickup(e.x, e.y, 'health');
      this.spawnPickup(e.x + 30, e.y, 'chest');
      this.toast('✦ ' + e.type.name + ' destroyed!');
    } else {
      Audio2.enemyDie();
      this.particles.burst(e.x, e.y, e.radius > 18 ? 14 : 7, { color: e.color, speed: rand(60, 220), life: rand(0.3, 0.6) });
      this.spawnGem(e.x, e.y, e.xp);
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
    const luckBonus = chance(this.player.luck) ? 4 : 3; // luck can grant an extra choice

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
    Audio2.bossWarn();
    this.shake(10, 0.5);
    this.toast('☠ ' + e.type.name + ' approaches!');
  }

  onPlayerDeath() {
    this.running = false;
    this.state = 'gameover';
    Audio2.stopMusic();
    Audio2.gameOver();
    this.shake(20, 0.8);
    this.particles.burst(this.player.x, this.player.y, 70, { color: this.player.char.color, speed: rand(100, 400), life: rand(0.6, 1.3) });

    // Compute shards earned and persist progression (difficulty boosts reward).
    const earned = Math.floor((this.time / 8 + this.kills * 0.25 + this.bossKills * 30)
      * this.player.shardMult * this.diff.reward);
    Save.addShards(earned);
    Save.recordRun(this.time, this.score, this.kills, this.bossKills);

    // Ascension: surviving the unlock threshold opens the next difficulty.
    const next = DIFFICULTIES[this.diffIndex + 1];
    let unlockedDiff = null;
    if (next && this.time >= next.unlockAt && Save.data.maxDifficulty < this.diffIndex + 1) {
      Save.unlockDifficulty(this.diffIndex + 1);
      unlockedDiff = next;
    }

    // Achievements (some reward extra shards on top).
    const newly = Achievements.check(this);
    this.lastEarned = earned;
    this.lastNewAchievements = newly;
    this.lastUnlockedDiff = unlockedDiff;
    setTimeout(() => UI.showGameOver(this), 900);
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
  toast(msg) { this.toasts.push({ msg, life: 2.6 }); if (this.toasts.length > 3) this.toasts.shift(); }

  // ---- Update -----------------------------------------------------------
  update(dt) {
    if (!this.running || this.state !== 'playing') return;
    dt = Math.min(dt, 0.05); // clamp huge frame gaps
    this.time += dt;

    this.buildGrid();          // grid first, so weapon queries see current foes
    this.player.update(dt);
    this.director.update(dt);
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updateEnemyProjectiles(dt);
    this.updateNovas(dt);
    this.updateGems(dt);
    this.updatePickups(dt);
    this.particles.update(dt);

    // Transient FX timers.
    for (let i = this.chains.length - 1; i >= 0; i--) { this.chains[i].life -= dt; if (this.chains[i].life <= 0) this.chains.splice(i, 1); }
    for (let i = this.whips.length - 1; i >= 0; i--) { this.whips[i].life -= dt; if (this.whips[i].life <= 0) this.whips.splice(i, 1); }
    for (let i = this.toasts.length - 1; i >= 0; i--) { this.toasts[i].life -= dt; if (this.toasts[i].life <= 0) this.toasts.splice(i, 1); }

    // Camera follow + shake.
    this.cam.x = clamp(this.player.x - this.view.w / 2, 0, Math.max(0, this.world.w - this.view.w));
    this.cam.y = clamp(this.player.y - this.view.h / 2, 0, Math.max(0, this.world.h - this.view.h));
    if (this.shake_.t > 0) {
      this.shake_.t -= dt;
      const k = this.shake_.mag * (this.shake_.t / this.shake_.max);
      this.cam.sx = rand(-k, k); this.cam.sy = rand(-k, k);
      if (this.shake_.t <= 0) { this.shake_.mag = 0; this.cam.sx = this.cam.sy = 0; }
    }

    // Music intensity scales with time + boss presence.
    Audio2.setIntensity(clamp(this.time / 300 + (this.activeBoss ? 0.4 : 0), 0, 1));
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

      // Knockback velocity decay.
      e.x += e.vx * dt; e.y += e.vy * dt;
      e.vx *= (1 - Math.min(1, 8 * dt)); e.vy *= (1 - Math.min(1, 8 * dt));

      const slow = 1 - e.slowAmount;
      const spd = e.speed * slow;

      // AI movement.
      this._enemyAI(e, dt, spd);

      // Light separation to avoid total overlap (keeps a "crowd" feel).
      this._separate(e, cs);

      // Keep within world.
      e.x = clamp(e.x, -200, this.world.w + 200);
      e.y = clamp(e.y, -200, this.world.h + 200);

      // Contact damage to player.
      if (p.alive) {
        const rr = e.radius + p.radius;
        if (dist2(e.x, e.y, p.x, p.y) <= rr * rr) p.hurt(e.damage);
      }
    }
  }

  _enemyAI(e, dt, spd) {
    const p = this.player;
    const ang = angleTo(e.x, e.y, p.x, p.y);
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

      if (pr.life <= 0 ||
          pr.x < -margin || pr.y < -margin ||
          pr.x > this.world.w + margin || pr.y > this.world.h + margin) {
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

    // Background.
    ctx.fillStyle = '#05060d';
    ctx.fillRect(0, 0, this.view.w, this.view.h);
    this._drawBackground(ctx, cam);

    if (this.player) {
      this._drawWorldBounds(ctx, cam);
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
      this._drawHUD(ctx);
    }
  }

  _drawBackground(ctx, cam) {
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

    // Subtle grid.
    ctx.strokeStyle = 'rgba(80,110,200,0.07)';
    ctx.lineWidth = 1;
    const gs = 80;
    const ox = -(cam.x % gs), oy = -(cam.y % gs);
    ctx.beginPath();
    for (let x = ox; x < this.view.w; x += gs) { ctx.moveTo(x, 0); ctx.lineTo(x, this.view.h); }
    for (let y = oy; y < this.view.h; y += gs) { ctx.moveTo(0, y); ctx.lineTo(this.view.w, y); }
    ctx.stroke();
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
      // Charger telegraph flash.
      let fill = e.color;
      if (e.flash > 0) fill = '#ffffff';
      else if (e.ai === 'charger' && e.state === 1) fill = (Math.floor(this.time * 20) % 2 ? '#fff' : e.color);
      else if (e.slowAmount > 0) fill = '#9fe9ff';
      ctx.fillStyle = fill;
      this._shapePath(ctx, e, x, y); ctx.fill();
      // Burn overlay.
      if (e.burn > 0) { ctx.shadowColor = '#ff7a3c'; ctx.fillStyle = 'rgba(255,130,60,0.5)'; this._shapePath(ctx, e, x, y); ctx.fill(); }
      ctx.restore();

      // Boss health bar.
      if (e.boss) {
        const bw = 76, bh = 6;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - bw / 2, y - e.radius - 16, bw, bh);
        ctx.fillStyle = '#ff5d6c'; ctx.fillRect(x - bw / 2, y - e.radius - 16, bw * clamp(e.hp / e.maxHp, 0, 1), bh);
      }
    }
    ctx.restore();
  }

  _drawProjectiles(ctx, cam) {
    ctx.save();
    for (const pr of this.projectiles) {
      const x = pr.x - cam.x, y = pr.y - cam.y;
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
          const jx = lerp(s.x1, s.x2, t) + (i < steps ? rand(-8, 8) : 0);
          const jy = lerp(s.y1, s.y2, t) + (i < steps ? rand(-8, 8) : 0);
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

    // Boss banner.
    if (this.activeBoss && !this.activeBoss.dead) {
      ctx.textAlign = 'center'; ctx.font = 'bold 16px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#ff6b8a';
      ctx.fillText('☠ ' + this.activeBoss.type.name, W / 2, 48);
    }

    // Toasts (center-ish).
    ctx.textAlign = 'center';
    let ty = this.view.h - 120;
    for (const t of this.toasts) {
      ctx.globalAlpha = clamp(t.life, 0, 1);
      ctx.font = 'bold 18px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#ffe9a8'; ctx.shadowBlur = 6; ctx.shadowColor = '#000';
      ctx.fillText(t.msg, W / 2, ty);
      ctx.shadowBlur = 0;
      ty -= 26;
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---- Touch joystick ---------------------------------------------------
  _initTouch() {
    const canvas = this.canvas;
    const onStart = (e) => {
      if (this.state !== 'playing') return;
      const t = e.touches[0]; if (!t) return;
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
