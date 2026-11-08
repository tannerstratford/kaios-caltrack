// CalTrack — KaiOS UI. Dashboard of today's calories + carbs/protein/fat,
// a phone-local food index keyed by barcode, and a camera barcode scanner.
//   Dashboard: Left softkey = Scan, OK = Add (or edit the selected entry),
//   Right softkey = Menu, D-pad left/right = previous/next day, up/down = log.
"use strict";

var $ = function (id) { return document.getElementById(id); };
var viewStack = [];
var curDay = Store.dayKey();
var statusTimer = null;

// ---------------------------------------------------------------- view plumbing

function status(text, bad) {
  var el = $("status");
  el.textContent = text || "";
  el.classList.toggle("err", bad === true);
  clearTimeout(statusTimer);
  if (text && bad !== true) statusTimer = setTimeout(function () { el.textContent = ""; }, 4000);
}
function softkeys(l, c, r) { $("sk-left").textContent = l || ""; $("sk-center").textContent = c || ""; $("sk-right").textContent = r || ""; }
function topView() { return viewStack[viewStack.length - 1]; }
function show() {
  var v = topView();
  $("title").textContent = v.title();
  $("view").innerHTML = "";
  $("view").scrollTop = 0;
  v.render($("view"));
}
function leave() { var v = topView(); if (v && v.leave) v.leave(); }
function push(v) { leave(); viewStack.push(v); show(); }
function pop() { leave(); if (viewStack.length > 1) viewStack.pop(); show(); }
function replace(v) { leave(); viewStack[viewStack.length - 1] = v; show(); }
function home() { leave(); viewStack = [DashView]; show(); }

window.addEventListener("keydown", function (e) {
  if (topView().key(e) !== false) e.preventDefault();
});

function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
function fmtK(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function fmtG(n) { return n >= 10 || n === Math.round(n) ? String(Math.round(n)) : String(Math.round(n * 10) / 10); }
function pct(a, b) { return b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0; }
function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }

function dayTitle(key) {
  var today = Store.dayKey();
  if (key === today) return "Today";
  if (key === Store.shiftDay(today, -1)) return "Yesterday";
  var p = key.split("-"), d = new Date(+p[0], +p[1] - 1, +p[2]);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] + " " +
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()] + " " + d.getDate();
}

function foodSub(f) {
  return (f.brand ? f.brand + " · " : "") + f.serving + " · " + f.kcal + " kcal · C" + fmtG(f.carbs) + " P" + fmtG(f.protein) + " F" + fmtG(f.fat);
}

// ---------------------------------------------------------------- dashboard

