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
          <button class="btn" id="btn-shop">⚙ SANCTUARY <span class="shard-chip">✦ ${formatNum(d.shards)}</span></button>
          <div class="menu-buttons row">
            <button class="btn" id="btn-ach">🏆 ${Save.achievementCount()}/${ACHIEVEMENTS.length}</button>
            <button class="btn" id="btn-codex">📖 CODEX</button>
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
        </div>
        <p class="hint">Move: WASD / Arrows • Pause: Esc/P • Weapons fire automatically</p>
      </div>`;
    document.getElementById('btn-play').onclick = () => { Audio2.uiSelect(); this.showCharacterSelect('survival'); };
    document.getElementById('btn-gauntlet').onclick = () => { Audio2.uiSelect(); this.showCharacterSelect('gauntlet'); };
    document.getElementById('btn-daily').onclick = () => { Audio2.uiSelect(); this.hide(); App.startRun('spark', 0, { daily: true }); };
    document.getElementById('btn-shop').onclick = () => { Audio2.uiSelect(); this.showShop(); };
    document.getElementById('btn-ach').onclick = () => { Audio2.uiSelect(); this.showAchievements(); };
    document.getElementById('btn-codex').onclick = () => { Audio2.uiSelect(); this.showCodex(); };
    document.getElementById('btn-help').onclick = () => { Audio2.uiSelect(); this.showHelp(); };
    document.getElementById('btn-sfx').onclick = (e) => { Audio2.resume(); const m = Audio2.toggleMute(); Save.data.muted = m; Save.save(); e.target.textContent = (m ? '🔇' : '🔊') + ' SFX'; };
    document.getElementById('btn-music').onclick = (e) => { Audio2.resume(); const m = Audio2.toggleMusic(); Save.data.musicMuted = m; Save.save(); e.target.textContent = (m ? '🎵̶' : '🎵') + ' Music'; };
    document.getElementById('btn-shake').onclick = (e) => { Save.data.shakeOff = !Save.data.shakeOff; Save.save(); e.target.textContent = (Save.data.shakeOff ? '⬚' : '⬛') + ' Shake'; Audio2.uiMove(); };
    document.getElementById('btn-dmg').onclick = (e) => { Save.data.dmgNumbers = !Save.data.dmgNumbers; Save.save(); e.target.textContent = (Save.data.dmgNumbers ? '🔢' : '⬚') + ' Damage #'; Audio2.uiMove(); };
  },

  showHelp() {
    this.clear(); this.show();
    this.root.innerHTML = `
      <div class="screen panel">
        <h2>How to Play</h2>
        <div class="help-grid">
          <div class="help-card"><h3>🎯 Goal</h3><p>You are the last light. Endless waves of dark close in. Survive as long as you can — there is no winning, only how long you last.</p></div>
          <div class="help-card"><h3>🕹 Move</h3><p><b>WASD</b> or <b>Arrow keys</b> to move (drag on touch screens). Your weapons fire <b>automatically</b> — focus on positioning and dodging.</p></div>
          <div class="help-card"><h3>💎 Grow</h3><p>Defeated foes drop light shards. Collect them to level up and <b>choose an upgrade</b> — new weapons, weapon levels, or passive boosts.</p></div>
          <div class="help-card"><h3>⚒ Build</h3><p>You hold up to <b>6 weapons</b> and <b>6 passives</b>. Combine them into a build. Every run is different.</p></div>
          <div class="help-card"><h3>☠ Bosses</h3><p>Bosses arrive on a timer and hit hard — but drop a flood of XP and treasure. Survive past 10:00 to face the Devourer.</p></div>
          <div class="help-card"><h3>✦ Sanctuary</h3><p>Earn shards every run. Spend them in the Sanctuary on <b>permanent upgrades</b> and to <b>unlock new characters</b>.</p></div>
          <div class="help-card"><h3>🧬 Evolve</h3><p>Max a weapon <b>and</b> own its paired passive to unlock a golden <b>EVOLUTION</b> — a far more powerful form. Chase them.</p></div>
          <div class="help-card"><h3>🎴 Omens</h3><p>Before each run, draft a powerful <b>Omen</b> that reshapes the whole run — usually a big upside with a tradeoff. Or play with none.</p></div>
          <div class="help-card"><h3>⚔ Gauntlet</h3><p>A boss-rush mode: <b>endless rounds of bosses</b>, escalating each time, with a short breather between. You start with extra upgrades — how many rounds can you clear?</p></div>
          <div class="help-card"><h3>🗓 Daily</h3><p>A <b>seeded</b> run that's the same for everyone today. Pure skill — beat your own best score each day.</p></div>
          <div class="help-card"><h3>⚙ Options</h3><p>From the menu, toggle <b>SFX</b>, <b>Music</b>, <b>screen shake</b>, and floating <b>damage numbers</b> to taste.</p></div>
        </div>
        <button class="btn btn-primary" id="btn-back">← Back</button>
      </div>`;
    document.getElementById('btn-back').onclick = () => { Audio2.uiMove(); this.showMenu(); };
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
      return `
        <div class="char-card ${unlocked ? '' : 'locked'} ${c.secret ? 'secret' : ''}" data-id="${c.id}">
          <div class="char-orb" style="--c:${c.color}"></div>
          <h3 style="color:${c.color}">${unlocked || !c.secret ? c.name : '???'}</h3>
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
          <h2>${this._mode === 'gauntlet' ? '⚔ Gauntlet — Choose your Light' : 'Choose your Light'}</h2>
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
      b.onclick = () => { Audio2.uiSelect(); this.showOmenDraft(b.dataset.id, this._selectedDiff, this._mode); };
    });
    this.root.querySelectorAll('.unlock-btn').forEach(b => {
      b.onclick = () => {
        const c = getCharacter(b.dataset.id);
        if (Save.spendShards(c.cost)) { Save.unlock(c.id); Audio2.buy(); this.showCharacterSelect(); }
        else Audio2.deny();
      };
    });
    document.getElementById('btn-back').onclick = () => { Audio2.uiMove(); this.showMenu(); };
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
    const eSeen = Object.keys(ENEMY_TYPES).filter(k => Save.isSeen('enemies', k)).length;
    const wSeen = WEAPON_LIST.filter(w => Save.isSeen('weapons', w.id)).length;
    this.root.innerHTML = `
      <div class="screen panel wide">
        <div class="panel-head"><h2>Codex</h2></div>
        <h3 class="sub">Foes <small>(${eSeen}/${Object.keys(ENEMY_TYPES).length})</small></h3>
        <div class="codex-grid">${enemyCards}</div>
        <h3 class="sub">Arsenal <small>(${wSeen}/${WEAPON_LIST.length} + evolutions)</small></h3>
        <div class="codex-grid">${weaponCards}</div>
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
    this.root.innerHTML = `
      <div class="screen levelup">
        <h2 class="levelup-title">✦ LEVEL UP ✦</h2>
        <p class="levelup-sub">Choose your power${game.pendingLevels > 1 ? ` &nbsp;(${game.pendingLevels} pending)` : ''}</p>
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
    const gauntlet = game.mode === 'gauntlet';
    const diffTag = game.daily
      ? `<span class="diff-chip" style="color:#9ad8ff;border-color:#9ad8ff">🗓 Daily ${game.dailyDate}</span>`
      : gauntlet
        ? `<span class="diff-chip" style="color:#ffd84d;border-color:#ffd84d">⚔ Gauntlet${game.diffIndex > 0 ? ' · ' + game.diff.name : ''}</span>`
        : (game.diffIndex > 0 ? `<span class="diff-chip" style="color:${game.diff.color};border-color:${game.diff.color}">${game.diff.name}</span>` : '');
    const gauntletBlock = (gauntlet && game.lastGauntlet)
      ? `<p class="new-best" ${game.lastGauntlet.isNew ? '' : 'style="color:var(--muted)"'}>${game.lastGauntlet.isNew ? '★ New Gauntlet Best — Round ' + game.gauntletCleared + '!' : 'Gauntlet best: Round ' + game.lastGauntlet.best.rounds}</p>`
      : '';
    const omenTag = game.omen ? `<span class="diff-chip" style="color:${game.omen.color};border-color:${game.omen.color}">${game.omen.icon} ${game.omen.name}</span>` : '';
    const dailyBlock = (game.daily && game.lastDaily)
      ? `<p class="new-best" ${game.lastDaily.isNew ? '' : 'style="color:var(--muted)"'}>${game.lastDaily.isNew ? '★ New Daily Best!' : 'Daily best: ' + formatNum(game.lastDaily.best.score) + ' (' + formatTime(game.lastDaily.best.time) + ')'}</p>`
      : '';
    this.root.innerHTML = `
      <div class="screen panel">
        <h2 class="gameover-title">The light fades…</h2>
        ${diffTag} ${omenTag}
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
          <button class="btn" id="btn-menu">⌂ Menu</button>
        </div>
      </div>`;
    const wasDaily = game.daily;
    const wasMode = game.mode;
    document.getElementById('btn-retry').onclick = () => {
      Audio2.uiSelect(); this.hide();
      if (wasDaily) App.startRun('spark', 0, { daily: true });
      else this.showCharacterSelect(wasMode);
    };
    document.getElementById('btn-menu').onclick = () => { Audio2.uiMove(); this.showMenu(); };
  },
};
