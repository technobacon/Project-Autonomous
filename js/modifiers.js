// ===========================================================================
// LASTLIGHT - modifiers.js
// "Omens" — run modifiers drafted at the start of a run (pick 1 of 3, or none).
// Each is a global tweak (usually a strong upside with a tradeoff) that changes
// how a whole run plays, for big run-to-run variety. Effects are pure data
// (a `mods` patch + a couple of behaviour flags) merged into game.mods and read
// by player.recalc / spawning / combat.
// ===========================================================================

// Neutral baseline — every field multiplies/adds into the relevant stat.
function defaultMods() {
  return {
    dmgMul: 1, hpMul: 1, speedMul: 1, hasteMul: 1, areaMul: 1, projSpeedMul: 1,
    pickupMul: 1, xpMul: 1, shardMul: 1,
    critChanceBonus: 0, critDmgBonus: 0, armorBonus: 0, luckBonus: 0,
    enemyHpMul: 1, enemyDmgMul: 1, enemySpeedMul: 1, enemyCountMul: 1,
    berserk: false,   // bonus damage scaling with missing HP
    lifesteal: 0,     // fraction of max HP healed per kill (+1 flat)
    extraChoice: false,
    reviveBonus: 0,   // extra revives (relics)
    regenBonus: 0,    // flat hp/sec regen added (relics)
    addProj: 0,       // bonus projectiles (relics/omens)
    addPierce: 0,     // bonus pierce (relics/omens)
    thornsBonus: 0,   // reflect fraction of contact damage (relics)
  };
}

const MODIFIERS = [
  { id: 'glass', name: 'Glass Cannon', icon: '💥', color: '#ff5d6c',
    desc: '+60% damage, but half max health.',
    mods: { dmgMul: 1.6, hpMul: 0.5 } },
  { id: 'swarm', name: 'Swarm Tide', icon: '🐜', color: '#ff9d3c',
    desc: '+45% more foes, +40% XP & +30% shards, foes are frailer.',
    mods: { enemyCountMul: 1.45, xpMul: 1.4, shardMul: 1.3, enemyHpMul: 0.85 } },
  { id: 'berserk', name: 'Berserker', icon: '🩸', color: '#e0405a',
    desc: 'The lower your health, the harder you hit (up to +100%). Frailer.',
    mods: { berserk: true, hpMul: 0.8 } },
  { id: 'giant', name: 'Colossal', icon: '🗿', color: '#9ad8ff',
    desc: '+60% area & +40% health, but slower.',
    mods: { areaMul: 1.6, hpMul: 1.4, speedMul: 0.8 } },
  { id: 'feather', name: 'Featherweight', icon: '🪶', color: '#8affc1',
    desc: '+40% move speed & pickup, but fragile.',
    mods: { speedMul: 1.4, pickupMul: 1.6, hpMul: 0.7 } },
  { id: 'frenzy', name: 'Frenzy', icon: '⏩', color: '#ffd84d',
    desc: '+35% attack speed, but foes hit harder.',
    mods: { hasteMul: 1.35, enemyDmgMul: 1.25 } },
  { id: 'executioner', name: 'Executioner', icon: '✶', color: '#ff7a3c',
    desc: '+20% crit chance & huge crits, slightly less base damage.',
    mods: { critChanceBonus: 0.20, critDmgBonus: 1.5, dmgMul: 0.9 } },
  { id: 'vampire', name: 'Vampiric', icon: '🦇', color: '#c98bff',
    desc: 'Heal a little on every kill, but thinner skin.',
    mods: { lifesteal: 0.004, armorBonus: -1, hpMul: 0.9 } },
  { id: 'greed', name: 'Greed', icon: '💰', color: '#ffe14d',
    desc: '+80% shards & +20% XP, but foes are tougher.',
    mods: { shardMul: 1.8, xpMul: 1.2, enemyHpMul: 1.25, enemyDmgMul: 1.1 } },
  { id: 'tempo', name: 'Slow Time', icon: '🕰', color: '#7fe9ff',
    desc: 'Foes move 18% slower & you hit 10% harder, but you fire slower.',
    mods: { enemySpeedMul: 0.82, dmgMul: 1.1, hasteMul: 0.85 } },
  { id: 'overcharge', name: 'Overcharge', icon: '⚡', color: '#9ad8ff',
    desc: '+50% projectile speed & +20% damage, but slower fire rate.',
    mods: { projSpeedMul: 1.5, dmgMul: 1.2, hasteMul: 0.85 } },
  { id: 'fortune', name: 'Fortune', icon: '🍀', color: '#7affc4',
    desc: '+30% luck & +50% pickup, but foes are a touch tougher.',
    mods: { luckBonus: 0.30, pickupMul: 1.5, enemyHpMul: 1.1 } },
  { id: 'bulwark', name: 'Bulwark', icon: '🛡', color: '#9ad8ff',
    desc: '+80% health & +3 armor, but slower and less damage.',
    mods: { hpMul: 1.8, armorBonus: 3, speedMul: 0.85, dmgMul: 0.9 } },
  { id: 'abundance', name: 'Abundance', icon: '🎴', color: '#c98bff',
    desc: 'Always get an extra upgrade choice, but +20% more foes.',
    mods: { extraChoice: true, enemyCountMul: 1.2 } },
  { id: 'tinderbox', name: 'Tinderbox', icon: '🔥', color: '#ff7a3c',
    desc: '+30% damage & +20% area, but foes hit harder.',
    mods: { dmgMul: 1.3, areaMul: 1.2, enemyDmgMul: 1.2 } },
  { id: 'phantom', name: 'Phantom', icon: '👻', color: '#b6f0ff',
    desc: '+25% move & +10% attack speed and foes are slower, but you are fragile.',
    mods: { speedMul: 1.25, hasteMul: 1.1, enemySpeedMul: 0.9, hpMul: 0.8 } },
  { id: 'bloodpact', name: 'Blood Pact', icon: '🩸', color: '#e0405a',
    desc: 'Heal on kills and hit harder as you bleed, but very thin skin.',
    mods: { lifesteal: 0.005, berserk: true, hpMul: 0.75 } },
  { id: 'volley', name: 'Volley', icon: '🎏', color: '#ffd1f5',
    desc: '+1 projectile to every weapon, but foes are tougher.',
    mods: { addProj: 1, enemyHpMul: 1.2 } },
  { id: 'lancet', name: 'Lancet', icon: '🔱', color: '#cfe3ff',
    desc: '+2 pierce & +25% projectile speed, but you fire slower.',
    mods: { addPierce: 2, projSpeedMul: 1.25, hasteMul: 0.85 } },
  { id: 'thornward', name: 'Thornward', icon: '🌵', color: '#9fd86a',
    desc: 'Reflect 40% of contact damage & +2 armor, but you hit softer.',
    mods: { thornsBonus: 0.40, armorBonus: 2, dmgMul: 0.85 } },
];

const MODIFIER_LIST = MODIFIERS.slice();
function getModifier(id) { return MODIFIERS.find(m => m.id === id) || null; }

// Build game.mods from an optional chosen omen id.
function buildMods(omenId) {
  const base = defaultMods();
  const m = getModifier(omenId);
  if (m) Object.assign(base, m.mods);
  return base;
}

// Three distinct random omens to draft from (deterministic under the seeded RNG
// when called during a seeded context; here it's pre-run so it uses RNG too).
function draftOmens(n = 3) {
  const pool = MODIFIER_LIST.slice();
  shuffle(pool);
  return pool.slice(0, n);
}
