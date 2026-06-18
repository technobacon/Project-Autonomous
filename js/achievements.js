// ===========================================================================
// LASTLIGHT - achievements.js
// Persistent goals that grant shard rewards (and unlock the secret character).
// Evaluated both live (so evolutions/arsenal pop mid-run) and at game over.
// ===========================================================================

const ACHIEVEMENTS = [
  { id: 'first_light',  icon: '✦', name: 'First Light',        desc: 'Finish your first run.',                 reward: 20,  check: c => c.save.runs >= 1 },
  { id: 'boss_hunter',  icon: '☠', name: 'Boss Hunter',        desc: 'Defeat your first boss.',                reward: 25,  check: c => c.save.bossKills >= 1 },
  { id: 'survivor',     icon: '⏳', name: 'Survivor',           desc: 'Survive 5 minutes.',                     reward: 30,  check: c => c.time >= 300 },
  { id: 'endurance',    icon: '⌛', name: 'Endurance',          desc: 'Survive 10 minutes.',                    reward: 60,  check: c => c.time >= 600 },
  { id: 'eternal',      icon: '♾', name: 'Into the Void',       desc: 'Survive 15 minutes. Unlocks Void.',      reward: 120, check: c => c.time >= 900 },
  { id: 'slayer',       icon: '⚔', name: 'Slayer',             desc: 'Defeat 500 foes in one run.',            reward: 30,  check: c => c.kills >= 500 },
  { id: 'exterminator', icon: '🗡', name: 'Exterminator',       desc: 'Defeat 1500 foes in one run.',           reward: 60,  check: c => c.kills >= 1500 },
  { id: 'genocide',     icon: '💀', name: 'Light the Dark',     desc: 'Defeat 5000 foes total.',                reward: 50,  check: c => c.save.totalKills >= 5000 },
  { id: 'boss_slayer',  icon: '👑', name: 'Boss Slayer',        desc: 'Defeat 3 bosses in one run.',            reward: 50,  check: c => c.bossKills >= 3 },
  { id: 'evolved',      icon: '🧬', name: 'Transcendence',      desc: 'Evolve a weapon.',                       reward: 40,  check: c => c.evolved },
  { id: 'arsenal',      icon: '🎒', name: 'Full Arsenal',       desc: 'Wield 6 weapons at once.',               reward: 30,  check: c => c.maxWeapons >= 6 },
  { id: 'untouchable',  icon: '🛡', name: 'Untouchable',        desc: 'Reach 3:00 without taking damage.',      reward: 50,  check: c => c.firstHitTime >= 180 },
  { id: 'flawless',     icon: '💠', name: 'Flawless',           desc: 'Reach 5:00 without taking damage.',      reward: 100, check: c => c.firstHitTime >= 300 },
  { id: 'power',        icon: '⚡', name: 'Power Overwhelming',  desc: 'Reach level 30 in a run.',               reward: 40,  check: c => c.level >= 30 },
  { id: 'high_roller',  icon: '✨', name: 'High Roller',         desc: 'Score 100,000 in a run.',                reward: 50,  check: c => c.score >= 100000 },
  { id: 'wealthy',      icon: '💰', name: 'Hoarder',            desc: 'Earn 1000 shards in total.',             reward: 0,   check: c => c.save.totalShardsEarned >= 1000 },
  { id: 'ascendant',    icon: '🔥', name: 'Ascendant',          desc: 'Reach 8:00 on Nightmare or harder.',     reward: 100, check: c => c.difficultyIndex >= 2 && c.time >= 480 },
  { id: 'abyssal',      icon: '🌑', name: 'Abyssal',            desc: 'Survive 5:00 in the Abyss.',             reward: 150, check: c => c.difficultyIndex >= 3 && c.time >= 300 },
  { id: 'roster',       icon: '🌟', name: 'The Five',           desc: 'Unlock every standard character.',       reward: 50,  check: c => c.baseCharsUnlocked >= 5 },
  { id: 'archivist',    icon: '📖', name: 'Archivist',          desc: 'Discover every foe in the Codex.',       reward: 40,  check: c => c.enemiesSeen },
  { id: 'omened',       icon: '🎴', name: 'Fate Sealed',         desc: 'Reach 5:00 with an Omen active.',        reward: 40,  check: c => c.omen && c.time >= 300 },
  { id: 'cursed_glory', icon: '🩸', name: 'Cursed Glory',        desc: 'Reach 8:00 with the Berserker Omen.',    reward: 80,  check: c => c.omenId === 'berserk' && c.time >= 480 },
];

function getAchievement(id) { return ACHIEVEMENTS.find(a => a.id === id); }

const Achievements = {
  // Build the evaluation context from the current run (game may be null).
  context(game) {
    const s = Save.data;
    return {
      time: game ? game.time : 0,
      kills: game ? game.kills : 0,
      bossKills: game ? game.bossKills : 0,
      level: game && game.player ? game.player.level : 0,
      score: game ? game.score : 0,
      maxWeapons: game && game.player ? game.player.weapons.length : 0,
      evolved: game ? !!game.evolvedThisRun : false,
      firstHitTime: game ? (game.firstHitTime == null ? Infinity : game.firstHitTime) : 0,
      difficultyIndex: game ? (game.diffIndex || 0) : 0,
      omen: game ? !!game.omen : false,
      omenId: game && game.omen ? game.omen.id : null,
      save: s,
      baseCharsUnlocked: CHARACTERS.filter(c => !c.secret && Save.isUnlocked(c.id)).length,
      enemiesSeen: Object.keys(ENEMY_TYPES).every(k => Save.isSeen('enemies', k)),
    };
  },

  // Unlock any newly-met achievements; return the list (for toasts/announce).
  check(game) {
    const ctx = this.context(game);
    const newly = [];
    for (const a of ACHIEVEMENTS) {
      if (Save.hasAchievement(a.id)) continue;
      let met = false;
      try { met = a.check(ctx); } catch (e) { met = false; }
      if (met) {
        Save.grantAchievement(a.id);
        if (a.reward) Save.addShards(a.reward);
        newly.push(a);
      }
    }
    return newly;
  },
};
