# LASTLIGHT — Handoff

A living handoff for whoever (human or future session) picks this up. It captures
**what the game is, how it's built, the rules you must not break, and where to go
next.** Pair it with `README.md` (player-facing) — this doc is builder-facing.

Current head: see `git log` (latest is the `v44` Bombardier milestone). Develop on
branch `claude/compassionate-thompson-r1yo8r`.

---

## 1. What it is

**LASTLIGHT** — a neon survivor-like / bullet-heaven roguelite that runs in the
browser with **no build step, no dependencies, no external assets**. Open
`index.html` and play. All art is procedural (Canvas 2D); all audio is synthesized
(Web Audio). Plain `<script>` tags load `js/*.js` in dependency order.

The project's standing directive: each "continue" ships **one meaningful, tested
milestone** that increases long-term replayability/enjoyment, committed and pushed.

## 2. How to run & test

- **Play:** open `index.html` (or `python3 -m http.server` then visit it).
- **Three headless harnesses** (Node, no deps) concatenate the `js/*.js` files in an
  `order` array and run in a `vm` sandbox with a stubbed canvas/localStorage:
  - `node tools/headless-test.js` — functional suite (**587 assertions, 0 failures**).
    Prints `ALL CHECKS PASSED ✓`. Sections are `sectionTry('name', () => { ok(...) })`.
  - `node tools/determinism-test.js` — **15 checks**. Proves seed → identical run
    regardless of render cadence / audio / shake, and that hazards/vortex differ by
    seed. Prints `ALL DETERMINISM CHECKS PASSED ✓`.
  - `node tools/balance-sim.js` — auto-play dodge-AI, random seed each run, high
    variance (~1:10–3:30 typical). Sanity check, not pass/fail.
- **Before every commit:** all three must be green (functional + determinism), and
  balance should look sane. If you add a `js/` file, add it to the `order` array in
  ALL THREE tools.

## 3. THE determinism invariant (most important rule)

> A given seed must produce a bit-identical run regardless of render cadence, audio,
> screen shake, or any cosmetic state.

Consequences, always:
- **Gameplay RNG** (`RNG` / seeded `mulberry32`: `rand`, `randInt`, `pick`, `chance`,
  `weightedPick`, `shuffle`) is used **only in the simulation path**.
- **Cosmetic randomness** uses `vrand()` / `Math.random()` (render only) — particles,
  damage-number jitter, camera shake, etc.
- **Render-only / meta-only state is never hashed**: toasts, particles, audio,
  camera, history snapshots, coaching tips, mastery cosmetics (trail/halo), Save
  persistence.
