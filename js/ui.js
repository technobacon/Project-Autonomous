// ===========================================================================
// LASTLIGHT - ui.js
// DOM-based overlays for all menus: main menu, character select, meta shop,
// level-up choices, pause, and game over. Gameplay + HUD live on the canvas.
// ===========================================================================

const UI = {
  root: null,
  game: null,

  init(root, game) {
    this.root = root;
    this.game = game;
  },

  _esc() { /* allow Escape handling elsewhere */ },

  _dailyChip() {
    const best = Save.getDailyBest(dailyDateString());
    return best ? ` <span class="shard-chip">best ${formatTime(best.time)}</span>` : '';
  },

  _gauntletChip() {
    const g = Save.data.gauntletBest;
    return g && g.rounds > 0 ? ` <span class="shard-chip">best R${g.rounds}</span>` : '';
  },

  _trialsChip() {
    return ` <span class="shard-chip">${Save.trialsDone()}/${TRIALS.length}</span>`;
  },

  clear() { this.root.innerHTML = ''; this.root.className = 'overlay'; this._omens = null; },
  show() { this.root.style.display = 'flex'; },
  hide() { this.root.style.display = 'none'; },

  // ---- Main menu --------------------------------------------------------
  showMenu() {
    this.clear(); this.show();
    const d = Save.data;
    this.root.innerHTML = `
      <div class="screen menu">
        <h1 class="title">LAST<span>LIGHT</span></h1>
        <p class="tagline">A spark of light against the endless dark.<br>Survive as long as you can.</p>
        <div class="menu-buttons">
          <button class="btn btn-primary" id="btn-play">▶ PLAY</button>
          <button class="btn" id="btn-gauntlet">⚔ GAUNTLET${this._gauntletChip()}</button>
          <button class="btn" id="btn-daily">🗓 DAILY CHALLENGE${this._dailyChip()}</button>
          <button class="btn" id="btn-trials">🎯 TRIALS${this._trialsChip()}</button>
          <button class="btn" id="btn-custom">🧪 CUSTOM RUN</button>
          <button class="btn" id="btn-shop">⚙ SANCTUARY <span class="shard-chip">✦ ${formatNum(d.shards)}</span></button>
          <button class="btn" id="btn-relics">🔮 RELICS <span class="shard-chip">${Save.relicCount()}/${RELIC_LIST.length}</span></button>
          <div class="menu-buttons row">
            <button class="btn" id="btn-ach">🏆 ${Save.achievementCount()}/${ACHIEVEMENTS.length}</button>
            <button class="btn" id="btn-codex">📖 CODEX</button>
            <button class="btn" id="btn-mastery">🎖 MASTERY</button>
            <button class="btn" id="btn-history">📜 HISTORY</button>
            <button class="btn" id="btn-help">? HELP</button>
          </div>
        </div>
        <div class="stats-row">
          <div class="stat"><span>Best Time</span><b>${formatTime(d.bestTime)}</b></div>
          <div class="stat"><span>Best Score</span><b>${formatNum(d.bestScore)}</b></div>
          <div class="stat"><span>Runs</span><b>${d.runs}</b></div>
          <div class="stat"><span>Total Kills</span><b>${formatNum(d.totalKills)}</b></div>
        </div>
        <div class="audio-toggles">
          <button class="mini" id="btn-sfx">${Audio2.muted ? '🔇' : '🔊'} SFX</button>
          <button class="mini" id="btn-music">${Audio2.musicMuted ? '🎵̶' : '🎵'} Music</button>
          <button class="mini" id="btn-shake">${d.shakeOff ? '⬚' : '⬛'} Shake</button>
          <button class="mini" id="btn-dmg">${d.dmgNumbers ? '🔢' : '⬚'} Damage #</button>
          <button class="mini" id="btn-trail">${d.trailFx !== false ? '✦' : '⬚'} Trail</button>
        </div>
        <p class="hint">Move: WASD / Arrows • Pause: Esc/P • Weapons fire automatically</p>
      </div>`;
    document.getElementById('btn-play').onclick = () => { Audio2.uiSelect(); this.showCharacterSelect('survival'); };
    document.getElementById('btn-gauntlet').onclick = () => { Audio2.uiSelect(); this.showCharacterSelect('gauntlet'); };
    document.getElementById('btn-daily').onclick = () => { Audio2.uiSelect(); this.hide(); App.startRun('spark', 0, { daily: true }); };
    document.getElementById('btn-trials').onclick = () => { Audio2.uiSelect(); this.showTrials(); };
    document.getElementById('btn-custom').onclick = () => { Audio2.uiSelect(); this.showMutators(); };
    document.getElementById('btn-shop').onclick = () => { Audio2.uiSelect(); this.showShop(); };
    document.getElementById('btn-relics').onclick = () => { Audio2.uiSelect(); this.showRelics(); };
    document.getElementById('btn-ach').onclick = () => { Audio2.uiSelect(); this.showAchievements(); };
    document.getElementById('btn-codex').onclick = () => { Audio2.uiSelect(); this.showCodex(); };
    document.getElementById('btn-mastery').onclick = () => { Audio2.uiSelect(); this.showMastery(); };
    document.getElementById('btn-history').onclick = () => { Audio2.uiSelect(); this.showHistory(); };
    document.getElementById('btn-help').onclick = () => { Audio2.uiSelect(); this.showHelp(); };
    document.getElementById('btn-sfx').onclick = (e) => { Audio2.resume(); const m = Audio2.toggleMute(); Save.data.muted = m; Save.save(); e.target.textContent = (m ? '🔇' : '🔊') + ' SFX'; };
    document.getElementById('btn-music').onclick = (e) => { Audio2.resume(); const m = Audio2.toggleMusic(); Save.data.musicMuted = m; Save.save(); e.target.textContent = (m ? '🎵̶' : '🎵') + ' Music'; };
    document.getElementById('btn-shake').onclick = (e) => { Save.data.shakeOff = !Save.data.shakeOff; Save.save(); e.target.textContent = (Save.data.shakeOff ? '⬚' : '⬛') + ' Shake'; Audio2.uiMove(); };
    document.getElementById('btn-dmg').onclick = (e) => { Save.data.dmgNumbers = !Save.data.dmgNumbers; Save.save(); e.target.textContent = (Save.data.dmgNumbers ? '🔢' : '⬚') + ' Damage #'; Audio2.uiMove(); };
    document.getElementById('btn-trail').onclick = (e) => { Save.data.trailFx = Save.data.trailFx === false; Save.save(); e.target.textContent = (Save.data.trailFx !== false ? '✦' : '⬚') + ' Trail'; Audio2.uiMove(); };
  },

  showHelp() {
    this.clear(); this.show();
    this.root.innerHTML = `
      <div class="screen panel">
        <h2>How to Play</h2>
        <div class="help-grid">
          <div class="help-card"><h3>🎯 Goal</h3><p>You are the last light. Endless waves of dark close in. Survive as long as you can — there is no winning, only how long you last.</p></div>
          <div class="help-card"><h3>🕹 Move</h3><p><b>WASD</b> or <b>Arrow keys</b> to move (drag on touch screens). Your weapons fire <b>automatically</b> — focus on positioning and dodging.</p></div>
          <div class="help-card"><h3>⟫ Blink</h3><p>Tap <b>Space</b> or <b>Shift</b> (double-tap on touch) to <b>dash</b> a short distance with brief <b>invulnerability</b>, on a cooldown. Blink through a wall of foes or out of a closing ring — the HUD bar glows when it's ready.</p></div>
          <div class="help-card"><h3>💎 Grow</h3><p>Defeated foes drop light shards. Collect them to level up and <b>choose an upgrade</b> — new weapons, weapon levels, or passive boosts.</p></div>
          <div class="help-card"><h3>⚒ Build</h3><p>You hold up to <b>6 weapons</b> and <b>6 passives</b>. Combine them into a build. Every run is different.</p></div>
          <div class="help-card"><h3>☠ Bosses</h3><p>Bosses arrive on a timer and hit hard — but drop a flood of XP and treasure. Survive past 10:00 to face the Devourer.</p></div>
          <div class="help-card"><h3>✦ Sanctuary</h3><p>Earn shards every run. Spend them in the Sanctuary on <b>permanent upgrades</b> and to <b>unlock new characters</b>.</p></div>
          <div class="help-card"><h3>🧬 Evolve</h3><p>Max a weapon <b>and</b> own its paired passive to unlock a golden <b>EVOLUTION</b> — a far more powerful form. Chase them.</p></div>
          <div class="help-card"><h3>✷ Synergies</h3><p>Hold the right <b>weapon pairs</b> together to trigger a <b>synergy</b> — an always-on set bonus (e.g. Flame + Toxin = <b>Wildfire</b>). Active synergies show under your weapons. Discover all ${SYNERGIES.length} in the Codex.</p></div>
          <div class="help-card"><h3>🎴 Omens</h3><p>Before each run, draft a powerful <b>Omen</b> that reshapes the whole run — usually a big upside with a tradeoff. Or play with none.</p></div>
          <div class="help-card"><h3>⚔ Gauntlet</h3><p>A boss-rush mode: <b>endless rounds of bosses</b>, escalating each time, with a short breather between. You start with extra upgrades — how many rounds can you clear?</p></div>
          <div class="help-card"><h3>🎯 Trials</h3><p><b>${TRIALS.length} fixed-rule challenges</b>, each with a twist and a clear objective (survive, slay, or score). They ignore Omens & Relics — pure skill. Clear one for a shard bounty.</p></div>
          <div class="help-card"><h3>🧪 Custom Run</h3><p>Stack <b>any mutators you like</b> — boons that ease the run or banes that brutalise it — then play. Your self-imposed difficulty <b>scales the shard payout</b>. Endless make-your-own variety.</p></div>
          <div class="help-card"><h3>⭐ Elites &amp; Champions</h3><p>Glowing <b>elite</b> foes carry an affix and drop extra loot; <b>Champions</b> are named two-affix mini-bosses with a chest. Affixes: ${AFFIX_LIST.map(a => `<b style="color:${a.color}">${a.name}</b>`).join(', ')}.</p></div>
          <div class="help-card"><h3>🗓 Daily</h3><p>A <b>seeded</b> run that's the same for everyone today. Pure skill — beat your own best score each day.</p></div>
          <div class="help-card"><h3>🔮 Relics</h3><p>Spend shards to <b>unlock relics</b> (some gated behind achievements), then <b>equip</b> a few into your loadout for permanent bonuses. Collect more to earn extra slots.</p></div>
          <div class="help-card"><h3>🌌 Biomes</h3><p>The world <b>shifts biome</b> every few minutes — new palette, new skies, and a lean toward different foes. The sequence is the same for a given seed, so the Daily stays fair.</p></div>
          <div class="help-card"><h3>⚠ Hazards</h3><p>Each biome past the first brings an <b>environmental hazard</b> — meteor strikes, frost pools, gloom, a bloodstorm. They're always <b>telegraphed</b> and hurt foes too: watch for the warning ring and <b>step out</b>.</p></div>
          <div class="help-card"><h3>📜 Chronicle</h3><p>Every run is logged in your <b>History</b> — its mode, character, build, score and time — so you can track your records and revisit your best runs.</p></div>
          <div class="help-card"><h3>🎖 Mastery</h3><p>Every run builds <b>lifetime mastery</b> for the hero you played and the weapons you wielded. Climb the rank ladder — <b>Initiate → Ascendant</b> — for each one. Veterans earn a glowing <b>trail</b>, and an Ascendant hero wears a <b>halo</b>. A long-game goal beyond any single score.</p></div>
          <div class="help-card"><h3>⚙ Options</h3><p>From the menu, toggle <b>SFX</b>, <b>Music</b>, <b>screen shake</b>, and floating <b>damage numbers</b> to taste.</p></div>
        </div>
        <div class="menu-buttons row">
          <button class="btn btn-primary" id="btn-back">← Back</button>
          <button class="btn" id="btn-replay-tut">↻ Replay Tutorial</button>
        </div>
      </div>`;
    document.getElementById('btn-back').onclick = () => { Audio2.uiMove(); this.showMenu(); };
    document.getElementById('btn-replay-tut').onclick = () => { Audio2.uiSelect(); Save.resetTutorial(); this.showIntro(() => this.showMenu()); };
  },

  // ---- First-run welcome / tutorial -------------------------------------
  showIntro(onDone) {
    this.clear(); this.show();
    const done = () => { Save.data.seenIntro = true; Save.save(); Audio2.uiSelect(); (onDone || (() => this.showMenu()))(); };
    this.root.innerHTML = `
      <div class="screen panel intro">
        <h1 class="title">LAST<span>LIGHT</span></h1>
        <p class="tagline">You are the last spark of light against an endless dark.<br>Here's all you need to begin:</p>
        <div class="intro-steps">
          <div class="intro-step"><div class="intro-ic">🕹</div><div><h3>Move to survive</h3><p>Steer with <b>WASD</b> or <b>arrow keys</b> — or drag on a touch screen. There's no fire button: your weapons attack <b>automatically</b>. Your whole job is to <b>dodge</b>.</p></div></div>
          <div class="intro-step"><div class="intro-ic">💎</div><div><h3>Gather &amp; grow</h3><p>Fallen foes drop <b>light shards</b>. Scoop them up to <b>level up</b>, then pick a new weapon, a weapon upgrade, or a passive boost.</p></div></div>
          <div class="intro-step"><div class="intro-ic">⚒</div><div><h3>Build a combo</h3><p>You carry up to <b>6 weapons</b> and <b>6 passives</b>. Max a weapon beside its paired passive to unlock a powerful <b>evolution</b>.</p></div></div>
          <div class="intro-step"><div class="intro-ic">✦</div><div><h3>Endure &amp; return</h3><p>Every run earns <b>shards</b> to spend in the <b>Sanctuary</b> on permanent upgrades and new characters. Death is just the start of the next run.</p></div></div>
        </div>
        <div class="menu-buttons row">
          <button class="btn btn-primary" id="btn-intro-go">▶ Begin</button>
          <button class="btn" id="btn-intro-skip">Skip</button>
        </div>
        <p class="hint">You can replay this anytime from <b>Help</b>.</p>
      </div>`;
    document.getElementById('btn-intro-go').onclick = done;
    document.getElementById('btn-intro-skip').onclick = done;
  },

  // ---- Character select -------------------------------------------------
  _charUnlocked(c) { return c.secret ? Save.hasAchievement(c.achievement) : Save.isUnlocked(c.id); },

  showCharacterSelect(mode) {
    this.clear(); this.show();
    if (mode) this._mode = mode;
    if (!this._mode) this._mode = 'survival';
    if (this._selectedDiff == null) this._selectedDiff = 0;
    this._selectedDiff = clamp(this._selectedDiff, 0, Save.data.maxDifficulty);

    const cards = CHARACTERS.map(c => {
      const unlocked = this._charUnlocked(c);
      const affordable = Save.data.shards >= c.cost;
      let action;
      if (unlocked) action = `<button class="btn btn-primary select-btn" data-id="${c.id}">SELECT</button>`;
      else if (c.secret) action = `<div class="char-locktag">🔒 ${getAchievement(c.achievement).name}</div>`;
      else action = `<button class="btn ${affordable ? '' : 'disabled'} unlock-btn" data-id="${c.id}">🔒 Unlock ✦${c.cost}</button>`;
      const rk = masteryRank(charMasteryPoints(Save.charStats(c.id)));
      const badge = (unlocked && rk.index > 0)
        ? `<div class="char-mastery" style="color:${rk.color};border-color:${rk.color}">🎖 ${rk.name}</div>` : '';
      return `
        <div class="char-card ${unlocked ? '' : 'locked'} ${c.secret ? 'secret' : ''}" data-id="${c.id}">
          <div class="char-orb" style="--c:${c.color}"></div>
          <h3 style="color:${c.color}">${unlocked || !c.secret ? c.name : '???'}</h3>
          ${badge}
          <p class="char-desc">${unlocked || !c.secret ? c.desc : 'A hidden light awaits the worthy.'}</p>
          <p class="char-blurb">${c.blurb}</p>
          <div class="char-stats">
            <span>❤ ${c.stats.maxHp}</span><span>👟 ${c.stats.speed}</span>
            <span>🗡 ${Math.round(c.stats.might*100)}%</span>
          </div>
          ${action}
        </div>`;
    }).join('');

    const diffBtns = DIFFICULTIES.map((dd, i) => {
      const locked = i > Save.data.maxDifficulty;
      const sel = i === this._selectedDiff;
      return `<button class="diff-btn ${sel ? 'sel' : ''} ${locked ? 'disabled' : ''}" data-i="${i}" style="--c:${dd.color}">
        ${locked ? '🔒 ' : ''}${dd.name}${i > 0 ? ` <small>×${dd.reward}✦</small>` : ''}</button>`;
    }).join('');
    const nextLocked = DIFFICULTIES[Save.data.maxDifficulty + 1];
    const diffHint = nextLocked ? `Survive ${formatTime(nextLocked.unlockAt)} to unlock <b style="color:${nextLocked.color}">${nextLocked.name}</b>.` : 'All difficulties unlocked. You are formidable.';

    this.root.innerHTML = `
      <div class="screen panel wide">
        <div class="panel-head">
          <h2>${this._mode === 'gauntlet' ? '⚔ Gauntlet — Choose your Light' : (this._mode === 'custom' ? '🧪 Custom Run — Choose your Light' : 'Choose your Light')}</h2>
          <span class="shard-chip big">✦ ${formatNum(Save.data.shards)}</span>
        </div>
        <div class="diff-row">${diffBtns}</div>
        <p class="tagline small">${diffHint}</p>
        <div class="char-grid">${cards}</div>
        <button class="btn" id="btn-back">← Back</button>
      </div>`;
    this.root.querySelectorAll('.diff-btn:not(.disabled)').forEach(b => {
      b.onclick = () => { this._selectedDiff = +b.dataset.i; Audio2.uiMove(); this.showCharacterSelect(); };
    });
    this.root.querySelectorAll('.select-btn').forEach(b => {
      b.onclick = () => {
        Audio2.uiSelect();
        if (this._mode === 'custom') { this.hide(); App.startRun(b.dataset.id, this._selectedDiff, { mode: 'custom', mutators: (this._mutators || []).slice() }); }
        else this.showOmenDraft(b.dataset.id, this._selectedDiff, this._mode);
      };
    });
    this.root.querySelectorAll('.unlock-btn').forEach(b => {
      b.onclick = () => {
        const c = getCharacter(b.dataset.id);
        if (Save.spendShards(c.cost)) { Save.unlock(c.id); Audio2.buy(); this.showCharacterSelect(); }
        else Audio2.deny();
      };
    });
    document.getElementById('btn-back').onclick = () => { Audio2.uiMove(); this._mode === 'custom' ? this.showMutators() : this.showMenu(); };
  },

  // ---- Omen draft (run modifier) ----------------------------------------
  showOmenDraft(charId, diffIndex, mode) {
    this.clear(); this.show();
    mode = mode || 'survival';
    const omens = draftOmens(3);
    const cards = omens.map((o, i) => `
      <div class="omen-card" data-i="${i}" style="--c:${o.color}">
        <div class="up-key">${i + 1}</div>
        <div class="omen-icon" style="color:${o.color}">${o.icon}</div>
        <h3 style="color:${o.color}">${o.name}</h3>
        <p>${o.desc}</p>
      </div>`).join('');
    this.root.innerHTML = `
      <div class="screen panel wide">
        <h2>Draft an Omen</h2>
        <p class="tagline small">A power that reshapes the whole run — choose wisely, or go without.</p>
        <div class="omen-grid">${cards}</div>
        <div class="menu-buttons row">
          <button class="btn btn-primary" id="btn-none">▶ No Omen</button>
          <button class="btn" id="btn-back">← Back</button>
        </div>
        <p class="hint">Press 1–${omens.length}, or play with no omen</p>
      </div>`;
    const launch = (omenId) => { this._omens = null; Audio2.uiSelect(); this.hide(); App.startRun(charId, diffIndex, { omen: omenId, mode }); };
    this._omenLaunch = launch; this._omens = omens;
    this.root.querySelectorAll('.omen-card').forEach(card => {
      card.onmouseenter = () => Audio2.uiMove();
      card.onclick = () => launch(omens[+card.dataset.i].id);
    });
    document.getElementById('btn-none').onclick = () => launch(null);
    document.getElementById('btn-back').onclick = () => { Audio2.uiMove(); this.showCharacterSelect(); };
  },

  // Called from the global key handler (number keys) while drafting.
  pickOmenByIndex(i) {
    if (this._omens && this._omenLaunch && this._omens[i]) this._omenLaunch(this._omens[i].id);
  },

  // ---- Achievements -----------------------------------------------------
  showAchievements() {
    this.clear(); this.show();
    const cards = ACHIEVEMENTS.map(a => {
      const got = Save.hasAchievement(a.id);
      return `
        <div class="ach-card ${got ? 'got' : 'locked'}">
          <div class="ach-icon">${got ? a.icon : '🔒'}</div>
          <div class="ach-info">
            <h3>${a.name}</h3>
            <p>${a.desc}</p>
          </div>
          ${a.reward ? `<div class="ach-reward">+${a.reward}✦</div>` : ''}
        </div>`;
    }).join('');
    this.root.innerHTML = `
      <div class="screen panel wide">
        <div class="panel-head">
          <h2>Achievements</h2>
          <span class="shard-chip big">${Save.achievementCount()} / ${ACHIEVEMENTS.length}</span>
        </div>
        <div class="ach-grid">${cards}</div>
        <button class="btn" id="btn-back">← Back</button>
      </div>`;
    document.getElementById('btn-back').onclick = () => { Audio2.uiMove(); this.showMenu(); };
  },

  // ---- Run History / Chronicle ------------------------------------------
  _modeChip(r) {
    if (r.mode === 'daily') return `<span class="hist-mode" style="color:#9ad8ff;border-color:#9ad8ff">🗓 Daily</span>`;
    if (r.mode === 'gauntlet') return `<span class="hist-mode" style="color:#ffd84d;border-color:#ffd84d">⚔ Gauntlet</span>`;
    if (r.mode === 'trial') return `<span class="hist-mode" style="color:#ff86c8;border-color:#ff86c8">🎯 ${r.trialWon ? '✓ ' : ''}${r.trialName || 'Trial'}</span>`;
    if (r.mode === 'custom') return `<span class="hist-mode" style="color:#c9a8ff;border-color:#c9a8ff">🧪 Custom${r.mutators && r.mutators.length ? ' ×' + r.mutators.length : ''}</span>`;
    return `<span class="hist-mode" style="color:${r.diffColor || '#7affc4'};border-color:${r.diffColor || '#7affc4'}">✦ ${r.diff > 0 ? r.diffName : 'Survival'}</span>`;
  },

  showHistory() {
    this.clear(); this.show();
    const d = Save.data;
    const hist = Array.isArray(d.history) ? d.history : [];
    const records = `
      <div class="stats-row">
        <div class="stat"><span>Best Time</span><b>${formatTime(d.bestTime)}</b></div>
        <div class="stat"><span>Best Score</span><b>${formatNum(d.bestScore)}</b></div>
        <div class="stat"><span>Gauntlet</span><b>${d.gauntletBest && d.gauntletBest.rounds ? 'R' + d.gauntletBest.rounds : '—'}</b></div>
        <div class="stat"><span>Runs</span><b>${d.runs}</b></div>
      </div>`;
    const rows = hist.length ? hist.map(r => {
      const primary = r.mode === 'gauntlet' ? 'Round ' + r.rounds : formatTime(r.time);
      const weps = (r.weapons || []).map(w =>
        `<span class="hist-wep ${w.evo ? 'evo' : ''}" style="color:${w.color}" title="Lv ${w.level}">${w.icon}</span>`).join('');
      const omen = r.omenIcon ? `<span class="hist-tag" style="color:${r.omenColor};border-color:${r.omenColor}">${r.omenIcon}</span>` : '';
      const relics = (r.relics && r.relics.length)
        ? `<span class="hist-tag" style="color:#c9a8ff;border-color:#c9a8ff">🔮 ${r.relics.map(id => { const x = getRelic(id); return x ? x.icon : ''; }).join('')}</span>` : '';
      return `
        <div class="hist-card">
          <div class="hist-top">
            ${this._modeChip(r)}
            <span class="hist-char" style="color:${r.charColor}">${r.charName}</span>
            <span class="hist-when">${timeAgo(r.t)}</span>
          </div>
          <div class="hist-main">
            <div class="hist-primary"><b>${primary}</b></div>
            <div class="hist-mini">
              <span>✦ ${formatNum(r.score)}</span>
              <span>☠ ${formatNum(r.kills)}</span>
              <span>Lv ${r.level}</span>
              ${r.bosses ? `<span>👑 ${r.bosses}</span>` : ''}
            </div>
          </div>
          <div class="hist-build">${weps}${omen}${relics}</div>
        </div>`;
    }).join('') : `<p class="empty-note">No runs recorded yet. Play a run and your chronicle begins here.</p>`;
    this.root.innerHTML = `
      <div class="screen panel wide">
        <div class="panel-head">
          <h2>Chronicle</h2>
          <span class="shard-chip big">${hist.length} run${hist.length === 1 ? '' : 's'}</span>
        </div>
        ${records}
        <div class="hist-list">${rows}</div>
        <button class="btn" id="btn-back">← Back</button>
      </div>`;
    document.getElementById('btn-back').onclick = () => { Audio2.uiMove(); this.showMenu(); };
  },

  // ---- Lifetime Mastery -------------------------------------------------
  showMastery() {
    this.clear(); this.show();
    // Heroes worth showing: every non-secret character, plus any unlocked
    // secret one. Each gets a rank badge + progress bar toward the next rank.
    const heroes = CHARACTERS.filter(c => !c.secret || Save.isUnlocked(c.id));
    const charCards = heroes.map(ch => {
      const s = Save.charStats(ch.id);
      const pts = charMasteryPoints(s);
      const rk = masteryRank(pts);
      const toNext = rk.next ? Math.max(0, rk.next.min - pts) : 0;
      const locked = !Save.isUnlocked(ch.id);
      return `
        <div class="mast-card ${locked ? 'locked' : ''}">
          <div class="mast-head">
            <span class="mast-hero" style="color:${ch.color}">${locked ? '🔒 ' : ''}${ch.name}</span>
            <span class="mast-rank" style="color:${rk.color};border-color:${rk.color}">${rk.name}</span>
          </div>
          <div class="mast-bar"><div class="mast-fill" style="width:${Math.round(rk.prog * 100)}%;background:${rk.color}"></div></div>
          <div class="mast-sub">${rk.next ? `${formatNum(pts)} pts · ${formatNum(toNext)} to ${rk.next.name}` : `${formatNum(pts)} pts · max rank`}</div>
          <div class="mast-stats">
            <span>${s ? s.runs : 0} runs</span>
            <span>☠ ${formatNum(s ? s.kills : 0)}</span>
            <span>⏱ ${formatTime(s ? s.bestTime : 0)}</span>
            <span>👑 ${formatNum(s ? s.bosses : 0)}</span>
          </div>
        </div>`;
    }).join('');
    // Weapon mastery: every base (non-evolved) weapon, lit by lifetime use.
    const weps = WEAPON_LIST.filter(w => !w.evolved).map(w => {
      const ws = Save.weaponStats(w.id);
      const used = ws && ws.runs > 0;
      const stars = Math.min(5, Math.floor(weaponMasteryPoints(ws) / 120));
      return `
        <div class="wep-mast ${used ? '' : 'dim'}" title="${w.name}">
          <span class="wep-ic" style="color:${w.color}">${w.icon}</span>
          <span class="wep-stars">${used ? '★'.repeat(stars) + '☆'.repeat(5 - stars) : '—'}</span>
          <span class="wep-runs">${used ? ws.runs + '× · ' + (ws.evolved ? '🧬' + ws.evolved : 'Lv' + ws.maxLevel) : 'unused'}</span>
        </div>`;
    }).join('');
    const playedAny = heroes.some(ch => Save.charStats(ch.id));
    this.root.innerHTML = `
      <div class="screen panel wide">
        <div class="panel-head">
          <h2>Mastery</h2>
          <span class="shard-chip big">${Save.data.runs} run${Save.data.runs === 1 ? '' : 's'}</span>
        </div>
        ${playedAny ? '' : '<p class="empty-note">Play a run to begin earning mastery with your heroes and weapons.</p>'}
        <p class="trial-intro">Reach <b style="color:#ffd84d">Veteran</b> with a hero for a glowing trail; <b style="color:#ff6b8a">Ascendant</b> earns a halo. Titles show on the character screen.</p>
        <h3 class="mast-section">Heroes</h3>
        <div class="mast-grid">${charCards}</div>
        <h3 class="mast-section">Weapons</h3>
        <div class="wep-grid">${weps}</div>
        <button class="btn" id="btn-back">← Back</button>
      </div>`;
    document.getElementById('btn-back').onclick = () => { Audio2.uiMove(); this.showMenu(); };
  },

  // ---- Trials of Light --------------------------------------------------
  showTrials() {
    this.clear(); this.show();
    const done = Save.trialsDone();
    const cards = TRIALS.map(t => {
      const cleared = Save.isTrialDone(t.id);
      const unlocked = trialUnlocked(t);
      const ch = getCharacter(t.char);
      const diff = getDifficulty(t.diff || 0);
      const lockedBy = unlocked ? [] : trialLockedBy(t);
      const state = cleared ? 'cleared' : (unlocked ? '' : 'locked');
      const body = unlocked
        ? `<p class="trial-desc">${t.desc}</p>
          <div class="trial-meta">
            <span class="trial-goal">🎯 ${trialGoalText(t)}</span>
            <span class="trial-tag" style="color:${ch ? ch.color : '#fff'}">${ch ? ch.name : 'Spark'}</span>
            ${t.diff ? `<span class="trial-tag" style="color:${diff.color};border-color:${diff.color}">${diff.name}</span>` : ''}
            <span class="trial-reward">✦ ${t.reward}</span>
          </div>
          <button class="btn ${cleared ? '' : 'btn-primary'}" data-trial="${t.id}">${cleared ? '↺ Replay' : '▶ Begin'}</button>`
        : `<p class="trial-desc trial-locked-desc">🔒 Locked — clear ${lockedBy.join(' & ')} to unlock.</p>
          <div class="trial-meta">
            <span class="trial-goal">🎯 ${trialGoalText(t)}</span>
            <span class="trial-reward">✦ ${t.reward}</span>
          </div>
          <button class="btn" disabled>🔒 Locked</button>`;
      return `
        <div class="trial-card ${state}" style="--c:${t.color}">
          <div class="trial-top">
            <span class="trial-name" style="color:${unlocked ? t.color : '#7488a8'}">${unlocked ? t.icon : '🔒'} ${t.name}</span>
            ${cleared ? '<span class="trial-done">✓ Cleared</span>' : ''}
          </div>
          ${body}
        </div>`;
    }).join('');
    this.root.innerHTML = `
      <div class="screen panel wide">
        <div class="panel-head">
          <h2>Trials of Light</h2>
          <span class="shard-chip big">${done} / ${TRIALS.length}</span>
        </div>
        <p class="trial-intro">Fixed-rule challenges with a clear objective. They ignore Omens and Relics — pure skill. Clearing a Trial unlocks the next on its path; first clear pays the full bounty.</p>
        <div class="trial-grid">${cards}</div>
        <button class="btn" id="btn-back">← Back</button>
      </div>`;
    this.root.querySelectorAll('[data-trial]').forEach(btn => {
      btn.onclick = () => {
        const t = getTrial(btn.getAttribute('data-trial'));
        if (!t || !trialUnlocked(t)) return;
        Audio2.uiSelect(); this.hide();
        const charId = Save.isUnlocked(t.char) ? t.char : 'spark';
        App.startRun(charId, t.diff || 0, { trial: t.id });
      };
    });
    document.getElementById('btn-back').onclick = () => { Audio2.uiMove(); this.showMenu(); };
  },

  // ---- Custom Run (mutators) --------------------------------------------
  showMutators() {
    this.clear(); this.show();
    if (!Array.isArray(this._mutators)) this._mutators = [];
    const sel = new Set(this._mutators);
    const boons = MUTATOR_LIST.filter(m => m.weight < 0);
    const banes = MUTATOR_LIST.filter(m => m.weight >= 0);
    const cardOf = m => {
      const on = sel.has(m.id);
      return `<button class="mut-card ${on ? 'on' : ''}" data-mut="${m.id}" style="--c:${m.color}">
        <span class="mut-ic">${m.icon}</span>
        <span class="mut-body"><b style="color:${m.color}">${m.name}</b><span class="mut-desc">${m.desc}</span></span>
        <span class="mut-check">${on ? '✓' : ''}</span>
      </button>`;
    };
    const mul = mutatorRewardMul(this._mutators);
    const score = mutatorScore(this._mutators);
    const tone = score > 0 ? '#ff9d3c' : (score < 0 ? '#8affc1' : '#9fb4d6');
    this.root.innerHTML = `
      <div class="screen panel wide">
        <div class="panel-head">
          <h2>🧪 Custom Run</h2>
          <span class="shard-chip big" style="color:${tone};border-color:${tone}">✦ ×${mul.toFixed(2)}</span>
        </div>
        <p class="trial-intro">Stack any mutators you like, then choose a hero. Harder choices raise your shard payout; easier ones lower it. Omens & Relics are off.</p>
        <h3 class="mast-section">Boons <small>(easier — less reward)</small></h3>
        <div class="mut-grid">${boons.map(cardOf).join('')}</div>
        <h3 class="mast-section">Banes <small>(harder — more reward)</small></h3>
        <div class="mut-grid">${banes.map(cardOf).join('')}</div>
        <div class="menu-buttons row">
          <button class="btn btn-primary" id="btn-go">Choose Hero → <span class="mut-count">${this._mutators.length} active</span></button>
          <button class="btn" id="btn-clear">Clear</button>
          <button class="btn" id="btn-back">← Back</button>
        </div>
      </div>`;
    this.root.querySelectorAll('[data-mut]').forEach(b => {
      b.onclick = () => {
        const id = b.getAttribute('data-mut');
        const i = this._mutators.indexOf(id);
        if (i >= 0) this._mutators.splice(i, 1); else this._mutators.push(id);
        Audio2.uiMove(); this.showMutators();
      };
    });
    document.getElementById('btn-go').onclick = () => { Audio2.uiSelect(); this.showCharacterSelect('custom'); };
    document.getElementById('btn-clear').onclick = () => { this._mutators = []; Audio2.uiMove(); this.showMutators(); };
    document.getElementById('btn-back').onclick = () => { Audio2.uiMove(); this.showMenu(); };
  },

  // ---- Codex / Bestiary -------------------------------------------------
  showCodex() {
    this.clear(); this.show();
    const enemyCards = Object.values(ENEMY_TYPES).concat(Object.values(BOSSES)).map(e => {
      const seen = Save.isSeen('enemies', e.id);
      return `<div class="codex-card ${seen ? '' : 'locked'}" style="--c:${e.color}">
        <div class="codex-glyph" style="color:${seen ? e.color : '#444'}">${e.boss ? '☠' : '◆'}</div>
        <h4>${seen ? e.name : '???'}</h4>
        <p>${seen ? (e.boss ? 'Boss' : 'HP ' + e.hp + ' · DMG ' + e.damage) : 'Undiscovered'}</p>
      </div>`;
    }).join('');
    const weaponCards = WEAPON_LIST.concat(Object.values(EVOLVED_WEAPONS)).map(w => {
      const seen = Save.isSeen('weapons', w.id);
      const evo = w.evolved;
      return `<div class="codex-card ${seen ? '' : 'locked'} ${evo ? 'evo' : ''}" style="--c:${w.color}">
        <div class="codex-glyph" style="color:${seen ? w.color : '#444'}">${seen ? w.icon : '?'}</div>
        <h4>${seen ? w.name : '???'}</h4>
        <p>${seen ? (evo ? 'Evolved' : 'Weapon') : 'Undiscovered'}</p>
      </div>`;
    }).join('');
    const synergyCards = SYNERGIES.map(s => {
      const icons = s.members.map(id => { const w = getWeapon(id); return w ? `<span style="color:${w.color}">${w.icon}</span>` : ''; }).join('<span class="syn-plus">+</span>');
      return `<div class="syn-card" style="--c:${s.color}">
        <div class="syn-card-head"><span class="syn-name" style="color:${s.color}">${s.icon} ${s.name}</span><span class="syn-req">any ${s.need}</span></div>
        <div class="syn-members">${icons}</div>
        <p>${s.desc}</p>
      </div>`;
    }).join('');
    const eSeen = Object.keys(ENEMY_TYPES).filter(k => Save.isSeen('enemies', k)).length;
    const wSeen = WEAPON_LIST.filter(w => Save.isSeen('weapons', w.id)).length;
    this.root.innerHTML = `
      <div class="screen panel wide">
        <div class="panel-head"><h2>Codex</h2></div>
        <h3 class="sub">Foes <small>(${eSeen}/${Object.keys(ENEMY_TYPES).length})</small></h3>
        <div class="codex-grid">${enemyCards}</div>
        <h3 class="sub">Arsenal <small>(${wSeen}/${WEAPON_LIST.length} + evolutions)</small></h3>
        <div class="codex-grid">${weaponCards}</div>
        <h3 class="sub">Synergies <small>(${SYNERGIES.length} set bonuses)</small></h3>
        <div class="syn-grid">${synergyCards}</div>
        <button class="btn" id="btn-back">← Back</button>
      </div>`;
    document.getElementById('btn-back').onclick = () => { Audio2.uiMove(); this.showMenu(); };
  },

  // ---- Meta shop (Sanctuary) -------------------------------------------
  showShop() {
    this.clear(); this.show();
    const items = META_UPGRADES.map(u => {
      const lvl = Save.metaLevel(u.id);
      const maxed = lvl >= u.max;
      const cost = metaCost(u, lvl);
      const affordable = Save.data.shards >= cost;
      const pips = Array.from({ length: u.max }, (_, i) => `<span class="pip ${i < lvl ? 'on' : ''}"></span>`).join('');
      return `
        <div class="shop-card ${maxed ? 'maxed' : ''}">
          <div class="shop-icon">${u.icon}</div>
          <div class="shop-info">
            <h3>${u.name}</h3>
            <p>${u.desc(lvl)}</p>
            <div class="pips">${pips}</div>
          </div>
          ${maxed
            ? `<div class="shop-buy maxed-tag">MAX</div>`
            : `<button class="shop-buy ${affordable ? '' : 'disabled'}" data-id="${u.id}">✦ ${cost}</button>`}
        </div>`;
    }).join('');
    this.root.innerHTML = `
      <div class="screen panel wide">
        <div class="panel-head">
          <h2>The Sanctuary</h2>
          <span class="shard-chip big">✦ ${formatNum(Save.data.shards)}</span>
        </div>
        <p class="tagline small">Permanent upgrades, carried into every run.</p>
        <div class="shop-grid">${items}</div>
        <div class="menu-buttons row">
          <button class="btn" id="btn-back">← Back</button>
          <button class="btn danger" id="btn-reset">Reset Progress</button>
        </div>
      </div>`;
    this.root.querySelectorAll('.shop-buy[data-id]').forEach(b => {
      b.onclick = () => {
        const u = getMeta(b.dataset.id);
        const cost = metaCost(u, Save.metaLevel(u.id));
        if (Save.metaLevel(u.id) < u.max && Save.spendShards(cost)) { Save.buyMeta(u.id); Audio2.buy(); this.showShop(); }
        else Audio2.deny();
      };
    });
    document.getElementById('btn-back').onclick = () => { Audio2.uiMove(); this.showMenu(); };
    document.getElementById('btn-reset').onclick = () => {
      if (confirm('Reset ALL progress? This cannot be undone.')) { Save.reset(); Audio2.deny(); this.showShop(); }
    };
  },

  // ---- Relics (permanent equippable modifiers) --------------------------
  showRelics() {
    this.clear(); this.show();
    const slots = Save.relicSlotCount();
    const used = Save.equippedRelics().length;
    const cards = RELIC_LIST.map(r => {
      const owned = Save.isRelicUnlocked(r.id);
      const equipped = Save.isEquipped(r.id);
      const gate = r.achievement ? getAchievement(r.achievement) : null;
      const gateMet = !gate || Save.hasAchievement(r.achievement);
      const affordable = Save.data.shards >= r.cost;
      let action;
      if (owned) action = `<button class="shop-buy relic-eq ${equipped ? 'on' : ''}" data-eq="${r.id}">${equipped ? '✓ Equipped' : 'Equip'}</button>`;
      else if (!gateMet) action = `<div class="shop-buy maxed-tag">🔒 ${gate.name}</div>`;
      else action = `<button class="shop-buy ${affordable ? '' : 'disabled'}" data-buy="${r.id}">✦ ${r.cost}</button>`;
      return `
        <div class="shop-card relic-card ${owned ? '' : 'locked'} ${equipped ? 'equipped' : ''}" style="--c:${r.color}">
          <div class="shop-icon" style="color:${r.color}">${owned || gateMet ? r.icon : '🔒'}</div>
          <div class="shop-info">
            <h3 style="color:${owned || gateMet ? r.color : ''}">${r.name}</h3>
            <p>${r.desc}</p>
            ${gate && !owned ? `<p class="hint">Unlocks via: ${gate.name}</p>` : ''}
          </div>
          ${action}
        </div>`;
    }).join('');
    this.root.innerHTML = `
      <div class="screen panel wide">
        <div class="panel-head">
          <h2>Relics</h2>
          <span class="shard-chip big">✦ ${formatNum(Save.data.shards)}</span>
        </div>
        <p class="tagline small">Unlock relics, then equip up to <b>${slots}</b> — <b>${used}/${slots}</b> slots used. Collect more relics to earn slots. (The Daily Challenge ignores relics.)</p>
        <div class="shop-grid">${cards}</div>
        <button class="btn" id="btn-back">← Back</button>
      </div>`;
    this.root.querySelectorAll('.shop-buy[data-buy]').forEach(b => {
      b.onclick = () => {
        const r = getRelic(b.dataset.buy);
        if (r && !Save.isRelicUnlocked(r.id) && Save.data.shards >= r.cost && Save.spendShards(r.cost)) {
          Save.unlockRelic(r.id); Audio2.buy(); this.showRelics();
        } else Audio2.deny();
      };
    });
    this.root.querySelectorAll('.shop-buy[data-eq]').forEach(b => {
      b.onclick = () => {
        const was = Save.isEquipped(b.dataset.eq);
        const now = Save.toggleEquip(b.dataset.eq);
        if (!was && !now) Audio2.deny(); else Audio2.uiSelect(); // deny = loadout full
        this.showRelics();
      };
    });
    document.getElementById('btn-back').onclick = () => { Audio2.uiMove(); this.showMenu(); };
  },

  // ---- Level up ---------------------------------------------------------
  showLevelUp(game, choices) {
    this.clear(); this.show();
    this.root.classList.add('translucent');
    this._levelChoices = choices;
    const cards = choices.map((c, i) => {
      const tag = c.evolve ? `<span class="evo-tag">EVOLVE</span>`
        : (c.isNew ? `<span class="new-tag">NEW</span>` : `<span class="lvl-tag">Lv ${c.level}</span>`);
      const kind = c.evolve ? 'Evolution'
        : (c.kind.startsWith('weapon') ? 'Weapon' : (c.kind === 'gold' ? 'Bonus' : 'Passive'));
      return `
        <div class="up-card ${c.evolve ? 'evolve-card' : ''}" data-i="${i}" style="--c:${c.color}">
          <div class="up-key">${i + 1}</div>
          <div class="up-icon" style="color:${c.color}">${c.icon}</div>
          <div class="up-kind">${kind}</div>
          <h3>${c.name} ${tag}</h3>
          <p>${c.desc}</p>
        </div>`;
    }).join('');
    // First level-up ever: teach the build loop (once).
    let coachLine = '';
    if (!Save.tipSeen('levelup')) {
      Save.markTip('levelup');
      coachLine = `<p class="coach-line">➤ Stack <b>weapons</b> and <b>passives</b> into a build — pair a maxed weapon with its passive to <b>evolve</b> it.</p>`;
    }
    this.root.innerHTML = `
      <div class="screen levelup">
        <h2 class="levelup-title">✦ LEVEL UP ✦</h2>
        <p class="levelup-sub">Choose your power${game.pendingLevels > 1 ? ` &nbsp;(${game.pendingLevels} pending)` : ''}</p>
        ${coachLine}
        <div class="up-grid">${cards}</div>
        <p class="hint">Press 1–${choices.length} or click</p>
      </div>`;
    this.root.querySelectorAll('.up-card').forEach(card => {
      card.onmouseenter = () => Audio2.uiMove();
      card.onclick = () => { const i = +card.dataset.i; game.chooseUpgrade(this._levelChoices[i]); };
    });
  },
  hideLevelUp() { this.hide(); this._levelChoices = null; this.root.classList.remove('translucent'); },

  // Called from key handler.
  pickLevelByIndex(i) {
    if (this._levelChoices && this._levelChoices[i]) {
      this.game.chooseUpgrade(this._levelChoices[i]);
    }
  },

  // ---- Pause ------------------------------------------------------------
  showPause(game) {
    this.clear(); this.show();
    this.root.classList.add('translucent');
    const p = game.player;
    const wlist = p.weapons.map(w => `<span class="tag" style="border-color:${w.def.color};color:${w.def.color}">${w.def.icon} ${w.def.name} L${w.level}</span>`).join('');
    const plist = Object.keys(p.passives).filter(k => p.passives[k] > 0)
      .map(k => { const d = PASSIVES[k]; return `<span class="tag" style="border-color:${d.color};color:${d.color}">${d.icon} ${d.name} L${p.passives[k]}</span>`; }).join('');
    const syn = (p.synergies || []);
    const slist = syn.map(s => `<span class="tag" style="border-color:${s.color};color:${s.color}" title="${s.desc}">${s.icon} ${s.name}</span>`).join('');
    this.root.innerHTML = `
      <div class="screen panel">
        <h2>Paused</h2>
        <div class="pause-stats">
          <div><span>Time</span><b>${formatTime(game.time)}</b></div>
          <div><span>Level</span><b>${p.level}</b></div>
          <div><span>Kills</span><b>${formatNum(game.kills)}</b></div>
          <div><span>Score</span><b>${formatNum(game.score)}</b></div>
        </div>
        <h3 class="sub">Weapons</h3><div class="tags">${wlist || '<i>none</i>'}</div>
        <h3 class="sub">Passives</h3><div class="tags">${plist || '<i>none</i>'}</div>
        ${syn.length ? `<h3 class="sub">Synergies</h3><div class="tags">${slist}</div>` : ''}
        <div class="menu-buttons row">
          <button class="btn btn-primary" id="btn-resume">▶ Resume</button>
          <button class="btn danger" id="btn-quit">⏏ Abandon Run</button>
        </div>
      </div>`;
    document.getElementById('btn-resume').onclick = () => { Audio2.uiSelect(); game.togglePause(); };
    document.getElementById('btn-quit').onclick = () => { Audio2.deny(); this.root.classList.remove('translucent'); game.onPlayerDeath(); };
  },
  hidePause() { this.hide(); this.root.classList.remove('translucent'); },

  // ---- Game over --------------------------------------------------------
  showGameOver(game) {
    this.clear(); this.show();
    const d = Save.data;
    const newBest = game.time >= d.bestTime;
    const newAch = game.lastNewAchievements || [];
    const achBlock = newAch.length ? `
      <div class="go-unlocks">
        <h3 class="sub" style="text-align:center;align-self:center">🏆 Unlocked</h3>
        <div class="tags">${newAch.map(a => `<span class="tag" style="border-color:#ffd84d;color:#ffd84d">${a.icon} ${a.name}${a.reward ? ' +' + a.reward + '✦' : ''}</span>`).join('')}</div>
      </div>` : '';
    const diffBlock = game.lastUnlockedDiff ? `<p class="new-best" style="color:${game.lastUnlockedDiff.color}">▲ ${game.lastUnlockedDiff.name} difficulty unlocked!</p>` : '';
    const trial = game.trial || null;
    const trialBlock = trial
      ? `<p class="new-best" style="color:${trial.color}">${game.trialWon
          ? (game.lastTrialFirst ? '★ Trial Cleared — first time! ★' : '✓ Trial cleared again')
          : 'Objective: ' + trialGoalText(trial)}</p>`
      : '';
    const gauntlet = game.mode === 'gauntlet';
    const diffTag = trial
      ? `<span class="diff-chip" style="color:${trial.color};border-color:${trial.color}">${trial.icon} Trial: ${trial.name}</span>`
      : game.customRun
      ? `<span class="diff-chip" style="color:#c9a8ff;border-color:#c9a8ff">🧪 Custom · ${game.mutators.length} mut · ×${game.mutatorRewardMul.toFixed(2)}</span>`
      : game.daily
      ? `<span class="diff-chip" style="color:#9ad8ff;border-color:#9ad8ff">🗓 Daily ${game.dailyDate}</span>`
      : gauntlet
        ? `<span class="diff-chip" style="color:#ffd84d;border-color:#ffd84d">⚔ Gauntlet${game.diffIndex > 0 ? ' · ' + game.diff.name : ''}</span>`
        : (game.diffIndex > 0 ? `<span class="diff-chip" style="color:${game.diff.color};border-color:${game.diff.color}">${game.diff.name}</span>` : '');
    const gauntletBlock = (gauntlet && game.lastGauntlet)
      ? `<p class="new-best" ${game.lastGauntlet.isNew ? '' : 'style="color:var(--muted)"'}>${game.lastGauntlet.isNew ? '★ New Gauntlet Best — Round ' + game.gauntletCleared + '!' : 'Gauntlet best: Round ' + game.lastGauntlet.best.rounds}</p>`
      : '';
    const omenTag = game.omen ? `<span class="diff-chip" style="color:${game.omen.color};border-color:${game.omen.color}">${game.omen.icon} ${game.omen.name}</span>` : '';
    const relicTag = (game.relics && game.relics.length)
      ? `<span class="diff-chip" style="color:#c9a8ff;border-color:#c9a8ff">🔮 ${game.relics.map(id => { const r = getRelic(id); return r ? r.icon : ''; }).join(' ')}</span>` : '';
    const dailyBlock = (game.daily && game.lastDaily)
      ? `<p class="new-best" ${game.lastDaily.isNew ? '' : 'style="color:var(--muted)"'}>${game.lastDaily.isNew ? '★ New Daily Best!' : 'Daily best: ' + formatNum(game.lastDaily.best.score) + ' (' + formatTime(game.lastDaily.best.time) + ')'}</p>`
      : '';
    const title = game.trialWon ? 'Trial Complete!' : (trial ? 'Trial Failed' : 'The light fades…');
    const hero = game.player && game.player.char;
    const heroLine = hero
      ? `<p class="go-hero" style="color:${hero.color}">${hero.name}${game.player.masteryTitle && game.player.masteryRank > 0 ? ' · 🎖 ' + game.player.masteryTitle : ''}</p>` : '';
    this.root.innerHTML = `
      <div class="screen panel">
        <h2 class="gameover-title" ${game.trialWon ? `style="color:${trial.color}"` : ''}>${title}</h2>
        ${heroLine}
        ${diffTag} ${omenTag} ${relicTag}
        ${trialBlock}
        ${dailyBlock}
        ${gauntletBlock}
        ${!game.daily && !gauntlet && newBest ? '<p class="new-best">★ New Best Time! ★</p>' : ''}
        ${diffBlock}
        <div class="go-stats">
          <div class="go-big"><span>${gauntlet ? 'Rounds Cleared' : 'Survived'}</span><b>${gauntlet ? game.gauntletCleared : formatTime(game.time)}</b></div>
          <div class="go-row">
            <div><span>Score</span><b>${formatNum(game.score)}</b></div>
            <div><span>Kills</span><b>${formatNum(game.kills)}</b></div>
            <div><span>Level</span><b>${game.player.level}</b></div>
            <div><span>Bosses</span><b>${game.bossKills}</b></div>
          </div>
          <div class="earned">✦ Shards earned: <b>${formatNum(game.lastEarned || 0)}</b></div>
        </div>
        ${achBlock}
        <div class="menu-buttons row">
          <button class="btn btn-primary" id="btn-retry">↺ Play Again</button>
          <button class="btn" id="btn-history">📜 History</button>
          <button class="btn" id="btn-menu">⌂ Menu</button>
        </div>
      </div>`;
    document.getElementById('btn-history').onclick = () => { Audio2.uiSelect(); this.showHistory(); };
    const wasDaily = game.daily;
    const wasMode = game.mode;
    const wasTrial = trial ? trial.id : null;
    const wasCustom = game.customRun ? game.mutators.slice() : null;
    const wasChar = (game.player && game.player.char) ? game.player.char.id : 'spark';
    const wasDiff = game.diffIndex || 0;
    const retryBtn = document.getElementById('btn-retry');
    if (wasTrial) retryBtn.textContent = '↺ Retry Trial';
    else if (wasCustom) retryBtn.textContent = '↺ Run Again';
    retryBtn.onclick = () => {
      Audio2.uiSelect(); this.hide();
      if (wasTrial) App.startRun(wasChar, trial.diff || 0, { trial: wasTrial });
      else if (wasCustom) App.startRun(wasChar, wasDiff, { mode: 'custom', mutators: wasCustom });
      else if (wasDaily) App.startRun('spark', 0, { daily: true });
      else this.showCharacterSelect(wasMode);
    };
    document.getElementById('btn-menu').onclick = () => { Audio2.uiMove(); this.showMenu(); };
  },
};
