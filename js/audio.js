// ===========================================================================
// LASTLIGHT - audio.js
// All sound is synthesized at runtime via the Web Audio API — no asset files.
// Includes a small procedural music engine (an evolving minor-key arpeggio).
// ===========================================================================

const Audio2 = {
  ctx: null,
  master: null,
  sfxGain: null,
  musicGain: null,
  enabled: true,
  muted: false,
  musicMuted: false,
  _musicTimer: null,
  _started: false,

  _bossMode: false,
  _intensity: 0,
  _interval: 320,
  _curVol: 0,
  _gates: null,

  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;

      // A master limiter tames the chaos of a bullet-heaven: hundreds of
      // overlapping voices no longer clip or stab the ears at peak moments.
      let out = this.master;
      if (this.ctx.createDynamicsCompressor) {
        const comp = this.ctx.createDynamicsCompressor();
        try {
          comp.threshold.value = -10; comp.knee.value = 22;
          comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.25;
        } catch (e) { /* some params may be read-only in stubs */ }
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
        this.limiter = comp;
      } else {
        this.master.connect(this.ctx.destination);
      }

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.6;
      this.sfxGain.connect(this.master);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.0;
      this.musicGain.connect(this.master);
    } catch (e) {
      this.enabled = false;
      console.warn('Audio disabled:', e);
    }
  },

  // Rate-limit a sound category so combat spam can't flood the graph with
  // oscillators (keeps the mix clean and CPU sane in dense fights).
  _gate(name, ms) {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (!this._gates) this._gates = {};
    if (this._gates[name] && now - this._gates[name] < ms) return false;
    this._gates[name] = now; return true;
  },

  // Browsers require a user gesture before audio can play.
  resume() {
    if (!this.enabled) return;
    this.init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },

  _now() { return this.ctx.currentTime; },

  // Generic synth blip.
  blip(freq, dur, type = 'square', vol = 0.3, sweep = 0) {
    if (!this.enabled || this.muted) return;
    this.init();
    const t = this._now();
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + sweep), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.sfxGain);
    osc.start(t); osc.stop(t + dur + 0.02);
  },

  noise(dur, vol = 0.3, filterFreq = 1000, type = 'lowpass') {
    if (!this.enabled || this.muted) return;
    this.init();
    const t = this._now();
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter); filter.connect(g); g.connect(this.sfxGain);
    src.start(t);
  },

  // ---- Named SFX --------------------------------------------------------
  shoot()      { this.blip(vrand(620, 700), 0.08, 'square', 0.12, -260); },
  shootSoft()  { this.blip(vrand(440, 500), 0.10, 'triangle', 0.10, -120); },
  hit()        { this.blip(vrand(180, 220), 0.06, 'sawtooth', 0.10, -80); },
  enemyDie()   { this.noise(0.12, 0.18, 900, 'lowpass'); this.blip(vrand(120,160), 0.10, 'square', 0.08, -60); },
  bossDie()    { this.noise(0.5, 0.35, 600); this.blip(90, 0.5, 'sawtooth', 0.2, -40); },
  pickup()     { this.blip(880, 0.05, 'sine', 0.12, 220); },
  pickupBig()  { this.blip(660, 0.06, 'sine', 0.14, 440); this.blip(990, 0.08, 'sine', 0.10, 220); },
  levelUp()    { [523,659,784,1046].forEach((f,i)=>setTimeout(()=>this.blip(f,0.18,'triangle',0.18),i*70)); },
  playerHurt() { this.noise(0.18, 0.3, 500); this.blip(140, 0.18, 'sawtooth', 0.18, -60); },
  uiMove()     { this.blip(520, 0.04, 'square', 0.07); },
  uiSelect()   { this.blip(720, 0.07, 'square', 0.12, 120); },
  gameOver()   { [392,330,262,196].forEach((f,i)=>setTimeout(()=>this.blip(f,0.4,'triangle',0.18),i*180)); },
  victory()    { [523,659,784,1046,1318].forEach((f,i)=>setTimeout(()=>this.blip(f,0.3,'triangle',0.2),i*120)); },
  bossWarn()   { this.blip(180, 0.5, 'sawtooth', 0.2, 80); },
  buy()        { this.blip(660, 0.05, 'square', 0.12, 200); this.blip(880, 0.07, 'square', 0.10, 200); },
  deny()       { this.blip(160, 0.15, 'sawtooth', 0.14, -40); },
  // Crisp, rewarding "ping" on a critical hit — gated so a crit storm
  // sparkles rather than screeches.
  crit()       { if (!this._gate('crit', 55)) return; this.blip(vrand(1080, 1240), 0.06, 'triangle', 0.09, 300); },
  // Elites pop richer than fodder; gated so a wave of them stays musical.
  eliteDie()   { if (!this._gate('elite', 50)) return; this.noise(0.16, 0.20, 1100); this.blip(vrand(170, 210), 0.13, 'square', 0.11, -70); this.blip(vrand(330, 380), 0.10, 'triangle', 0.07, 120); },
  // A Champion's arrival sting — a rising, ominous triad over a low rumble.
  championWarn() { [150, 188, 252].forEach((f, i) => setTimeout(() => this.blip(f, 0.45, 'sawtooth', 0.2, 70), i * 110)); this.noise(0.55, 0.16, 420); },

  // ---- Procedural music -------------------------------------------------
  // An evolving minor arpeggio whose tempo, brightness and harmony respond to
  // the run: it quickens and brightens as intensity climbs, and shifts to a
  // darker, driving mode (with a tritone tension layer) while a boss or
  // Champion is on the field.
  startMusic(intensity = 0) {
    if (!this.enabled) return;
    this.init();
    this.stopMusic();
    this._intensity = intensity;
    this._curVol = this.musicMuted ? 0 : 0.15;
    this.musicGain.gain.cancelScheduledValues(this._now());
    this.musicGain.gain.linearRampToValueAtTime(this._curVol, this._now() + 1.5);

    const roots = [110, 110, 130.81, 146.83, 98]; // A2, A2, C3, D3, G2
    const calmScale = [0, 3, 5, 7, 10, 12, 15];   // natural minor feel
    const bossScale = [0, 3, 6, 7, 10, 13, 12];   // adds the b5 tritone (dread)
    let step = 0, rootIdx = 0;
    const semis = (base, s) => base * Math.pow(2, s / 12);

    const tick = () => {
      if (!this.enabled) return;
      const t = this._now();
      const I = this._intensity, boss = this._bossMode;
      const root = roots[rootIdx];
      const scale = boss ? bossScale : calmScale;
      // Bass note (longer/heavier in boss mode) + tritone tension drone.
      if (step % 4 === 0) {
        this._mNote(root / 2, boss ? 2.2 : 1.6, 'triangle', boss ? 0.55 : 0.5, t);
        if (boss) this._mNote(semis(root / 2, 6), 1.4, 'sawtooth', 0.14 + 0.08 * I, t);
        rootIdx = (rootIdx + 1) % roots.length;
      }
      // Lead arpeggio.
      const deg = scale[(step * 2 + (step % 3)) % scale.length];
      this._mNote(semis(root, deg) * 2, 0.5, 'sine', 0.3, t);
      // High sparkle as intensity rises.
      if (I > 0.35 && step % 2 === 0) {
        this._mNote(semis(root, scale[(step + 4) % scale.length]) * 4, 0.25, 'triangle', 0.09 + 0.07 * I, t);
      }
      // Driving inner pulse during boss fights.
      if (boss && step % 2 === 1) {
        this._mNote(semis(root, scale[(step + 2) % scale.length]) * 2, 0.18, 'square', 0.06, t);
      }
      step++;
    };

    this._tickFn = tick;
    this._interval = this._targetInterval();
    tick();
    this._musicTimer = setInterval(tick, this._interval);
    this._started = true;
  },

  // Desired ms-per-step: faster as intensity climbs, faster still under a boss.
  _targetInterval() {
    let iv = 330 - 130 * clamp(this._intensity, 0, 1);
    if (this._bossMode) iv -= 28;
    return Math.max(170, Math.round(iv));
  },

  // Reschedule the beat when the tempo band shifts enough to matter.
  _retempo() {
    if (!this._started || !this._musicTimer) return;
    const want = this._targetInterval();
    if (Math.abs(want - this._interval) >= 18) {
      clearInterval(this._musicTimer);
      this._interval = want;
      this._musicTimer = setInterval(this._tickFn, want);
    }
  },

  _mNote(freq, dur, type, vol, t) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.musicGain);
    osc.start(t); osc.stop(t + dur + 0.05);
  },

  setIntensity(v) {
    this._intensity = clamp(v, 0, 1);
    this._retempo();
    // Swell the music volume with intensity — but only when it has drifted
    // enough to be worth a (debounced) ramp, so this is cheap per-frame.
    if (!this.musicGain || !this._started) return;
    const target = this.musicMuted ? 0 : (0.15 + 0.07 * this._intensity + (this._bossMode ? 0.04 : 0));
    if (Math.abs(target - this._curVol) >= 0.012) {
      this._curVol = target;
      this.musicGain.gain.cancelScheduledValues(this._now());
      this.musicGain.gain.linearRampToValueAtTime(target, this._now() + 0.6);
    }
  },

  // Toggle the darker, driving "boss" arrangement (re-tempos on change).
  setBossMode(on) {
    on = !!on;
    if (on === this._bossMode) return;
    this._bossMode = on;
    this._retempo();
  },

  stopMusic() {
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
    if (this.musicGain) {
      this.musicGain.gain.cancelScheduledValues(this._now());
      this.musicGain.gain.linearRampToValueAtTime(0, this._now() + 0.6);
    }
    this._started = false;
    this._bossMode = false;
    this._curVol = 0;
  },

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  },
  toggleMusic() {
    this.musicMuted = !this.musicMuted;
    if (this.musicGain) {
      const v = this.musicMuted ? 0 : (0.15 + 0.07 * this._intensity + (this._bossMode ? 0.04 : 0));
      this._curVol = v;
      this.musicGain.gain.cancelScheduledValues(this._now());
      this.musicGain.gain.linearRampToValueAtTime(v, this._now() + 0.3);
    }
    return this.musicMuted;
  },
};
