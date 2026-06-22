// ===========================================================================
// LASTLIGHT - mutators.js
// Custom Run mutators: free-stacking rule twists. Unlike Omens (draft 1 of 3)
// or Trials (fixed authored rules), a Custom Run lets the player toggle ANY
// combination of mutators to craft their own challenge — endless self-directed
// variety. Each mutator folds into the same `mods` object the omen/relic/recalc
// pipeline understands (multiplicative *Mul, additive *Bonus, OR-ed flags).
//
// Every mutator carries a `weight`: positive makes the run HARDER, negative
// EASIER. The summed weight scales the shard payout (harder = more, self-imposed
// difficulty rewarded; easier = less), so a Custom Run can't be cheesed for loot
// and brutal builds feel worth it — a little personal Ascension dial.
// ===========================================================================

const MUTATORS = [
  // ---- Boons (make the run easier → smaller reward) ----
  { id: 'overpower', name: 'Overpower', icon: '💥', color: '#ffd84d', weight: -2,
    desc: '+45% damage.', apply(m) { m.dmgMul *= 1.45; } },
  { id: 'titan', name: 'Titan', icon: '🗿', color: '#9ad8ff', weight: -2,
    desc: '+50% max health.', apply(m) { m.hpMul *= 1.5; } },
  { id: 'fleet', name: 'Fleetfoot', icon: '🪶', color: '#8affc1', weight: -2,
    desc: '+30% move speed.', apply(m) { m.speedMul *= 1.3; } },
  { id: 'rapid', name: 'Rapid Fire', icon: '⏩', color: '#ffe14d', weight: -2,
    desc: '+25% attack speed.', apply(m) { m.hasteMul *= 1.25; } },
  { id: 'bloodthirst', name: 'Bloodthirst', icon: '🦇', color: '#c98bff', weight: -2,
    desc: 'Heal a little on every kill.', apply(m) { m.lifesteal += 0.004; } },
  { id: 'scholar', name: 'Scholar', icon: '📘', color: '#5ad9ff', weight: -1,
    desc: '+35% XP gained.', apply(m) { m.xpMul *= 1.35; } },
  { id: 'fortune', name: 'Fortune', icon: '🍀', color: '#7affc4', weight: -1,
    desc: '+25% luck & +40% pickup range.', apply(m) { m.luckBonus += 0.25; m.pickupMul *= 1.4; } },
  { id: 'warded', name: 'Warded', icon: '🛡', color: '#9ad8ff', weight: -2,
    desc: '+4 armor.', apply(m) { m.armorBonus += 4; } },
  { id: 'sharpshooter', name: 'Sharpshooter', icon: '✶', color: '#ff9d3c', weight: -1,
    desc: '+15% crit chance & +0.8× crit damage.', apply(m) { m.critChanceBonus += 0.15; m.critDmgBonus += 0.8; } },
  { id: 'volley', name: 'Volley', icon: '🎏', color: '#ffd1f5', weight: -2,
    desc: '+1 projectile to every weapon.', apply(m) { m.addProj += 1; } },
  { id: 'piercer', name: 'Piercer', icon: '🔱', color: '#cfe3ff', weight: -1,
    desc: '+2 pierce to every weapon.', apply(m) { m.addPierce += 2; } },
  { id: 'thornplate', name: 'Thornplate', icon: '🌵', color: '#9fd86a', weight: -1,
    desc: 'Reflect 40% of contact damage at attackers.', apply(m) { m.thornsBonus += 0.40; } },
  // ---- System twists (reshape a whole subsystem's cadence, not just a stat) ----
  // Unlike every mutator above (which folds into a player/enemy stat channel),
  // these reach into a game system — shrine spawning, biome hazards, the Champion
  // event — and change how *often* it fires. Pilgrimage is a boon (more optional
  // shrine boons on offer); the other two pile on pressure.
  { id: 'pilgrimage', name: 'Pilgrimage', icon: '⛩', color: '#ffd28a', weight: -1,
    desc: 'Shrines appear far more often.', apply(m) { m.shrineRateMul *= 2.2; } },
  // ---- Banes (make the run harder → bigger reward) ----
  { id: 'glass', name: 'Glass Cannon', icon: '💔', color: '#ff5d6c', weight: 1,
    desc: '+60% damage, but −45% max health.', apply(m) { m.dmgMul *= 1.6; m.hpMul *= 0.55; } },
  { id: 'berserk', name: 'Berserker', icon: '🩸', color: '#e0405a', weight: 1,
    desc: 'The lower your health, the harder you hit.', apply(m) { m.berserk = true; } },
  { id: 'sluggish', name: 'Sluggish', icon: '🐢', color: '#9ad8ff', weight: 2,
    desc: '−25% move speed.', apply(m) { m.speedMul *= 0.75; } },
  { id: 'horde', name: 'Horde', icon: '🐜', color: '#ff9d3c', weight: 2,
    desc: '+50% more foes.', apply(m) { m.enemyCountMul *= 1.5; } },
  { id: 'brutes', name: 'Brutes', icon: '💪', color: '#ff7a3c', weight: 2,
    desc: 'Foes have +45% health.', apply(m) { m.enemyHpMul *= 1.45; } },
  { id: 'vicious', name: 'Vicious', icon: '😡', color: '#ff5d8f', weight: 2,
    desc: 'Foes deal +30% damage.', apply(m) { m.enemyDmgMul *= 1.3; } },
  { id: 'swift_foes', name: 'Swift Foes', icon: '💨', color: '#bfe6ff', weight: 2,
    desc: 'Foes move +25% faster.', apply(m) { m.enemySpeedMul *= 1.25; } },
  { id: 'onslaught', name: 'Onslaught', icon: '☄', color: '#ff5a2c', weight: 3,
    desc: '+40% foes and they hit +20% harder.', apply(m) { m.enemyCountMul *= 1.4; m.enemyDmgMul *= 1.2; } },
  { id: 'frailty', name: 'Frailty', icon: '💀', color: '#ff5d6c', weight: 3,
    desc: '−60% max health.', apply(m) { m.hpMul *= 0.4; } },
  { id: 'juggernauts', name: 'Juggernauts', icon: '👹', color: '#c98bff', weight: 3,
    desc: 'Foes are bigger, tougher and faster.', apply(m) { m.enemyHpMul *= 1.6; m.enemySpeedMul *= 1.18; } },
  { id: 'upheaval', name: 'Upheaval', icon: '🌋', color: '#ff7a3c', weight: 2,
    desc: 'Biome hazards strike far more often.', apply(m) { m.hazardRateMul *= 1.8; } },
  { id: 'warband', name: 'Warband', icon: '👑', color: '#ff5d8f', weight: 3,
    desc: 'Champion mini-bosses hound you far more often.', apply(m) { m.champRateMul *= 2.0; } },
];

const MUTATOR_LIST = MUTATORS.slice();
function getMutator(id) { return MUTATORS.find(x => x.id === id) || null; }

// Fold a set of mutator ids into a fresh mods object.
function buildMutatorMods(ids) {
  const m = defaultMods();
  for (const id of (ids || [])) { const x = getMutator(id); if (x) try { x.apply(m); } catch (e) { /* ignore */ } }
  return m;
}

// Net difficulty of a selection (positive = harder).
function mutatorScore(ids) {
  let s = 0;
  for (const id of (ids || [])) { const x = getMutator(id); if (x) s += x.weight; }
  return s;
}

// Shard payout multiplier from self-imposed difficulty.
function mutatorRewardMul(ids) { return clamp(1 + 0.1 * mutatorScore(ids), 0.25, 2.5); }
