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
      relics: {},                // unlocked relic ids (id -> true)
      equipped: [],              // currently-equipped relic ids (loadout)
      dailyBest: {},             // 'YYYY-MM-DD' -> { time, score }
      achievements: {},          // id -> true
      seen: { enemies: {}, weapons: {} }, // codex discovery
      maxDifficulty: 0,          // highest difficulty tier unlocked (index)
      bestTime: 0,               // longest survival, seconds
      bestScore: 0,
      gauntletBest: { rounds: 0, score: 0 }, // boss-rush record
      runs: 0,
      totalKills: 0,
      bossKills: 0,
      totalShardsEarned: 0,
      evolutionsMade: 0,
      seenIntro: false,
      muted: false,
      musicMuted: false,
      shakeOff: false,
      dmgNumbers: true,          // floating damage numbers (game-feel)
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
      this.data.relics = Object.assign({}, this.data.relics || {});
      this.data.equipped = Array.isArray(this.data.equipped) ? this.data.equipped : [];
      this.data.dailyBest = Object.assign({}, this.data.dailyBest || {});
      this.data.gauntletBest = Object.assign(d.gauntletBest, this.data.gauntletBest || {});
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

  // ---- Relics --------------------------------------------------------------
  isRelicUnlocked(id) { return !!this.data.relics[id]; },
  relicCount() { return Object.keys(this.data.relics).length; },
  unlockRelic(id) { this.data.relics[id] = true; this.save(); },
  relicSlotCount() { return relicSlots(this.relicCount()); },
  isEquipped(id) { return this.data.equipped.indexOf(id) >= 0; },
  equippedRelics() {
    // Filter to still-unlocked, valid ids and cap at the current slot count.
    return this.data.equipped.filter(id => this.isRelicUnlocked(id)).slice(0, this.relicSlotCount());
  },
  // Toggle a relic in/out of the loadout. Returns true if now equipped.
  toggleEquip(id) {
    if (!this.isRelicUnlocked(id)) return false;
    const i = this.data.equipped.indexOf(id);
    if (i >= 0) { this.data.equipped.splice(i, 1); this.save(); return false; }
    if (this.data.equipped.length >= this.relicSlotCount()) return this.isEquipped(id); // full
    this.data.equipped.push(id); this.save(); return true;
  },

  hasAchievement(id) { return !!this.data.achievements[id]; },
  grantAchievement(id) { this.data.achievements[id] = true; this.save(); },
  achievementCount() { return Object.keys(this.data.achievements).length; },

  markSeen(kind, id) {
    if (!this.data.seen[kind]) this.data.seen[kind] = {};
    if (!this.data.seen[kind][id]) { this.data.seen[kind][id] = true; this.save(); }
  },
  isSeen(kind, id) { return !!(this.data.seen[kind] && this.data.seen[kind][id]); },

  getDailyBest(date) { return this.data.dailyBest[date] || null; },
  recordDaily(date, time, score) {
    const prev = this.data.dailyBest[date];
    const isNew = !prev || score > prev.score;
    if (isNew) { this.data.dailyBest[date] = { time, score }; this.save(); }
    return { best: this.data.dailyBest[date], isNew };
  },

  recordGauntlet(rounds, score) {
    const prev = this.data.gauntletBest || { rounds: 0, score: 0 };
    const isNew = rounds > prev.rounds || (rounds === prev.rounds && score > prev.score);
    if (isNew) { this.data.gauntletBest = { rounds, score }; this.save(); }
    return { best: this.data.gauntletBest, isNew };
  },

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