var DashView = {
  sel: -1,
  title: function () { return "◀ " + dayTitle(curDay) + (curDay < Store.dayKey() ? " ▶" : ""); },
  render: function (el) {
    var t = Store.totals(curDay), g = Store.goals(), list = Store.entries(curDay);
    if (this.sel >= list.length) this.sel = list.length - 1;
    softkeys("Scan", this.sel >= 0 ? "Edit" : "Add", "Menu");

    var left = g.kcal - t.kcal;
    var macroK = t.carbs * 4 + t.protein * 4 + t.fat * 9;
    var html = '<div class="cal card">' +
      '<div class="calrow"><span class="kc">' + fmtK(t.kcal) + '</span><span class="of">/ ' + fmtK(g.kcal) + ' kcal</span>' +
      '<span class="left ' + (left < 0 ? "over" : "") + '">' + (left < 0 ? fmtK(-left) + " over" : fmtK(left) + " left") + "</span></div>" +
      '<div class="bar"><i class="' + (left < 0 ? "over" : "kcal") + '" style="width:' + pct(t.kcal, g.kcal) + '%"></i></div>';
    if (macroK > 0) {
      html += '<div class="split"><i class="c" style="width:' + pct(t.carbs * 4, macroK) + '%"></i><i class="p" style="width:' +
        pct(t.protein * 4, macroK) + '%"></i><i class="f" style="width:' + pct(t.fat * 9, macroK) + '%"></i></div>';
    }
    html += "</div>";

    [["Carbs", "c", t.carbs, g.carbs, 4], ["Protein", "p", t.protein, g.protein, 4], ["Fat", "f", t.fat, g.fat, 9]].forEach(function (m) {
      var share = macroK > 0 ? Math.round((m[2] * m[4] / macroK) * 100) : 0;
      html += '<div class="macro"><div class="mrow"><span class="mk ' + m[1] + '">' + m[0] + "</span>" +
        '<span class="mv">' + fmtG(m[2]) + " / " + fmtG(m[3]) + "g" + (macroK > 0 ? ' <em>' + share + "%</em>" : "") + "</span></div>" +
        '<div class="bar thin"><i class="' + m[1] + '" style="width:' + pct(m[2], m[3]) + '%"></i></div></div>';
    });

    html += '<div class="loghead">LOG · ' + plural(list.length, "item") + "</div>";
    if (!list.length) {
      html += '<div class="hint">Nothing logged. <b>Scan</b> a barcode or press <b>OK</b> to add from your foods.</div>';
    } else {
      html += '<ul class="list log">';
      list.forEach(function (e, i) {
        html += '<li class="' + (i === this.sel ? "sel" : "") + '"><span class="nm">' + esc(e.name) +
          (e.servings !== 1 ? ' <em>×' + fmtG(e.servings) + "</em>" : "") + '</span><span class="rt">' +
          fmtK(e.kcal * e.servings) + "</span></li>";
      }, this);
      html += "</ul>";
    }
    el.innerHTML = html;
    var s = el.querySelector("li.sel");
    if (s) s.scrollIntoView({ block: "nearest" });
  },
  key: function (e) {
    var n = Store.entries(curDay).length;
    switch (e.key) {
      case "SoftLeft": case "Call": return startScan();
      case "SoftRight": return push(MenuView());
      case "Enter":
        if (this.sel >= 0) return push(EntryView(Store.entries(curDay)[this.sel]));
        return push(AddView());
      case "ArrowDown": if (n) { this.sel = Math.min(n - 1, this.sel + 1); show(); } return;
      case "ArrowUp": if (this.sel >= 0) { this.sel--; show(); } return;
      case "ArrowLeft": curDay = Store.shiftDay(curDay, -1); this.sel = -1; show(); return;
      case "ArrowRight":
        if (curDay < Store.dayKey()) { curDay = Store.shiftDay(curDay, 1); this.sel = -1; show(); }
        return;
      case "#": return push(BarcodePrompt());
      case "0": curDay = Store.dayKey(); this.sel = -1; show(); return;
      default: return false;
    }
  },
};

// ---------------------------------------------------------------- generic list

// items: {label, sub, right, head, run}. opts.left = {label, run(item)}.
function ListView(title, items, opts) {
  opts = opts || {};
  var s = 0;
  while (items[s] && items[s].head) s++;
  function move(d) {
    if (!items.length) return;
    var i = s;
    do { i = (i + d + items.length) % items.length; } while (items[i].head && i !== s);
    s = i; show();
  }
  return {
    title: function () { return title; },
    render: function (el) {
      var cur = items[s];
      softkeys(opts.left && cur && !cur.head && (!opts.left.when || opts.left.when(cur)) ? opts.left.label : "",
        opts.center || "Select", "Back");
      var ul = document.createElement("ul"); ul.className = "list";
      items.forEach(function (it, i) {
        var li = document.createElement("li");
        li.className = it.head ? "head" : (i === s ? "sel" : "");
        var nm = document.createElement("span"); nm.className = "nm"; nm.textContent = it.label; li.appendChild(nm);
        if (it.right != null) { var r = document.createElement("span"); r.className = "rt"; r.textContent = it.right; li.appendChild(r); }
        if (it.sub) { var d = document.createElement("div"); d.className = "sub"; d.textContent = it.sub; li.appendChild(d); }
        ul.appendChild(li);
      });
      el.appendChild(ul);
      if (ul.children[s]) ul.children[s].scrollIntoView({ block: "nearest" });
    },
    key: function (e) {
      switch (e.key) {
        case "ArrowDown": return move(1);
        case "ArrowUp": return move(-1);
        case "Enter": return items[s] && !items[s].head && items[s].run && items[s].run();
        case "SoftLeft":
          if (opts.left && items[s] && !items[s].head && (!opts.left.when || opts.left.when(items[s]))) return opts.left.run(items[s]);
          return;
        case "SoftRight": case "Backspace": return pop();
        default: return false;
      }
    },
  };
}

function ConfirmView(question, yesLabel, onYes) {
  return ListView(question, [
    { label: "No, cancel", run: pop },
    { label: yesLabel, run: onYes },
  ]);
}

// ---------------------------------------------------------------- inputs

