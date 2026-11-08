// Backup: everything lives in localStorage on the phone, so offer a JSON
// export/import to internal storage / SD card via KaiOS DeviceStorage.
// File: caltrack-backup.json in the storage root (visible in the Files app).
(function (root) {
  "use strict";

  var NAME = "caltrack-backup.json";

  function storage() {
    var get = (navigator.b2g && navigator.b2g.getDeviceStorage) ? navigator.b2g.getDeviceStorage.bind(navigator.b2g)
      : (navigator.getDeviceStorage ? navigator.getDeviceStorage.bind(navigator) : null);
    if (!get) return null;
    return get("sdcard");
  }

  function req(r) {
    return new Promise(function (resolve, reject) {
      if (r && typeof r.then === "function") return r.then(resolve, reject);
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error || new Error("storage error")); };
    });
  }

  function save() {
    var ds = storage();
    if (!ds) return Promise.reject(new Error("no device storage"));
    var blob = new Blob([Store.exportAll()], { type: "application/json" });
    // addNamed fails if the file exists, so delete first (ignore "not found").
    return req(ds.delete(NAME)).catch(function () {}).then(function () {
      return req(ds.addNamed(blob, NAME));
    }).then(function (path) { return path || NAME; });
  }

  function restore() {
    var ds = storage();
    if (!ds) return Promise.reject(new Error("no device storage"));
    return req(ds.get(NAME)).then(function (file) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () { try { resolve(Store.importAll(fr.result)); } catch (e) { reject(e); } };
        fr.onerror = function () { reject(fr.error); };
        fr.readAsText(file);
      });
    });
  }

  root.Backup = { save: save, restore: restore, available: function () { return !!storage(); }, NAME: NAME };
}(this));
