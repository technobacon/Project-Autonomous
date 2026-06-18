// ===========================================================================
// LASTLIGHT - upgrades.js
// Passive item definitions and the level-up choice generator. Choices mix new
// weapons, weapon upgrades, and passive stat items, weighted by rarity & luck.
// ===========================================================================

const PASSIVES = {
  power:     { id: 'power', name: 'Power Crystal', icon: '◆', color: '#ff6b6b', max: 5, rarity: 1.0,
               desc: l => `+10% damage (lvl ${l})` },
  haste:     { id: 'haste', name: 'Swift Sigil', icon: '⏩', color: '#ffd84d', max: 5, rarity: 1.0,
               desc: l => `+8% attack speed (lvl ${l})` },
  boots:     { id: 'boots', name: 'Wind Boots', icon: '👟', color: '#8affc1', max: 5, rarity: 1.0,
               desc: l => `+8% move speed (lvl ${l})` },
  area:      { id: 'area', name: 'Wide Lens', icon: '⊙', color: '#9ad8ff', max: 5, rarity: 0.9,
               desc: l => `+12% area of effect (lvl ${l})` },
  multishot: { id: 'multishot', name: 'Split Prism', icon: '⋔', color: '#c98bff', max: 3, rarity: 0.6,
               desc: l => `+1 projectile (lvl ${l})` },
  pierce:    { id: 'pierce', name: 'Piercer', icon: '➶', color: '#5ad9ff', max: 3, rarity: 0.7,
               desc: l => `+1 pierce (lvl ${l})` },
  velocity:  { id: 'velocity', name: 'Velocity Rune', icon: '»', color: '#9aff9a', max: 4, rarity: 0.9,
               desc: l => `+15% projectile speed (lvl ${l})` },
  magnet:    { id: 'magnet', name: 'Lodestone', icon: '🧲', color: '#ffb3e6', max: 4, rarity: 1.0,
               desc: l => `+25% pickup range (lvl ${l})` },
  vigor:     { id: 'vigor', name: 'Heart Ember', icon: '❤', color: '#ff5d8f', max: 5, rarity: 1.0,
               desc: l => `+20 max health & heal (lvl ${l})` },
  regen:     { id: 'regen', name: 'Mending Light', icon: '✚', color: '#7affc4', max: 5, rarity: 0.8,
               desc: l => `+0.5 health/sec (lvl ${l})` },
  greed:     { id: 'greed', name: 'Greed Idol', icon: '💰', color: '#ffe14d', max: 4, rarity: 0.7,
               desc: l => `+12% XP gained (lvl ${l})` },
  crit:      { id: 'crit', name: 'Keen Edge', icon: '✶', color: '#ff9d3c', max: 5, rarity: 0.8,
               desc: l => `+8% crit chance (lvl ${l})` },
  guard:     { id: 'guard', name: 'Aegis Plate', icon: '🛡', color: '#9ad8ff', max: 5, rarity: 0.85,
               desc: l => `-1 damage taken (lvl ${l})` },
  luck:      { id: 'luck', name: 'Clover', icon: '🍀', color: '#7affc4', max: 4, rarity: 0.5,
               desc: l => `+6% luck (lvl ${l})` },
};
const PASSIVE_LIST = Object.values(PASSIVES);

// Build a list of upgrade choices for the level-up screen.
// Returns array of choice objects: { kind, id, name, icon, color, desc, level, isNew }
function buildUpgradeChoices(game, n = 3) {
  const p = game.player;
  const pool = [];

  // 1) Upgrade existing weapons. Weapons you've invested in are increasingly
  //    likely to be offered, and near-max weapons are strongly favored so you
  //    can actually finish (and evolve) a build rather than spreading thin.
  for (const inst of p.weapons) {
    const def = inst.def;
    if (inst.level < def.maxLevel) {
      const nearMax = inst.level >= def.maxLevel - 3 ? 2.6 : 0;
      pool.push({
        kind: 'weapon-up', id: def.id, name: def.name, icon: def.icon, color: def.color,
        desc: def.desc(inst.level + 1), level: inst.level + 1, isNew: false,
        weight: 1.4 + inst.level * 0.16 + nearMax,
      });
    }
  }

  // 2) New weapons (if slots remain) — de-emphasised once you hold several.
  if (p.weapons.length < p.maxWeapons) {
    const newW = p.weapons.length >= 4 ? 0.4 : 0.9;
    for (const def of WEAPON_LIST) {
      if (!p.hasWeapon(def.id)) {
        pool.push({
          kind: 'weapon-new', id: def.id, name: def.name, icon: def.icon, color: def.color,
          desc: def.desc(1), level: 1, isNew: true, weight: newW,
        });
      }
    }
  }

  // 3) Upgrade existing passives (slightly favoured — helps reach the level-2
  //    passive an evolution needs).
  for (const def of PASSIVE_LIST) {
    const lvl = p.passives[def.id] || 0;
    if (lvl > 0 && lvl < def.max) {
      pool.push({
        kind: 'passive-up', id: def.id, name: def.name, icon: def.icon, color: def.color,
        desc: def.desc(lvl + 1), level: lvl + 1, isNew: false, weight: def.rarity * 1.15,
      });
    }
  }

  // 4) New passives (if slots remain).
  if (p.passiveCount() < p.maxPassives) {
    for (const def of PASSIVE_LIST) {
      if (!(p.passives[def.id] > 0)) {
        pool.push({
          kind: 'passive-new', id: def.id, name: def.name, icon: def.icon, color: def.color,
          desc: def.desc(1), level: 1, isNew: true, weight: def.rarity * 0.8,
        });
      }
    }
  }

  // Pick n distinct choices, weighted. Luck slightly favors rarer/upgrade picks.
  const luck = p.luck;
  const choices = [];
  const used = new Set();
  let guard = 0;
  while (choices.length < n && pool.length > 0 && guard++ < 200) {
    const c = weightedPick(pool, it => it.weight * (1 + (it.isNew ? 0 : luck)));
    if (!c) break;
    const key = c.kind + ':' + c.id;
    if (!used.has(key)) { used.add(key); choices.push(c); }
    if (used.size >= pool.length) break;
  }

  // Guarantee a path to finishing a build: if you own an un-maxed weapon but
  // none of the rolled choices let you level one, swap in the highest-level
  // owned weapon-up. This makes maxing (and evolving) a weapon reliably
  // achievable for a focused player, without removing variety elsewhere.
  const ownedUps = pool.filter(c => c.kind === 'weapon-up');
  if (ownedUps.length && !choices.some(c => c.kind === 'weapon-up')) {
    ownedUps.sort((a, b) => b.level - a.level);
    if (choices.length >= n) choices[choices.length - 1] = ownedUps[0];
    else choices.push(ownedUps[0]);
  }

  // Always offer a fallback if pool is exhausted (everything maxed).
  if (choices.length === 0) {
    choices.push({ kind: 'gold', id: 'gold', name: 'Hoard', icon: '💰', color: '#ffe14d',
      desc: 'Gain shards & full heal.', level: 0, isNew: false });
  }
  return choices;
}
