// Lookup: OPTIONAL prefill for a never-seen barcode from Open Food Facts
// (free, no key). Only used to pre-fill the "new food" form — the result is
// reviewed, then saved to the phone's own index; nothing is looked up again.
// Menu > Online lookup turns it off entirely.
(function (root) {
  "use strict";

  var FIELDS = "product_name,brands,serving_size,nutriments";

  function r1(n) { return n == null || !isFinite(n) ? "" : String(Math.round(n * 10) / 10); }

  function product(code) {
    return new Promise(function (resolve, reject) {
      var r = new XMLHttpRequest({ mozSystem: true });
      r.open("GET", "https://world.openfoodfacts.org/api/v2/product/" + encodeURIComponent(code) + ".json?fields=" + FIELDS);
      r.timeout = 10000;
      r.onload = function () {
        if (r.status === 404) return resolve(null);
        if (r.status !== 200) return reject(new Error("HTTP " + r.status));
        var j = null; try { j = JSON.parse(r.responseText); } catch (e) {}
        resolve(j && j.status === 1 && j.product ? toFood(j.product) : null);
      };
      r.onerror = function () { reject(new Error("offline")); };
      r.ontimeout = function () { reject(new Error("timeout")); };
      r.send();
    });
  }

  // Prefer per-serving numbers; fall back to per-100g with serving "100 g".
  function toFood(p) {
    var n = p.nutriments || {};
    var per = n["energy-kcal_serving"] != null || n.carbohydrates_serving != null ? "_serving" : "_100g";
    var kcal = n["energy-kcal" + per];
    if (kcal == null && n["energy" + per] != null) kcal = n["energy" + per] / 4.184; // kJ -> kcal
    return {
      name: (p.product_name || "").trim(),
      brand: (p.brands || "").split(",")[0].trim(),
      serving: per === "_serving" ? (p.serving_size || "1 serving") : "100 g",
      kcal: kcal == null ? "" : String(Math.round(kcal)),
      carbs: r1(n["carbohydrates" + per]),
      protein: r1(n["proteins" + per]),
      fat: r1(n["fat" + per]),
    };
  }

  root.Lookup = { product: product, toFood: toFood };
}(this));
