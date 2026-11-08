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

  // ------------------------------------------------------------ live camera

  var stream = null, timer = null, running = false;
  var canvas = null, ctx = null;

  function start(video, onCode, onError) {
    stop();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      onError(new Error("camera API missing (getUserMedia)"));
      return;
    }
    running = true;
    var want = { audio: false, video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } } };
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

  function loop(video, onCode) {
    if (!running) return;
    var vw = video.videoWidth, vh = video.videoHeight;
    if (vw && vh) {
      // Cap the decode size: the QM215 is slow; 1D codes don't need many pixels.
      var scale = Math.min(1, 480 / Math.max(vw, vh));
      var w = Math.round(vw * scale), h = Math.round(vh * scale);
      if (!canvas) { canvas = document.createElement("canvas"); ctx = canvas.getContext("2d"); }
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.drawImage(video, 0, 0, w, h);
      var gray = toGray(ctx.getImageData(0, 0, w, h).data, w * h);
      // Try both orientations so the code reads however the phone is held.
      var code = decodeGray(gray, w, h) || decodeGray(rotate90(gray, w, h), h, w);
      if (code) { stop(); onCode(code); return; }
    }
    timer = setTimeout(function () { loop(video, onCode); }, 100);
  }

  function stop() {
    running = false;
    if (timer) { clearTimeout(timer); timer = null; }
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  }

  root.Scanner = { start: start, stop: stop, decodeGray: decodeGray, rotate90: rotate90, toGray: toGray };
}(this));
