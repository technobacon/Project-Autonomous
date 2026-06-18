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

  clear() { this.root.innerHTML = ''; this.root.className = 'overlay'; },
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
          <button class="btn" id="btn-shop">⚙ SANCTUARY <span class="shard-chip">✦ ${formatNum(d.shards)}</span></button>
          <button class="btn" id="btn-help">? HOW TO PLAY</button>
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
        </div>
        <p class="hint">Move: WASD / Arrows • Pause: Esc/P • Weapons fire automatically</p>
      </div>`;
    document.getElementById('btn-play').onclick = () => { Audio2.uiSelect(); this.showCharacterSelect(); };
    document.getElementById('btn-shop').onclick = () => { Audio2.uiSelect(); this.showShop(); };
    document.getElementById('btn-help').onclick = () => { Audio2.uiSelect(); this.showHelp(); };
    document.getElementById('btn-sfx').onclick = (e) => { Audio2.resume(); const m = Audio2.toggleMute(); Save.data.muted = m; Save.save(); e.target.textContent = (m ? '🔇' : '🔊') + ' SFX'; };
    document.getElementById('btn-music').onclick = (e) => { Audio2.resume(); const m = Audio2.toggleMusic(); Save.data.musicMuted = m; Save.save(); e.target.textContent = (m ? '🎵̶' : '🎵') + ' Music'; };
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
        </div>
        <button class="btn btn-primary" id="btn-back">← Back</button>
      </div>`;
    document.getElementById('btn-back').onclick = () => { Audio2.uiMove(); this.showMenu(); };
  },

  // ---- Character select -------------------------------------------------
  showCharacterSelect() {
    this.clear(); this.show();
    const cards = CHARACTERS.map(c => {
      const unlocked = Save.isUnlocked(c.id);
      const affordable = Save.data.shards >= c.cost;
      return `
        <div class="char-card ${unlocked ? '' : 'locked'}" data-id="${c.id}">
          <div class="char-orb" style="--c:${c.color}"></div>
          <h3 style="color:${c.color}">${c.name}</h3>
          <p class="char-desc">${c.desc}</p>
          <p class="char-blurb">${c.blurb}</p>
          <div class="char-stats">
            <span>❤ ${c.stats.maxHp}</span><span>👟 ${c.stats.speed}</span>
            <span>🗡 ${Math.round(c.stats.might*100)}%</span>
          </div>
          ${unlocked
            ? `<button class="btn btn-primary select-btn" data-id="${c.id}">SELECT</button>`
            : `<button class="btn ${affordable ? '' : 'disabled'} unlock-btn" data-id="${c.id}">🔒 Unlock ✦${c.cost}</button>`}
        </div>`;
    }).join('');
    this.root.innerHTML = `
      <div class="screen panel wide">
        <div class="panel-head">
          <h2>Choose your Light</h2>
          <span class="shard-chip big">✦ ${formatNum(Save.data.shards)}</span>
        </div>
        <div class="char-grid">${cards}</div>
        <button class="btn" id="btn-back">← Back</button>
      </div>`;
    this.root.querySelectorAll('.select-btn').forEach(b => {
      b.onclick = () => { Audio2.uiSelect(); this.hide(); App.startRun(b.dataset.id); };
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
      const newTag = c.isNew ? `<span class="new-tag">NEW</span>` : `<span class="lvl-tag">Lv ${c.level}</span>`;
      const kind = c.kind.startsWith('weapon') ? 'Weapon' : (c.kind === 'gold' ? 'Bonus' : 'Passive');
      return `
        <div class="up-card" data-i="${i}" style="--c:${c.color}">
          <div class="up-key">${i + 1}</div>
          <div class="up-icon" style="color:${c.color}">${c.icon}</div>
          <div class="up-kind">${kind}</div>
          <h3>${c.name} ${newTag}</h3>
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
    this.root.innerHTML = `
      <div class="screen panel">
        <h2 class="gameover-title">The light fades…</h2>
        ${newBest ? '<p class="new-best">★ New Best Time! ★</p>' : ''}
        <div class="go-stats">
          <div class="go-big"><span>Survived</span><b>${formatTime(game.time)}</b></div>
          <div class="go-row">
            <div><span>Score</span><b>${formatNum(game.score)}</b></div>
            <div><span>Kills</span><b>${formatNum(game.kills)}</b></div>
            <div><span>Level</span><b>${game.player.level}</b></div>
            <div><span>Bosses</span><b>${game.bossKills}</b></div>
          </div>
          <div class="earned">✦ Shards earned: <b>${formatNum(game.lastEarned || 0)}</b></div>
        </div>
        <div class="menu-buttons row">
          <button class="btn btn-primary" id="btn-retry">↺ Play Again</button>
          <button class="btn" id="btn-menu">⌂ Menu</button>
        </div>
      </div>`;
    document.getElementById('btn-retry').onclick = () => { Audio2.uiSelect(); this.hide(); this.showCharacterSelect(); };
    document.getElementById('btn-menu').onclick = () => { Audio2.uiMove(); this.showMenu(); };
  },
};
