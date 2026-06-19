// ===========================================================================
// LASTLIGHT - trials.js
// Trials of Light: curated challenge runs. Each Trial fixes a rule twist (via
// the same `mods` pipeline omens use) and a concrete WIN CONDITION, turning the
// open-ended survival loop into structured, repeatable goals. Clearing one is
// persisted and pays a one-time shard reward (replays pay a small bounty).
//
// Trials force their own configuration (character, difficulty, mods) and ignore
// omens AND relics, so each is a fixed, comparable test of skill. They use a
// fresh random seed per attempt (replayable), so they're never part of the
// determinism harness — but a Trial's RULES are pure data.
// ===========================================================================

const TRIALS = [
  { id: 'kindling', name: 'Kindling', icon: '🕯', color: '#9ad8ff', char: 'spark', diff: 0,
    desc: 'A gentle first test. No twists — just endure.',
    mods: {}, win: { type: 'survive', value: 210 }, reward: 50 },
  { id: 'glass', name: 'Glass Gauntlet', icon: '💥', color: '#ff5d6c', char: 'spark', diff: 0,
    desc: 'Double damage, but a quarter of your health. One mistake ends it.',
    mods: { dmgMul: 2.0, hpMul: 0.25 }, win: { type: 'survive', value: 300 }, reward: 110 },
  { id: 'swarm', name: 'The Swarm', icon: '🐜', color: '#ff9d3c', char: 'spark', diff: 0,
    desc: 'Twice the foes (frailer) and more XP. Cut down 800 of them.',
    mods: { enemyCountMul: 2.0, enemyHpMul: 0.6, xpMul: 1.3 }, win: { type: 'kills', value: 800 }, reward: 110 },
  { id: 'tortoise', name: 'Tortoise', icon: '🐢', color: '#8affc1', char: 'spark', diff: 0,
    desc: 'Sturdy but ponderous — you move at 60% speed and foes are quicker.',
    mods: { speedMul: 0.6, hpMul: 1.6, enemySpeedMul: 1.25 }, win: { type: 'survive', value: 330 }, reward: 120 },
  { id: 'bloodlust', name: 'Bloodlust', icon: '🩸', color: '#e0405a', char: 'ember', diff: 1,
    desc: 'Berserker on Hard: the lower your health, the harder you hit. Survive 6:00.',
    mods: { berserk: true, hpMul: 0.7 }, win: { type: 'survive', value: 360 }, reward: 150 },
  { id: 'ascendant', name: 'Ascendant Trial', icon: '🌑', color: '#c98bff', char: 'spark', diff: 2,
    desc: 'Nightmare difficulty with 50% more foes. Amass a score of 80,000.',
    mods: { enemyCountMul: 1.5 }, win: { type: 'score', value: 80000 }, reward: 200 },
];

function getTrial(id) { return TRIALS.find(t => t.id === id) || null; }

// Current value toward a Trial's objective, for HUD + screens.
function trialCurrent(trial, game) {
  switch (trial.win.type) {
    case 'survive': return game.time;
    case 'kills': return game.kills;
    case 'score': return game.score;
    case 'bosses': return game.bossKills;
    default: return 0;
  }
}

function trialGoalMet(trial, game) { return trialCurrent(trial, game) >= trial.win.value; }

// Short objective label, e.g. "Survive 5:00" or "Slay 800".
function trialGoalText(trial) {
  switch (trial.win.type) {
    case 'survive': return 'Survive ' + formatTime(trial.win.value);
    case 'kills': return 'Slay ' + formatNum(trial.win.value);
    case 'score': return 'Score ' + formatNum(trial.win.value);
    case 'bosses': return 'Fell ' + trial.win.value + ' bosses';
    default: return 'Endure';
  }
}

// HUD progress string, e.g. "2:13 / 5:00" or "340 / 800".
function trialProgressText(trial, game) {
  const cur = trialCurrent(trial, game), tgt = trial.win.value;
  if (trial.win.type === 'survive') return formatTime(Math.min(cur, tgt)) + ' / ' + formatTime(tgt);
  return formatNum(Math.min(cur, tgt)) + ' / ' + formatNum(tgt);
}
