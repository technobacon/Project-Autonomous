// ===========================================================================
// LASTLIGHT - synergies.js
// Weapon synergies (set bonuses). Holding thematically-linked weapons together
// activates a named synergy that grants a modest, always-on bonus — so every
// level-up choice carries strategic weight ("do I take this to complete a set?")
// and a deep arsenal pays off beyond raw stats.
//
// A synergy is a PURE FUNCTION of the weapons currently held (evolved forms
// count as their base weapon), evaluated in player.recalc. There is no RNG and
// nothing here is written to disk, so synergies are fully deterministic and the
// Daily Challenge stays fair — everyone on a seed sees the same opportunities,
// exactly like evolutions.
// ===========================================================================

// Map each evolved weapon back to its base, so an evolved build still counts
// toward the same synergies (built from the evolution table).
const SYNERGY_EVO_TO_BASE = {};
for (const e of (typeof EVOLUTIONS !== 'undefined' ? EVOLUTIONS : [])) {
  SYNERGY_EVO_TO_BASE[e.into] = e.base;
}
function weaponBaseId(id) { return SYNERGY_EVO_TO_BASE[id] || id; }

// Each synergy lists candidate member base-weapon ids and how many distinct
// members must be held (`need`). `mods` uses the same channels as omen mods:
//   *Mul fields multiply; *Bonus / add* fields add. Kept small on purpose.
const SYNERGIES = [
  { id: 'wildfire', name: 'Wildfire', icon: '🔥', color: '#ff7a3c',
    members: ['flame', 'toxin'], need: 2,
    desc: 'Flame + Toxin: burn and blight feed each other. +15% damage, +10% area.',
    mods: { dmgMul: 1.15, areaMul: 1.10 } },
  { id: 'deepfreeze', name: 'Deep Freeze', icon: '❄', color: '#7fe9ff',
    members: ['shard', 'nova'], need: 2,
    desc: 'Frost + Nova: shattering cold detonations. +20% projectile speed, +8% crit.',
    mods: { projSpeedMul: 1.20, critChanceBonus: 0.08 } },
  { id: 'stormcaller', name: 'Stormcaller', icon: '⚡', color: '#9ad8ff',
    members: ['chain', 'bolt'], need: 2,
    desc: 'Bolt + Arc: light calls the lightning. +15% attack speed.',
    mods: { hasteMul: 1.15 } },
  { id: 'bastion', name: 'Bastion', icon: '🛡', color: '#8affc1',
    members: ['orbit', 'whip', 'flame'], need: 2,
    desc: 'Two close-range guardians: a whirling shield of light. +2 armor, +10% area.',
    mods: { armorBonus: 2, areaMul: 1.10 } },
  { id: 'wildhunt', name: 'Wild Hunt', icon: '👻', color: '#b6f0ff',
    members: ['spirit', 'glaive'], need: 2,
    desc: 'Seekers + Glaive: they hunt as one. +1 projectile, +10% projectile speed.',
    mods: { addProj: 1, projSpeedMul: 1.10 } },
  { id: 'refraction', name: 'Refraction', icon: '🌈', color: '#ff86c8',
    members: ['prism', 'nova', 'chain'], need: 2,
    desc: 'Two energy bursts refract into killing crits. +10% crit, +0.5× crit damage.',
    mods: { critChanceBonus: 0.10, critDmgBonus: 0.5 } },
  { id: 'entrench', name: 'Entrench', icon: '🛡', color: '#c0d860',
    members: ['lance', 'caltrops', 'whip'], need: 2,
    desc: 'Hold the line with reach and barbs. +2 armor, lances/whips pierce +1.',
    mods: { armorBonus: 2, addPierce: 1 } },
  { id: 'garrison', name: 'Garrison', icon: '🏰', color: '#9fd8a0',
    members: ['sentry', 'caltrops', 'orbit'], need: 2,
    desc: 'Fortify your ground with turrets, barbs and wardens. +3 armor, +12% area.',
    mods: { armorBonus: 3, areaMul: 1.12 } },
  { id: 'fusillade', name: 'Fusillade', icon: '🎯', color: '#9ad8ff',
    members: ['sentry', 'bolt', 'spirit'], need: 2,
    desc: 'Massed ranged fire from every angle. +1 projectile, +14% projectile speed.',
    mods: { addProj: 1, projSpeedMul: 1.14 } },
];

function getSynergy(id) { return SYNERGIES.find(s => s.id === id) || null; }

// Which synergies are active for a given set of weapon instances?
function activeSynergies(weapons) {
  const have = new Set((weapons || []).map(w => weaponBaseId(w.def.id)));
  const out = [];
  for (const s of SYNERGIES) {
    let n = 0;
    for (const m of s.members) if (have.has(m)) n++;
    if (n >= s.need) out.push(s);
  }
  return out;
}
