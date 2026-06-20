// ===========================================================================
// LASTLIGHT - save.js
// Persistent meta-progression via localStorage: shards (meta currency),
// permanent upgrades, unlocked characters, high scores, achievements, the
// codex (discovered enemies/weapons), and options.
// ===========================================================================

// ---- Lifetime mastery ranks -------------------------------------------------
// Mastery accrues across every run (meta only — never read by the simulation,
// so it can't influence fairness or determinism). A character earns "mastery
// points" from cumulative kills, time survived, bosses felled and runs played;
// those points climb through named ranks, giving a long-horizon goal for each
// hero beyond a single run's high score.
const MASTERY_RANKS = [
  { name: 'Untrained', min: 0,     color: '#9aa6c4' },
  { name: 'Initiate',  min: 250,   color: '#9ad8ff' },
  { name: 'Adept',     min: 900,   color: '#7affc4' },
  { name: 'Veteran',   min: 2400,  color: '#ffd84d' },
  { name: 'Master',    min: 5500,  color: '#ff9a4d' },
  { name: 'Ascendant', min: 12000, color: '#ff6b8a' },
];
function charMasteryPoints(s) {
  if (!s) return 0;
  return Math.floor((s.kills || 0) + (s.time || 0) / 2 + (s.bosses || 0) * 40 + (s.runs || 0) * 20);
}
function weaponMasteryPoints(s) {
  if (!s) return 0;
  return Math.floor((s.runs || 0) * 12 + (s.evolved || 0) * 80 + (s.maxLevel || 0) * 8);
}
function masteryRank(points) {
  let idx = 0;
  for (let i = 0; i < MASTERY_RANKS.length; i++) if (points >= MASTERY_RANKS[i].min) idx = i;
  const cur = MASTERY_RANKS[idx], next = MASTERY_RANKS[idx + 1] || null;
  const prog = next ? clamp((points - cur.min) / (next.min - cur.min), 0, 1) : 1;
  return { index: idx, name: cur.name, color: cur.color, min: cur.min, next, prog, points };
}

const Save = {
  KEY: 'lastlight.save.v1',
  HISTORY_CAP: 30,           // how many recent runs to keep in the chronicle
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
      history: [],               // recent run snapshots (most-recent first)
      mastery: { chars: {}, weapons: {} }, // lifetime per-character / per-weapon totals
      trials: {},                // completed Trial ids (id -> true)
      runs: 0,
      totalKills: 0,
      bossKills: 0,
      totalShardsEarned: 0,
      evolutionsMade: 0,
      seenIntro: false,
      tips: {},                  // one-time coaching tips already shown (id -> true)
      muted: false,
      musicMuted: false,
      shakeOff: false,
      dmgNumbers: true,          // floating damage numbers (game-feel)
      trailFx: true,             // cosmetic mastery trail (prestige FX)
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
      this.data.history = Array.isArray(this.data.history) ? this.data.history : [];
      this.data.mastery = Object.assign({ chars: {}, weapons: {} }, this.data.mastery || {});
      this.data.mastery.chars = Object.assign({}, this.data.mastery.chars || {});
      this.data.mastery.weapons = Object.assign({}, this.data.mastery.weapons || {});
      this.data.trials = Object.assign({}, this.data.trials || {});
      this.data.tips = Object.assign({}, this.data.tips || {});
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

  // ---- Onboarding / coaching ----------------------------------------------
  tipSeen(id) { return !!this.data.tips[id]; },
  markTip(id) { if (!this.data.tips[id]) { this.data.tips[id] = true; this.save(); } },
  resetTutorial() { this.data.seenIntro = false; this.data.tips = {}; this.save(); },

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

  // Push a rich snapshot of a finished run onto the chronicle (newest first,
  // capped). Used by the Run History screen — purely a record, never read by
  // the simulation, so it can't affect determinism.
  recordHistory(snap) {
    if (!Array.isArray(this.data.history)) this.data.history = [];
    this.data.history.unshift(snap);
    if (this.data.history.length > this.HISTORY_CAP) {
      this.data.history.length = this.HISTORY_CAP;
    }
    this.save();
    return snap;
  },

  // ---- Lifetime mastery ----------------------------------------------------
  charStats(id) { return (this.data.mastery && this.data.mastery.chars[id]) || null; },
  weaponStats(id) { return (this.data.mastery && this.data.mastery.weapons[id]) || null; },
  // Fold a finished run's snapshot into the lifetime mastery totals. Called at
  // game over alongside recordHistory; pure record-keeping (never read by sim).
  recordMastery(snap) {
    if (!this.data.mastery) this.data.mastery = { chars: {}, weapons: {} };
    const m = this.data.mastery;
    const cid = snap.char || 'spark';
    const c = m.chars[cid] || (m.chars[cid] = { runs: 0, kills: 0, time: 0, bosses: 0, bestTime: 0, bestScore: 0 });
    c.runs++;
    c.kills += snap.kills || 0;
    c.time += snap.time || 0;
    c.bosses += snap.bosses || 0;
    if ((snap.time || 0) > c.bestTime) c.bestTime = snap.time || 0;
    if ((snap.score || 0) > c.bestScore) c.bestScore = snap.score || 0;
    for (const w of (snap.weapons || [])) {
      if (!w.id) continue;
      const ws = m.weapons[w.id] || (m.weapons[w.id] = { runs: 0, evolved: 0, maxLevel: 0 });
      ws.runs++;
      if (w.evo) ws.evolved++;
      if ((w.level || 0) > ws.maxLevel) ws.maxLevel = w.level || 0;
    }
    this.save();
  },

  recordRun(time, score, kills, bosses) {
    this.data.runs++;
    this.data.totalKills += kills;
    this.data.bossKills += bosses;
    if (time > this.data.bestTime) this.data.bestTime = time;
    if (score > this.data.bestScore) this.data.bestScore = score;
    this.save();
  },

  // ---- Trials --------------------------------------------------------------
  isTrialDone(id) { return !!(this.data.trials && this.data.trials[id]); },
  completeTrial(id) { if (!this.data.trials) this.data.trials = {}; this.data.trials[id] = true; this.save(); },
  trialsDone() { return this.data.trials ? Object.keys(this.data.trials).length : 0; },
  // A Trial or Custom run feeds run/kill totals (for achievements) but
  // deliberately does NOT touch best time/score, keeping the standard records
  // about standard play.
  recordSideRun(kills, bosses) {
    this.data.runs++;
    this.data.totalKills += kills;
    this.data.bossKills += bosses;
    this.save();
  },

  reset() {
    this.data = this.defaults();
    this.save();
  },
};
