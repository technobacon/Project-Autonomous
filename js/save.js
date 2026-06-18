// ===========================================================================
// LASTLIGHT - save.js
// Persistent meta-progression via localStorage: shards (meta currency),
// permanent upgrades, unlocked characters, high scores, achievements, the
// codex (discovered enemies/weapons), and options.
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
      achievements: {},          // id -> true
      seen: { enemies: {}, weapons: {} }, // codex discovery
      maxDifficulty: 0,          // highest difficulty tier unlocked (index)
      bestTime: 0,               // longest survival, seconds
      bestScore: 0,
      runs: 0,
      totalKills: 0,
      bossKills: 0,
      totalShardsEarned: 0,
      evolutionsMade: 0,
      seenIntro: false,
      muted: false,
      musicMuted: false,
      shakeOff: false,
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
      this.data.achievements = Object.assign({}, this.data.achievements || {});
      this.data.seen = Object.assign(d.seen, this.data.seen || {});
      this.data.seen.enemies = Object.assign({}, this.data.seen.enemies || {});
      this.data.seen.weapons = Object.assign({}, this.data.seen.weapons || {});
    } catch (e) {
      this.data = this.defaults();
    }
    return this.data;
  },

  save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); }
    catch (e) { /* storage may be unavailable; ignore */ }
  },

  addShards(n) { this.data.shards += n; this.data.totalShardsEarned += n; this.save(); },
  spendShards(n) {
    if (this.data.shards < n) return false;
    this.data.shards -= n; this.save(); return true;
  },

  metaLevel(id) { return this.data.meta[id] || 0; },
  buyMeta(id) { this.data.meta[id] = (this.data.meta[id] || 0) + 1; this.save(); },

  unlock(charId) { this.data.unlocked[charId] = true; this.save(); },
  isUnlocked(charId) { return !!this.data.unlocked[charId]; },

  hasAchievement(id) { return !!this.data.achievements[id]; },
  grantAchievement(id) { this.data.achievements[id] = true; this.save(); },
  achievementCount() { return Object.keys(this.data.achievements).length; },

  markSeen(kind, id) {
    if (!this.data.seen[kind]) this.data.seen[kind] = {};
    if (!this.data.seen[kind][id]) { this.data.seen[kind][id] = true; this.save(); }
  },
  isSeen(kind, id) { return !!(this.data.seen[kind] && this.data.seen[kind][id]); },

  unlockDifficulty(index) {
    if (index > this.data.maxDifficulty) { this.data.maxDifficulty = index; this.save(); }
  },

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
