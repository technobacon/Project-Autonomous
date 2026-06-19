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

## 🎮 How to play

- **Move** with `WASD` or the **arrow keys** (on touch devices, drag anywhere).
- Your **weapons fire automatically** — your only job is positioning and
  survival.
- Defeated foes drop **light shards**. Collect them to **level up** and choose
  an upgrade: a new weapon, a weapon level, or a passive boost.
- **Pause** any time with `Esc` or `P`. During a level-up, press `1`–`4` or
  click a card.
- Survive long enough and **bosses** arrive (3:00, 6:00, 10:00, then endlessly).
  They hit hard but drop a flood of XP and treasure.

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

Progress is saved automatically in your browser (`localStorage`).

## ⚒ Build variety

**8 weapons** — Light Bolt, Frost Shard, Flame Aura, Orbit Wisps, Nova Burst,
Arc Lightning, Spirit Seekers, Light Whip — each with 8 levels.
**14 passives** — damage, attack speed, move speed, area, projectiles, pierce,
projectile speed, pickup range, max health, regen, XP gain, crit, armor, luck.

You carry up to **6 weapons** and **6 passives** per run, so every game becomes
a different build. The upgrade pool is weighted and nudged by your **Luck**.

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

## 🎴 Omens (run modifiers)

Before each run you draft **1 of 3 random Omens** (or play with none) — global
modifiers that reshape the whole run, usually a strong upside with a tradeoff.
There are **14**, e.g. *Glass Cannon* (+60% damage, half HP), *Swarm Tide* (far
more foes, far more loot), *Berserker* (the lower your health, the harder you
hit), *Vampiric* (heal on kill), *Greed* (+80% shards, tougher foes), *Colossal*,
*Featherweight*, *Executioner*, *Bulwark*, *Abundance*, and more. Every run
opens differently.

## ✨ Game feel

LASTLIGHT leans into **juice**: a slow drifting **nebula** behind the parallax
starfield, **comet trails** on every projectile, **tiered floating damage
numbers** that grow and heat up with the size of the hit (with a punchy pop),
bright **impact flashes**, a **look-ahead camera** that eases toward where
you're heading, and a red **edge-flash** the instant you take a hit. All of it
is cosmetic and isolated from the seeded simulation, so the Daily Challenge
stays bit-for-bit fair. Prefer it cleaner? Toggle **screen shake** and
**damage numbers** off in the menu.

## 🏆 Achievements, difficulty & the Codex

- **22 achievements** with shard rewards and long-term goals — survive 15:00 to
  unlock the secret character **Void**.
- **Ascension difficulties** — Normal → Hard → Nightmare → Abyss. Each scales
  enemies *and* shard rewards up, and unlocks by surviving a threshold on the
  tier below.
- **Codex** — a bestiary + arsenal that fills in as you discover foes, weapons,
  and evolutions.
- **Options** — toggle SFX, music, screen shake, and floating damage numbers
  (accessibility / clarity).

## 🗓 Daily Challenge

A **deterministic, seeded** run from the main menu: today's date seeds the
world, so the spawn waves, drops, and upgrade offers are identical every time
you play it that day — it comes down to pure skill. Your best score per day is
saved, and "Play Again" re-rolls the same daily so you can refine your run.

The simulation is built so the seed alone determines the world: the gameplay
RNG stream is fully isolated from anything cosmetic, so framerate, audio mute,
and screen-shake settings **cannot** change the outcome. This is verified by a
dedicated determinism test (see below).

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
  audio.js          # procedural Web Audio SFX + evolving music
  input.js          # keyboard / pointer / touch
  particles.js      # particle + floating-text system
  save.js           # localStorage meta-progression
  content.js        # characters, difficulty tiers + meta-upgrade shop
  weapons.js        # 8 base weapons (periodic + continuous)
  evolutions.js     # 8 weapon evolutions + evolution rules
  enemies.js        # enemy archetypes + the spawn Director + bosses
  upgrades.js       # passives + level-up choice generator
  achievements.js   # achievement definitions + live/game-over checker
  player.js         # player entity, stat recalculation, leveling
  game.js           # engine: world, camera, collision, combat, render, HUD
  ui.js             # DOM overlays: menu, shop, level-up, achievements, codex…
  main.js           # bootstrap + fixed-timestep loop + global keys
tools/
  headless-test.js  # runs the whole game headless to validate runtime
  balance-sim.js    # auto-plays with a dodge-AI to tune difficulty
```

## ✅ Tests

A headless harness stubs the DOM/Canvas/WebAudio APIs and actually runs the
game — a full simulated run, every weapon, all bosses, all 8 evolutions, all 22
achievements, every omen, difficulty scaling, level-ups, pickups, the polish FX
(nebula, projectile trails, tiered damage numbers), every UI screen, death,
persistence, and the shop (140+ assertions):

```bash
npm test                          # functional + determinism suites
node tools/headless-test.js       # functional suite (140+ assertions)
node tools/determinism-test.js    # proves Daily seeds are framerate/settings-independent
node tools/balance-sim.js 6 0     # auto-play a run (args: metaLevel difficulty)
```

## 📜 License

MIT — see [LICENSE](LICENSE). All code, art, and audio are original and
generated at runtime; you're free to play, fork, and remix.
