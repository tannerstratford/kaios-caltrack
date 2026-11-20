// Benchmark: current ZXing pipeline vs EAN model decoder on synthetic frames.
// node test/bench.js [n per cell]
const fs = require("fs"), vm = require("vm"), path = require("path");
const S = require("./synth.js"), EAN = require("../src/ean.js");
const ZXing = require("../src/zxing.min.js");
const ctx = { ZXing, Map, Uint8ClampedArray, Float32Array, Float64Array, Math, console };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/scanner.js"), "utf8").replace("}(this));", "}(window));"), ctx);
const Scanner = ctx.Scanner;

const N = +process.argv[2] || 4, r = S.rng(42);
const Xs = [1.0, 1.2, 1.5, 2, 3], BL = [0.3, 0.6, 0.9, 1.2];
let tot = { z: 0, e: 0, ew: 0, zw: 0, both: 0, n: 0 }, tE = 0, tZ = 0;
const rows = [];
for (const X of Xs) {
  const row = [];
  for (const b of BL) {
    let z = 0, e = 0, ew = 0, zw = 0, any = 0;
    for (let i = 0; i < N; i++) {
      const text = S.randomCode(r), w = Math.min(480, Math.ceil(95 * X + 90)), h = 72;
      const o = { text, w, h, X, blur: b * X, noise: 2 + r() * 8, angle: (r() - 0.5) * 6, persp: (r() - 0.5) * 0.06,
        spread: (r() - 0.5) * 0.3, grad: (r() - 0.5) * 0.6, white: 170 + r() * 60, black: 30 + r() * 50,
        sharpen: r() < 0.3 ? 0.8 : 0, seed: Math.floor(r() * 1e6) };
      const g = S.render(o);
      let t = Date.now(); const zr = Scanner.decodeBest(g, w, h); tZ += Date.now() - t;
      t = Date.now(); const er = EAN.decodeImage(g, w, h); tE += Date.now() - t;
      const zt = zr && (zr.length === 12 ? "0" + zr : zr);
      if (zt === text) z++; else if (zt) zw++;
      if (er && er.text === text) { e++; (global.OK = global.OK || []).push(er); } else if (er) { ew++; console.log("WRONG", X, b, text, er.text, er.rms.toFixed(3), er.margin.toFixed(4), JSON.stringify(er.prm, (k, v) => typeof v === "number" ? +v.toFixed(3) : v)); }
      if (zt === text || (er && er.text === text)) any++;
      tot.n++;
    }
    tot.z += z; tot.e += e; tot.ew += ew; tot.zw += zw; tot.both += any;
    row.push(`zx ${z} ean ${e}${ew ? " WRONG " + ew : ""}`);
  }
  rows.push(`X=${X}: ` + row.join(" | "));
}
console.log("blur/X columns:", BL.join(", "), " n per cell", N);
rows.forEach(l => console.log(l));
console.log(`total ${tot.n}: zxing ${tot.z} (wrong ${tot.zw}), ean ${tot.e} (wrong ${tot.ew}), either ${tot.both}`);
console.log(`time per frame: zxing ${(tZ / tot.n).toFixed(1)} ms, ean ${(tE / tot.n).toFixed(1)} ms`);

// False positives on non-barcode textures
let fp = 0, nfp = 60;
for (let i = 0; i < nfp; i++) {
  const w = 360, h = 72, g = new Uint8ClampedArray(w * h), rr = S.rng(1000 + i);
  // random stripes of random widths (text-like / packaging patterns), blurred by averaging
  let x = 0, v = 200; const col = new Float64Array(w);
  while (x < w) { const len = 1 + Math.floor(rr() * (i % 3 === 0 ? 4 : 12)); v = rr() < 0.5 ? 40 + rr() * 60 : 160 + rr() * 80; for (let k = 0; k < len && x < w; k++) col[x++] = v; }
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) g[y * w + xx] = (col[Math.max(0, xx - 1)] + col[xx] + col[Math.min(w - 1, xx + 1)]) / 3 + (rr() - 0.5) * 10;
  const er = EAN.decodeImage(g, w, h);
  if (er) { fp++; console.log("FALSE POSITIVE", er.text, er.rms.toFixed(3), JSON.stringify(er.prm)); }
}
console.log(`false positives: ${fp}/${nfp}`);
const ok = global.OK || [];
const q = (a, f) => { a = a.slice().sort((x, y) => x - y); return a[Math.floor(a.length * f)]; };
console.log("correct reads: rms p50/p90/max", q(ok.map(o => o.rms), .5).toFixed(3), q(ok.map(o => o.rms), .9).toFixed(3), Math.max(...ok.map(o => o.rms)).toFixed(3),
  " sig p90/max", q(ok.map(o => o.prm.sig), .9).toFixed(2), Math.max(...ok.map(o => o.prm.sig)).toFixed(2),
  " margin p90/max", q(ok.map(o => o.margin), .9).toFixed(4), Math.max(...ok.map(o => o.margin)).toFixed(4));