// Numeric fields use type=tel (digit keypad); "*" types the decimal point.
function wireNumeric(input) {
  input.addEventListener("keydown", function (e) {
    if (e.key === "*") {
      e.preventDefault(); e.stopPropagation();
      if (input.value.indexOf(".") < 0) {
        var p = input.selectionStart == null ? input.value.length : input.selectionStart;
        input.value = input.value.slice(0, p) + "." + input.value.slice(p);
        try { input.setSelectionRange(p + 1, p + 1); } catch (err) {}
        input.dispatchEvent(new Event("input"));
      }
    }
  });
  input.addEventListener("input", function () {
    var v = input.value.replace(/[^0-9.]/g, "");
    var i = v.indexOf(".");
    if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, "");
    if (v !== input.value) input.value = v;
  });
}

// Single-field prompt. opts: {numeric, preview(value) -> text, okLabel}
function PromptView(title, hint, value, onSubmit, opts) {
  opts = opts || {};
  return {
    title: function () { return title; },
    render: function (el) {
      softkeys("Cancel", opts.okLabel || "OK", "");
      el.innerHTML = '<div class="form"><p></p><input><div class="preview"></div>' +
        (opts.numeric ? '<div class="hint">* = decimal point</div>' : "") + "</div>";
      el.querySelector("p").textContent = hint;
      var input = el.querySelector("input");
      var prev = el.querySelector(".preview");
      if (opts.numeric) { input.type = "tel"; wireNumeric(input); }
      input.value = value == null ? "" : value;
      var upd = function () { if (opts.preview) prev.textContent = opts.preview(input.value.trim()); };
      input.addEventListener("input", upd); upd();
      setTimeout(function () { input.focus(); try { input.select(); } catch (e) {} }, 50);
    },
    key: function (e) {
      var input = document.querySelector(".form input");
      if (e.key === "Enter") return onSubmit(input.value.trim());
      if (e.key === "SoftLeft" || (e.key === "Backspace" && !input.value)) return pop();
      return false;
    },
  };
}

// ---------------------------------------------------------------- adding food

function ServingsView(food) {
  return PromptView(food.name, "Servings (1 serving = " + food.serving + ", " + food.kcal + " kcal)", "1", function (val) {
    var n = parseFloat(val);
    if (!(n > 0)) return status("Enter servings, e.g. 1 or 0.5", true);
    Store.addEntry(curDay, food, n);
    DashView.sel = -1;
    home();
    status("Added " + food.name + " · " + fmtK(food.kcal * n) + " kcal");
  }, {
    numeric: true, okLabel: "Log",
    preview: function (v) {
      var n = parseFloat(v);
      if (!(n > 0)) return "";
      return fmtK(food.kcal * n) + " kcal · C" + fmtG(food.carbs * n) + " P" + fmtG(food.protein * n) + " F" + fmtG(food.fat * n);
    },
  });
}

function AddView() {
  var foods = Store.foodList();
  var items = [
    { label: "Scan barcode", sub: "camera", run: function () { pop(); startScan(); } },
    { label: "Type barcode", sub: "enter the digits", run: function () { replace(BarcodePrompt()); } },
    { label: "New food", sub: "no barcode (homemade, etc.)", run: function () { push(FoodForm({}, afterNewFood)); } },
    { head: true, label: "MY FOODS · " + foods.length },
  ];
  foods.forEach(function (f) {
    items.push({ label: f.name, sub: foodSub(f), food: f, run: function () { push(ServingsView(f)); } });
  });
  if (!foods.length) items.push({ head: true, label: "(none yet — scan something)" });
  return ListView("Add to " + dayTitle(curDay), items, {
    center: "Select",
    left: { label: "Options", when: function (it) { return !!it.food; }, run: function (it) { push(FoodOptions(it.food)); } },
  });
}

function FoodOptions(food) {
  return ListView(food.name, [
    { label: "Log it", run: function () { replace(ServingsView(food)); } },
    { label: "Edit food", sub: foodSub(food), run: function () {
        replace(FoodForm(food, function (saved) { pop(); replace(AddView()); status("Saved " + saved.name); }));
      } },
    { label: "Delete food", sub: "removes it from your index (log history stays)", run: function () {
        replace(ConfirmView("Delete " + food.name + "?", "Yes, delete", function () {
          Store.deleteFood(food.id); pop(); pop(); push(AddView()); status("Deleted " + food.name);
        }));
      } },
  ]);
}

function afterNewFood(food) {
  replace(ServingsView(food));
  status("Saved to your foods");
}

// ---------------------------------------------------------------- food form

