// Blur-tolerant EAN-13 / UPC-A decoder for low-resolution, out-of-focus
// camera frames. ZXing thresholds each row into black/white runs, which fails
// once the thin bars and spaces smear together. This instead fits a model:
//
//   1. Average many rows (with a small shear search for tilt) into a clean
//      1D brightness profile.
//   2. Find the barcode's outer edges -> start position s and module width X.
//   3. For a blur width sigma and ink spread g, every 7-module digit pattern
//      predicts a smeared brightness curve. Dynamic programming picks the 12
//      digits whose combined curve best matches the profile, with the
//      first-digit parity pattern and the check digit enforced exactly.
//   4. Re-fit s, X, perspective, sigma, g, brightness and contrast to the
//      decoded pattern and repeat until the answer stops changing.
//
// Pure functions (no DOM), so it runs in Node for testing.
(function (root) {
  "use strict";

  var LC = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
  function inv(s) { return s.replace(/./g, function (c) { return c === "0" ? "1" : "0"; }); }
  function rev(s) { return s.split("").reverse().join(""); }
  function bitsOf(s) { var a = []; for (var i = 0; i < 7; i++) a.push(+s[i]); return a; }
  var RC = LC.map(inv), GC = RC.map(rev);
  var LEFT = LC.concat(GC).map(bitsOf);   // index = digit + 10 * (G parity)
  var RIGHT = RC.map(bitsOf);
  var PAR = [0, 11, 13, 14, 19, 25, 28, 21, 22, 26]; // first digit -> L/G pattern (bit 5 = position 0)
  var NM = 95, QZ = 10, QUIET = 6;   // modules; quiet zone actually scored = QUIET
  var NB = NM + 2 * QZ;

  function slotStart(i) { return i < 6 ? 3 + 7 * i : 50 + 7 * (i - 6); }

  // ------------------------------------------------------------ math

  function erf(x) {
    var s = x < 0 ? -1 : 1; x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  function Phi(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }
  function phi(x) { return Math.exp(-0.5 * x * x) / 2.5066282746310002; }

  // Per sample phase: weight of each neighbouring module (H) and of each
  // module boundary for ink spread (Gd). Units: modules.
  function makeModel(sig, g, S) {
    var k = Math.max(1, Math.min(3, Math.ceil(2.5 * sig + Math.abs(g) / 2)));
    var H = [], Gd = [];
    for (var ph = 0; ph < S; ph++) {
      var uo = (ph + 0.5) / S, h = new Float64Array(2 * k + 1), gd = new Float64Array(2 * k + 1);
      for (var j = -k; j <= k; j++) h[j + k] = Phi((j + 1 - uo) / sig) - Phi((j - uo) / sig);
      for (var b = -k + 1; b <= k; b++) gd[b + k] = (g / 2) * phi((b - uo) / sig) / sig;
      H.push(h); Gd.push(gd);
    }
    return { sig: sig, g: g, S: S, k: k, H: H, Gd: Gd };
  }

  // Predicted darkness (0 white .. 1 black) at sample (module m, phase ph).
  function pred(bits, m, ph, md) {
    var k = md.k, h = md.H[ph], gd = md.Gd[ph], o = m + QZ, v = 0, j;
    for (j = -k; j <= k; j++) v += bits[o + j] * h[j + k];
    if (md.g) for (j = -k + 1; j <= k; j++) v += Math.abs(bits[o + j] - bits[o + j - 1]) * gd[j + k];
    return v;
  }

  function baseBits() {
    var b = new Float32Array(NB), i;
    for (i = 0; i < 12; i++) for (var j = 0; j < 7; j++) b[QZ + slotStart(i) + j] = 0.5;
    [0, 2, 46, 48, 92, 94].forEach(function (m) { b[QZ + m] = 1; });
    return b;
  }
  function putSlot(bits, i, code) { var o = QZ + slotStart(i); for (var j = 0; j < 7; j++) bits[o + j] = code[j]; }
  function fullBits(codes) { var b = baseBits(); for (var i = 0; i < 12; i++) putSlot(b, i, codes[i]); return b; }

  // ------------------------------------------------------------ sampling

  // Geometry: pixel of module coordinate u = s + X*u + q*u*(u-95)/95^2.
  function px(geo, u) { return geo.s + geo.X * u + geo.q * u * (u - NM) / (NM * NM); }

  // y[i] brightness at sample i (module m = i/S - QZ), wt[i] = 1 if inside profile.
  function sampleProfile(p, geo, S) {
    var n = NB * S, y = new Float64Array(n), wt = new Uint8Array(n), last = p.length - 1;
    for (var i = 0; i < n; i++) {
      var m = Math.floor(i / S) - QZ;
      if (m < -QUIET || m >= NM + QUIET) continue;
      var x = px(geo, m + ((i % S) + 0.5) / S);
      if (x < 0 || x > last) continue;
      var x0 = Math.floor(x), f = x - x0;
      y[i] = x0 >= last ? p[last] : p[x0] * (1 - f) + p[x0 + 1] * f;
      wt[i] = 1;
    }
    return { y: y, wt: wt };
  }

  // Brightness model y = A(t) - C(t)*darkness, A and C linear in t = position
  // across the code. Least squares for (a0, a1, c0, c1) given darkness d.
  function fitLight(y, wt, d, S) {
    var M = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], r = [0, 0, 0, 0], n = 0;
    for (var i = 0; i < y.length; i++) {
      if (!wt[i]) continue;
      var t = (i / S - QZ - NM / 2) / (NM / 2), f = [1, t, -d[i], -d[i] * t];
      for (var a = 0; a < 4; a++) { r[a] += f[a] * y[i]; for (var b = 0; b < 4; b++) M[a][b] += f[a] * f[b]; }
      n++;
    }
    var L = solve4(M, r);
    if (!L || !(L[2] > 0)) return null;
    var sse = 0;
    for (i = 0; i < y.length; i++) {
      if (!wt[i]) continue;
      t = (i / S - QZ - NM / 2) / (NM / 2);
      var e = y[i] - (L[0] + L[1] * t - (L[2] + L[3] * t) * d[i]);
      sse += e * e;
    }
    return { a0: L[0], a1: L[1], c0: L[2], c1: L[3], sse: sse, n: n };
  }

  function solve4(M, r) {
    var A = M.map(function (row, i) { return row.concat([r[i]]); }), n = 4;
    for (var c = 0; c < n; c++) {
      var piv = c;
      for (var i = c + 1; i < n; i++) if (Math.abs(A[i][c]) > Math.abs(A[piv][c])) piv = i;
      if (Math.abs(A[piv][c]) < 1e-9) return null;
      var tmp = A[c]; A[c] = A[piv]; A[piv] = tmp;
      for (i = 0; i < n; i++) {
        if (i === c) continue;
        var f = A[i][c] / A[c][c];
        for (var j = c; j <= n; j++) A[i][j] -= f * A[c][j];
      }
    }
    return A.map(function (row, i) { return row[n] / row[i]; });
  }

  // Normalised darkness z = (A - y) / C.
  function normalise(y, wt, light, S) {
    var z = new Float64Array(y.length);
    for (var i = 0; i < y.length; i++) {
      if (!wt[i]) continue;
      var t = (i / S - QZ - NM / 2) / (NM / 2), C = light.c0 + light.c1 * t;
      z[i] = (light.a0 + light.a1 * t - y[i]) / (C > 1e-6 ? C : 1e-6);
    }
    return z;
  }

  // ------------------------------------------------------------ digit search

  function windowCost(z, wt, bits, w0, w1, md) {
    var S = md.S, c = 0;
    for (var m = w0; m < w1; m++) {
      for (var ph = 0; ph < S; ph++) {
        var i = (m + QZ) * S + ph;
        if (!wt[i]) continue;
        var e = z[i] - pred(bits, m, ph, md);
        c += e * e;
      }
    }
    return c;
  }

  // Emission tables: cost of the samples owned by digit i given the codes
  // in slots i-1 and i. Windows are shifted left by k modules so each
  // sample only depends on those two slots.
  //
  // The prediction is additive per slot: pred = K + A[prev] + B[cur]
  // (every L/G code starts with a space and ends with a bar, every R code
  // the reverse, so the ink-spread edge between two slots never changes).
  // So cost(p, c) = |r - A_p - B_c|^2 with r = z - K, expanded into
  // precomputed norms and one dot product per pair.
  function emissions(z, wt, md) {
    var k = md.k, S = md.S, bits = baseBits(), E = [];
    var constCost = windowCost(z, wt, bits, -QUIET, 3 - k, md);
    for (var i = 0; i < 12; i++) {
      var st = slotStart(i), w0 = st - k, w1 = st + 7 - k;
      if (i === 5) w1 = 50 - k;
      if (i === 11) w1 = NM + QUIET;
      var P = i === 0 ? [null] : (i <= 6 ? LEFT : RIGHT), C = i < 6 ? LEFT : RIGHT;
      // samples in the window
      var idx = [];
      for (var m = w0; m < w1; m++) for (var ph = 0; ph < S; ph++) { var si = (m + QZ) * S + ph; if (wt[si]) idx.push(si); }
      var L = idx.length;
      var predWin = function () {
        var o = new Float64Array(L);
        for (var j = 0; j < L; j++) o[j] = pred(bits, Math.floor(idx[j] / S) - QZ, idx[j] % S, md);
        return o;
      };
      if (P[0]) putSlot(bits, i - 1, P[0]);
      putSlot(bits, i, C[0]);
      var K = predWin(), A = [], B = [], a, b, j;
      for (a = 0; a < P.length; a++) {
        if (P[a]) putSlot(bits, i - 1, P[a]);
        var va = predWin(); for (j = 0; j < L; j++) va[j] -= K[j];
        A.push(va);
      }
      if (P[0]) putSlot(bits, i - 1, P[0]);
      for (b = 0; b < C.length; b++) {
        putSlot(bits, i, C[b]);
        var vb = predWin(); for (j = 0; j < L; j++) vb[j] -= K[j];
        B.push(vb);
      }
      var r = new Float64Array(L), rr = 0;
      for (j = 0; j < L; j++) { r[j] = z[idx[j]] - K[j]; rr += r[j] * r[j]; }
      var nA = A.map(function (v) { var s2 = 0; for (var q = 0; q < L; q++) s2 += v[q] * (v[q] - 2 * r[q]); return s2; });
      var nB = B.map(function (v) { var s2 = 0; for (var q = 0; q < L; q++) s2 += v[q] * (v[q] - 2 * r[q]); return s2; });
      var tab = new Float64Array(P.length * C.length);
      for (a = 0; a < P.length; a++) {
        var va2 = A[a], base = rr + nA[a];
        for (b = 0; b < C.length; b++) {
          var vb2 = B[b], d = 0;
          for (j = 0; j < L; j++) d += va2[j] * vb2[j];
          tab[a * C.length + b] = base + nB[b] + 2 * d;
        }
      }
      E.push({ t: tab, nc: C.length });
      // slot i-1 goes back to unknown (0.5) as far context for the next window
      if (i > 0) for (j = 0; j < 7; j++) bits[QZ + slotStart(i - 1) + j] = 0.5;
    }
    return { E: E, constCost: constCost };
  }

  // Best digits with parity pattern and check digit enforced.
  // State per position: (digit, weighted sum mod 10). Left codes: digit + 10*parity.
  function bestValid(em) {
    var E = em.E, best = null, cost = new Float64Array(100), nx = new Float64Array(100);
    for (var first = 0; first < 10; first++) {
      var pat = PAR[first], off = [];
      for (var i = 0; i < 12; i++) off.push(i < 6 ? 10 * ((pat >> (5 - i)) & 1) : 0);
      cost.fill(Infinity);
      var back = [null];
      for (var d = 0; d < 10; d++) cost[d * 10 + (first + 3 * d) % 10] = E[0].t[d + off[0]];
      for (i = 1; i < 12; i++) {
        var w = i % 2 === 0 ? 3 : 1, nc = E[i].nc, t = E[i].t, op = off[i - 1], oc = off[i];
        var bk = new Int8Array(100);
        nx.fill(Infinity);
        for (var dp = 0; dp < 10; dp++) {
          var row = (dp + op) * nc + oc;
          for (var s = 0; s < 10; s++) {
            var c0 = cost[dp * 10 + s];
            if (c0 === Infinity) continue;
            for (var dn = 0; dn < 10; dn++) {
              var c1 = c0 + t[row + dn], key = dn * 10 + (s + w * dn) % 10;
              if (c1 < nx[key]) { nx[key] = c1; bk[key] = dp * 10 + s; }
            }
          }
        }
        var tmp = cost; cost = nx; nx = tmp;
        back.push(bk);
      }
      for (d = 0; d < 10; d++) {
        var c = cost[d * 10];
        if (c < Infinity && (!best || c < best.cost)) {
          var digits = [], key2 = d * 10;
          for (i = 11; i >= 0; i--) { digits.unshift(Math.floor(key2 / 10)); if (i) key2 = back[i][key2]; }
          best = { cost: c, first: first, digits: digits };
        }
      }
    }
    if (!best) return null;
    best.cost += em.constCost;
    var codes = best.digits.map(function (d, i) {
      return i < 6 ? LEFT[d + 10 * ((PAR[best.first] >> (5 - i)) & 1)] : RIGHT[d];
    });
    return { text: best.first + best.digits.join(""), cost: best.cost, codes: codes };
  }

  // Cheapest path with no parity/check constraints (for the confidence margin).
  function bestFree(em) {
    var E = em.E, cost = Array.prototype.slice.call(E[0].t);
    for (var i = 1; i < 12; i++) {
      var nc = E[i].nc, nx = new Array(nc).fill(Infinity);
      for (var a = 0; a < cost.length; a++) for (var b = 0; b < nc; b++) {
        var c = cost[a] + E[i].t[a * nc + b];
        if (c < nx[b]) nx[b] = c;
      }
      cost = nx;
    }
    return Math.min.apply(null, cost) + em.constCost;
  }

  // ------------------------------------------------------------ fitting

  function darkness(bits, md) {
    var S = md.S, d = new Float64Array(NB * S), k = md.k;
    for (var m = -QZ + k; m < NM + QZ - k; m++) for (var ph = 0; ph < S; ph++) d[(m + QZ) * S + ph] = pred(bits, m, ph, md);
    return d;
  }

  // SSE of a full known pattern under params; brightness fitted inside.
  function fitCost(p, bits, prm, S) {
    if (!(prm.sig > 0.15 && prm.sig < 1.6 && prm.X > 0.6 && prm.g > -0.5 && prm.g < 0.6 && Math.abs(prm.q) <= 4 * prm.X)) return null;
    var md = makeModel(prm.sig, prm.g, S), smp = sampleProfile(p, prm, S);
    var light = fitLight(smp.y, smp.wt, darkness(bits, md), S);
    if (!light) return null;
    light.md = md; light.smp = smp;
    return light;
  }

  // Coordinate descent over geometry, blur and ink spread for a fixed pattern.
  function refine(p, bits, prm, S, iters) {
    var keys = ["s", "X", "q", "sig", "g"];
    var step = { s: 0.25 * prm.X, X: 0.004 * prm.X, q: 0.4 * prm.X, sig: 0.12, g: 0.08 };
    var cur = Object.assign({}, prm), best = fitCost(p, bits, cur, S);
    if (!best) return null;
    for (var it = 0; it < iters; it++) {
      var moved = false;
      for (var ki = 0; ki < keys.length; ki++) {
        var key = keys[ki];
        for (var dir = -1; dir <= 1; dir += 2) {
          for (;;) {
            var t = Object.assign({}, cur); t[key] += dir * step[key];
            var f = fitCost(p, bits, t, S);
            if (f && f.sse < best.sse - 1e-9) { cur = t; best = f; moved = true; } else break;
          }
        }
      }
      if (!moved) keys.forEach(function (k2) { step[k2] /= 2; });
    }
    return { prm: cur, fit: best };
  }

  // Quick score of a start geometry + blur: one digit search, no refitting.
  function quick(p, geo, sig, S) {
    var prm = { s: geo.s, X: geo.X, q: 0, sig: sig, g: 0 };
    var smp = sampleProfile(p, prm, S), light = initialLight(smp, S);
    if (!light) return null;
    var em = emissions(normalise(smp.y, smp.wt, light, S), smp.wt, makeModel(sig, 0, S));
    var n = 0; for (var i = 0; i < smp.wt.length; i++) n += smp.wt[i];
    return { prm: prm, smp: smp, light: light, em: em, score: bestFree(em) / n };
  }

  // Refit parameters to the decoded pattern, re-run the digit search, repeat
  // until the code is stable.
  function attempt(p, q0, S) {
    var prm = q0.prm, smp = q0.smp, light = q0.light, md = makeModel(prm.sig, prm.g, S), em = q0.em;
    var res = null;
    for (var round = 0; round < 4; round++) {
      if (round) em = emissions(normalise(smp.y, smp.wt, light, S), smp.wt, md);
      var v = bestValid(em);
      if (!v) return null;
      if (res && v.text === res.text) {
        // Stable. Confidence margin: how much better the best unconstrained
        // digit path fits than this valid code (near 0 = the data spells it).
        res.margin = (v.cost - bestFree(em)) / res.n;
        res.agree = true;
        return res;
      }
      var r = refine(p, fullBits(v.codes), prm, S, round ? 2 : 3);
      if (!r) return null;
      res = { text: v.text, prm: r.prm, rms: Math.sqrt(r.fit.sse / r.fit.n) / r.fit.c0, contrast: r.fit.c0, n: r.fit.n };
      prm = r.prm; md = r.fit.md; smp = r.fit.smp; light = r.fit;
    }
    res.margin = 1; res.agree = false;   // never settled
    return res;
  }

  function initialLight(smp, S) {
    var wl = [], wr = [], inside = [];
    for (var i = 0; i < smp.y.length; i++) {
      if (!smp.wt[i]) continue;
      var m = i / S - QZ;
      if (m < -1 && m >= -QUIET) wl.push(smp.y[i]);
      else if (m >= NM + 1 && m < NM + QUIET) wr.push(smp.y[i]);
      else if (m >= 0 && m < NM) inside.push(smp.y[i]);
    }
    if (inside.length < 20) return null;
    inside.sort(function (a, b) { return a - b; });
    var lo = inside[Math.floor(inside.length * 0.1)], hi = inside[Math.floor(inside.length * 0.95)];
    var mean = function (a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : hi; };
    var aL = Math.max(mean(wl), hi), aR = Math.max(mean(wr), hi), a0 = (aL + aR) / 2;
    if (a0 - lo < 4) return null;
    return { a0: a0, a1: (aR - aL) / 2, c0: (a0 - lo) * 1.05, c1: 0 };
  }

  // ------------------------------------------------------------ locating

  // Edges of a profile: local extrema of the derivative above a threshold.
  function findEdges(p, frac) {
    var n = p.length, d = new Float64Array(n), mx = 0, i;
    for (i = 1; i < n - 1; i++) { d[i] = (p[i + 1] - p[i - 1]) / 2; mx = Math.max(mx, Math.abs(d[i])); }
    var th = frac * mx, out = [];
    for (i = 2; i < n - 2; i++) {
      var a = Math.abs(d[i]);
      // neighbours of the opposite sign belong to another edge: count them as 0
      var y0 = d[i - 1] * d[i] > 0 ? Math.abs(d[i - 1]) : 0, y2 = d[i + 1] * d[i] > 0 ? Math.abs(d[i + 1]) : 0;
      if (a < th || a < y0 || a <= y2) continue;
      var den = y0 - 2 * a + y2;
      out.push({ x: i + (den < 0 ? 0.5 * (y0 - y2) / den : 0), dir: d[i] < 0 ? -1 : 1, a: a });
    }
    return { edges: out, max: mx };
  }

  // Candidate (start, module width) pairs for the barcode nearest the centre.
  function locate(p) {
    var fe = findEdges(p, 0.12), e = fe.edges;
    if (e.length < 16 || fe.max < 1) return [];
    var gaps = [];
    for (var i = 1; i < e.length; i++) gaps.push(e[i].x - e[i - 1].x);
    var sorted = gaps.slice().sort(function (a, b) { return a - b; });
    var med = sorted[Math.floor(sorted.length / 2)], split = Math.max(5 * med, 4);
    // Clusters of edges separated by quiet gaps.
    var clusters = [], cur = [e[0]];
    for (i = 1; i < e.length; i++) {
      if (gaps[i - 1] > split) { clusters.push(cur); cur = []; }
      cur.push(e[i]);
    }
    clusters.push(cur);
    var mid = p.length / 2, out = [];
    clusters.filter(function (c) { return c.length >= 14; }).sort(function (a, b) {
      var da = Math.max(0, a[0].x - mid, mid - a[a.length - 1].x), db = Math.max(0, b[0].x - mid, mid - b[b.length - 1].x);
      return da - db || b.length - a.length;
    }).slice(0, 2).forEach(function (c) {
      var falls = c.filter(function (x) { return x.dir < 0; }).slice(0, 2);
      var rises = c.filter(function (x) { return x.dir > 0; }).slice(-2).reverse();
      falls.forEach(function (f, fi) {
        rises.forEach(function (r, ri) {
          var X = (r.x - f.x) / NM;
          if (X >= 0.9) out.push({ s: f.x, X: X, rank: fi + ri });
        });
      });
    });
    return out.sort(function (a, b) { return a.rank - b.rank; });
  }

  // ------------------------------------------------------------ public

  var SIGMAS = [0.5, 0.85];

  // p: brightness profile across the bars (any numeric array).
  // Returns {text, rms, margin, ...} for the best fit, or null.
  function decodeProfile(p, opts) {
    opts = opts || {};
    var S = 2, qs = [];
    locate(p).slice(0, opts.maxCands || 4).forEach(function (g) {
      SIGMAS.forEach(function (sig) { var q = quick(p, g, sig, S); if (q) qs.push(q); });
    });
    qs.sort(function (a, b) { return a.score - b.score; });
    var best = null;
    qs.slice(0, opts.refineTop || 2).forEach(function (q) {
      var r = attempt(p, q, S);
      if (r && (!best || r.rms < best.rms)) best = r;
    });
    return best;
  }

  function accept(r) { return !!r && r.agree && r.rms < 0.12 && r.prm.sig < 1.12 && r.margin < 0.0003; }

  // ---- 2D helpers: gray image (bars vertical) -> profiles

  // Mean of rows y0..y1 with horizontal shear t (px per row, around the band centre).
  function bandProfile(g, w, y0, y1, t) {
    var p = new Float64Array(w), cnt = new Float64Array(w), yc = (y0 + y1) / 2;
    for (var y = y0; y < y1; y++) {
      var sh = Math.round((y - yc) * t), row = y * w;
      var a = Math.max(0, -sh), b = Math.min(w, w - sh);
      for (var x = a; x < b; x++) { p[x] += g[row + x + sh]; cnt[x]++; }
    }
    for (var i = 0; i < w; i++) p[i] = cnt[i] ? p[i] / cnt[i] : 0;
    return p;
  }

  function sharpness(p) { var s = 0; for (var i = 1; i < p.length; i++) { var d = p[i] - p[i - 1]; s += d * d; } return s; }

  var SHEARS = [-0.12, -0.09, -0.06, -0.03, 0, 0.03, 0.06, 0.09, 0.12];

  // Best-shear profiles for a few horizontal bands, sharpest first.
  function profiles(g, w, h, nb) {
    nb = nb || 3;
    var bh = Math.max(8, Math.min(48, Math.round(h / (nb + 1)))), out = [];
    for (var bi = 0; bi < nb; bi++) {
      var yc = Math.round(h * (bi + 1) / (nb + 1)), y0 = Math.max(0, yc - (bh >> 1)), y1 = Math.min(h, y0 + bh);
      var best = null;
      SHEARS.forEach(function (t) {
        var p = bandProfile(g, w, y0, y1, t), s = sharpness(p);
        if (!best || s > best.s) best = { p: p, s: s, t: t, band: bi };
      });
      out.push(best);
    }
    return out.sort(function (a, b) { return b.s - a.s; });
  }

  // Whole-frame attempt. Returns {text, rms, ...} only when it passes accept().
  function decodeImage(g, w, h, opts) {
    opts = opts || {};
    var ps = profiles(g, w, h, opts.bands || 3).slice(0, opts.tries || 2);
    for (var i = 0; i < ps.length; i++) {
      var r = decodeProfile(ps[i].p, opts);
      if (accept(r)) return r;
    }
    return null;
  }

  var api = {
    decodeProfile: decodeProfile, decodeImage: decodeImage, accept: accept, profiles: profiles, locate: locate,
    LEFT: LEFT, RIGHT: RIGHT, PAR: PAR, slotStart: slotStart,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EAN = api;
}(this));
