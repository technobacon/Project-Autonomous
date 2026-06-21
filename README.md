# ✦ LASTLIGHT

**A neon survivor-like roguelite for the browser.**
You are the last spark of light against an endless, encroaching dark. Move,
dodge, and let your light fight for you. Grow stronger every run. Survive as
long as you can.

![play: open index.html](https://img.shields.io/badge/play-open%20index.html-ffd84d) ![no build step](https://img.shields.io/badge/build-none%20required-5ad9ff) ![no assets](https://img.shields.io/badge/assets-100%25%20procedural-7affc4)

---

## ▶ Play it

**No install, no build step, no dependencies.** Just open the game:

- **Locally:** double-click `index.html` (or open it in any modern browser).
- **Hosted:** serve the folder with any static host (GitHub Pages works out of
  the box — set Pages to serve the repo root).
- Optionally, from the project folder: `python3 -m http.server` then visit
  `http://localhost:8000`.

Works on desktop (keyboard) and mobile (drag-to-move).

**New here?** The first launch opens a short, skippable **tutorial**, and your
first run gently **coaches you** through the basics (movement, shards, dodging,
the build loop) with one-time tips. You can replay the walkthrough anytime from
the **Help** screen.

## 🎮 How to play

- **Move** with `WASD` or the **arrow keys** (on touch devices, drag anywhere).
- **Blink** with `Space` or `Shift` (double-tap on touch): a short dash with
  brief invulnerability on a cooldown — punch through a wall of foes or slip out
  of a closing ring. A readiness bar in the HUD glows when it's charged, and the
  Sanctuary can **shorten its cooldown** (*Quickstep*) and grant a **second
  charge** (*Echo Step*) for back-to-back blinks.
- Your **weapons fire automatically** — your only job is positioning and
  survival.
- Defeated foes drop **light shards**. Collect them to **level up** and choose
  an upgrade: a new weapon, a weapon level, or a passive boost.
- **Pause** any time with `Esc` or `P`. During a level-up, press `1`–`4` or
  click a card.
- Survive long enough and **bosses** arrive (3:00, 6:00, 8:00, 10:00, then
  endlessly). Each fights differently — the **Warden** sprays radial volleys,
  the **Colossus** lobs aimed shots and summons adds, the **Maelstrom** weaves an
  ever-rotating *spiral of bolts* punctuated by a full ring-nova, and the
  **Devourer** does it all, faster. They hit hard but drop a flood of XP and
  treasure, and the endless rotation keeps alternating their mechanics.

## ✦ The Sanctuary (meta-progression)

Every run earns **shards** based on how long you survived and how much you
slew. Spend them in the Sanctuary on **permanent upgrades** (damage, health,
attack speed, luck, a second life, and more) and to **unlock new characters**,
each with a distinct starting weapon and playstyle:

| Character | Style | Starting weapon |
|-----------|-------|-----------------|
| **Spark** | Balanced all-rounder | Light Bolt |
| **Ember** | Glass cannon, area burn | Flame Aura |
| **Frost** | Sturdy control, chills foes | Frost Shard |
| **Gale**  | Fast, fragile, far reach | Orbit Wisps |
| **Monarch** | Slow, devastating bursts | Nova Burst |
| **Comet** | Hit-and-run, blades return | Whirling Glaive |
| **Astra** | Precise piercing striker | Light Lance |
| **Flux** | Hyper-mobile, blink-empowered glass | Spirit Seekers |

…plus a secret hero, **Void**, unlocked by surviving 15:00. Each hero also has a
distinct feel, and some carry a **signature perk** — Flux, for instance, is built
around the Blink: an extra charge, a faster recharge, and a damage surge on every
dash. Progress is saved
automatically in your browser (`localStorage`).

## ⚒ Build variety

**14 weapons** — Light Bolt, Frost Shard, Flame Aura, Orbit Wisps, Nova Burst,
Arc Lightning, Spirit Seekers, Light Whip, **Whirling Glaive** (a returning
boomerang), **Toxic Flask** (lingering poison pools), **Prism Cross** (rotating
beams), **Light Lance** (a fast spear that skewers a whole line), **Caltrops**
(scattered ground spikes for zone control), and the **Sentry Turret** (a
deployable, stationary ally that auto-fires at nearby foes — reward good
positioning) — each with 8 levels.
**14 passives** — damage, attack speed, move speed, area, projectiles, pierce,
projectile speed, pickup range, max health, regen, XP gain, crit, armor, luck.

You carry up to **6 weapons** and **6 passives** per run, so every game becomes
a different build. The upgrade pool is weighted and nudged by your **Luck**, and
pairing the right weapons unlocks **synergies** (set bonuses — see below).

## 🧬 Weapon evolutions

Max out a weapon **and** own its paired passive, and the level-up screen offers
a golden **EVOLUTION** — transforming it into a devastating new form:

| Weapon + Passive | becomes |
|---|---|
| Light Bolt + Split Prism | **Starfall** — a storm of homing starlight |
| Frost Shard + Velocity Rune | **Glacier** — a deep-freezing barrage |
| Flame Aura + Power Crystal | **Inferno** — an erupting firestorm |
| Orbit Wisps + Swift Sigil | **Halo** — a ring of swift searing wisps |
| Nova Burst + Wide Lens | **Singularity** — collapses foes, then detonates |
| Arc Lightning + Keen Edge | **Tempest** — arcs through the whole horde |
| Spirit Seekers + Lodestone | **Reaper Swarm** — relentless piercing reapers |
| Light Whip + Piercer | **Eclipse Blade** — encircling sweeping blades |
| Whirling Glaive + Velocity Rune | **Ouroboros** — an eternal ring of returning blades |
| Toxic Flask + Wide Lens | **Pandemic** — a creeping plague that engulfs the field |
| Prism Cross + Split Prism | **Spectrum** — a rotating storm of prismatic beams |
| Light Lance + Piercer | **Sunpiercer** — a volley of lances that run through everything |
| Caltrops + Wide Lens | **Thornfield** — a sprawling ring of barbs that grips the horde |
| Sentry Turret + Swift Sigil | **Arsenal** — deploys paired, long-lived turrets firing fast piercing volleys |

## ✷ Weapon synergies

Some weapons amplify each other. Hold the right **pair** (or any two of a small
set) and an always-on **synergy** lights up — a free set bonus that rewards
building around a theme, so every level-up choice carries a little extra weight:

| Synergy | Needs | Bonus |
|---|---|---|
| 🔥 **Wildfire** | Flame + Toxin | +15% damage, +10% area |
| ❄ **Deep Freeze** | Frost Shard + Nova | +20% projectile speed, +8% crit |
| ⚡ **Stormcaller** | Light Bolt + Arc Lightning | +15% attack speed |
| 🛡 **Bastion** | any 2 of Orbit / Whip / Flame | +2 armor, +10% area |
| 👻 **Wild Hunt** | Spirit Seekers + Glaive | +1 projectile, +10% projectile speed |
| 🌈 **Refraction** | any 2 of Prism / Nova / Arc | +10% crit, +0.5× crit damage |
| 🛡 **Entrench** | any 2 of Lance / Caltrops / Whip | +2 armor, lances/whips pierce +1 |

Evolved weapons still count as their base, active synergies show under your
weapon row (and on the pause screen), and the full set lives in the **Codex**.
Synergies are a pure function of your arsenal — no luck involved — so they're
deterministic and the Daily Challenge stays fair.

## 🎴 Omens (run modifiers)

Before each run you draft **1 of 3 random Omens** (or play with none) — global
modifiers that reshape the whole run, usually a strong upside with a tradeoff.
There are **14**, e.g. *Glass Cannon* (+60% damage, half HP), *Swarm Tide* (far
more foes, far more loot), *Berserker* (the lower your health, the harder you
hit), *Vampiric* (heal on kill), *Greed* (+80% shards, tougher foes), *Colossal*,
*Featherweight*, *Executioner*, *Bulwark*, *Abundance*, and more. Every run
opens differently.

## 🔮 Relics (permanent loadout)

Where Omens are random and per-run, **Relics are permanent and chosen**. Spend
shards to **unlock** relics — several are gated behind achievements for a long
unlock arc — then **equip** a few into a limited loadout that carries into every
run. There are **20**, e.g. *Titan Heart* (+30% max HP), *Glass Lens* (+25%
damage, −15% HP), *Chrono Core* (+18% attack speed), *Keenstone* (crit chance &
damage), *Vampiric Charm* (heal on kill), *Phoenix Feather* (an extra revive),
and the master-tier *Void Shard*. You start with **2 equip slots and earn more
as you collect relics** (up to 4), so you deliberately craft a build identity
before the run even begins. (The Daily Challenge ignores relics so its
leaderboard stays fair.)

Three relics are **synergy-aware** — they read your live arsenal and pay off the
more weapon synergies you've assembled: *Resonance Crystal* (+8% damage per
active synergy), *Harmonic Core* (+5% attack speed & +4% move speed per synergy),
and *Confluence* (+20% damage and +2 armor once 3+ synergies are live). They turn
a deep, themed build into a loadout choice that compounds, weaving the relic and
synergy layers together.