var FIELDS = [
  { k: "name", label: "Name", ph: "e.g. Protein bar" },
  { k: "brand", label: "Brand", ph: "optional" },
  { k: "serving", label: "Serving size", ph: "e.g. 1 bar (40 g)" },
  { k: "kcal", label: "Calories", num: true, ph: "blank = from macros" },
  { k: "carbs", label: "Carbs (g)", num: true },
  { k: "protein", label: "Protein (g)", num: true },
  { k: "fat", label: "Fat (g)", num: true },
  { k: "barcode", label: "Barcode", num: true, ph: "optional" },
];

function FoodForm(food, onSaved) {
  var data = {}; FIELDS.forEach(function (f) { data[f.k] = food[f.k] == null ? "" : String(food[f.k]); });
  var focus = data.name ? 3 : 0;
  var inputs = [];
  function sync() { inputs.forEach(function (inp, i) { data[FIELDS[i].k] = inp.value; }); }
  function calc() {
    var k = Store.kcalFromMacros(data.carbs, data.protein, data.fat);
    var el = document.getElementById("calc");
    if (el) el.textContent = k ? "macros ≈ " + k + " kcal (4·C + 4·P + 9·F)" : "";
  }
  function focusField(i) {
    focus = Math.max(0, Math.min(FIELDS.length - 1, i));
    var inp = inputs[focus];
    inputs.forEach(function (x, j) { x.parentNode.classList.toggle("sel", j === focus); });
    inp.parentNode.scrollIntoView({ block: "nearest" });
    inp.focus();
    try { var L = inp.value.length; inp.setSelectionRange(L, L); } catch (e) {}
  }
  function save() {
    sync();
    if (!data.name.trim()) { focusField(0); return status("Name is required", true); }
    var bc = data.barcode.trim();
    if (bc) {
      var other = Store.findByBarcode(bc);
      if (other && other.id !== food.id) { focusField(7); return status("Barcode already used by " + other.name, true); }
    }
    var saved = Store.saveFood({
      id: food.id, barcode: bc, name: data.name, brand: data.brand, serving: data.serving,
      kcal: data.kcal, carbs: data.carbs, protein: data.protein, fat: data.fat,
    });
    onSaved(saved);
  }
  return {
    title: function () { return food.id ? "Edit food" : "New food"; },
    render: function (el) {
      softkeys("Cancel", "Next", "Save");
      var form = document.createElement("div"); form.className = "fields";
      inputs = FIELDS.map(function (f) {
        var row = document.createElement("label"); row.className = "field";
        var lab = document.createElement("span"); lab.textContent = f.label; row.appendChild(lab);
        var inp = document.createElement("input");
        if (f.num) { inp.type = "tel"; wireNumeric(inp); } else inp.type = "text";
        inp.value = data[f.k]; inp.placeholder = f.ph || "";
        inp.addEventListener("input", function () { sync(); calc(); });
        row.appendChild(inp);
        if (f.k === "kcal") { var c = document.createElement("div"); c.id = "calc"; c.className = "calc"; row.appendChild(c); }
        form.appendChild(row);
        return inp;
      });
      el.appendChild(form);
      calc();
      setTimeout(function () { focusField(focus); }, 50);
    },
    key: function (e) {
      var inp = inputs[focus];
      switch (e.key) {
        case "ArrowDown": focusField(focus + 1); return;
        case "ArrowUp": focusField(focus - 1); return;
        case "Enter": if (focus === FIELDS.length - 1) return save(); focusField(focus + 1); return;
        case "SoftRight": return save();
        case "SoftLeft": sync(); return pop();
        case "Backspace": if (!inp.value) { sync(); return pop(); } return false;
        default: return false;
      }
    },
  };
}

// ---------------------------------------------------------------- log entry