- **Input-only mechanics** (the Blink dash, Flux's on-blink buff) never fire in the
  auto-sim/harnesses (they don't press keys), so they can't desync replays. There's a
  test asserting "no phantom dashes without input."
- `tools/determinism-test.js` `hashState()` covers: time/kills/score/level, player
  pos+hp, enemy count/hp/pos sums, gems/projectiles/enemyProjectiles/zones, hazards,
  shrines (+types), player buffs, ward sum, turrets, synergy ids, weapons.length.
  **When you add sim state that affects outcomes, extend `hashState`.**

The Daily Challenge relies on this (everyone shares a date-seed); Trials/Custom use a
fresh seed per attempt but their *rules* are pure data.

## 4. Architecture / file map (`js/`, ~6.6k lines)

- **game.js** — the engine core (largest file): world/camera, entity arrays, the
  fixed-step `update(dt)` and `render()`, spatial grid, collision/combat
  (`dealDamage`, `killEnemy`), spawning helpers, leveling, bosses, biomes+hazards,
  shrines, turrets, HUD. Also holds data tables `BIOMES` and `SHRINE_TYPES`, and the
  `Game` class. Key methods: `start(charId, diffIndex, opts)`, `reset()`,
  `_enemyAI(e, dt, spd)` (the big AI switch), `_applyAffix`, `makeElite/makeChampion`,
  `spawnProjectile/spawnZone/spawnEnemy/spawnPickup/spawnGem`, `nova`, `schedule`,
  `deployTurret/updateTurrets`, `updateHazards/_detonateStrike/_fieldTick/_vortexPull/
  _vortexTick`, `updateShrines/spawnShrine/spawnShrinePack`, `hasRelic`, `_drawHUD`.
- **player.js** — `Player`: movement, `recalc(initHp)` (THE derived-stats function —
  folds char stats + meta + passives + omen mods + synergies + synergy-aware relics +
  timed buffs, via the `_applyStatMods(sm)` helper), weapons firing, XP/level,
  `hurt/heal`, the **Blink** (`dash()` + charge regen), **timed buffs**
  (`addBuff/hasBuff`, `buffs[]`), `applyUpgrade`, draw (incl. mastery trail/halo).
- **enemies.js** — `ENEMY_TYPES`, `AFFIXES` (9), `BOSSES` (4), `BOSS_SCHEDULE`,
  `ENDLESS_BOSSES`, and the `Director` (spawn scheduling, scaling curves, packs,
  rings, champions, gauntlet rounds).
- **weapons.js** — `WEAPONS` (15 base) + `WEAPON_LIST`. Periodic weapons implement
  `cooldown(l,p)` + `fire(game,inst)`; continuous ones implement `tick(game,inst,dt)`.
- **evolutions.js** — `EVOLUTIONS` table (base+passive→into) + `EVOLVED_WEAPONS` (15),
  merged into `WEAPONS` (excluded from normal pools).
- **synergies.js** — `SYNERGIES` (9) set bonuses; `activeSynergies(weapons)` is a pure
  function (evolved forms count as base).
- **modifiers.js** — `defaultMods()` (the neutral mods object & channel list),
  `MODIFIERS`/Omens (17), `buildMods`, `draftOmens`.
- **relics.js** — `RELICS` (21), `applyRelics`, `relicSlots`. Some relics are
  synergy-aware: `apply()` is a no-op and the work is a pure `synergyMods(n)` read in
  `recalc`. Some are read by systems via `game.hasRelic(id)` (e.g. Pilgrim's Charm).
- **mutators.js** — `MUTATORS` (19) for Custom Run; each `apply(m)` + a `weight` that
  feeds `mutatorRewardMul` (payout scales with self-imposed difficulty).
- **trials.js** — `TRIALS` (8) with `req` unlock chain; `trialUnlocked/trialLockedBy`
  (pure predicates), goal/progress helpers.
- **content.js** — `CHARACTERS` (9; some have a `perk` + `perkDesc`), `DIFFICULTIES`,
  `META_UPGRADES` (Sanctuary), cost helpers.
- **upgrades.js** — `PASSIVES` (15) + `buildUpgradeChoices` (the level-up draft).
- **save.js** — `Save` object, localStorage persistence (KEY `lastlight.save.v1`),
  deep-merged `defaults()` on load, mastery/trials/bossLog/history/etc.
- **achievements.js** — `ACHIEVEMENTS` (37), `Achievements.context(game)`,
  `Achievements.check(game)`.
- **ui.js** — all DOM overlay screens (menu, char-select, sanctuary, codex, mastery,
  trials, mutators, help, pause, game-over, options).
- **audio.js** (`Audio2`), **particles.js**, **input.js** (`Input`), **utils.js**
  (math + `RNG` + `vrand`), **main.js** (`App` bootstrap).

### The mods pipeline (how nearly everything composes)
`defaultMods()` → omen overwrites (`buildMods`) **or** trial mods **or**
`buildMutatorMods` → `applyRelics` (combine) → all folded into `game.mods`. Then
`player.recalc()` applies `game.mods`, then synergies, then synergy-aware relics, then
timed buffs, all through `_applyStatMods`. **Channels:** dmgMul, hpMul, speedMul,
hasteMul, areaMul, projSpeedMul, pickupMul, xpMul, shardMul, critChanceBonus,
critDmgBonus, armorBonus, luckBonus, regenBonus, lifesteal, berserk, reviveBonus,
extraChoice, enemy{Hp,Dmg,Speed,Count}Mul, plus addProj/addPierce (synergies/mutators
→ player.bonusProj/bonusPierce). To add a stat lever, add a channel here and apply it
in `recalc`/spawn/combat.

## 5. Current feature state (as of v47)

- **16 weapons / 16 evolutions**, **16 passives**, **12 heroes** (Flux = blink perks,
  Forge = turret perks, Reaper = crit/execute perks, Sentinel = thorns/tank perks;
  Void secret), **10 synergies**,
  **20 omens**, **23 relics** (3 synergy-aware + Pilgrim's Charm), **22 mutators**,
  **40 achievements**.
- **13 enemy archetypes** (incl. Conjurer=summoner, Acolyte=warder/aura,
  Bombardier=lobber), **9 affixes**, **6 bosses** (Warden/Colossus/Maelstrom/Devourer/
  Eclipse/Herald, endless rotation cycles the toughest), **7 biomes** with **4 hazard kinds**
  (strike / field / vortex / beam; verge has none), **5 shrine types**.
- **Modes:** Survival, Gauntlet (boss rush), Daily (date-seeded), Trials (9-node
  unlock chain), Custom Run (stack mutators, scaled payout).
- **Systems:** Blink dash (charge-based, meta upgrades Quickstep/Echo Step, per-hero
  perks), timed buffs, deployable turrets, shrines (risk/reward + buffs), Overdrive
  pickup, lifetime Mastery (ranks + cosmetic prestige), Chronicle (run history),
  per-boss kill log, coaching tutorial.

## 6. Conventions & gotchas

- **Commit trailers (required):**
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` and
  `Claude-Session: <session url>`. Never put the model identifier in committed
  artifacts.
- **Branch:** develop/commit/push only to `claude/compassionate-thompson-r1yo8r`.
  Push with `git push -u origin <branch>`. No PRs unless explicitly asked.
- **New content auto-flows:** weapons → level-up pool + Codex + weapon-mastery;
  enemies → Codex + biome bias; the test for "every boss"/"every omen" iterates the
  tables, so new entries get baseline coverage automatically.
- **Adding a `js/` file:** register it in the `order` array of all three tools AND in
  `index.html` (correct dependency order).
- **Editing files mid-session:** a linter may touch files after you write them; if an
  `Edit` fails with "file modified", re-`Read` then edit.
- **Headless test pitfalls:** assertions assuming "no meta/relic multipliers" break
  because Save persists in-memory across sections — compute expected values from a
  clean baseline run (`new Game(...).start('spark',0,{noRelics:true})`) and compare
  ratios. Avoid `node ... | grep -c "✗" && git commit` (grep exit code breaks the
  `&&`). The `✓` count drifts ±a few run-to-run (an RNG-dependent loop) — gate on
  `ALL CHECKS PASSED` / 0 failures, not the exact count.
- **Balance is high-variance** (random seed). Don't treat one short run as a
  regression — run it a few times.

## 7. Good next milestones (menu, pick one per "continue")

- **Mutator-aware content** — Custom Run has no cross-system interactions yet (e.g. a
  mutator that makes shrines constant, or boss frequency; would need new channels +
  wiring into those systems).
- **Another perk hero** — e.g. a shrine/risk specialist, reusing the `perk` hook
  (perks currently cover dash + turret + stat + execute + thorns; add new perk keys
  read where relevant).
- **More biomes / a new hazard kind** (e.g. a damaging trail, a tracking pillar) —
  the hazard framework (`updateHazards` + `kind` switch + `_drawHazards`) takes new
  kinds cleanly; remember a determinism warp-check for late biomes. *(Done so far:
  strike / field / vortex / beam.)*
- **A new boss** with a distinct mechanic (add to `BOSSES`, a `boss_*` AI case,
  schedule/rotation/gauntlet keys).
- **Weapon/synergy/relic/omen drops** — always-welcome build variety; cheapest are
  omens/mutators/synergies (pure data).
- **Polish/accessibility** — colorblind-safe palette toggle, reduced-flash mode, more
  options.

## 8. Definition of done (every milestone)

1. Implement the feature respecting the determinism invariant.
2. Add headless tests (a dedicated `sectionTry`); extend `hashState` if you added
   hashed sim state; add a determinism check if you added a movement/seed-affecting
   mechanic.
3. `headless` (0 failures) + `determinism` (all pass) green; balance sane.
4. Update `README.md` (and `index.html`/tool `order` if files changed).
5. Commit with the required trailers; push to the feature branch. No PR unless asked.
