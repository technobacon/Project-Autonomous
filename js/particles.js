// ===========================================================================
// LASTLIGHT - particles.js
// Lightweight particle + floating-text system for game juice.
// ===========================================================================

class Particles {
  constructor() {
    this.list = [];
    this.texts = [];
    this.pool = new Pool(() => ({}));
    this.max = 700;
    this.maxTexts = 70;   // cap floating text so big hordes stay readable + fast
  }

  clear() { this.list.length = 0; this.texts.length = 0; }

  spawn(x, y, opts = {}) {
    if (this.list.length >= this.max) return;
    const p = this.pool.obtain();
    p.x = x; p.y = y;
    const a = opts.angle !== undefined ? opts.angle : rand(0, TAU);
    const spd = opts.speed !== undefined ? opts.speed : rand(40, 160);
    p.vx = Math.cos(a) * spd;
    p.vy = Math.sin(a) * spd;
    p.life = p.maxLife = opts.life || rand(0.3, 0.7);
    p.size = opts.size || rand(1.5, 3.5);
    p.color = opts.color || '#fff';
    p.drag = opts.drag !== undefined ? opts.drag : 3;
    p.grav = opts.grav || 0;
    p.glow = opts.glow !== undefined ? opts.glow : true;
    p.shrink = opts.shrink !== undefined ? opts.shrink : true;
    this.list.push(p);
    return p;
  }

  burst(x, y, n, opts = {}) {
    for (let i = 0; i < n; i++) this.spawn(x, y, opts);
  }

  // Directional spray (e.g. blood/sparks from a hit).
  spray(x, y, angle, n, spread, opts = {}) {
    for (let i = 0; i < n; i++) {
      this.spawn(x, y, Object.assign({}, opts, { angle: angle + rand(-spread, spread) }));
    }
  }

  ring(x, y, n, opts = {}) {
    for (let i = 0; i < n; i++) {
      this.spawn(x, y, Object.assign({}, opts, { angle: (i / n) * TAU }));
    }
  }

  text(x, y, str, opts = {}) {
    // Evict the oldest floating text once we hit the cap (keeps the screen
    // legible and rendering cheap when thousands of hits land per second).
    if (this.texts.length >= this.maxTexts) this.texts.shift();
    this.texts.push({
      x, y, str,
      vx: opts.vx !== undefined ? opts.vx : 0,
      vy: opts.vy !== undefined ? opts.vy : -42,
      life: opts.life || 0.9,
      maxLife: opts.life || 0.9,
      color: opts.color || '#fff',
      size: opts.size || 14,
      pop: opts.pop !== undefined ? opts.pop : 1, // peak scale for the spawn pop
    });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) {
        const last = this.list.pop();
        if (i < this.list.length) this.list[i] = last;
        this.pool.recycle(p);
        continue;
      }
      const dragF = 1 - Math.min(1, p.drag * dt);
      p.vx *= dragF; p.vy *= dragF;
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.y += t.vy * dt;
      t.x += t.vx * dt;
      t.vy *= (1 - 1.5 * dt);
      t.vx *= (1 - 3 * dt);
      if (t.life <= 0) this.texts.splice(i, 1);
    }
  }

  draw(ctx, cam) {
    ctx.save();
    for (const p of this.list) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      const sz = p.shrink ? p.size * a : p.size;
      ctx.globalAlpha = a;
      if (p.glow) { ctx.shadowBlur = 8; ctx.shadowColor = p.color; }
      else ctx.shadowBlur = 0;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x - cam.x, p.y - cam.y, sz, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawText(ctx, cam) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const a = clamp(t.life / t.maxLife, 0, 1);
      // Spawn "pop": overshoot then settle over the first ~18% of life.
      const age = 1 - a;
      const grow = age < 0.18 ? clamp(age / 0.18, 0, 1) : 1;
      const scale = (t.pop || 1) * (0.5 + 0.5 * grow) * (age < 0.18 ? (1 + (1 - grow) * 0.25) : 1);
      ctx.globalAlpha = a < 0.35 ? a / 0.35 : 1; // fade only at the tail end
      ctx.font = `bold ${(t.size * scale).toFixed(1)}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillStyle = t.color;
      ctx.shadowBlur = 4; ctx.shadowColor = '#000';
      ctx.fillText(t.str, t.x - cam.x, t.y - cam.y);
    }
    ctx.restore();
  }
}
