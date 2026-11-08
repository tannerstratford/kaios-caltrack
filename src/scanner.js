// Scanner: rear camera via getUserMedia -> canvas frames -> ZXing 1D decode
// (EAN-13 / UPC-A / EAN-8 / UPC-E). No DOM besides the <video> it is handed.
// decodeGray() is pure so it can be tested off-device.
(function (root) {
  "use strict";

  var Z = root.ZXing;
  var reader = null, hints = null;

  function getReader() {
    if (reader) return reader;
    hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
      Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_E,
    ]);
    // No TRY_HARDER: measured ~20x slower with no extra reads; the camera
    // loop gives us many frames instead.
    reader = new Z.MultiFormatOneDReader(hints);
    return reader;
  }

  // gray: Uint8ClampedArray luminance, w*h. Returns digits string or null.
  function decodeGray(gray, w, h) {
    var src = new Z.RGBLuminanceSource(gray, w, h);
    var bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(src));
    try {
      return getReader().decode(bmp, hints).getText();
    } catch (e) {
      return null; // NotFound / Checksum / Format -> just no read this frame
    } finally {
      try { getReader().reset(); } catch (e2) {}
    }
  }

  // Transpose so a barcode held sideways (bars horizontal) becomes readable.
  function rotate90(gray, w, h) {
    var out = new Uint8ClampedArray(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) out[x * h + (h - 1 - y)] = gray[y * w + x];
    return out;
  }

  function toGray(rgba, n) {
    var g = new Uint8ClampedArray(n);
    for (var i = 0, j = 0; i < n; i++, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
    return g;
  }

  // ------------------------------------------------------------ enhancement
  // ZXing binarizes each row with ONE threshold, so focus blur + uneven light
  // (vignetting, shadows) + sensor noise break it. Bars run vertically, so we
  // can average rows for free SNR, then sharpen horizontally against blur.
  // Measured on synthetic camera-like frames: raw 7/29 -> enhanced 16/29,
  // union of the three passes 18/29.

  // Column-wise moving average over (2r+1) rows.
  function vavg(g, w, h, r) {
    var o = new Uint8ClampedArray(w * h);
    for (var x = 0; x < w; x++) {
      var s = 0, n = 0, y;
      for (y = 0; y < Math.min(h, r); y++) { s += g[y * w + x]; n++; }
      for (y = 0; y < h; y++) {
        if (y + r < h) { s += g[(y + r) * w + x]; n++; }
        if (y - r - 1 >= 0) { s -= g[(y - r - 1) * w + x]; n--; }
        o[y * w + x] = s / n;
      }
    }
    return o;
  }

  // Row-wise box blur over (2r+1) px (prefix sums).
  function hblur(g, w, h, r) {
    var o = new Float32Array(w * h), ps = new Float64Array(w + 1);
    for (var y = 0; y < h; y++) {
      var b = y * w, x;
      for (x = 0; x < w; x++) ps[x + 1] = ps[x] + g[b + x];
      for (x = 0; x < w; x++) { var a = Math.max(0, x - r), c = Math.min(w, x + r + 1); o[b + x] = (ps[c] - ps[a]) / (c - a); }
    }
    return o;
  }

  function sharpen(g, w, h, r, k) {
    var bl = hblur(g, w, h, r), o = new Uint8ClampedArray(w * h);
    for (var i = 0; i < w * h; i++) o[i] = g[i] + k * (g[i] - bl[i]);
    return o;
  }

  // Local-contrast normalise: remove slow light gradients.
  function flatten(g, w, h, r) {
    var bl = hblur(g, w, h, r), o = new Uint8ClampedArray(w * h);
    for (var i = 0; i < w * h; i++) o[i] = 128 + 2 * (g[i] - bl[i]);
    return o;
  }

  // gray with bars vertical. Tries enhanced, raw, flattened.
  function decodeBest(g, w, h) {
    var v = vavg(g, w, h, 8);
    return decodeGray(sharpen(v, w, h, 2, 2), w, h) || decodeGray(g, w, h) ||
      decodeGray(flatten(v, w, h, Math.max(8, Math.round(w / 16))), w, h);
  }

  // ------------------------------------------------------------ live camera

  var stream = null, timer = null, running = false;
  var canvas = null, ctx = null, frame = 0, info = "";

  function start(video, onCode, onError) {
    stop();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      onError(new Error("camera API missing (getUserMedia)"));
      return;
    }
    running = true;
    var want = { audio: false, video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } } };
    navigator.mediaDevices.getUserMedia(want).catch(function () {
      return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    }).then(function (s) {
      if (!running) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = s;
      video.srcObject = s;
      video.setAttribute("playsinline", "");
      video.muted = true;
      var p = video.play(); if (p && p.catch) p.catch(function () {});
      loop(video, onCode);
    }).catch(function (err) {
      running = false;
      onError(new Error((err && (err.name || err.message)) || "camera denied"));
    });
  }

  // Crop from the native frame (no downscale: downscaling = extra blur).
  function grab(video, vw, vh, cx, cy) {
    var w = Math.round(vw * cx), h = Math.round(vh * cy);
    if (!canvas) { canvas = document.createElement("canvas"); ctx = canvas.getContext("2d"); }
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.drawImage(video, (vw - w) / 2, (vh - h) / 2, w, h, 0, 0, w, h);
    return { g: toGray(ctx.getImageData(0, 0, w, h).data, w * h), w: w, h: h };
  }

  function loop(video, onCode) {
    if (!running) return;
    var vw = video.videoWidth, vh = video.videoHeight;
    if (vw && vh) {
      info = vw + "x" + vh;
      var code = null, f;
      // Alternate orientations frame to frame (keeps each frame fast on the QM215).
      if (frame++ % 2 === 0) {
        f = grab(video, vw, vh, 0.9, 0.5);          // bars vertical: wide strip
        code = decodeBest(f.g, f.w, f.h);
      } else {
        f = grab(video, vw, vh, 0.5, 0.9);          // bars horizontal: tall strip
        code = decodeBest(rotate90(f.g, f.w, f.h), f.h, f.w);
      }
      if (code) { stop(); onCode(code); return; }
    }
    timer = setTimeout(function () { loop(video, onCode); }, 60);
  }

  function stop() {
    running = false;
    if (timer) { clearTimeout(timer); timer = null; }
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  }

  root.Scanner = {
    start: start, stop: stop, decodeGray: decodeGray, decodeBest: decodeBest, rotate90: rotate90, toGray: toGray,
    info: function () { return info; },
  };
}(this));
