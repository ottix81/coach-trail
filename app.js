/* Coach Trail — PWA. Données personnelles stockées uniquement en local (localStorage). */
(function () {
  "use strict";
  var APP_VERSION = "1.2.1";
  var KEY = "coachtrail:state:v1";
  var STATUS = { planned: "Prévue", done: "Effectuée (Strava)", modified: "Modifiée", race: "Course", rest: "Repos" };
  var JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
  var MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  var MOIS_C = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

  /* ---------- Stockage ---------- */
  var storageOK = false, mem = null;
  try { localStorage.setItem("__ct", "1"); localStorage.removeItem("__ct"); storageOK = true; } catch (e) { storageOK = false; }
  function blank() { return { plans: {}, activePlan: null, checks: {}, adapt: {}, adaptLog: {}, prefs: { view: "home" } }; }
  /* Migration : les données enregistrées avant la 1.2.0 n'ont ni adaptations ni historique. */
  function isObj(x) { return x && typeof x === "object" && !Array.isArray(x); }
  function migrate(st) {
    if (!isObj(st.checks)) st.checks = {};
    if (!isObj(st.prefs)) st.prefs = { view: "home" };
    if (!isObj(st.adapt)) st.adapt = {};
    if (!isObj(st.adaptLog)) st.adaptLog = {};
    return st;
  }
  function load() {
    if (!storageOK) return mem || (mem = blank());
    try { var s = JSON.parse(localStorage.getItem(KEY)); return s && s.plans ? migrate(s) : blank(); } catch (e) { return blank(); }
  }
  function save() {
    if (!storageOK) { mem = state; return; }
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { toast("Impossible d'enregistrer : stockage plein ou indisponible."); }
  }
  var state = load();

  /* ---------- Utilitaires ---------- */
  var qs = new URLSearchParams(location.search);
  function todayISO() { var t = qs.get("today"); return /^\d{4}-\d{2}-\d{2}$/.test(t || "") ? t : iso(new Date()); }
  function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function D(s) { var p = s.split("-"); return new Date(+p[0], p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = D(s); d.setDate(d.getDate() + n); return iso(d); }
  function monday(s) { var d = D(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); }
  function fdate(s) { var d = D(s); return JOURS[d.getDay()] + " " + d.getDate() + " " + MOIS_C[d.getMonth()]; }
  function fshort(s) { var d = D(s); return d.getDate() + " " + MOIS_C[d.getMonth()]; }
  function fmin(m) { if (!m) return "0 min"; var h = Math.floor(m / 60), r = Math.round(m % 60); return h ? h + "h" + (r < 10 ? "0" : "") + r : r + " min"; }
  function fkm(x) { return (Math.round((x || 0) * 10) / 10).toLocaleString("fr-FR"); }
  function fint(x) { return Math.round(x || 0).toLocaleString("fr-FR"); }
  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function $(id) { return document.getElementById(id); }
  var toastT;
  function toast(msg) { var t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("show"); }, 3200); }

  /* ---------- Modèle ---------- */
  function plan() { return state.activePlan ? state.plans[state.activePlan] : null; }
  function viewVer() { var p = plan(); if (!p) return null; var v = state.prefs.viewVersion; return (v && p.versions[v]) ? v : p.currentVersion; }
  function sessions(vid) {
    var p = plan(); if (!p) return []; vid = vid || viewVer(); var list = p.versions[vid].sessions;
    return (vid === p.currentVersion && adaptStore(false)) ? list.map(applyAdapt) : list;
  }
  function checks() { var p = plan(); if (!p) return {}; return state.checks[p.planId] || (state.checks[p.planId] = {}); }
  function isChecked(id) { return !!checks()[id]; }
  function setChecked(id, v) { var c = checks(); if (v) c[id] = { at: new Date().toISOString() }; else delete c[id]; save(); }
  function kind(s) { if (s.adapted) return "modified"; return s.status === "rest" ? "rest" : (STATUS[s.status] ? s.status : "planned"); }
  function sum(list, opts) {
    opts = opts || {}; var r = { km: 0, dplus: 0, minutes: 0, n: 0 };
    list.forEach(function (s) {
      if (s.status === "rest") return; if (opts.noRace && s.status === "race") return; if (opts.checked && !isChecked(s.id)) return;
      r.km += s.km || 0; r.dplus += s.dplus || 0; r.minutes += s.minutes || 0; r.n++;
    });
    return r;
  }
  function weeksOf(list) {
    var g = {}; list.forEach(function (s) { var k = monday(s.date); (g[k] = g[k] || []).push(s); });
    return Object.keys(g).sort().map(function (k) { return { start: k, items: g[k].sort(function (a, b) { return a.date < b.date ? -1 : 1; }) }; });
  }

  /* ---------- Import / validation / diff ---------- */
  function validate(o) {
    var err = [];
    if (!o || typeof o !== "object") return ["Fichier illisible."];
    if (o.schema !== "coach-trail-plan") err.push("Ce fichier n'est pas un programme Coach Trail (schema attendu : coach-trail-plan).");
    if (o.schemaVersion !== 1) err.push("Version de format non prise en charge (" + esc(o.schemaVersion) + ").");
    if (!o.planId) err.push("planId manquant.");
    if (!o.race || !o.race.name || !o.race.date) err.push("Informations de course manquantes.");
    if (!Array.isArray(o.versions) || !o.versions.length) err.push("Aucune version de programme.");
    else o.versions.forEach(function (v) {
      if (!v.id || !Array.isArray(v.sessions)) err.push("Version invalide.");
      else { var ids = {}; v.sessions.forEach(function (s) {
        if (!s.id || !/^\d{4}-\d{2}-\d{2}$/.test(s.date || "") || !s.type) err.push("Séance invalide dans " + v.id + ".");
        else if (ids[s.id]) err.push("Identifiant en double : " + s.id); else ids[s.id] = 1;
      }); }
    });
    if (o.currentVersion && Array.isArray(o.versions) && !o.versions.some(function (v) { return v.id === o.currentVersion; })) err.push("currentVersion ne correspond à aucune version.");
    var bad = JSON.stringify(o).match(/access_token|refresh_token|client_secret|"token"/i);
    if (bad) err.push("Le fichier semble contenir un jeton d'accès : import refusé par sécurité.");
    return err;
  }
  var FIELDS = [["type", "Type"], ["date", "Date"], ["km", "Distance"], ["minutes", "Durée"], ["dplus", "D+"], ["intensity", "Intensité"], ["goal", "Objectif"], ["status", "Statut"]];
  function fmtField(f, v) { if (v == null || v === "") return "—"; if (f === "km") return fkm(v) + " km"; if (f === "minutes") return fmin(v); if (f === "dplus") return "+" + fint(v) + " m"; if (f === "status") return STATUS[v] || v; if (f === "date") return fdate(v); return v; }
  function diff(oldList, newList) {
    var om = {}, nm = {}, out = { added: [], removed: [], changed: [] };
    (oldList || []).forEach(function (s) { om[s.id] = s; }); newList.forEach(function (s) { nm[s.id] = s; });
    newList.forEach(function (s) {
      var o = om[s.id]; if (!o) { out.added.push(s); return; }
      var ch = FIELDS.filter(function (f) { return (o[f[0]] == null ? "" : o[f[0]]) !== (s[f[0]] == null ? "" : s[f[0]]); }).map(function (f) { return { f: f[0], label: f[1], from: o[f[0]], to: s[f[0]] }; });
      if (ch.length) out.changed.push({ s: s, ch: ch });
    });
    (oldList || []).forEach(function (s) { if (!nm[s.id]) out.removed.push(s); });
    return out;
  }
  function importPlan(o) {
    var err = validate(o); if (err.length) return { ok: false, errors: err };
    var p = state.plans[o.planId], isNew = !p, warnings = [], addedV = [], prevCur = p ? p.currentVersion : null, prevSessions = p && prevCur ? p.versions[prevCur].sessions : null;
    if (p && p.exportedAt && o.exportedAt && o.exportedAt < p.exportedAt) {
      if (!confirm("Ce fichier est plus ancien que le programme déjà importé (" + o.exportedAt.slice(0, 10) + " contre " + p.exportedAt.slice(0, 10) + "). L'importer quand même ?")) return { ok: false, errors: ["Import annulé."] };
    }
    if (!p) p = state.plans[o.planId] = { planId: o.planId, versions: {}, order: [], log: [] };
    p.race = o.race; p.goals = o.goals || {}; p.intensityGuide = o.intensityGuide || ""; p.exportedAt = o.exportedAt || null;
    o.versions.forEach(function (v) {
      var ex = p.versions[v.id];
      if (!ex) { p.versions[v.id] = v; p.order.push(v.id); addedV.push(v.id); }
      else if (JSON.stringify(ex.sessions) !== JSON.stringify(v.sessions)) {
        if (ex.validated) warnings.push("La version " + v.id + " déjà enregistrée et validée n'a pas été remplacée (versions immuables).");
        else { p.versions[v.id] = v; warnings.push("La version provisoire " + v.id + " a été mise à jour."); }
      } else if (v.validated && !ex.validated) { ex.validated = true; ex.status = v.status; }
    });
    p.currentVersion = o.currentVersion || o.versions[o.versions.length - 1].id;
    var cur = p.versions[p.currentVersion].sessions, c = state.checks[o.planId] || (state.checks[o.planId] = {});
    var ids = {}; cur.forEach(function (s) { ids[s.id] = 1; });
    var kept = Object.keys(c).filter(function (id) { return ids[id]; }).length, orphan = Object.keys(c).filter(function (id) { return !ids[id]; });
    var d = prevSessions ? diff(prevSessions, cur) : null;
    p.log.unshift({ at: new Date().toISOString(), file: o.exportedAt || "", from: prevCur, to: p.currentVersion, addedVersions: addedV, kept: kept, orphan: orphan.length,
      summary: d ? { added: d.added.length, removed: d.removed.length, changed: d.changed.length } : null });
    p.log = p.log.slice(0, 30);
    state.activePlan = o.planId; state.prefs.viewVersion = null; state.prefs.weekStart = null; state.prefs.month = null;
    save();
    if (navigator.storage && navigator.storage.persist) { navigator.storage.persist().catch(function () {}); }
    return { ok: true, isNew: isNew, addedV: addedV, kept: kept, orphan: orphan, diff: d, warnings: warnings, cur: p.currentVersion };
  }
  function importBackup(o) {
    if (o.schema !== "coach-trail-backup" || !o.state || !o.state.plans) return { ok: false, errors: ["Sauvegarde invalide."] };
    if (!confirm("Restaurer cette sauvegarde remplacera les données actuelles de l'application sur ce téléphone. Continuer ?")) return { ok: false, errors: ["Restauration annulée."] };
    state = migrate(o.state); save(); return { ok: true, backup: true };
  }

  /* ---------- Rendu ---------- */
  function setView(v) { state.prefs.view = v; save(); render(); window.scrollTo(0, 0); }
  function render() {
    var p = plan(), v = state.prefs.view || "home";
    document.querySelectorAll(".tabbar button").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.v === v ? "true" : "false"); });
    $("topSub").textContent = p ? p.race.name + " · " + versionLabel(viewVer()) : "Aucun programme importé";
    var m = $("main");
    if (!p && v !== "settings") { m.innerHTML = emptyState(); return; }
    m.innerHTML = v === "week" ? viewWeek() : v === "month" ? viewMonth() : v === "progress" ? viewProgress() : v === "settings" ? viewSettings() : viewHome();
    if (v === "home") tick();
  }
  function versionLabel(id) { var p = plan(); if (!p || !id) return ""; var x = p.versions[id]; return (x.label || id) + (x.validated ? "" : " (provisoire)"); }
  function emptyState() {
    return '<div class="card empty-state"><img src="icons/icon-192.png" alt=""><h1>Coach Trail</h1><p class="muted">Importe le programme exporté par la skill <b>coach-trail</b> (fichier <code>.json</code>). Il reste uniquement sur ce téléphone.</p><button class="btn btn-o" data-act="import">Importer un programme</button></div>' +
      '<div class="card small muted">Tes données sportives ne sont pas publiées : elles sont lues depuis le fichier que tu choisis et enregistrées dans le stockage local de l\'application.</div>';
  }
  function legend() { return '<div class="legend"><span class="pill p-planned">Prévue</span><span class="pill p-done">Effectuée (Strava)</span><span class="pill p-modified">Modifiée / Adaptée</span><span class="pill p-race">Course</span><span class="pill p-check">✓ Cochée</span></div>'; }
  function raceCard() {
    var p = plan(), r = p.race, g = p.goals || {};
    return '<section class="card race"><div class="eyebrow">Prochaine course</div><h1>' + esc(r.name) + '</h1><div class="facts"><span>' + esc(fdate(r.date)) + " " + D(r.date).getFullYear() + (r.start ? " · " + esc(r.start.slice(11, 16).replace(":", "h")) : "") + '</span><span><b>' + fkm(r.km) + ' km</b></span><span><b>+' + fint(r.dplus) + ' m</b></span>' + (r.place ? "<span>" + esc(r.place) + "</span>" : "") + (r.timeLimit ? "<span>Limite " + esc(r.timeLimit) + "</span>" : "") +
      '</div><div class="count" id="count"></div><div class="chips">' + (g.ambitious ? '<span class="chip o">Objectif ' + esc(g.ambitious) + "</span>" : "") + (g.prudent ? '<span class="chip">Repère ' + esc(g.prudent) + "</span>" : "") + (g.estimate ? '<span class="chip">Estimation ' + esc(g.estimate) + "</span>" : "") + "</div></section>";
  }
  function tick() {
    var el = $("count"), p = plan(); if (!el || !p) return;
    var start = p.race.start ? new Date(p.race.start) : D(p.race.date), t = start - new Date();
    if (t <= 0) { el.innerHTML = '<div style="grid-column:1/-1"><b>Jour J</b><span>Bonne course !</span></div>'; return; }
    var d = Math.floor(t / 864e5), h = Math.floor(t / 36e5) % 24, mi = Math.floor(t / 6e4) % 60, s = Math.floor(t / 1e3) % 60;
    el.innerHTML = [[d, "jours"], [h, "heures"], [mi, "min"], [s, "s"]].map(function (x) { return "<div><b>" + x[0] + "</b><span>" + x[1] + "</span></div>"; }).join("");
  }
  /* ---------- Prénom (stocké uniquement en local) ---------- */
  function firstName() { var n = state.prefs && state.prefs.firstName; return typeof n === "string" ? n : ""; }
  function cleanName(v) { return String(v || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 30); }
  function greeting(today, t) {
    var p = plan(), n = firstName(), raceDay = (today && today.status === "race") || (p && p.race && p.race.date === t);
    var msg = raceDay ? "C'est le grand jour !" : (today && today.status !== "rest") ? "Voici ta séance du jour." : "Aujourd'hui, on récupère.";
    return '<section class="hello"><h1 id="hello">Bonjour' + (n ? " " + esc(n) : "") + ' !</h1><p id="helloMsg">' + esc(msg) + "</p>" +
      (n ? "" : '<button class="linkbtn" data-go="settings">Ajouter ton prénom</button>') + "</section>";
  }
  function sessionMeta(s) { return [s.time ? String(s.time).replace(":", "h") : "", s.km ? fkm(s.km) + " km" : "", s.minutes ? fmin(s.minutes) : "", s.dplus ? "+" + fint(s.dplus) + " m" : ""].filter(Boolean).join(" · "); }
  function viewHome() {
    var list = sessions(), t = todayISO(), today = list.filter(function (s) { return s.date === t; })[0];
    var next = list.filter(function (s) { return s.date > t && s.status !== "rest"; })[0];
    var h = greeting(today, t) + raceCard();
    h += '<section class="card today"><h2>Séance du jour <span class="small muted">' + esc(fdate(t)) + "</span></h2>";
    if (today) h += sessCardBig(today); else h += '<p class="muted">Aucune séance prévue aujourd\'hui.</p>';
    if (next && (!today || today.status === "rest")) h += '<div class="small muted" style="margin-top:12px">Prochaine séance</div>' + sessCardBig(next, true);
    h += "</section>";
    var wk = weeksOf(list).filter(function (w) { return w.start === monday(t); })[0];
    if (wk) {
      var pl = sum(wk.items), dn = sum(wk.items, { checked: true }), pct = pl.km ? Math.min(100, Math.round(dn.km / pl.km * 100)) : 0;
      h += '<section class="card"><h2>Cette semaine</h2><div class="wsum"><span><b>' + fkm(dn.km) + "</b> / " + fkm(pl.km) + " km</span><span><b>+" + fint(dn.dplus) + "</b> / " + fint(pl.dplus) + " m</span><span><b>" + dn.n + "</b> / " + pl.n + ' séances</span></div><div class="prog"><i style="width:' + pct + '%"></i></div>' + (origLine(wk.items) ? '<p class="small muted" style="margin:4px 0">' + origLine(wk.items) + "</p>" : "") + '<button class="btn btn-ghost" data-go="week" style="margin-top:8px">Voir la semaine</button></section>';
    }
    var p = plan(), v = p.versions[p.currentVersion];
    if (!v.validated) h += '<div class="card small" style="border-color:var(--mod);color:var(--mod)">Programme ' + esc(v.label || v.id) + " : provisoire, non validé.</div>";
    h += '<p class="small muted">Données figées à l\'export du ' + esc((p.exportedAt || "").slice(0, 10).split("-").reverse().join("/")) + ". Coach Trail ne se connecte pas à Strava : pour intégrer tes nouvelles sorties, demande une nouvelle analyse à Claude (skill coach-trail) puis importe le nouveau fichier.</p>";
    return h;
  }
  function sessCardBig(s, compact) {
    var k = kind(s), ck = isChecked(s.id);
    return '<div class="sess' + (ck ? " checked" : "") + (s.status === "rest" ? " rest" : "") + '" style="border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-top:8px"><div class="bar b-' + k + '"></div>' +
      '<label class="chk">' + (s.status === "rest" ? "" : '<input type="checkbox" data-check="' + esc(s.id) + '"' + (ck ? " checked" : "") + ' aria-label="Séance terminée">') + "</label>" +
      '<button class="sbody" data-open="' + esc(s.id) + '"><div class="srow"><span class="' + (compact ? "sdate" : "sdate now") + '">' + esc(compact ? fdate(s.date) : "Aujourd'hui") + '</span>' + (k !== "planned" && k !== "rest" ? '<span class="pill p-' + k + '">' + (s.adapted ? "Adaptée" : STATUS[k]) + "</span>" : "") + '</div><div class="' + (compact ? "stype" : "big") + '">' + esc(s.type) + '</div><div class="smeta">' + esc([sessionMeta(s), s.intensity].filter(Boolean).join(" · ") || s.goal || "") + "</div></button></div>" + adaptBtn(s);
  }
  function sessRow(s) {
    var k = kind(s), ck = isChecked(s.id), t = todayISO();
    return '<div class="sess' + (ck ? " checked" : "") + (s.status === "rest" ? " rest" : "") + '"><div class="bar b-' + k + '"></div><label class="chk">' + (s.status === "rest" ? "" : '<input type="checkbox" data-check="' + esc(s.id) + '"' + (ck ? " checked" : "") + ' aria-label="Séance terminée : ' + esc(fdate(s.date)) + '">') + '</label>' +
      '<button class="sbody" data-open="' + esc(s.id) + '"><div class="srow"><span class="sdate' + (s.date === t ? " now" : "") + '">' + esc(fdate(s.date)) + (s.date === t ? " · aujourd'hui" : "") + "</span>" + (k !== "planned" && k !== "rest" ? '<span class="pill p-' + k + '">' + (s.adapted ? "Adaptée" : STATUS[k]) + "</span>" : "") + '</div><div class="stype">' + esc(s.type) + '</div><div class="smeta">' + esc([sessionMeta(s), s.intensity].filter(Boolean).join(" · ") || s.goal || "") + "</div></button></div>";
  }
  function viewWeek() {
    var ws = weeksOf(sessions()); if (!ws.length) return "<p>Aucune séance.</p>";
    var cur = state.prefs.weekStart, t = monday(todayISO());
    if (!cur || !ws.some(function (w) { return w.start === cur; })) { cur = ws.some(function (w) { return w.start === t; }) ? t : (t < ws[0].start ? ws[0].start : ws[ws.length - 1].start); }
    var i = ws.findIndex(function (w) { return w.start === cur; }), w = ws[i], pl = sum(w.items, { noRace: true }), all = sum(w.items), dn = sum(w.items, { checked: true });
    var hasRace = w.items.some(function (s) { return s.status === "race"; });
    return versionSwitch() + '<div class="wnav"><button class="btn" data-week="' + (i - 1) + '"' + (i === 0 ? " disabled" : "") + ' aria-label="Semaine précédente">‹</button><b>Semaine du ' + esc(fshort(w.start)) + " au " + esc(fshort(addDays(w.start, 6))) + '</b><button class="btn" data-week="' + (i + 1) + '"' + (i === ws.length - 1 ? " disabled" : "") + ' aria-label="Semaine suivante">›</button></div>' +
      '<div class="wsum"><span>Prévu <b>' + fkm(pl.km) + " km</b></span><span><b>+" + fint(pl.dplus) + " m</b></span><span><b>" + fmin(pl.minutes) + "</b></span>" + (hasRace ? "<span>Course comprise : " + fkm(all.km) + " km · +" + fint(all.dplus) + " m</span>" : "") + "<span>Coché <b>" + fkm(dn.km) + " km</b></span>" + origLine(w.items) + "</div>" +
      legend() + '<div class="list">' + w.items.map(sessRow).join("") + "</div>";
  }
  function versionSwitch() {
    var p = plan(); if (p.order.length < 2) return "";
    return oldVerNotice() + '<div style="margin-bottom:12px"><label class="small muted" for="verSel">Version affichée</label><select id="verSel" class="btn sel">' + p.order.map(function (id) { return '<option value="' + esc(id) + '"' + (id === viewVer() ? " selected" : "") + ">" + esc(versionLabel(id)) + (id === p.currentVersion ? " · actuelle" : "") + "</option>"; }).join("") + "</select></div>";
  }
  function viewMonth() {
    var list = sessions(), by = {}; list.forEach(function (s) { by[s.date] = s; });
    var months = []; list.forEach(function (s) { var k = s.date.slice(0, 7); if (months.indexOf(k) < 0) months.push(k); }); months.sort();
    var cur = state.prefs.month; if (!cur || months.indexOf(cur) < 0) { var tm = todayISO().slice(0, 7); cur = months.indexOf(tm) >= 0 ? tm : months[0]; }
    var i = months.indexOf(cur), y = +cur.slice(0, 4), mo = +cur.slice(5, 7) - 1, first = new Date(y, mo, 1), n = new Date(y, mo + 1, 0).getDate(), off = (first.getDay() + 6) % 7, t = todayISO();
    var h = versionSwitch() + '<div class="wnav"><button class="btn" data-month="' + (i - 1) + '"' + (i === 0 ? " disabled" : "") + ' aria-label="Mois précédent">‹</button><b style="text-transform:capitalize">' + MOIS[mo] + " " + y + '</b><button class="btn" data-month="' + (i + 1) + '"' + (i === months.length - 1 ? " disabled" : "") + ' aria-label="Mois suivant">›</button></div>' + legend() + '<div class="grid">' + ["L", "M", "M", "J", "V", "S", "D"].map(function (x) { return '<div class="dow">' + x + "</div>"; }).join("");
    for (var e = 0; e < off; e++) h += '<div class="day empty"></div>';
    for (var d = 1; d <= n; d++) {
      var k = iso(new Date(y, mo, d)), s = by[k];
      if (!s) { h += '<div class="day off' + (k === t ? " is-today" : "") + '"><span class="n">' + d + "</span></div>"; continue; }
      h += '<button class="day k-' + kind(s) + (k === t ? " is-today" : "") + '" data-open="' + esc(s.id) + '"><span class="n">' + d + (isChecked(s.id) ? ' <span class="tick">✓</span>' : "") + '</span><span class="t">' + esc(s.status === "rest" ? "Repos" : (s.km ? fkm(s.km) + " km" : fmin(s.minutes))) + "</span></button>";
    }
    h += "</div>";
    h += '<section class="card"><h2>Résumé par semaine</h2><table><thead><tr><th>Semaine</th><th class="n">km</th><th class="n">D+</th><th class="n">Durée</th></tr></thead><tbody>' + weeksOf(list).map(function (w) { var s = sum(w.items); return "<tr><td>" + esc(fshort(w.start)) + '</td><td class="n">' + fkm(s.km) + '</td><td class="n">' + fint(s.dplus) + '</td><td class="n">' + fmin(s.minutes) + "</td></tr>"; }).join("") + '</tbody></table><p class="small muted">Course comprise.</p></section>';
    return h;
  }
  function diffHTML(d) {
    if (!d) return '<p class="small muted">Aucune version précédente à comparer.</p>';
    if (!d.added.length && !d.removed.length && !d.changed.length) return '<p class="small muted">Aucune différence.</p>';
    var li = [];
    d.changed.forEach(function (c) { li.push("<li><b>" + esc(fdate(c.s.date)) + " · " + esc(c.s.type) + '</b> <span class="pill p-modified">modifiée</span><br>' + c.ch.map(function (x) { return esc(x.label) + " : " + esc(fmtField(x.f, x.from)) + " → <b>" + esc(fmtField(x.f, x.to)) + "</b>"; }).join("<br>") + "</li>"); });
    d.added.forEach(function (s) { li.push("<li><b>" + esc(fdate(s.date)) + " · " + esc(s.type) + '</b> <span class="pill p-done">ajoutée</span></li>'); });
    d.removed.forEach(function (s) { li.push("<li><b>" + esc(fdate(s.date)) + " · " + esc(s.type) + '</b> <span class="pill p-removed">retirée</span></li>'); });
    return '<ul class="diff">' + li.join("") + "</ul>";
  }
  function viewProgress() {
    var p = plan(), list = sessions(p.currentVersion), t = todayISO();
    var past = list.filter(function (s) { return s.status !== "rest" && s.status !== "race" && s.date <= t; }), doneN = past.filter(function (s) { return isChecked(s.id) || s.status === "done"; }).length;
    var pl = sum(list, { noRace: true }), dn = sum(list, { checked: true, noRace: true }), pct = pl.km ? Math.round(dn.km / pl.km * 100) : 0;
    var h = '<section class="card"><h2>Progression</h2><div class="wsum"><span>Séances à jour : <b>' + doneN + " / " + past.length + "</b></span><span>Coché <b>" + fkm(dn.km) + " / " + fkm(pl.km) + " km</b></span><span><b>+" + fint(dn.dplus) + " / " + fint(pl.dplus) + ' m</b></span></div><div class="prog"><i style="width:' + Math.min(100, pct) + '%"></i></div><p class="small muted">Hors course. « Effectuée (Strava) » vient du dernier export ; les cases cochées sont tes propres validations.</p>' +
      '<table><thead><tr><th>Semaine</th><th class="n">Prévu</th><th class="n">Coché</th><th class="n">D+ coché</th></tr></thead><tbody>' + weeksOf(list).map(function (w) { var a = sum(w.items, { noRace: true }), b = sum(w.items, { noRace: true, checked: true }); return "<tr><td>" + esc(fshort(w.start)) + '</td><td class="n">' + fkm(a.km) + ' km</td><td class="n">' + fkm(b.km) + ' km</td><td class="n">' + fint(b.dplus) + " m</td></tr>"; }).join("") + "</tbody></table></section>";
    var ids = {}; list.forEach(function (s) { ids[s.id] = 1; });
    var orphan = Object.keys(checks()).filter(function (id) { return !ids[id]; });
    if (orphan.length) h += '<section class="card"><h2>Séances cochées retirées du programme</h2><p class="small muted">Elles restent dans ton historique local.</p><ul class="diff">' + orphan.map(function (id) { return "<li>" + esc(id) + "</li>"; }).join("") + "</ul></section>";
    h += adaptList() + adaptHistory();
    h += '<section class="card"><h2>Versions du programme</h2>';
    p.order.slice().reverse().forEach(function (id, idx, arr) {
      var v = p.versions[id], prevId = p.order[p.order.indexOf(id) - 1];
      h += '<div style="padding:10px 0;border-top:' + (idx ? "1px solid var(--line)" : "0") + '"><div class="row" style="justify-content:space-between"><b>' + esc(v.label || id) + '</b><span>' + (id === p.currentVersion ? '<span class="pill p-check">actuelle</span> ' : "") + (p.order[0] === id ? '<span class="pill p-planned">initiale</span> ' : "") + (v.validated ? '<span class="pill p-done">validée</span>' : '<span class="pill p-modified">provisoire</span>') + '</span></div><div class="small muted">' + esc((v.date || "").split("-").reverse().join("/")) + "</div>" +
        (v.notes && v.notes.length ? '<ul class="small" style="margin:6px 0 0;padding-left:18px">' + v.notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul>" : "") +
        (prevId ? '<details style="margin-top:6px"><summary class="small">Différences avec ' + esc(prevId) + "</summary>" + diffHTML(diff(p.versions[prevId].sessions, v.sessions)) + "</details>" : "") +
        '<button class="btn btn-ghost small" data-showver="' + esc(id) + '" style="margin-top:8px">Afficher cette version</button></div>';
    });
    h += "</section>";
    if (p.log && p.log.length) h += '<section class="card"><h2>Journal des imports</h2><ul class="diff small">' + p.log.map(function (l) { return "<li>" + esc(new Date(l.at).toLocaleString("fr-FR")) + " · " + esc(l.from ? l.from + " → " : "") + esc(l.to) + (l.addedVersions.length ? " · nouvelles versions : " + esc(l.addedVersions.join(", ")) : "") + " · cases conservées : " + l.kept + (l.orphan ? " · retirées : " + l.orphan : "") + "</li>"; }).join("") + "</ul></section>";
    return h;
  }
  function viewSettings() {
    var p = plan();
    return '<section class="card"><h2>Profil</h2><label for="nameIn" class="small muted">Prénom affiché sur l\'accueil</label><div class="row" style="margin-top:6px"><input id="nameIn" class="field" type="text" maxlength="30" autocomplete="given-name" autocapitalize="words" placeholder="Ton prénom" value="' + esc(firstName()) + '"><button class="btn btn-o" data-act="savename">Enregistrer</button></div><p class="small muted">Enregistré uniquement sur ce téléphone, jamais dans les fichiers du site.</p></section>' +
      '<section class="card"><h2>Programme</h2>' + (p ? '<p class="small muted">' + esc(p.race.name) + " · version actuelle " + esc(versionLabel(p.currentVersion)) + "</p>" : '<p class="small muted">Aucun programme importé.</p>') +
      '<div class="row"><button class="btn btn-o" data-act="import">Importer un programme (.json)</button></div><p class="small muted">Les séances déjà cochées sont conservées grâce à leurs identifiants. Les versions validées ne sont jamais écrasées.</p></section>' +
      '<section class="card"><h2>Sauvegarde</h2><p class="small muted">Exporte tes cases cochées et tes programmes dans un fichier, à garder en lieu sûr (pas sur un site public).</p><div class="row"><button class="btn" data-act="backup">Exporter une sauvegarde</button><button class="btn" data-act="import">Restaurer</button></div></section>' +
      '<section class="card"><h2>Confidentialité et stockage</h2><ul class="small" style="padding-left:18px;margin:0">' +
      "<li>Aucune donnée personnelle n'est incluse dans les fichiers du site : tout est importé et stocké <b>uniquement sur ce téléphone</b>.</li>" +
      "<li>Stockage local : " + (storageOK ? "disponible" : "<b>indisponible</b> (navigation privée ?) : les données seront perdues à la fermeture") + ".</li>" +
      "<li>Les données peuvent disparaître si tu supprimes l'application, vides les données du navigateur, ou utilises la navigation privée. Sur iPhone, l'app installée et Safari ont des stockages séparés : importe le programme depuis l'app installée.</li>" +
      "<li>Les adaptations de séances (fatigue, météo, temps, forme) sont calculées et enregistrées <b>uniquement ici</b>, sans envoi nulle part. Elles figurent dans la sauvegarde que tu exportes.</li>" +
      "<li>Aucune connexion à Strava : aucun identifiant ni jeton n'est demandé ou enregistré.</li></ul>" +
      '<div class="row" style="margin-top:12px"><button class="btn btn-danger" data-act="wipe">Effacer toutes les données</button></div></section>' +
      '<section class="card"><h2>Application</h2><p class="small muted">Coach Trail ' + APP_VERSION + ' · <span id="swState">service worker : vérification…</span></p><div class="row"><button class="btn" data-act="checkupdate">Rechercher une mise à jour</button></div></section>';
  }

  /* ---------- Détail ---------- */
  function findSession(id) { return sessions().filter(function (s) { return s.id === id; })[0]; }
  function openSheet(id) {
    var s = findSession(id); if (!s) return; var k = kind(s), p = plan(), ck = isChecked(id), prev = null;
    var vi = p.order.indexOf(viewVer()); if (vi > 0) prev = p.versions[p.order[vi - 1]].sessions.filter(function (x) { return x.id === id; })[0];
    var rs = s._raw || s, ch = prev ? FIELDS.filter(function (f) { return (prev[f[0]] == null ? "" : prev[f[0]]) !== (rs[f[0]] == null ? "" : rs[f[0]]); }) : [];
    var h = '<span class="pill p-' + (k === "rest" ? "planned" : k) + '">' + (s.adapted ? "Adaptée" : (STATUS[k] || "")) + '</span><h3 id="shTitle">' + esc(s.type) + '</h3><div class="muted">' + esc(fdate(s.date)) + '</div><dl class="kv">' +
      (s.time ? "<dt>Horaire</dt><dd>" + esc(String(s.time).replace(":", "h")) + "</dd>" : "") + (s.km ? "<dt>Distance</dt><dd>" + fkm(s.km) + " km</dd>" : "") + (s.minutes ? "<dt>Durée</dt><dd>" + fmin(s.minutes) + "</dd>" : "") + (s.dplus ? "<dt>D+</dt><dd>+" + fint(s.dplus) + " m</dd>" : "") + (s.intensity ? "<dt>Intensité</dt><dd>" + esc(s.intensity) + "</dd>" : "") + (s.goal ? "<dt>Objectif</dt><dd>" + esc(s.goal) + "</dd>" : "") + "</dl>" +
      (s.instructions ? '<div class="note">' + esc(s.instructions) + "</div>" : "") + adaptInfo(s) +
      (ch.length ? '<div class="was"><b>Avant (' + esc(p.order[vi - 1]) + ")</b><br>" + ch.map(function (f) { return esc(f[1]) + " : " + esc(fmtField(f[0], prev[f[0]])); }).join("<br>") + "</div>" : "") +
      adaptElsewhere(s) + adaptBtn(s) + askBtn(s) + (s.status === "rest" ? "" : '<label class="checkline"><input type="checkbox" class="cb" data-check="' + esc(id) + '"' + (ck ? " checked" : "") + "> Séance terminée</label>") +
      (p.intensityGuide ? '<p class="small muted">' + esc(p.intensityGuide) + "</p>" : "");
    $("shBody").innerHTML = h; $("sheet").classList.add("open"); $("sheetBg").classList.add("open");
  }
  function closeSheet() { AD = null; $("sheet").classList.remove("open"); $("sheetBg").classList.remove("open"); }

  /* ---------- Adaptation de séance (calcul et stockage 100 % locaux) ---------- */
  /* Les adaptations ne modifient jamais les versions importées : elles sont superposées à la version actuelle,
     enregistrées dans state.adapt[planId][idSéance] (état actif) et state.adaptLog[planId] (historique séparé).
     Rien n'est envoyé nulle part : « Demander à Claude » prépare seulement un texte à copier. */
  var AD = null, ADF = ["type", "time", "km", "minutes", "dplus", "intensity"];
  var EASY = "Facile (allure conversation)";
  var PAIN_NOTE = "Douleur signalée : aucune augmentation de volume ni d'intensité. Si la douleur persiste ou s'aggrave, arrête et demande l'avis d'un professionnel de santé.";
  var ADAPT_REASONS = [
    { id: "fatigue", label: "Fatigue", opts: [["light", "Un peu fatigué(e)"], ["heavy", "Très fatigué(e)"]] },
    { id: "meteo", label: "Météo", opts: [["rain", "Pluie / terrain glissant"], ["heat", "Forte chaleur"], ["cold", "Gel / verglas"], ["storm", "Orage / vent violent"]] },
    { id: "temps", label: "Manque de temps", opts: [["30", "30 min disponibles"], ["45", "45 min disponibles"], ["60", "1 h disponible"], ["90", "1 h 30 disponible"]] },
    { id: "forme", label: "Forme du jour", opts: [["low", "Mauvaise forme"], ["mid", "Forme moyenne"], ["top", "Très bonne forme"]] },
    { id: "autre", label: "Autre", opts: [["less10", "Un peu moins (−10 %)"], ["less30", "Nettement moins (−30 %)"], ["manual", "Je règle moi-même"]] }
  ];
  function reasonOf(id) { return ADAPT_REASONS.filter(function (r) { return r.id === id; })[0]; }
  function optLabel(r, o) { var x = r && r.opts.filter(function (q) { return q[0] === o; })[0]; return x ? x[1] : ""; }
  function adaptStore(create) {
    var p = plan(); if (!p) return null;
    if (!isObj(state.adapt)) { if (!create) return null; state.adapt = {}; }
    if (!isObj(state.adapt[p.planId])) { if (!create) return null; state.adapt[p.planId] = {}; }
    return state.adapt[p.planId];
  }
  function adaptLogOf(create) {
    var p = plan(); if (!p) return [];
    if (!isObj(state.adaptLog)) { if (!create) return []; state.adaptLog = {}; }
    if (!Array.isArray(state.adaptLog[p.planId])) { if (!create) return []; state.adaptLog[p.planId] = []; }
    return state.adaptLog[p.planId];
  }
  function logAdapt(entry) { var l = adaptLogOf(true); l.unshift(entry); if (l.length > 200) l.length = 200; }
  function validA(a) { return isObj(a) && isObj(a.before) && isObj(a.after); }
  function snap(s) { var o = {}; ADF.forEach(function (f) { o[f] = s[f] == null ? null : s[f]; }); return o; }
  function sameSnap(a, b) { return ADF.every(function (f) { return (a[f] == null ? null : a[f]) === (b[f] == null ? null : b[f]); }); }
  function applyAdapt(s) {
    var st = adaptStore(false), a = st && st[s.id];
    if (!validA(a) || !sameSnap(a.before, snap(s))) return s; /* séance modifiée par un nouvel import : adaptation ignorée */
    var o = {}; Object.keys(s).forEach(function (k) { o[k] = s[k]; });
    ADF.forEach(function (f) { if (a.after[f] != null) o[f] = a.after[f]; });
    o.adapted = true; o._raw = s; o._ad = a;
    o.instructions = "Adaptation (" + a.label + ") : " + a.note + (s.instructions ? "\n\nSéance d'origine : " + s.instructions : "");
    return o;
  }
  function rawSession(id) { var p = plan(); return p ? p.versions[p.currentVersion].sessions.filter(function (x) { return x.id === id; })[0] : null; }
  function canAdapt(s) {
    var p = plan(); if (!p || !s) return false;
    return (s.status === "planned" || s.status === "modified") && s.date >= todayISO() && viewVer() === p.currentVersion;
  }
  function adaptBtn(s) {
    if (!canAdapt(s)) return "";
    return '<button class="btn btn-o adapt-btn" data-adapt="' + esc(s.id) + '">' + (s.adapted ? "Adapter à nouveau" : "Adapter ma séance") + "</button>";
  }
  function askBtn(s) {
    var p = plan(); if (!p || s.status === "rest" || viewVer() !== p.currentVersion) return "";
    return '<button class="btn adapt-btn" data-ask="' + esc(s.id) + '">Demander à Claude</button>';
  }
  function ftime(t) { return String(t || "").replace(":", "h"); }
  function descr(b) { return [b.type, b.time ? ftime(b.time) : "", b.km ? fkm(b.km) + " km" : "", b.minutes ? fmin(b.minutes) : "", b.dplus ? "+" + fint(b.dplus) + " m" : "", b.intensity].filter(Boolean).join(" · "); }
  function adaptInfo(s) {
    if (!s.adapted) return "";
    return '<div class="was"><b>Séance adaptée (' + esc(s._ad.label) + ")</b><br>Prévu à l'origine : " + esc(descr(s._ad.before)) +
      '<br><button class="linkbtn" data-arevert="' + esc(s.id) + '">Revenir à la séance d\'origine</button></div>';
  }
  /* Consultation d'une ancienne version : on signale l'adaptation de la version actuelle sans rien réécrire. */
  function adaptElsewhere(s) {
    var p = plan(), st = adaptStore(false), a = st && st[s.id];
    if (!p || viewVer() === p.currentVersion || !validA(a)) return "";
    return '<div class="was">Cette séance a été adaptée sur la version actuelle (' + esc(a.label) + ", " + esc(new Date(a.at).toLocaleDateString("fr-FR")) + "). Cette version ancienne reste affichée telle qu'importée.</div>";
  }
  function oldVerNotice() {
    var p = plan(), st = adaptStore(false); if (!p || !st || viewVer() === p.currentVersion) return "";
    var n = Object.keys(st).filter(function (id) { return validA(st[id]); }).length; if (!n) return "";
    return '<div class="card small" style="border-color:var(--mod);color:var(--mod)">' + n + " séance" + (n > 1 ? "s" : "") + " adaptée" + (n > 1 ? "s" : "") + " sur la version actuelle. Cette ancienne version est affichée telle qu'importée, sans les adaptations.</div>";
  }
  function origLine(items) {
    if (!items.some(function (s) { return s.adapted; })) return "";
    var o = sum(items.map(function (s) { return s._raw || s; }), { noRace: true });
    return "<span>Prévu à l'origine <b>" + fkm(o.km) + " km · +" + fint(o.dplus) + " m · " + fmin(o.minutes) + "</b></span>";
  }

  var r1 = function (x) { return Math.round(x * 10) / 10; }, r5 = function (x) { return Math.max(5, Math.round(x / 5) * 5); }, r10 = function (x) { return Math.round(x / 10) * 10; };
  function propose(s, reason, opt, pain) {
    var f = 1, fd = null, type = s.type, inten = s.intensity, note = "", zero = false;
    var base = s.minutes || (s.km ? Math.round(s.km * 7) : 0), target = null;
    if (reason === "fatigue") {
      f = opt === "heavy" ? 0.5 : 0.8; inten = EASY;
      note = opt === "heavy" ? "Très fatigué(e) : volume réduit de moitié, allure facile. Si la fatigue dure plusieurs jours, privilégie le repos."
        : "Un peu fatigué(e) : volume réduit d'environ 20 %, allure facile. Arrête-toi plus tôt si les jambes restent lourdes.";
    } else if (reason === "meteo") {
      if (opt === "rain") { f = 0.9; fd = 0.7; inten = EASY; note = "Terrain glissant : un peu moins de distance et de dénivelé, foulée courte, prudence dans les descentes."; }
      else if (opt === "heat") { f = 0.8; fd = 0.8; inten = EASY; note = "Forte chaleur : sors tôt ou tard, emporte de l'eau, ralentis et arrête-toi au moindre malaise."; }
      else if (opt === "cold") { f = 0.8; fd = 0.5; inten = EASY; note = "Gel / verglas : privilégie des chemins dégagés, évite les sections exposées, échauffe-toi longuement."; }
      else { zero = true; type = "Mobilité / renforcement léger en intérieur"; inten = "Très facile"; note = "Orage ou vent violent : ne cours pas dehors. 20 à 30 min de mobilité et de renforcement léger, ou décale la séance."; }
    } else if (reason === "temps") {
      target = +opt; f = base ? Math.min(1, target / base) : 1;
      note = f < 1 ? "Séance raccourcie à " + target + " min : intensité prévue conservée, volume réduit." : "La séance tient déjà dans les " + target + " min disponibles.";
    } else if (reason === "forme") {
      if (opt === "low") { f = 0.7; inten = EASY; note = "Mauvaise forme : volume réduit d'environ 30 % et allure facile. Écoute ton corps."; }
      else if (opt === "mid") { f = 0.9; note = "Forme moyenne : volume réduit d'environ 10 %, intensité inchangée mais sans forcer."; }
      else { f = 1.1; note = "Très bonne forme : jusqu'à +10 % de volume au maximum, sans ajouter d'intensité."; }
    } else if (reason === "autre") {
      if (opt === "less10") { f = 0.9; note = "Volume réduit d'environ 10 %."; }
      else if (opt === "less30") { f = 0.7; inten = EASY; note = "Volume réduit d'environ 30 %, allure facile."; }
      else note = "Séance réglée manuellement.";
    }
    if (pain) { /* une douleur ne déclenche jamais une séance plus longue ou plus intense */
      if (f > 1) f = 0.9; if (fd != null && fd > 1) fd = 0.9;
      if (!zero) inten = EASY;
      note = PAIN_NOTE + " " + note;
    }
    if (fd == null) fd = f;
    var r = { type: type, intensity: inten, note: note, km: s.km, minutes: s.minutes, dplus: s.dplus };
    if (zero) { if (s.km) r.km = 0; if (s.dplus) r.dplus = 0; r.minutes = Math.min(s.minutes || 30, 30); return r; }
    if (f !== 1 || fd !== 1) {
      if (s.km) r.km = r1(s.km * f);
      if (s.minutes) r.minutes = target ? Math.min(s.minutes, target) : r5(s.minutes * f);
      else if (target && f < 1) r.minutes = target;
      if (s.dplus) r.dplus = r10(s.dplus * fd);
    }
    return r;
  }
  function openAdapt(id) {
    var s = rawSession(id); if (!s || !canAdapt(s)) return;
    AD = { id: id, reason: null, opt: null, pain: false, ctx: "", from: "menu" }; renderAdapt();
    $("sheet").classList.add("open"); $("sheetBg").classList.add("open");
  }
  function chipRow(attr, list, cur) { return list.map(function (r) { return '<button class="chip' + (cur === r[0] ? " o" : "") + '" ' + attr + '="' + r[0] + '" aria-pressed="' + (cur === r[0]) + '">' + esc(r[1]) + "</button>"; }).join(""); }
  function cmpRow(key, label, o, p) { return "<tr><td>" + label + "</td><td>" + esc(o || "—") + '</td><td id="adP-' + key + '"><b>' + esc(p || "—") + "</b></td></tr>"; }
  function renderAdapt() {
    var s = rawSession(AD.id); if (!s) return;
    var h = '<span class="pill p-modified">Adapter ma séance</span><h3 id="shTitle">' + esc(s.type) + '</h3><div class="muted">' + esc(fdate(s.date)) + "</div>" +
      '<p class="small muted" style="margin-top:14px">Pourquoi veux-tu adapter cette séance ?</p><div class="chips">' + chipRow("data-ar", ADAPT_REASONS.map(function (r) { return [r.id, r.label]; }), AD.reason) + "</div>" +
      '<label class="checkline" style="font-size:15px;margin-top:12px"><input type="checkbox" class="cb" id="adPain"' + (AD.pain ? " checked" : "") + "> J'ai une douleur (articulation, tendon, muscle…)</label>";
    var rs = reasonOf(AD.reason);
    if (rs) h += '<div class="opts">' + rs.opts.map(function (o) { return '<button class="btn' + (AD.opt === o[0] ? " sel-on" : "") + '" data-ao="' + o[0] + '" aria-pressed="' + (AD.opt === o[0]) + '">' + esc(o[1]) + "</button>"; }).join("") + "</div>";
    if (rs && AD.opt) {
      var r = propose(s, AD.reason, AD.opt, AD.pain), pick = function (k) { var v = AD.man && AD.man[k] != null ? AD.man[k] : r[k]; return v == null ? "" : v; };
      h += '<div class="note" style="margin-top:14px">' + esc(r.note) + "</div>" +
        '<h3 style="font-size:16px;margin-top:14px">Originale / proposée</h3><table class="cmp"><thead><tr><th></th><th>Originale</th><th>Proposée</th></tr></thead><tbody>' +
        cmpRow("type", "Séance", s.type, r.type) + cmpRow("time", "Horaire", s.time ? ftime(s.time) : "", "") + cmpRow("km", "Distance", s.km ? fkm(s.km) + " km" : "", "") +
        cmpRow("min", "Durée", s.minutes ? fmin(s.minutes) : "", "") + cmpRow("dp", "D+", s.dplus ? "+" + fint(s.dplus) + " m" : "", "") + cmpRow("int", "Intensité", s.intensity || "", "") + '</tbody></table>' +
        '<h3 style="font-size:16px;margin-top:14px">Modifier à la main</h3><div class="adfields">' +
        '<label>Distance (km)<input id="adKm" class="field" type="number" inputmode="decimal" min="0" step="0.1" value="' + pick("km") + '"></label>' +
        '<label>Durée (min)<input id="adMin" class="field" type="number" inputmode="numeric" min="0" step="5" value="' + pick("minutes") + '"></label>' +
        '<label>D+ (m)<input id="adDp" class="field" type="number" inputmode="numeric" min="0" step="10" value="' + pick("dplus") + '"></label>' +
        '<label>Horaire<input id="adTime" class="field" type="time" value="' + esc(pick("time")) + '"></label>' +
        '<label style="grid-column:1/-1">Intensité<input id="adInt" class="field" type="text" maxlength="60" value="' + esc(pick("intensity")) + '" placeholder="Ex. Facile, Moyenne, Seuil…"></label></div>' +
        '<p class="small muted">' + (AD.pain ? "Douleur signalée : aucune augmentation n'est possible, seulement des réductions ou des changements d'horaire / d'intensité." : "Les suggestions automatiques sont limitées à +10 %. En modification manuelle tu choisis librement, mais une augmentation importante demande une confirmation.") +
        " Enregistré uniquement sur ce téléphone ; la séance d'origine reste récupérable. Ces conseils généraux ne remplacent pas un avis médical.</p>" +
        '<div id="adWarn" aria-live="polite"></div>' +
        '<div class="row"><button class="btn btn-o" data-aapply="1">Appliquer</button><button class="btn" data-ask="' + esc(s.id) + '">Demander à Claude</button><button class="btn" data-aback="' + esc(s.id) + '">Annuler</button></div>';
    } else h += '<div class="row" style="margin-top:14px"><button class="btn" data-ask="' + esc(s.id) + '">Demander à Claude</button><button class="btn" data-aback="' + esc(s.id) + '">Retour</button></div>';
    $("shBody").innerHTML = h;
    if (rs && AD.opt) updatePreview();
  }
  var NUMF = [["km", "adKm", "Distance", "km"], ["minutes", "adMin", "Durée", "min"], ["dplus", "adDp", "D+", "m"]];
  /* Valeurs saisies (champ vide = valeur proposée). Aucun plafond en saisie manuelle :
     les augmentations sont listées dans `incs` (big = au-delà de +10 %). */
  function formVals(s, r, strict) {
    var out = { type: r.type, km: r.km, minutes: r.minutes, dplus: r.dplus, time: r.time || s.time || null, intensity: r.intensity }, err = null;
    NUMF.forEach(function (c) {
      var el = $(c[1]); if (!el || String(el.value).trim() === "") return;
      var v = parseFloat(String(el.value).replace(",", "."));
      if (!isFinite(v) || v < 0) { if (strict && !err) err = c[2] + " : saisis un nombre positif."; return; }
      out[c[0]] = c[0] === "km" ? r1(v) : Math.round(v);
    });
    if ($("adTime") && $("adTime").value) { if (/^([01]\d|2[0-3]):[0-5]\d$/.test($("adTime").value)) out.time = $("adTime").value; else if (strict && !err) err = "Horaire invalide."; }
    if ($("adInt")) { var iv = String($("adInt").value).replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 60); out.intensity = iv || s.intensity || null; }
    out.incs = incsOf(s, out); out.err = err; return out;
  }
  function incsOf(s, v) {
    var l = [];
    NUMF.forEach(function (c) {
      var o = s[c[0]] || 0, n = v[c[0]] || 0; if (n <= o) return;
      l.push({ f: c[0], label: c[2], unit: c[3], from: o, to: n, pct: o ? Math.round((n / o - 1) * 100) : null, big: o ? n > Math.ceil(o * 1.1 * 10) / 10 : true });
    });
    return l;
  }
  function captureMan(s) { if (!$("adInt")) return null; var v = formVals(s, propose(s, AD.reason, AD.opt, AD.pain), false); return { km: v.km, minutes: v.minutes, dplus: v.dplus, time: v.time, intensity: v.intensity }; }
  function updatePreview() {
    if (!AD || !AD.opt) return; var s = rawSession(AD.id); if (!s) return;
    var w = $("adWarn"); if (w) w.innerHTML = ""; /* toute modification invalide l'avertissement affiché */
    var v = formVals(s, propose(s, AD.reason, AD.opt, AD.pain), false);
    var set = function (k, t) { var el = $("adP-" + k); if (el) el.innerHTML = "<b>" + esc(t || "—") + "</b>"; };
    set("time", v.time ? ftime(v.time) : ""); set("km", v.km ? fkm(v.km) + " km" : (s.km ? "0 km" : "")); set("min", v.minutes ? fmin(v.minutes) : (s.minutes ? "0 min" : "")); set("dp", v.dplus ? "+" + fint(v.dplus) + " m" : (s.dplus ? "0 m" : "")); set("int", v.intensity || "");
  }
  function showWarn(incs) {
    var w = $("adWarn"); if (!w) return;
    w.innerHTML = '<div class="warn" role="alert"><b>Augmentation importante</b><ul>' + incs.map(function (x) {
      return "<li>" + esc(x.label) + " : " + esc(x.from ? fnum(x.from) + " → " + fnum(x.to) + " " + x.unit + " (+" + x.pct + " %)" : "ajout de " + fnum(x.to) + " " + x.unit) + "</li>";
    }).join("") + "</ul><p>Une hausse brutale de distance, de durée, de dénivelé ou d'intensité augmente le risque de surcharge et de blessure (tendinites, périostite, fracture de fatigue). <b>Cette augmentation n'est pas recommandée par l'application.</b> Tu peux demander un avis à Claude avant de l'enregistrer.</p>" +
      '<div class="row"><button class="btn" data-ask="' + esc(AD.id) + '">Demander à Claude</button><button class="btn btn-danger" data-aconfirm="1">Je confirme : enregistrer quand même</button></div></div>';
    w.scrollIntoView({ block: "nearest" });
  }
  function fnum(x) { return String(Math.round(x * 10) / 10).replace(".", ","); }
  function showInCalendar(date) {
    state.prefs.weekStart = monday(date); state.prefs.month = date.slice(0, 7);
    if ((state.prefs.view || "home") === "home" && date !== todayISO()) state.prefs.view = "week";
  }
  function applyAdaptForm(force) {
    if (!AD || !AD.opt) return; var s = rawSession(AD.id); if (!s) return;
    var r = propose(s, AD.reason, AD.opt, AD.pain), v = formVals(s, r, true);
    if (v.err) { toast(v.err); return; }
    if (AD.pain && v.incs.length) { toast("Douleur signalée : pas d'augmentation de " + v.incs.map(function (x) { return x.label.toLowerCase(); }).join(", ") + "."); return; }
    var big = v.incs.filter(function (x) { return x.big; });
    if (big.length && force !== true) { showWarn(big); return; }
    var after = { type: r.type, km: v.km, minutes: v.minutes, dplus: v.dplus, time: v.time, intensity: v.intensity };
    if (sameSnap(snap(s), snap(after))) { toast("Aucun changement par rapport à la séance prévue."); return; }
    var rs = reasonOf(AD.reason), st = adaptStore(true), label = rs.label.toLowerCase() + (AD.pain ? " + douleur" : ""), now = new Date().toISOString(), forced = big.length > 0;
    st[s.id] = { at: now, reason: AD.reason, label: label, note: r.note + (forced ? " Augmentation importante confirmée manuellement (non recommandée)." : ""), pain: !!AD.pain, big: forced, before: snap(s), after: after };
    logAdapt({ at: now, sessionId: s.id, date: s.date, type: s.type, label: label, action: "adaptée", big: forced, before: snap(s), after: after });
    showInCalendar(s.date); save(); closeSheet(); render(); toast(forced ? "Séance modifiée (augmentation confirmée). Retour possible à l'original." : "Séance adaptée. Tu peux revenir à l'original à tout moment.");
  }
  function revertAdapt(id) {
    var st = adaptStore(false), a = st && st[id]; if (!a) return;
    var raw = rawSession(id);
    logAdapt({ at: new Date().toISOString(), sessionId: id, date: raw ? raw.date : "", type: raw ? raw.type : id, label: a.label || "", action: "annulée", before: a.after || {}, after: a.before || {} });
    delete st[id]; save(); var open = $("sheet").classList.contains("open"); render(); if (open && findSession(id)) openSheet(id); toast("Séance d'origine rétablie.");
  }
  function adaptList() {
    var st = adaptStore(false); if (!st) return "";
    var li = Object.keys(st).filter(function (id) { return validA(st[id]); }).map(function (id) { var raw = rawSession(id); return raw ? { id: id, raw: raw, a: st[id] } : null; }).filter(Boolean)
      .sort(function (x, y) { return x.raw.date < y.raw.date ? -1 : 1; });
    if (!li.length) return "";
    return '<section class="card"><h2>Séances adaptées</h2><p class="small muted">Adaptations actives, enregistrées sur ce téléphone. Les versions importées ne sont jamais modifiées.</p><ul class="diff">' + li.map(function (x) {
      var on = sameSnap(x.a.before, snap(x.raw));
      return "<li><b>" + esc(fdate(x.raw.date)) + " · " + esc(x.raw.type) + '</b> <span class="pill p-modified">' + esc(x.a.label) + "</span>" + (x.a.big ? ' <span class="pill p-removed">hausse confirmée</span>' : "") + (on ? "" : ' <span class="pill p-removed">non appliquée</span>') +
        '<br><span class="small muted">' + (on ? "Prévu : " + esc(descr(x.a.before)) + "<br>Adapté : " + esc(descr(x.a.after)) : "La séance a changé dans la version importée : l'adaptation est ignorée.") + '</span><br><button class="linkbtn" data-arevert="' + esc(x.id) + '">' + (on ? "Revenir à l'original" : "Supprimer") + "</button></li>";
    }).join("") + "</ul></section>";
  }
  function adaptHistory() {
    var l = adaptLogOf(false).filter(function (e) { return isObj(e); }); if (!l.length) return "";
    return '<section class="card"><h2>Historique des adaptations</h2><p class="small muted">Séparé de l\'historique des versions : les programmes importés restent intacts.</p><ul class="diff small">' + l.slice(0, 30).map(function (e) {
      return "<li>" + esc(new Date(e.at).toLocaleString("fr-FR")) + " · <b>" + esc(e.action) + "</b> · " + esc(e.date ? fdate(e.date) : "") + " · " + esc(e.type) + ' <span class="pill p-modified">' + esc(e.label) + "</span>" + (e.big ? ' <span class="pill p-removed">hausse confirmée</span>' : "") + "<br>" + esc(descr(e.before || {})) + " → <b>" + esc(descr(e.after || {})) + "</b></li>";
    }).join("") + "</ul></section>";
  }

  /* ---------- Demander à Claude : texte à copier, rien n'est envoyé ---------- */
  function openAsk(id) {
    var s = rawSession(id) || findSession(id); if (!s) return;
    if (!AD || AD.id !== id) AD = { id: id, reason: null, opt: null, pain: false, ctx: "", from: "sheet" };
    if (AD.opt && AD.view !== "ask") { var m0 = captureMan(rawSession(id) || s); if (m0) AD.man = m0; }
    AD.view = "ask"; renderAsk(); $("sheet").classList.add("open"); $("sheetBg").classList.add("open");
  }
  function askText(s) {
    var p = plan(), rs = reasonOf(AD.reason), cur = s;
    var l = ["Utilise la skill coach-trail.", "",
      "Je veux adapter une séance de mon programme « " + p.race.name + " » (version " + p.currentVersion + ").", "",
      "Séance : " + fdate(s.date) + " · " + descr(cur) + (s.goal ? " · objectif : " + s.goal : ""),
      "Raison : " + (rs ? rs.label + (AD.opt ? " (" + optLabel(rs, AD.opt) + ")" : "") : "à préciser"),
      "Douleur : " + (AD.pain ? "oui, je ressens une douleur" : "non signalée")];
    if (AD.man) {
      var mv = { type: s.type, time: AD.man.time, km: AD.man.km, minutes: AD.man.minutes, dplus: AD.man.dplus, intensity: AD.man.intensity }, bg = incsOf(s, mv).filter(function (x) { return x.big; });
      if (!sameSnap(snap(s), snap(mv))) l.push("Modification que j'envisage : " + descr(mv) + (bg.length ? " (augmentation importante : dis-moi si c'est raisonnable et comment progresser)" : ""));
    }
    if (AD.ctx) l.push("Précisions : " + AD.ctx);
    l.push("", "Demande :", "- Analyse mes dernières activités Strava et mon état de forme.",
      "- Propose une adaptation prudente de cette séance" + (AD.pain ? " (douleur signalée : ne propose ni plus long ni plus intense ; recommande un avis médical si elle persiste)" : "") + ", et ajuste les séances suivantes de la semaine si nécessaire.",
      "- Exporte un nouveau fichier JSON coach-trail-plan (nouvelle version) que j'importerai dans l'application.");
    return l.join("\n");
  }
  function renderAsk() {
    var s = rawSession(AD.id) || findSession(AD.id); if (!s) return;
    $("shBody").innerHTML = '<span class="pill p-check">Demander à Claude</span><h3 id="shTitle">' + esc(s.type) + '</h3><div class="muted">' + esc(fdate(s.date)) + "</div>" +
      '<p class="small muted" style="margin-top:12px">Copie ce texte puis colle-le toi-même dans Claude (skill <b>coach-trail</b>). <b>Rien n\'est envoyé automatiquement</b> : l\'application n\'est connectée ni à Strava ni à une IA. Relis le texte avant de le coller.</p>' +
      '<label class="small muted" for="adCtx">Précisions (facultatif)</label><input id="adCtx" class="field" type="text" maxlength="200" value="' + esc(AD.ctx) + '" placeholder="Ex. voyage jeudi, genou sensible…" style="width:100%;margin:4px 0 10px">' +
      '<textarea id="adPrompt" class="field" rows="10" readonly style="width:100%;font-size:14px">' + esc(askText(s)) + '</textarea>' +
      '<div class="row" style="margin-top:12px"><button class="btn btn-o" data-acopy="1">Copier le texte</button><button class="btn" data-aaskback="1">Retour</button></div>';
  }
  function copyAsk() {
    var ta = $("adPrompt"); if (!ta) return;
    var ok = function () { toast("Texte copié. Colle-le dans Claude."); }, fail = function () { ta.focus(); ta.select(); toast("Sélectionne et copie le texte manuellement."); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(ok, function () { try { ta.select(); document.execCommand("copy") ? ok() : fail(); } catch (e) { fail(); } });
    else { try { ta.focus(); ta.select(); document.execCommand("copy") ? ok() : fail(); } catch (e) { fail(); } }
  }

/* ---------- Actions ---------- */
  function download(name, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    try { var f = new File([blob], name, { type: "application/json" }); if (navigator.canShare && navigator.canShare({ files: [f] })) { navigator.share({ files: [f], title: name }).catch(function () {}); return; } } catch (e) {}
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function handleFile(file) {
    var r = new FileReader();
    r.onload = function () {
      var o; try { o = JSON.parse(r.result); } catch (e) { toast("Fichier JSON illisible."); return; }
      var res = o && o.schema === "coach-trail-backup" ? importBackup(o) : importPlan(o);
      if (!res.ok) { alert(res.errors.join("\n")); return; }
      if (res.backup) { toast("Sauvegarde restaurée."); render(); return; }
      state.prefs.view = "home"; render();
      var d = res.diff, msg = (res.isNew ? "Programme importé" : "Programme mis à jour") + " · version " + res.cur;
      openReport(res, msg, d);
    };
    r.readAsText(file);
  }
  function openReport(res, msg, d) {
    $("shBody").innerHTML = '<span class="pill p-check">Import réussi</span><h3 id="shTitle">' + esc(msg) + "</h3>" +
      '<dl class="kv"><dt>Nouvelles versions</dt><dd>' + esc(res.addedV.join(", ") || "aucune") + "</dd><dt>Cases conservées</dt><dd>" + res.kept + "</dd>" + (res.orphan.length ? "<dt>Cochées retirées</dt><dd>" + res.orphan.length + "</dd>" : "") + "</dl>" +
      (res.warnings.length ? '<div class="was">' + res.warnings.map(esc).join("<br>") + "</div>" : "") +
      (d ? "<h3 style=\"font-size:16px;margin-top:14px\">Modifications</h3>" + diffHTML(d) : "");
    $("sheet").classList.add("open"); $("sheetBg").classList.add("open");
  }
  document.addEventListener("click", function (e) {
    var t = e.target, el;
    if ((el = t.closest(".tabbar button"))) { setView(el.dataset.v); return; }
    if ((el = t.closest("[data-go]"))) { setView(el.dataset.go); return; }
    if ((el = t.closest("[data-adapt]"))) { openAdapt(el.dataset.adapt); return; }
    if ((el = t.closest("[data-ar]"))) { if (AD) { AD.reason = el.dataset.ar; AD.opt = null; AD.man = null; renderAdapt(); } return; }
    if ((el = t.closest("[data-ao]"))) { if (AD) { AD.opt = el.dataset.ao; AD.man = null; renderAdapt(); } return; }
    if ((el = t.closest("[data-aapply]"))) { applyAdaptForm(false); return; }
    if ((el = t.closest("[data-aconfirm]"))) { applyAdaptForm(true); return; }
    if ((el = t.closest("[data-aback]"))) { AD = null; openSheet(el.dataset.aback); return; }
    if ((el = t.closest("[data-ask]"))) { openAsk(el.dataset.ask); return; }
    if ((el = t.closest("[data-acopy]"))) { copyAsk(); return; }
    if ((el = t.closest("[data-aaskback]"))) { var bid = AD && AD.id; if (AD && AD.from === "menu") { AD.view = null; renderAdapt(); } else { AD = null; if (bid) openSheet(bid); } return; }
    if ((el = t.closest("[data-arevert]"))) { revertAdapt(el.dataset.arevert); return; }
    if ((el = t.closest("[data-open]"))) { openSheet(el.dataset.open); return; }
    if ((el = t.closest("[data-week]"))) { var ws = weeksOf(sessions()), i = +el.dataset.week; if (ws[i]) { state.prefs.weekStart = ws[i].start; save(); render(); } return; }
    if ((el = t.closest("[data-month]"))) { var ms = []; sessions().forEach(function (s) { var k = s.date.slice(0, 7); if (ms.indexOf(k) < 0) ms.push(k); }); ms.sort(); if (ms[+el.dataset.month]) { state.prefs.month = ms[+el.dataset.month]; save(); render(); } return; }
    if ((el = t.closest("[data-showver]"))) { state.prefs.viewVersion = el.dataset.showver; state.prefs.view = "week"; save(); render(); return; }
    if ((el = t.closest("[data-act]"))) {
      var a = el.dataset.act;
      if (a === "import") $("fileIn").click();
      else if (a === "backup") download("coach-trail-sauvegarde-" + iso(new Date()) + ".json", { schema: "coach-trail-backup", schemaVersion: 1, exportedAt: new Date().toISOString(), state: state });
      else if (a === "wipe") { if (confirm("Effacer tous les programmes et toutes les cases cochées de ce téléphone ? Cette action est définitive.")) { state = blank(); save(); render(); toast("Données effacées."); } }
      else if (a === "checkupdate") checkUpdate(true);
      else if (a === "savename") { var nv = cleanName($("nameIn").value); if (nv) state.prefs.firstName = nv; else delete state.prefs.firstName; save(); render(); toast(nv ? "Prénom enregistré : " + nv : "Prénom effacé."); }
      return;
    }
    if (t.id === "shClose" || t.id === "sheetBg") closeSheet();
  });
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.id === "fileIn") { if (t.files[0]) handleFile(t.files[0]); t.value = ""; return; }
    if (t.id === "adPain" && AD) { var s0 = rawSession(AD.id); AD.man = s0 && AD.opt ? captureMan(s0) : null; AD.pain = t.checked; renderAdapt(); return; }
    if (t.id === "verSel") { state.prefs.viewVersion = t.value; save(); render(); return; }
    if (t.dataset && t.dataset.check) { setChecked(t.dataset.check, t.checked); var open = $("sheet").classList.contains("open"); render(); if (open) openSheet(t.dataset.check); }
  });
  document.addEventListener("input", function (e) {
    var t = e.target;
    if (t.id === "adCtx" && AD) { AD.ctx = t.value.replace(/[\u0000-\u001f<>]/g, ""); var s = rawSession(AD.id) || findSession(AD.id); if (s && $("adPrompt")) $("adPrompt").value = askText(s); }
    else if (t.id === "adKm" || t.id === "adMin" || t.id === "adDp" || t.id === "adInt" || t.id === "adTime") updatePreview();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); if (e.key === "Enter" && e.target.id === "nameIn") { e.preventDefault(); var b = document.querySelector('[data-act="savename"]'); if (b) b.click(); } });

  /* ---------- Réseau ---------- */
  function net() { $("net").hidden = navigator.onLine; }
  window.addEventListener("online", net); window.addEventListener("offline", net); net();

  /* ---------- Service worker et mises à jour ---------- */
  var reg = null, reloading = false;
  function showUpdate(w) { $("updateBar").hidden = false; $("updateBtn").onclick = function () { w.postMessage({ type: "SKIP_WAITING" }); }; }
  function swStatus(txt) { var el = $("swState"); if (el) el.textContent = txt; }
  function checkUpdate(manual) {
    if (!reg) { if (manual) toast("Service worker indisponible ici (HTTPS requis)."); return; }
    reg.update().then(function () { if (manual && !reg.waiting && !reg.installing) toast("L'application est à jour."); }).catch(function () { if (manual) toast("Vérification impossible hors ligne."); });
  }
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(function (r) {
      reg = r; swStatus("service worker actif, hors ligne disponible");
      if (r.waiting && navigator.serviceWorker.controller) showUpdate(r.waiting);
      r.addEventListener("updatefound", function () {
        var w = r.installing; if (!w) return;
        w.addEventListener("statechange", function () { if (w.state === "installed" && navigator.serviceWorker.controller) showUpdate(w); });
      });
    }).catch(function () { swStatus("service worker non enregistré"); });
    navigator.serviceWorker.addEventListener("controllerchange", function () { if (reloading) return; reloading = true; location.reload(); });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") checkUpdate(false); });
  }

  render(); setInterval(tick, 1000);
  window.__coachTrail = { importPlan: importPlan, state: function () { return state; }, version: APP_VERSION };
})();