## ✨ Game feel

LASTLIGHT leans into **juice**: a slow drifting **nebula** behind the parallax
starfield, **comet trails** on every projectile, **tiered floating damage
numbers** that grow and heat up with the size of the hit (with a punchy pop),
bright **impact flashes**, a **look-ahead camera** that eases toward where
you're heading, and a red **edge-flash** the instant you take a hit. All of it
is cosmetic and isolated from the seeded simulation, so the Daily Challenge
stays bit-for-bit fair. Prefer it cleaner? Toggle **screen shake** and
**damage numbers** off in the menu.

The **audio** is fully synthesized and reactive: a master limiter keeps dense
fights clean, critical hits *ping*, elites pop richer than fodder, and a
Champion announces itself with a rising sting. The **music adapts** — the
minor-key arpeggio quickens and brightens as the run heats up, then shifts into
a darker, driving arrangement (with a tritone tension layer) whenever a boss or
Champion is on the field.

## 🌌 Biomes (a transforming world)

A survival run doesn't stay in one place. Every ~2½ minutes the world **shifts
into a new biome** — *The Verge*, *Emberwaste*, *Glacial Rift*, *The Hollows*,
*Bloodmoon*, *The Sundering* — each with its own palette, nebula tint and grid colour, announced
with a wash of colour and a soft swell. Each biome also **leans the spawns**
toward thematic foes (Emberwaste favours chargers and runners, Glacial Rift
favours brutes, the Hollows crawl with wraiths and stalkers…) — it changes
*which* enemies you face, never the difficulty curve. The sequence cycles, so a
long run keeps changing scenery. Because the active biome is a pure function of
elapsed time, it's identical for a given seed — the Daily Challenge stays fair.

