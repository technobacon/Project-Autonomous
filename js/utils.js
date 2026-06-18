// ===========================================================================
// LASTLIGHT - utils.js
// Math helpers, RNG, vectors, and small shared utilities.
// ===========================================================================

const TAU = Math.PI * 2;

function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function invLerp(a, b, v) { return (v - a) / (b - a); }
function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
function dist(ax, ay, bx, by) { return Math.sqrt(dist2(ax, ay, bx, by)); }
function angleTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }
function sign(x) { return x < 0 ? -1 : (x > 0 ? 1 : 0); }
function approach(cur, target, step) {
  if (cur < target) return Math.min(cur + step, target);
  if (cur > target) return Math.max(cur - step, target);
  return cur;
}

// Random helpers (Math.random based — good enough for a runs-based game).
function rand(min, max) { return min + Math.random() * (max - min); }
function randInt(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
function chance(p) { return Math.random() < p; }
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Weighted pick: items must have a `.weight` field (or pass a weightFn).
function weightedPick(items, weightFn) {
  let total = 0;
  for (const it of items) total += (weightFn ? weightFn(it) : it.weight) || 0;
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const it of items) {
    r -= (weightFn ? weightFn(it) : it.weight) || 0;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

// Format seconds as M:SS
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function formatNum(n) {
  n = Math.floor(n);
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
  return '' + n;
}

// Color helpers — work with HSL strings for easy neon palettes.
function hsl(h, s, l, a) {
  return a === undefined
    ? `hsl(${h},${s}%,${l}%)`
    : `hsla(${h},${s}%,${l}%,${a})`;
}

// A lightweight object pool to avoid GC churn for short-lived entities.
class Pool {
  constructor(factory) {
    this.factory = factory;
    this.free = [];
  }
  obtain() { return this.free.length ? this.free.pop() : this.factory(); }
  recycle(obj) { this.free.push(obj); }
}
