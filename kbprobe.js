// CalTrack keyboard probe — READ ONLY. Runs in the KaiOS system app context
// after staging (same path as the installer). It connects to AppsManager and
// calls getAll() to see how the built-in keyboard app is registered, so we can
// tell whether it could be replaced/updated without root. It calls NO mutating
// method: no installPackage, no update, no setEnabled, no uninstall, no clear.
(function () {
  "use strict";

  function render(text) {
    try { document.title = "KB probe"; } catch (e) {}
    try {
      var el = document.getElementById("kb-out");
      if (!el) {
        el = document.createElement("pre");
        el.id = "kb-out";
        el.style.cssText =
          "position:fixed;left:0;top:0;right:0;bottom:0;z-index:99999;margin:0;padding:8px;overflow:auto;" +
          "background:#000;color:#0f0;font:12px monospace;white-space:pre-wrap;word-break:break-word";
        (document.body || document.documentElement).appendChild(el);
      }
      el.textContent = text;
    } catch (e) {}
  }
  var lines = [];
  function log(s) { lines.push(s); render(lines.join("\n")); }

  if (!window.JScalatedAppsManager) {
    render("Probe error: AppsManager wrapper did not load.");
    return;
  }

  // Only the fields we care about, so the dump stays readable on a 240px screen.
  function pick(app) {
    var o = {};
    ["name", "manifestUrl", "updateUrl", "removable", "status", "updateState",
      "installState", "origin", "allowedAutoDownload", "version"].forEach(function (k) {
      if (app && app[k] !== undefined) o[k] = app[k];
    });
    // Anything else we didn't name, so we don't miss a useful flag.
    if (app && typeof app === "object") {
      Object.keys(app).forEach(function (k) {
        if (!(k in o) && typeof app[k] !== "function" && typeof app[k] !== "object") o["+" + k] = app[k];
      });
    }
    return o;
  }

  function isKbd(app) {
    var u = String((app && (app.manifestUrl || app.origin)) || "").toLowerCase();
    return u.indexOf("keyboard") !== -1;
  }

  function dump(list) {
    var arr = Array.isArray(list) ? list : (list && (list.apps || list.result || list.value)) || [];
    if (!Array.isArray(arr)) {
      log("getAll() returned a non-list. Raw:");
      log(safe(list));
      return;
    }
    log("getAll() OK — " + arr.length + " apps installed.");
    log("");
    // Keyboard first, then our own apps, then the rest (names only).
    var kbd = [], ours = [], rest = [];
    arr.forEach(function (a) {
      var u = String((a && a.manifestUrl) || "").toLowerCase();
      if (isKbd(a)) kbd.push(a);
      else if (/caltrack|tvremote|deako|whereami/.test(u)) ours.push(a);
      else rest.push(a);
    });
    log("=== KEYBOARD ===");
    if (!kbd.length) log("(no app with 'keyboard' in its URL — unexpected)");
    kbd.forEach(function (a) { log(safe(pick(a))); });
    log("");
    log("=== YOUR SIDELOADED APPS (for comparison) ===");
    if (!ours.length) log("(none found)");
    ours.forEach(function (a) { log(safe(pick(a))); });
    log("");
    log("=== OTHER BUILT-IN APPS (name · removable · status) ===");
    rest.forEach(function (a) {
      log("- " + (a.name || "?") + " · removable=" + a.removable + " · status=" + a.status +
        "\n  " + (a.manifestUrl || ""));
    });
  }

  function safe(v) {
    try { return JSON.stringify(v, null, 1); } catch (e) { return String(v); }
  }

  render("KB probe: connecting to AppsManager…");
  var client = new window.JScalatedAppsManager(function (m) { log("· " + m); });
  client.connect().then(function (manager) {
    log("Connected. Calling getAll() (read-only)…");
    log("");
    return manager.getAll();
  }).then(function (list) {
    dump(list);
    log("");
    log("Done. Nothing was changed. Screenshot or read this back.");
  }).catch(function (error) {
    log("PROBE FAILED: " + window.JScalatedAppsManager.errorText(error));
  });
}());
