// ===========================================================================
// LASTLIGHT - input.js
// Keyboard + pointer input. Exposes a normalized movement vector and a small
// "just pressed" queue used by menus.
// ===========================================================================

const Input = {
  keys: {},
  pressed: {},        // edge-triggered (consumed by menus)
  mouse: { x: 0, y: 0, down: false },
  _bound: false,

  init(canvas) {
    if (this._bound) return;
    this._bound = true;

    window.addEventListener('keydown', (e) => {
      // Prevent scrolling / browser shortcuts while playing.
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','Space'].includes(e.key)) e.preventDefault();
      const k = this._norm(e.key);
      if (!this.keys[k]) this.pressed[k] = true;
      this.keys[k] = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys[this._norm(e.key)] = false;
    });
    window.addEventListener('blur', () => { this.keys = {}; });

    const updateMouse = (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = (e.clientX - r.left) * (canvas.width / r.width);
      this.mouse.y = (e.clientY - r.top) * (canvas.height / r.height);
    };
    canvas.addEventListener('mousemove', updateMouse);
    canvas.addEventListener('mousedown', (e) => { updateMouse(e); this.mouse.down = true; });
    window.addEventListener('mouseup', () => { this.mouse.down = false; });

    // Touch -> virtual joystick handled in game for movement; track tap here.
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches[0]) {
        const r = canvas.getBoundingClientRect();
        this.mouse.x = (e.touches[0].clientX - r.left) * (canvas.width / r.width);
        this.mouse.y = (e.touches[0].clientY - r.top) * (canvas.height / r.height);
        this.mouse.down = true;
      }
    }, { passive: true });
  },

  _norm(key) {
    if (key === ' ') return 'space';
    return key.length === 1 ? key.toLowerCase() : key.toLowerCase();
  },

  isDown(...ks) { return ks.some(k => this.keys[k.toLowerCase()]); },

  // Consume an edge-triggered press (returns true once).
  justPressed(...ks) {
    for (const k of ks) {
      const key = k.toLowerCase();
      if (this.pressed[key]) { this.pressed[key] = false; return true; }
    }
    return false;
  },

  clearPressed() { this.pressed = {}; },

  // Normalized movement vector from WASD / arrows. Returns {x,y}.
  moveVector() {
    let x = 0, y = 0;
    if (this.isDown('a', 'arrowleft')) x -= 1;
    if (this.isDown('d', 'arrowright')) x += 1;
    if (this.isDown('w', 'arrowup')) y -= 1;
    if (this.isDown('s', 'arrowdown')) y += 1;
    if (x !== 0 && y !== 0) { const inv = 1 / Math.SQRT2; x *= inv; y *= inv; }
    return { x, y };
  },
};
