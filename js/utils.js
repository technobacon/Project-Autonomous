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

// ---------------------------------------------------------------------------
// Randomness. Two independent streams:
//  - RNG: the seeded GAMEPLAY stream (spawns, drops, crits, upgrade offers…).
//    Consumed only inside the fixed-timestep simulation, so a given seed yields
//    the same world on any machine/framerate. This is what powers Daily runs.
//  - vrand(): a NON-seeded cosmetic stream (Math.random) for visuals/audio that
//    must NOT perturb the gameplay stream (particles drawn in render, screen
//    shake jitter, audio — all of which can be gated by user settings).
// ---------------------------------------------------------------------------
const RNG = {
  s: 0x9e3779b9 >>> 0,
  seed(n) { this.s = (n >>> 0) || 1; },
  // mulberry32 — fast, decent quality, deterministic.
  next() {
    this.s = (this.s + 0x6D2B79F5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  },
};

// Hash a string to a 32-bit seed (for date-based Daily seeds).
function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Gameplay random helpers (seeded — deterministic per RNG seed).
function rand(min, max) { return min + RNG.next() * (max - min); }
function randInt(min, max) { return Math.floor(min + RNG.next() * (max - min + 1)); }
function pick(arr) { return arr[(RNG.next() * arr.length) | 0]; }
function chance(p) { return RNG.next() < p; }
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (RNG.next() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Cosmetic random (NOT seeded) — for render/audio/shake only.
function vrand(min, max) { return min + Math.random() * (max - min); }

// Local-date string YYYY-MM-DD, used as the Daily Challenge seed key.
function dailyDateString(d) {
  d = d || new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

// Weighted pick: items must have a `.weight` field (or pass a weightFn).
function weightedPick(items, weightFn) {
  let total = 0;
  for (const it of items) total += (weightFn ? weightFn(it) : it.weight) || 0;
  if (total <= 0) return null;
  let r = RNG.next() * total;
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
