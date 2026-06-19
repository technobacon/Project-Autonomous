// ===========================================================================
// LASTLIGHT - relics.js
// "Relics" — permanent, equippable run modifiers. Unlike Omens (random, drafted
// per run), relics are UNLOCKED for good (via shards, some gated behind
// achievements) and EQUIPPED deliberately into a limited number of slots before
// a run, so you craft a build identity that persists across runs.
//
// Each relic's `apply(mods)` folds its effect into the same `game.mods` object
// the omens/recalc pipeline already understands — multiplicative for *Mul
// fields, additive for *Bonus fields — so relics stack cleanly with each other
// and with the drafted omen. Relics are deterministic config (applied at run
// start) and never touch render-time randomness.
// ===========================================================================

const RELICS = [
  { id: 'glass_lens', name: 'Glass Lens', icon: '🔻', color: '#ff5d6c', cost: 150,
    desc: '+25% damage, but −15% max health.',
    apply(m) { m.dmgMul *= 1.25; m.hpMul *= 0.85; } },
  { id: 'titan_heart', name: 'Titan Heart', icon: '❤', color: '#ff5d8f', cost: 150,
    desc: '+30% max health.',
    apply(m) { m.hpMul *= 1.30; } },
  { id: 'chrono_core', name: 'Chrono Core', icon: '⏱', color: '#ffd84d', cost: 200,
    desc: '+18% attack speed.',
    apply(m) { m.hasteMul *= 1.18; } },
  { id: 'feathercharm', name: 'Feathercharm', icon: '🪶', color: '#8affc1', cost: 140,
    desc: '+12% move speed.',
    apply(m) { m.speedMul *= 1.12; } },
  { id: 'magnetar', name: 'Magnetar', icon: '🧲', color: '#ffb3e6', cost: 120,
    desc: '+60% pickup range.',
    apply(m) { m.pickupMul *= 1.6; } },
  { id: 'wide_eye', name: 'Wide Eye', icon: '⊙', color: '#9ad8ff', cost: 170,
    desc: '+20% area of effect.',
    apply(m) { m.areaMul *= 1.20; } },
  { id: 'sage_idol', name: 'Sage Idol', icon: '📘', color: '#5ad9ff', cost: 180,
    desc: '+25% XP gained.',
    apply(m) { m.xpMul *= 1.25; } },
  { id: 'hoarders_eye', name: "Hoarder's Eye", icon: '💰', color: '#ffe14d', cost: 180,
    desc: '+35% shards earned.',
    apply(m) { m.shardMul *= 1.35; } },
  { id: 'keenstone', name: 'Keenstone', icon: '✶', color: '#ff9d3c', cost: 200,
    desc: '+12% crit chance & +40% crit damage.',
    apply(m) { m.critChanceBonus += 0.12; m.critDmgBonus += 0.40; } },
  { id: 'aegis_sigil', name: 'Aegis Sigil', icon: '🛡', color: '#9ad8ff', cost: 160,
    desc: '+3 armor.',
    apply(m) { m.armorBonus += 3; } },
  { id: 'mending_root', name: 'Mending Root', icon: '✚', color: '#7affc4', cost: 200,
    desc: '+1.0 health regen / sec.',
    apply(m) { m.regenBonus += 1.0; } },
  { id: 'lucky_clover', name: 'Lucky Clover', icon: '🍀', color: '#7affc4', cost: 220,
    desc: '+12% luck (better upgrade rolls).',
    apply(m) { m.luckBonus += 0.12; } },
  // --- Achievement-gated relics: the long unlock arc -----------------------
  { id: 'vampiric_charm', name: 'Vampiric Charm', icon: '🩸', color: '#e0405a', cost: 250,
    achievement: 'slayer', desc: 'Heal 0.8% of max health on each kill.',
    apply(m) { m.lifesteal += 0.008; } },
  { id: 'berserkers_mark', name: "Berserker's Mark", icon: '⚔', color: '#ff5d6c', cost: 300,
    achievement: 'exterminator', desc: 'The lower your health, the harder you hit.',
    apply(m) { m.berserk = true; } },
  { id: 'champions_crest', name: "Champion's Crest", icon: '⚜', color: '#ffd84d', cost: 350,
    achievement: 'champion_slayer', desc: '+15% damage & +8% attack speed.',
    apply(m) { m.dmgMul *= 1.15; m.hasteMul *= 1.08; } },
  { id: 'phoenix_feather', name: 'Phoenix Feather', icon: '🔥', color: '#ff7a3c', cost: 400,
    achievement: 'boss_slayer', desc: 'Revive once per run with a searing nova.',
    apply(m) { m.reviveBonus += 1; } },
  { id: 'void_shard', name: 'Void Shard', icon: '🌌', color: '#ff4dff', cost: 600,
    achievement: 'eternal', desc: '+22% damage & +12% attack speed — for masters.',
    apply(m) { m.dmgMul *= 1.22; m.hasteMul *= 1.12; } },
];

const RELIC_LIST = RELICS.slice();
function getRelic(id) { return RELICS.find(r => r.id === id) || null; }

// Equip-slot count grows as you collect relics: 2 base, +1 per 4 unlocked, cap 4.
function relicSlots(unlockedCount) {
  return clamp(2 + Math.floor((unlockedCount || 0) / 4), 2, 4);
}

// Fold every equipped relic's effect into a mods object (in place).
function applyRelics(mods, relicIds) {
  if (!relicIds) return mods;
  for (const id of relicIds) {
    const r = getRelic(id);
    if (r) try { r.apply(mods); } catch (e) { /* ignore a malformed relic */ }
  }
  return mods;
}
