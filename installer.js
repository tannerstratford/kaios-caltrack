// CalTrack installer — runs in the KaiOS system app context after staging.
// Plain install request against our hosted update manifest (see kaios-deako).
(function () {
  "use strict";

  var UPDATE_URL =
    "https://tannerstratford.github.io/kaios-caltrack/Apps-directory/CalTrack/update.webmanifest";

  function show(msg) {
    try { document.title = msg; } catch (e) {}
    try {
      var el = document.getElementById("ct-status");
      if (!el) {
        el = document.createElement("pre");
        el.id = "ct-status";
        el.style.cssText =
          "position:fixed;left:0;top:0;right:0;z-index:99999;margin:0;padding:8px;" +
          "background:#000;color:#0f0;font:12px monospace;white-space:pre-wrap;word-break:break-word";
        (document.body || document.documentElement).appendChild(el);
      }
      el.textContent = msg;
    } catch (e) {}
  }

  if (!window.JScalatedAppsManager) {
    show("Installer error: AppsManager wrapper did not load.");
    return;
  }

  show("CalTrack: connecting to AppsManager…");
  var client = new window.JScalatedAppsManager(function (m) { show("CalTrack: " + m); });

  client
    .connect()
    .then(function (manager) {
      show("CalTrack: installing…\n" + UPDATE_URL);
      return window.JScalatedAppsManager.callUrlMethod(manager, "installPackage", UPDATE_URL);
    })
    .then(function (result) { show("CalTrack: INSTALL OK\n" + JSON.stringify(result || {})); })
    .catch(function (error) { show("CalTrack: INSTALL FAILED\n" + window.JScalatedAppsManager.errorText(error)); });
}());