Each biome past the opening also carries a **signature hazard** — an
environmental danger that turns the stage from a repaint into its own arena:

- **Emberwaste — *Emberfall*:** meteors rain down. A warning ring blooms, then
  the impact detonates in an AoE blast.
- **Glacial Rift — *Frost Fields*:** chilling pools open and linger, slowing and
  biting anything that stands in them.
- **The Hollows — *Gloom*:** patches of devouring dark settle on the field and
  eat at the light while you're inside.
- **Bloodmoon — *Bloodstorm*:** a relentless, fast cadence of strikes — keep
  moving or get caught.
- **The Sundering — *Riftvortex*:** a swirling vortex opens and **drags
  everything toward its core** — you gently, the horde hard. Fight outward to
  escape the damaging eye, or turn it to your advantage: it bunches foes into a
  perfect target for area weapons.

Every hazard is **telegraphed** (a warning phase before it bites), hurts
**enemies as well as you**, and is always dodgeable — so it rewards the same
move-to-survive instinct the whole game runs on. *The Verge* (the first ~2½
minutes) stays clean, easing newcomers in. Spawn timing and positions come from
the seeded simulation, so hazards are perfectly reproducible — the Daily stays
fair.

## 🔯 Shrines (risk & reward)

Every so often an **altar** materialises out in the world. Step onto it and it
grants a powerful boon — but every shrine **summons fresh danger** in the same
breath, so claiming one means choosing to detour *toward* trouble:

- **🔥 Shrine of Power** — **+50% damage for 18 seconds**, but an elite pack
  answers the call.
- **❤ Shrine of Vigor** — instantly **heal 45% of max health**, but a ring of
  foes closes in around you.
- **💰 Shrine of Fortune** — a **shower of light shards**, but elites are drawn
  to the gleam.

Shrines bring a moment-to-moment *decision* to a genre that's usually pure
reaction — is the buff worth fighting through what it spawns? (The temporary
buff stacks on top of everything else via the same modifier pipeline.) Their
timing, placement, type and the threat they conjure are all seeded, so they're
fully deterministic and the Daily stays fair. Trials and the Gauntlet — fixed,
comparable challenges — leave them out.

## ⭐ Elites & Champions

The dark isn't just fodder. Any foe can spawn as a glowing **elite** — scaled
up, wreathed in an aura, carrying one of six **affixes**, and dropping extra
loot:

- **Swift** (much faster), **Hardened** (resists damage, extra health),
  **Regenerating** (heals — burst it down), **Volatile** (bursts projectiles on
  death), **Arcane** (fires bolts at you), **Shielded** (a shield soaks a
  burst before its health is touched), **Leeching** (heals itself when it
  wounds you), **Frenzied** (grows faster the more it's hurt), and **Phasing**
  (blinks toward you in sudden lunges) — **9** in all.

Periodically a named **Champion** rises — a two-affix mini-boss with its own
health bar that drops a chest. And distinct foes prowl the field: the **Stalker**
(orbits and harasses you at range), the **Bomber** (closes in, then detonates),
the **Conjurer** (an arcane caster that *summons fresh waves of motes*), and the
**Acolyte** — a support caster whose aura **empowers every foe around it**, making
them faster and tougher. The Conjurer and Acolyte are true **priority targets**
in different ways: one *creates* the horde, the other *strengthens* it, and the
Acolyte gets deadlier the more crowded the screen — so cut it down first. Affixes
stack on these foes too, so a *Shielded Bomber*, a *Swift Stalker*, or a
*Hardened Conjurer* keeps every minute different.

## 🏆 Achievements, difficulty & the Codex

- **34 achievements** with shard rewards and long-term goals — survive 15:00 to
  unlock the secret character **Void**; hunt elites, slay a Champion, collect
  relics, climb the mastery ranks, clear the Trials, defeat **every kind of
  boss** (*Apex Predator*) and **25 bosses** in total (*Nemesis*).
- **Ascension difficulties** — Normal → Hard → Nightmare → Abyss. Each scales
  enemies *and* shard rewards up, and unlocks by surviving a threshold on the
  tier below.
- **Codex** — a bestiary + arsenal that fills in as you discover foes, weapons,
  and evolutions, and now tracks your **lifetime kill count for each boss**.
- **Options** — toggle SFX, music, screen shake, floating damage numbers, and
  the mastery trail FX (accessibility / clarity).

## 📜 Chronicle (run history & records)

Every finished run is logged to your **Chronicle** — a scrolling history of your
last 30 runs, each with a full snapshot: mode (Survival / Gauntlet / Daily),
character, difficulty, the **weapons you ended with** (evolutions glow), any
Omen and equipped Relics, plus score, kills, level and time. Your headline
records (best time, best score, best Gauntlet round, total runs) sit at the top.
Open it from the menu or straight from the game-over screen to track your
progress and revisit your best builds.

## 🎖 Mastery (lifetime progression)

Beyond any single run, every game you finish builds **lifetime mastery**. Each
**hero** accumulates kills, time survived, bosses felled and runs played into
mastery points, climbing a rank ladder — **Untrained → Initiate → Adept →
Veteran → Master → Ascendant** — shown with a progress bar toward the next rank.
Every **weapon** you wield earns its own track too, lit up by how often you've
used it, the levels you've reached and the evolutions you've unlocked (a 0–5★
rating). Two achievements reward the climb (reach **Adept**, then **Master**,
with any hero).

Rank also brings **visible prestige**: your hero's title shows on the character
screen and the game-over banner, a **Veteran** earns a glowing motion **trail**,
**Master** burns brighter, and an **Ascendant** wears a pulsing **halo** (all
toggleable). It's a deliberate long-game: a reason to keep returning to a
favourite hero, and to give every weapon a real run. Mastery is pure
record-keeping and the rewards are purely cosmetic — never read by the
simulation, so it can't tip the Daily.

## ⚔ Gauntlet (boss rush)

A separate mode for when you want pure pressure: **endless rounds of bosses**,
back to back, each round tougher than the last (and from round 6, two at once).
You start with a few **opening upgrades** so you arrive armed, get a short
breather and a heal between rounds, and chase a single number — **how many
rounds can you clear?** Your best round is saved and shown on the menu. Omens
and ascension difficulties stack on top for an even steeper climb.

## 🗓 Daily Challenge

A **deterministic, seeded** run from the main menu: today's date seeds the
world, so the spawn waves, drops, and upgrade offers are identical every time
you play it that day — it comes down to pure skill. Your best score per day is
saved, and "Play Again" re-rolls the same daily so you can refine your run.

The simulation is built so the seed alone determines the world: the gameplay
RNG stream is fully isolated from anything cosmetic, so framerate, audio mute,
and screen-shake settings **cannot** change the outcome. This is verified by a
dedicated determinism test (see below).

## 🎯 Trials of Light

Beyond freeform survival, **Trials** are curated challenge runs — each with a
fixed rule-twist and a concrete **win condition**, turning the open-ended loop
into structured goals you can actually *complete*:

| Trial | Twist | Objective | Unlocks after |
|---|---|---|---|
| 🕯 **Kindling** | none — a gentle first test | Survive 3:30 | *(open)* |
| 💥 **Glass Gauntlet** | double damage, quarter health | Survive 5:00 | Kindling |
| 🐜 **The Swarm** | twice the foes (frailer), more XP | Slay 800 | Kindling |
| 🐢 **Tortoise** | 60% move speed, sturdier, faster foes | Survive 5:30 | Glass Gauntlet |
| 🩸 **Bloodlust** | Berserker on Hard | Survive 6:00 | The Swarm |
| 🌑 **Ascendant Trial** | Nightmare + 50% more foes | Score 80,000 | Tortoise **&** Bloodlust |

The Trials form an **unlock chain** — a diamond that branches after the opener
and rejoins at a capstone, so clearing one opens the next on its path and the
Ascendant Trial only appears once you've conquered *both* branches:

```
       Kindling
       /      \
    Glass    Swarm
      |        |
  Tortoise  Bloodlust
       \      /
       Ascendant
```

Trials force their own character, difficulty and rules and **ignore Omens and
Relics**, so each is a fixed, comparable test of skill. Clearing one is saved
and pays a one-time shard **bounty** (replays pay a small one); two achievements
reward clearing your first and *all* of them. Your live objective and progress
show at the top of the screen. Unlock state is a pure function of which Trials
you've cleared — no extra randomness, so the chain is fully deterministic.

## 🧪 Custom Run (mutators)

Where Trials are *authored*, a **Custom Run** is *yours*. Toggle any combination
of **mutators** — **boons** that ease the run (+damage, +health, lifesteal, more
XP…) or **banes** that brutalise it (more foes, tougher/faster/angrier enemies,
Glass Cannon, Berserker, Onslaught…) — then pick a hero and play. There are
**15** to mix freely, for effectively endless make-your-own variety.

Your self-imposed difficulty **scales the shard payout**: every mutator carries a
weight, and the net total moves a reward multiplier (shown live) from **×0.25**
(stacked boons) up to **×2.5** (a brutal gauntlet) — so a Custom Run can't be
cheesed for loot, and punishing builds feel worth it, like a personal Ascension
dial. Custom runs use the full survival rules (bosses, biomes, hazards), ignore
Omens & Relics, and keep their own books (they never touch your standard
best-time/score records).

---

## 🛠 Project layout

Plain JS (classic scripts) + HTML5 Canvas + Web Audio. **No frameworks, no
external assets** — all art is drawn procedurally and all sound is synthesized
at runtime, so there are no licensing or network dependencies.

```
index.html          # shell; loads scripts in dependency order
css/style.css       # neon-on-dark UI
js/
  utils.js          # math, RNG, helpers, object pool
  audio.js          # procedural Web Audio SFX + adaptive, boss-aware music
  input.js          # keyboard / pointer / touch
  particles.js      # particle + floating-text system
  save.js           # localStorage meta-progression
  content.js        # characters, difficulty tiers + meta-upgrade shop
  weapons.js        # 13 base weapons (periodic, continuous, boomerang, zones, lances)
  evolutions.js     # 13 weapon evolutions + evolution rules
  synergies.js      # weapon set bonuses (pure function of the arsenal)
  enemies.js        # enemy archetypes + affixes + the spawn Director + bosses/champions
  upgrades.js       # passives + level-up choice generator
  achievements.js   # achievement definitions + live/game-over checker
  modifiers.js      # "omens" — drafted per-run modifiers
  mutators.js       # Custom Run mutators (free-stacked twists + reward scaling)
  relics.js         # permanent, equippable run modifiers (loadout)
  trials.js         # Trials of Light: fixed-rule challenge runs + win conditions
  player.js         # player entity, stat recalculation, leveling
  game.js           # engine: world, biomes + hazards, camera, collision, combat, render, HUD
  ui.js             # DOM overlays: menu, shop, level-up, achievements, codex…
  main.js           # bootstrap + fixed-timestep loop + global keys
tools/
  headless-test.js  # runs the whole game headless to validate runtime
  balance-sim.js    # auto-plays with a dodge-AI to tune difficulty
```

## ✅ Tests

A headless harness stubs the DOM/Canvas/WebAudio APIs and actually runs the
game — a full simulated run, every weapon, all bosses, all 13 evolutions, the
weapon-synergy set bonuses, all 32 achievements, every omen, the relic loadout
system, the run-history Chronicle, the lifetime-mastery system (ranks +
per-hero/weapon accrual), the Trials of Light (rule twists + win/fail paths),
the Custom Run mutators (free-stacked twists + reward scaling), the Gauntlet
boss-rush flow, the elite/affix/champion system, the boomerang/poison-pool
mechanics, difficulty scaling, level-ups, pickups, the polish FX (nebula,
projectile trails, tiered damage numbers), the time-driven biome progression
(palette + spawn bias + environmental hazards), the adaptive audio engine
(limiter, combat SFX, boss-aware music), the first-run onboarding (intro +
coaching tips), the mastery rewards (rank-gated titles + cosmetic trail/halo),
every UI screen, death, persistence, and the shop (440+ assertions):

```bash
npm test                          # functional + determinism suites
 node tools/headless-test.js       # functional suite (440+ assertions)
node tools/determinism-test.js    # proves Daily seeds are framerate/settings-independent
node tools/balance-sim.js 6 0     # auto-play a run (args: metaLevel difficulty)
```

## 📜 License

MIT — see [LICENSE](LICENSE). All code, art, and audio are original and
generated at runtime; you're free to play, fork, and remix.
