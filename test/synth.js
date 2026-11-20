// Synthetic camera-like barcode frames for decoder benchmarks.
"use strict";
const EAN = require("../src/ean.js");

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function randomCode(r) {
  const d = []; for (let i = 0; i < 12; i++) d.push(Math.floor(r() * 10));
  let sum = 0; for (let i = 0; i < 12; i++) sum += d[i] * (i % 2 ? 3 : 1);
  d.push((10 - (sum % 10)) % 10);
  return d.join("");
}

function moduleBits(text) {
  const d = text.split("").map(Number), pat = EAN.PAR[d[0]], b = [1, 0, 1];
  for (let i = 0; i < 6; i++) b.push(...EAN.LEFT[d[i + 1] + 10 * ((pat >> (5 - i)) & 1)]);
  b.push(0, 1, 0, 1, 0);
  for (let i = 0; i < 6; i++) b.push(...EAN.RIGHT[d[i + 7]]);
  b.push(1, 0, 1);
  return b;
}

function gaussBlur(img, w, h, sig) {
  if (sig < 0.3) return img;
  const r = Math.ceil(3 * sig), k = []; let ks = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-i * i / (2 * sig * sig)); k.push(v); ks += v; }
  const tmp = new Float64Array(w * h), out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0; for (let i = -r; i <= r; i++) s += img[y * w + Math.min(w - 1, Math.max(0, x + i))] * k[i + r]; tmp[y * w + x] = s / ks;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0; for (let i = -r; i <= r; i++) s += tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x] * k[i + r]; out[y * w + x] = s / ks;
  }
  return out;
}

// o: {text, w, h, X (px/module), blur (px), angle (deg), persp, spread (modules), noise, white, black, grad, sharpen, x0}
function render(o) {
  const w = o.w, h = o.h, bits = moduleBits(o.text), X = o.X;
  const total = 95 * X, x0 = o.x0 != null ? o.x0 : (w - total) / 2;
  const a = (o.angle || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), cx = w / 2, cy = h / 2;
  const barH = o.barH || h * 0.8, img = new Float64Array(w * h), SS = 4, sp = (o.spread || 0) / 2, pp = o.persp || 0;
  const isBar = u => {   // u module coordinate; ink spread widens bars
    if (u < -sp || u >= 95 + sp) return false;
    const m = Math.floor(u);
    if (m >= 0 && m < 95 && bits[m]) return true;
    const f = u - m;
    if (f < sp && m - 1 >= 0 && m - 1 < 95 && bits[m - 1] && !(m >= 0 && m < 95 && bits[m])) return true;
    if (f > 1 - sp && m + 1 < 95 && m + 1 >= 0 && bits[m + 1]) return true;
    return false;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let cov = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const px = x + (sx + 0.5) / SS - cx, py = y + (sy + 0.5) / SS - cy;
      const rx = px * ca + py * sa + cx, ry = -px * sa + py * ca + cy;
      if (Math.abs(ry - cy) > barH / 2) continue;
      // perspective: module width grows linearly across the code
      const t = (rx - x0) / total; let u = t * 95; u = u + pp * 95 * t * (t - 1);
      if (isBar(u)) cov++;
    }
    img[y * w + x] = cov / (SS * SS);
  }
  let b = gaussBlur(img, w, h, o.blur || 0);
  const r = rng(o.seed || 1), W = o.white || 200, B = o.black || 40, g = o.grad || 0, out = new Uint8ClampedArray(w * h);
  if (o.sharpen) { const bb = gaussBlur(b, w, h, 1.2); b = b.map((v, i) => v + o.sharpen * (v - bb[i])); }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const light = 1 + g * (x / w - 0.5);
    let v = (W - (W - B) * b[y * w + x]) * light;
    // gaussian-ish noise
    v += (o.noise || 0) * ((r() + r() + r() - 1.5) * 2);
    out[y * w + x] = Math.round(v);
  }
  return out;
}

module.exports = { render, randomCode, moduleBits, rng };
