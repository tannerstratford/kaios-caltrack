// Store: the phone-local food index + daily log + goals, all in localStorage.
// No DOM here. Foods are keyed by id; barcoded foods are also findable by a
// canonical GTIN so UPC-A (12) and EAN-13 ("0"+UPC-A) scans hit the same item.
//
//   food  = {id, barcode, name, brand, serving, kcal, carbs, protein, fat,
//            uses, lastUsed, created}              (macros are PER SERVING)
//   entry = {id, foodId, name, servings, kcal, carbs, protein, fat, ts}
//           (macros snapshotted per serving at log time, so editing a food
//            later doesn't rewrite history)
(function (root) {
  "use strict";

  var FOODS_KEY = "ct.foods";
  var LOG_KEY = "ct.log";
  var GOALS_KEY = "ct.goals";
  var CFG_KEY = "ct.cfg";

  function loadJSON(k, dflt) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v || dflt; } catch (e) { return dflt; }
  }
  function saveJSON(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function num(v) { var n = parseFloat(v); return isFinite(n) && n >= 0 ? n : 0; }
  function round1(n) { return Math.round(n * 10) / 10; }

  // ------------------------------------------------------------ dates

  function dayKey(d) {
    d = d || new Date();
    var m = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (dd < 10 ? "0" : "") + dd;
  }
  function shiftDay(key, delta) {
    var p = key.split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2] + delta);
    return dayKey(d);
  }

  // ------------------------------------------------------------ barcodes

  // UPC-A "012345678905" and EAN-13 "0012345678905" are the same GTIN.
  function canonBarcode(code) {
    code = String(code || "").replace(/\D/g, "");
    if (code.length === 12) code = "0" + code;
    return code;
  }

  // GTIN mod-10 check digit validity (EAN-8, UPC-A, EAN-13, GTIN-14).
  function validBarcode(code) {
    code = String(code || "");
    if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
    var sum = 0, n = code.length;
    for (var i = 0; i < n - 1; i++) {
      var dgt = +code[n - 2 - i];
      sum += i % 2 === 0 ? dgt * 3 : dgt;
    }
    return (10 - (sum % 10)) % 10 === +code[n - 1];
  }

  // ------------------------------------------------------------ foods

  function foods() { return loadJSON(FOODS_KEY, {}); }
  function saveFoods(f) { saveJSON(FOODS_KEY, f); }

  function foodList() {
    var f = foods();
    return Object.keys(f).map(function (k) { return f[k]; }).sort(function (a, b) {
      return (b.lastUsed || b.created || 0) - (a.lastUsed || a.created || 0);
    });
  }

  function getFood(id) { return foods()[id] || null; }

  function findByBarcode(code) {
    var c = canonBarcode(code);
    if (!c) return null;
    var f = foods();
    for (var k in f) if (f[k].barcode && canonBarcode(f[k].barcode) === c) return f[k];
    return null;
  }

  // Calories: use the label value if given, else derive 4/4/9 from macros.
  function kcalFromMacros(carbs, protein, fat) { return Math.round(num(carbs) * 4 + num(protein) * 4 + num(fat) * 9); }

  function saveFood(data) {
    var f = foods();
    var id = data.id || uid();
    var prev = f[id] || {};
    var food = {
      id: id,
      barcode: data.barcode ? canonBarcode(data.barcode) : "",
      name: String(data.name || "").trim() || "Unnamed food",
      brand: String(data.brand || "").trim(),
      serving: String(data.serving || "").trim() || "1 serving",
      carbs: round1(num(data.carbs)),
      protein: round1(num(data.protein)),
      fat: round1(num(data.fat)),
      kcal: 0,
      uses: prev.uses || 0,
      lastUsed: prev.lastUsed || 0,
      created: prev.created || Date.now(),
    };
    food.kcal = String(data.kcal == null ? "" : data.kcal).trim() !== "" ? Math.round(num(data.kcal)) : kcalFromMacros(food.carbs, food.protein, food.fat);
    f[id] = food;
    saveFoods(f);
    return food;
  }

  function deleteFood(id) { var f = foods(); delete f[id]; saveFoods(f); }

  // ------------------------------------------------------------ log

  function log() { return loadJSON(LOG_KEY, {}); }
  function entries(day) { return log()[day] || []; }

  function addEntry(day, food, servings) {
    servings = num(servings) || 1;
    var l = log();
    var e = {
      id: uid(), foodId: food.id, name: food.name, servings: servings,
      kcal: food.kcal, carbs: food.carbs, protein: food.protein, fat: food.fat, ts: Date.now(),
    };
    (l[day] = l[day] || []).push(e);
    saveJSON(LOG_KEY, l);
    var f = foods();
    if (f[food.id]) { f[food.id].uses = (f[food.id].uses || 0) + 1; f[food.id].lastUsed = Date.now(); saveFoods(f); }
    return e;
  }

  function updateEntry(day, id, servings) {
    var l = log();
    (l[day] || []).forEach(function (e) { if (e.id === id) e.servings = num(servings) || e.servings; });
    saveJSON(LOG_KEY, l);
  }

  function deleteEntry(day, id) {
    var l = log();
    l[day] = (l[day] || []).filter(function (e) { return e.id !== id; });
    if (!l[day].length) delete l[day];
    saveJSON(LOG_KEY, l);
  }

  function totals(day) {
    var t = { kcal: 0, carbs: 0, protein: 0, fat: 0 };
    entries(day).forEach(function (e) {
      t.kcal += e.kcal * e.servings; t.carbs += e.carbs * e.servings;
      t.protein += e.protein * e.servings; t.fat += e.fat * e.servings;
    });
    t.kcal = Math.round(t.kcal); t.carbs = round1(t.carbs); t.protein = round1(t.protein); t.fat = round1(t.fat);
    return t;
  }

  // ------------------------------------------------------------ goals + config

  function goals() {
    var g = loadJSON(GOALS_KEY, {});
    return {
      kcal: num(g.kcal) || 2000, carbs: num(g.carbs) || 200,
      protein: num(g.protein) || 150, fat: num(g.fat) || 65,
    };
  }
  function saveGoals(g) { saveJSON(GOALS_KEY, g); }

  function config() {
    var c = loadJSON(CFG_KEY, {});
    if (typeof c.onlineLookup !== "boolean") c.onlineLookup = true;
    return c;
  }
  function saveConfig(c) { saveJSON(CFG_KEY, c); }

  // ------------------------------------------------------------ backup

  function exportAll() {
    return JSON.stringify({ app: "caltrack", v: 1, at: Date.now(), foods: foods(), log: log(), goals: goals(), cfg: config() });
  }
  function importAll(text) {
    var d = JSON.parse(text);
    if (!d || d.app !== "caltrack") throw new Error("not a CalTrack backup");
    saveJSON(FOODS_KEY, d.foods || {});
    saveJSON(LOG_KEY, d.log || {});
    if (d.goals) saveJSON(GOALS_KEY, d.goals);
    if (d.cfg) saveJSON(CFG_KEY, d.cfg);
    return { foods: Object.keys(d.foods || {}).length, days: Object.keys(d.log || {}).length };
  }

  root.Store = {
    dayKey: dayKey, shiftDay: shiftDay,
    canonBarcode: canonBarcode, validBarcode: validBarcode,
    foodList: foodList, getFood: getFood, findByBarcode: findByBarcode,
    saveFood: saveFood, deleteFood: deleteFood, kcalFromMacros: kcalFromMacros,
    entries: entries, addEntry: addEntry, updateEntry: updateEntry, deleteEntry: deleteEntry, totals: totals,
    goals: goals, saveGoals: saveGoals, config: config, saveConfig: saveConfig,
    exportAll: exportAll, importAll: importAll,
  };
}(this));
