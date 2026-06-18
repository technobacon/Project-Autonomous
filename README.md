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
  content.js        # characters + meta-upgrade shop definitions
  weapons.js        # 8 weapons (periodic + continuous)
  enemies.js        # enemy archetypes + the spawn Director + bosses
  upgrades.js       # passives + level-up choice generator
  player.js         # player entity, stat recalculation, leveling
  game.js           # engine: world, camera, collision, combat, render, HUD
  ui.js             # DOM overlays: menu, shop, level-up, pause, game over
  main.js           # bootstrap + game loop + global keys
tools/
  headless-test.js  # runs the whole game headless to validate runtime
```

## ✅ Tests

A headless harness stubs the DOM/Canvas/WebAudio APIs and actually runs the
game — a full simulated run, every weapon, all bosses, level-ups, pickups, UI
screens, death, persistence, and the shop:

```bash
node tools/headless-test.js
```

## 📜 License

MIT — see [LICENSE](LICENSE). All code, art, and audio are original and
generated at runtime; you're free to play, fork, and remix.
