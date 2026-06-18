// ===========================================================================
// LASTLIGHT - save.js
// Persistent meta-progression via localStorage: shards (meta currency),
// permanent upgrades, unlocked characters, high scores, and stats.
// ===========================================================================

const Save = {
  KEY: 'lastlight.save.v1',
  data: null,

  defaults() {
    return {
      shards: 0,                 // meta currency earned per run
      meta: {                    // permanent upgrade levels (id -> level)
        might: 0, vigor: 0, swift: 0, greed: 0, magnet: 0,
        haste: 0, armor: 0, luck: 0, regen: 0, revival: 0,
      },
      unlocked: { spark: true }, // characters unlocked (spark is free)
      bestTime: 0,               // longest survival, seconds
      bestScore: 0,
      runs: 0,
      totalKills: 0,
      bossKills: 0,
      seenIntro: false,
      muted: false,
      musicMuted: false,
    };
  },

  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      this.data = raw ? Object.assign(this.defaults(), JSON.parse(raw)) : this.defaults();
      // Deep-merge nested objects so new keys appear after updates.
      const d = this.defaults();
      this.data.meta = Object.assign(d.meta, this.data.meta || {});
      this.data.unlocked = Object.assign(d.unlocked, this.data.unlocked || {});
    } catch (e) {
      this.data = this.defaults();
    }
    return this.data;
  },

  save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); }
    catch (e) { /* storage may be unavailable; ignore */ }
  },

  addShards(n) { this.data.shards += n; this.save(); },
  spendShards(n) {
    if (this.data.shards < n) return false;
    this.data.shards -= n; this.save(); return true;
  },

  metaLevel(id) { return this.data.meta[id] || 0; },
  buyMeta(id) { this.data.meta[id] = (this.data.meta[id] || 0) + 1; this.save(); },

  unlock(charId) { this.data.unlocked[charId] = true; this.save(); },
  isUnlocked(charId) { return !!this.data.unlocked[charId]; },

  recordRun(time, score, kills, bosses) {
    this.data.runs++;
    this.data.totalKills += kills;
    this.data.bossKills += bosses;
    if (time > this.data.bestTime) this.data.bestTime = time;
    if (score > this.data.bestScore) this.data.bestScore = score;
    this.save();
  },

  reset() {
    this.data = this.defaults();
    this.save();
  },
};
