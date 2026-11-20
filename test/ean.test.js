// node test/ean.test.js — model decoder reads blurry low-res codes and never
// accepts junk. (Benchmark vs ZXing: node test/bench.js 20)
const assert = require("assert");
const S = require("./synth.js"), EAN = require("../src/ean.js");
const r = S.rng(99);
let ok = 0, wrong = 0, n = 0;
for (const X of [1.2, 1.6, 2.2]) for (const b of [0.4, 0.7, 0.9]) for (let i = 0; i < 3; i++) {
  const text = S.randomCode(r), w = Math.ceil(95 * X + 100), h = 64;
  const g = S.render({ text, w, h, X, blur: b * X, noise: 5, angle: (r() - 0.5) * 4, grad: 0.3, seed: n + 1 });
  const res = EAN.decodeImage(g, w, h);
  n++;
  if (res && res.text === text) ok++; else if (res) wrong++;
}
console.log(`decoded ${ok}/${n}, wrong ${wrong}`);
assert.strictEqual(wrong, 0, "no misreads");
assert.ok(ok >= n * 0.85, "reads most blurry frames");

// Blank / noise frames give nothing
const blank = new Uint8ClampedArray(300 * 60).fill(190);
assert.strictEqual(EAN.decodeImage(blank, 300, 60), null);
const rr = S.rng(5), noise = blank.map(() => 60 + rr() * 140);
assert.strictEqual(EAN.decodeImage(noise, 300, 60), null);
console.log("ean tests passed");

// Scanner vote rule: one frame's single read is not enough; two votes are.
{
  const fs = require("fs"), vm = require("vm");
  const ctx = { ZXing: require("../src/zxing.min.js"), Map, Uint8ClampedArray, Float32Array, Float64Array, Math };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + "/../src/scanner.js", "utf8").replace("}(this));", "}(window));"), ctx);
  const V = ctx.Scanner.vote;
  assert.strictEqual(V(["0049000006346"]), null);
  assert.strictEqual(V(["04900634"]), null);
  assert.strictEqual(V([]), null);
  assert.strictEqual(V(["0049000006346"]), "0049000006346");
  assert.strictEqual(V(["111", "222"]), null);
  assert.strictEqual(V(["333", "333"]), "333", "both decoders agreeing on one frame = 2 votes");
  console.log("vote tests passed");
}