function EntryView(entry) {
  var food = Store.getFood(entry.foodId);
  return ListView(entry.name, [
    { label: "Servings", right: fmtG(entry.servings), sub: fmtK(entry.kcal * entry.servings) + " kcal · C" +
        fmtG(entry.carbs * entry.servings) + " P" + fmtG(entry.protein * entry.servings) + " F" + fmtG(entry.fat * entry.servings),
      run: function () {
        replace(PromptView("Servings", entry.name, fmtG(entry.servings), function (val) {
          var n = parseFloat(val);
          if (!(n > 0)) return status("Enter a number", true);
          Store.updateEntry(curDay, entry.id, n); pop(); status("Updated");
        }, { numeric: true, preview: function (v) { var n = parseFloat(v); return n > 0 ? fmtK(entry.kcal * n) + " kcal" : ""; } }));
      } },
    { label: "Log again", sub: "add another of this to " + dayTitle(curDay), run: function () {
        if (!food) return status("Food was deleted from your index", true);
        replace(ServingsView(food));
      } },
    { label: "Edit food", sub: food ? foodSub(food) : "deleted", run: function () {
        if (!food) return status("Food was deleted from your index", true);
        replace(FoodForm(food, function (saved) { pop(); status("Saved " + saved.name + " (future logs)"); }));
      } },
    { label: "Remove from log", run: function () {
        Store.deleteEntry(curDay, entry.id); DashView.sel = Math.max(-1, DashView.sel - 1); pop(); status("Removed " + entry.name);
      } },
  ]);
}

// ---------------------------------------------------------------- scanning

var ScanView = {
  title: function () { return "Scan barcode"; },
  render: function (el) {
    softkeys("Cancel", "", "Type #");
    el.innerHTML = '<div class="scan"><video id="cam" autoplay muted></video><div class="aim"></div></div>' +
      '<div class="hint">Hold 10–20 cm away, bars across the red line. Either orientation works.</div>';
    status("Starting camera…");
    Scanner.start(document.getElementById("cam"), function (code) {
      try { navigator.vibrate && navigator.vibrate(80); } catch (e) {}
      handleBarcode(code, true);
    }, function (err) {
      status("Camera failed: " + err.message + " — press Type #", true);
    });
    setTimeout(function () { if (topView() === ScanView && !$("status").classList.contains("err")) status("Point at a barcode"); }, 1200);
  },
  leave: function () { Scanner.stop(); },
  key: function (e) {
    switch (e.key) {
      case "SoftLeft": case "Backspace": return pop();
      case "SoftRight": case "#": return replace(BarcodePrompt());
      default: return false;
    }
  },
};

function startScan() { push(ScanView); }

function BarcodePrompt() {
  return PromptView("Type barcode", "Digits under the barcode (UPC/EAN)", "", function (val) {
    var code = val.replace(/\D/g, "");
    if (!Store.validBarcode(code)) return status("Not a valid UPC/EAN (check digit). Retype.", true);
    handleBarcode(code, true);
  }, { numeric: true, okLabel: "Look up" });
}

// Known -> log it. Unknown -> (optional online prefill) -> new food form.
function handleBarcode(raw, replaceTop) {
  var code = Store.canonBarcode(raw);
  var go = replaceTop ? replace : push;
  var food = Store.findByBarcode(code);
  if (food) { go(ServingsView(food)); status("Found: " + food.name); return; }
  var cfg = Store.config();
  if (!cfg.onlineLookup) { go(FoodForm({ barcode: code }, afterNewFood)); status("New barcode — enter label info"); return; }

  var cancelled = false;
  go({
    title: function () { return "New item"; },
    render: function (el) {
      softkeys("Skip", "", "");
      el.innerHTML = '<div class="hint big">' + esc(code) + '<br><br>Not in your foods yet.<br>Checking Open Food Facts…</div>';
    },
    key: function (e) {
      if (e.key === "SoftLeft" || e.key === "Backspace") { cancelled = true; replace(FoodForm({ barcode: code }, afterNewFood)); return; }
      return false;
    },
  });
  Lookup.product(code).then(function (p) {
    if (cancelled) return;
    var pre = p ? Object.assign({}, p, { barcode: code }) : { barcode: code };
    replace(FoodForm(pre, afterNewFood));
    status(p ? "Prefilled online — check against the label" : "Not found online — enter label info");
  }).catch(function (err) {
    if (cancelled) return;
    replace(FoodForm({ barcode: code }, afterNewFood));
    status("Lookup " + err.message + " — enter label info");
  });
}

// ---------------------------------------------------------------- menu

