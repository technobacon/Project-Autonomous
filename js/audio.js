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

  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);

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

  // ---- Procedural music -------------------------------------------------
  // A slow, evolving minor arpeggio that grows more intense over time.
  startMusic(intensity = 0) {
    if (!this.enabled) return;
    this.init();
    this.stopMusic();
    this.musicGain.gain.cancelScheduledValues(this._now());
    this.musicGain.gain.linearRampToValueAtTime(this.musicMuted ? 0 : 0.16, this._now() + 1.5);

    // A minor pentatonic-ish set of scale degrees (Hz), low octave roots.
    const roots = [110, 110, 130.81, 146.83, 98]; // A2, A2, C3, D3, G2
    const scale = [0, 3, 5, 7, 10, 12, 15]; // semitone offsets (minor feel)
    let step = 0;
    let rootIdx = 0;

    const semis = (base, s) => base * Math.pow(2, s / 12);

    const tick = () => {
      if (!this.enabled) return;
      const t = this._now();
      const root = roots[rootIdx];
      // Bass note every 4 steps.
      if (step % 4 === 0) {
        this._mNote(root / 2, 1.6, 'triangle', 0.5, t);
        rootIdx = (rootIdx + 1) % roots.length;
      }
      // Arpeggio.
      const deg = scale[(step * 2 + (step % 3)) % scale.length];
      this._mNote(semis(root, deg) * 2, 0.5, 'sine', 0.32, t);
      // Sparse higher sparkle as intensity rises.
      if (this._intensity > 0.4 && step % 2 === 0) {
        this._mNote(semis(root, scale[(step + 4) % scale.length]) * 4, 0.25, 'triangle', 0.12, t);
      }
      step++;
    };

    this._intensity = intensity;
    const interval = 300; // ms per arpeggio step
    tick();
    this._musicTimer = setInterval(tick, interval);
    this._started = true;
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

  setIntensity(v) { this._intensity = clamp(v, 0, 1); },

  stopMusic() {
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
    if (this.musicGain) {
      this.musicGain.gain.cancelScheduledValues(this._now());
      this.musicGain.gain.linearRampToValueAtTime(0, this._now() + 0.6);
    }
    this._started = false;
  },

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  },
  toggleMusic() {
    this.musicMuted = !this.musicMuted;
    if (this.musicGain) {
      this.musicGain.gain.cancelScheduledValues(this._now());
      this.musicGain.gain.linearRampToValueAtTime(this.musicMuted ? 0 : 0.16, this._now() + 0.3);
    }
    return this.musicMuted;
  },
};
