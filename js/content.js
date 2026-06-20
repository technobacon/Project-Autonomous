// ===========================================================================
// LASTLIGHT - content.js
// Static game content: playable characters and the meta-progression shop.
// ===========================================================================

// ---- Playable characters --------------------------------------------------
// Each character has base stat modifiers and a starting weapon. They feel
// distinct and reward different playstyles / build directions.
const CHARACTERS = [
  {
    id: 'spark', name: 'Spark', color: '#ffd84d',
    desc: 'The original light. Balanced, fires a steady bolt.',
    startWeapon: 'bolt',
    cost: 0,
    stats: { maxHp: 100, speed: 175, might: 1, haste: 1, armor: 0, pickup: 135 },
    blurb: 'A reliable all-rounder. Good for learning the dark.',
  },
  {
    id: 'ember', name: 'Ember', color: '#ff7a3c',
    desc: 'Burns hot. More damage, less health.',
    startWeapon: 'flame',
    cost: 200,
    stats: { maxHp: 80, speed: 170, might: 1.25, haste: 1, armor: 0, pickup: 140 },
    blurb: 'Glass-cannon. Sets the void alight with area burn.',
  },
  {
    id: 'frost', name: 'Frost', color: '#5ad9ff',
    desc: 'Cold and careful. Slows foes, sturdier frame.',
    startWeapon: 'shard',
    cost: 300,
    stats: { maxHp: 120, speed: 165, might: 0.95, haste: 1, armor: 1, pickup: 150 },
    blurb: 'Control specialist. Chilled enemies move slower.',
  },
  {
    id: 'gale', name: 'Gale', color: '#8affc1',
    desc: 'Swift and elusive. Fast, fragile, wide pickup.',
    startWeapon: 'orbit',
    cost: 400,
    stats: { maxHp: 75, speed: 215, might: 1.0, haste: 1.15, armor: 0, pickup: 195 },
    blurb: 'Kiting expert. Outruns everything, collects from afar.',
  },
  {
    id: 'monarch', name: 'Monarch', color: '#c98bff',
    desc: 'Commands the storm. High might, slow fire.',
    startWeapon: 'nova',
    cost: 650,
    stats: { maxHp: 110, speed: 160, might: 1.4, haste: 0.85, armor: 1, pickup: 150 },
    blurb: 'For the patient. Devastating bursts of arcane power.',
  },
  {
    id: 'comet', name: 'Comet', color: '#9affe0',
    desc: 'Hurls returning blades and never stops moving.',
    startWeapon: 'glaive',
    cost: 800,
    stats: { maxHp: 95, speed: 195, might: 1.15, haste: 1.05, armor: 0, pickup: 160 },
    blurb: 'Hit-and-run striker. Blades return — so keep on the move.',
  },
  {
    id: 'astra', name: 'Astra', color: '#cfe3ff',
    desc: 'Impales the dark with piercing lances of light.',
    startWeapon: 'lance',
    cost: 950,
    stats: { maxHp: 95, speed: 180, might: 1.15, haste: 1.0, armor: 0, pickup: 155 },
    blurb: 'A precise striker — line up the horde and run it through.',
  },
  {
    // Secret character — not purchasable; unlocked by the "Into the Void"
    // achievement (survive 15:00). Powerful but high-risk.
    id: 'void', name: 'Void', color: '#ff4dff',
    desc: 'Born of the dark it once fought. Lethal and relentless.',
    startWeapon: 'chain',
    cost: -1, secret: true, achievement: 'eternal',
    stats: { maxHp: 90, speed: 185, might: 1.5, haste: 1.1, armor: 0, pickup: 170 },
    blurb: 'For masters. Immense power, little margin for error.',
  },
];

function getCharacter(id) { return CHARACTERS.find(c => c.id === id) || CHARACTERS[0]; }

// ---- Difficulty / Ascension tiers -----------------------------------------
// Higher tiers scale enemies up and rewards with them. Each unlocks by
// surviving a time threshold on the previous tier.
const DIFFICULTIES = [
  { id: 'normal',    name: 'Normal',    color: '#7affc4', hp: 1.0, dmg: 1.0, speed: 1.0, spawn: 1.0, reward: 1.0,  unlockAt: 0 },
  { id: 'hard',      name: 'Hard',      color: '#ffd84d', hp: 1.5, dmg: 1.25, speed: 1.06, spawn: 1.2, reward: 1.4, unlockAt: 360 },
  { id: 'nightmare', name: 'Nightmare', color: '#ff7a3c', hp: 2.2, dmg: 1.6, speed: 1.12, spawn: 1.45, reward: 2.0, unlockAt: 480 },
  { id: 'abyss',     name: 'Abyss',     color: '#ff4d6d', hp: 3.2, dmg: 2.1, speed: 1.2, spawn: 1.7, reward: 3.0,  unlockAt: 600 },
];
function getDifficulty(i) { return DIFFICULTIES[clamp(i, 0, DIFFICULTIES.length - 1)]; }

// ---- Meta-progression shop (permanent upgrades bought with shards) --------
// Each level multiplies cost. value(level) returns the bonus at a given level.
const META_UPGRADES = [
  { id: 'might',   name: 'Inner Fire',  icon: '🔥', max: 8, baseCost: 30,
    desc: l => `+${l*8}% damage`, value: l => l * 0.08 },
  { id: 'vigor',   name: 'Vitality',    icon: '❤', max: 8, baseCost: 30,
    desc: l => `+${l*12} max health`, value: l => l * 12 },
  { id: 'armor',   name: 'Carapace',    icon: '🛡', max: 5, baseCost: 45,
    desc: l => `-${l} damage taken`, value: l => l },
  { id: 'swift',   name: 'Fleetfoot',   icon: '👟', max: 5, baseCost: 35,
    desc: l => `+${l*4}% move speed`, value: l => l * 0.04 },
  { id: 'haste',   name: 'Quickening',  icon: '⏱', max: 6, baseCost: 40,
    desc: l => `+${l*5}% attack speed`, value: l => l * 0.05 },
  { id: 'blink',   name: 'Quickstep',   icon: '💨', max: 6, baseCost: 35,
    desc: l => `-${l*8}% Blink cooldown`, value: l => l * 0.08 },
  { id: 'echo',    name: 'Echo Step',   icon: '⟫', max: 1, baseCost: 280,
    desc: l => l ? 'A second Blink charge' : 'A second Blink charge', value: l => l },
  { id: 'magnet',  name: 'Lodestone',   icon: '🧲', max: 5, baseCost: 25,
    desc: l => `+${l*15}% pickup range`, value: l => l * 0.15 },
  { id: 'greed',   name: 'Avarice',     icon: '💰', max: 6, baseCost: 40,
    desc: l => `+${l*10}% shards & XP`, value: l => l * 0.10 },
  { id: 'luck',    name: 'Fortune',     icon: '🍀', max: 5, baseCost: 50,
    desc: l => `+${l*6}% better upgrades`, value: l => l * 0.06 },
  { id: 'regen',   name: 'Mending',     icon: '✚', max: 5, baseCost: 45,
    desc: l => `+${(l*0.2).toFixed(1)} hp/s regen`, value: l => l * 0.2 },
  { id: 'revival', name: 'Second Wind', icon: '♻', max: 1, baseCost: 300,
    desc: l => l ? 'Revive once per run' : 'Revive once per run', value: l => l },
];

function metaCost(up, level) {
  // Cost grows ~1.6x per level.
  return Math.round(up.baseCost * Math.pow(1.6, level));
}

function getMeta(id) { return META_UPGRADES.find(u => u.id === id); }