function MenuView() {
  var cfg = Store.config(), g = Store.goals();
  return ListView("Menu", [
    { label: "Add food", run: function () { replace(AddView()); } },
    { label: "Scan barcode", run: function () { pop(); startScan(); } },
    { label: "Jump to today", run: function () { curDay = Store.dayKey(); DashView.sel = -1; pop(); } },
    { head: true, label: "VIEW" },
    { label: "History", sub: "daily totals, last 30 days", run: function () { push(HistoryView()); } },
    { label: "My foods", sub: plural(Store.foodList().length, "item") + " in your index", run: function () { replace(AddView()); } },
    { head: true, label: "SETTINGS" },
    { label: "Daily goals", sub: fmtK(g.kcal) + " kcal · C" + g.carbs + " P" + g.protein + " F" + g.fat, run: function () { push(GoalsView()); } },
    { label: "Online lookup", right: cfg.onlineLookup ? "ON" : "off", sub: "prefill new barcodes from Open Food Facts", run: function () {
        cfg.onlineLookup = !cfg.onlineLookup; Store.saveConfig(cfg); replace(MenuView());
      } },
    { label: "Back up data", sub: "save " + Backup.NAME + " to phone storage", run: function () {
        status("Saving…");
        Backup.save().then(function (p) { status("Backed up: " + p); }).catch(function (e) { status("Backup failed: " + (e.name || e.message || e), true); });
      } },
    { label: "Restore backup", sub: "replace all data from " + Backup.NAME, run: function () {
        push(ConfirmView("Replace ALL data?", "Yes, restore", function () {
          Backup.restore().then(function (r) {
            home(); status("Restored " + plural(r.foods, "food") + ", " + plural(r.days, "day"));
          }).catch(function (e) { pop(); status("Restore failed: " + (e.name || e.message || e), true); });
        }));
      } },
    { label: "Diagnostics", run: function () { push(DiagView()); } },
    { label: "Exit", run: function () { try { window.close(); } catch (e) {} } },
  ]);
}

function GoalsView() {
  var g = Store.goals();
  function edit(k, label, unit) {
    return { label: label, right: fmtK(g[k]) + unit, run: function () {
      push(PromptView(label + " goal", "Daily " + label.toLowerCase() + " target (" + unit.trim() + ")", String(g[k]), function (val) {
        var n = parseFloat(val);
        if (!(n > 0)) return status("Enter a number", true);
        g[k] = Math.round(n); Store.saveGoals(g); pop(); replace(GoalsView()); status("Goal saved");
      }, { numeric: true, preview: k === "kcal" ? null : function (v) {
        var n = parseFloat(v) || 0; return Math.round(n * (k === "fat" ? 9 : 4)) + " kcal";
      } }));
    } };
  }
  var mk = g.carbs * 4 + g.protein * 4 + g.fat * 9;
  return ListView("Daily goals", [
    edit("kcal", "Calories", " kcal"),
    edit("carbs", "Carbs", " g"),
    edit("protein", "Protein", " g"),
    edit("fat", "Fat", " g"),
    { head: true, label: "macro goals add up to " + fmtK(mk) + " kcal" },
  ]);
}

function HistoryView() {
  var today = Store.dayKey(), items = [], sum = 0, n = 0;
  for (var i = 0; i < 30; i++) {
    var d = Store.shiftDay(today, -i), t = Store.totals(d), cnt = Store.entries(d).length;
    if (cnt) { sum += t.kcal; n++; }
    (function (day, t, cnt) {
      items.push({
        label: dayTitle(day), right: cnt ? fmtK(t.kcal) : "—",
        sub: cnt ? "C" + fmtG(t.carbs) + " P" + fmtG(t.protein) + " F" + fmtG(t.fat) + " · " + plural(cnt, "item") : "",
        run: function () { curDay = day; DashView.sel = -1; home(); },
      });
    }(d, t, cnt));
  }
  items.unshift({ head: true, label: n ? "AVG " + fmtK(sum / n) + " kcal over " + plural(n, "logged day") : "NO DAYS LOGGED YET" });
  return ListView("History", items, { center: "Open" });
}

function DiagView() {
  var lines = [
    "version: " + "1.0",
    "getUserMedia: " + !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    "ZXing: " + !!window.ZXing,
    "device storage: " + Backup.available(),
    "foods: " + Store.foodList().length,
    "storage used: " + Math.round((JSON.stringify(localStorage).length) / 1024) + " KB",
  ];
  return ListView("Diagnostics", lines.map(function (l) { return { label: l }; }));
}

// ---------------------------------------------------------------- start

(function start() {
  viewStack = [DashView];
  show();
  // Day rollover while the app stays open: follow "today" if we were on it.
  var lastToday = Store.dayKey();
  setInterval(function () {
    var t = Store.dayKey();
    if (t !== lastToday) { if (curDay === lastToday) curDay = t; lastToday = t; if (topView() === DashView) show(); }
  }, 60000);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && topView() === ScanView) pop(); // release camera when backgrounded
    else if (!document.hidden && topView() === DashView) show();
  });
}());
