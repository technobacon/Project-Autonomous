// ===========================================================================
// LASTLIGHT - audio.js
// All sound is synthesized at runtime via the Web Audio API — no asset files.
// Includes a small music engine that plays Grieg's "In the Hall of the Mountain
// King" (public domain), accelerating with the run's intensity.
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
  // A soft, airy swell when the world shifts into a new biome.
  biomeShift() { [392, 523, 659].forEach((f, i) => setTimeout(() => this.blip(f, 0.5, 'sine', 0.12, 40), i * 90)); },
  // An environmental hazard detonating — a low, gritty thud. Gated so a dense
  // Bloodstorm of strikes stays punchy instead of a wall of noise.
  hazardHit()  { if (!this._gate('hazard', 70)) return; this.noise(0.22, 0.20, 600); this.blip(vrand(90, 120), 0.18, 'square', 0.16, -50); },
  conjure()    { if (!this._gate('conjure', 90)) return; this.blip(vrand(520, 600), 0.10, 'sine', 0.08, 200); this.blip(vrand(780, 880), 0.14, 'triangle', 0.07, 260); },
  dash()       { if (!this._gate('dash', 90)) return; this.noise(0.14, 0.14, 1800, 'highpass'); this.blip(vrand(440, 520), 0.10, 'sine', 0.09, 380); },
  shrine()     { [523, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.3, 'sine', 0.12, 80), i * 70)); },

  // ---- Music ------------------------------------------------------------
  // The lead is Grieg's "In the Hall of the Mountain King" (Peer Gynt, 1875 —
  // public domain): an iconic, instantly-hummable minor call-and-answer theme
  // that famously starts low and creeps, then accelerates to a frenzy. That arc
  // maps perfectly onto our intensity engine — the beat quickens and brightens
  // as the run heats up, and a boss/Champion shifts it darker (a tritone dread
  // drone + a driving off-beat pulse). All synthesized; no audio files.
  startMusic(intensity = 0) {
    if (!this.enabled) return;
    this.init();
    this.stopMusic();
    this._intensity = intensity;
    this._curVol = this.musicMuted ? 0 : 0.15;
    this.musicGain.gain.cancelScheduledValues(this._now());
    this.musicGain.gain.linearRampToValueAtTime(this._curVol, this._now() + 1.5);

    const ROOT = 110;                              // A2 — the minor tonic (bass pedal)
    const semis = (base, s) => base * Math.pow(2, s / 12);
    // The Mountain King theme as semitone offsets from ROOT (natural minor):
    //   call   1  2 b3  4  5 b3  5   — the creeping ascent + turn
    //   answer b6  5 b3  5            — leans on the flat-6 (the "menace")
    //   call   (repeats)
    //   resolve 4 b3  2  1            — settles back to the tonic
    const MELODY = [0, 2, 3, 5, 7, 3, 7,  8, 7, 3, 7,  0, 2, 3, 5, 7, 3, 7,  5, 3, 2, 0];
    const LEN = MELODY.length;
    let mi = 0;

    const tick = () => {
      if (!this.enabled) return;
      const t = this._now();
      const I = this._intensity, boss = this._bossMode;
      const k = mi % LEN;
      const off = MELODY[k];
      const slot = this._interval / 1000;          // seconds per step (for staccato length)
      // Lead — the melody itself, warm mid register, brighter under load.
      this._mNote(semis(ROOT, off) * 2, Math.min(0.5, slot * 0.92), boss ? 'sawtooth' : 'triangle', 0.24 + 0.06 * I, t);
      // An octave-up sparkle doubles the line as the run climbs (the "frenzy").
      if (I > 0.3) this._mNote(semis(ROOT, off) * 4, slot * 0.5, 'triangle', 0.05 + 0.06 * I, t);
      // Bass pedal on the down-beats: tonic under the call, dominant under the
      // answer — the I→V pull that gives the theme its march. Boss adds a
      // tritone dread drone beneath it.
      if (mi % 4 === 0) {
        const onAnswer = k >= 7 && k <= 10;
        const bassDeg = onAnswer ? 7 : 0;
        this._mNote(semis(ROOT, bassDeg) / 2, boss ? 2.0 : 1.5, 'triangle', boss ? 0.5 : 0.42, t);
        if (boss) this._mNote(semis(ROOT, bassDeg + 6) / 2, 1.2, 'sawtooth', 0.12 + 0.08 * I, t);
      }
      // Driving off-beat pulse during boss fights.
      if (boss && mi % 2 === 1) this._mNote(semis(ROOT, off) * 2, slot * 0.45, 'square', 0.06, t);
      mi++;
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
