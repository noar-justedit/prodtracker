// prodtracker - working-time tracker for post-production
// Copyright (C) 2026 Just Edit
// Licensed under the GNU General Public License v3 or later. See LICENSE.

"use strict";

const APP_VERSION = "0.4.4";
const IDLE_DEFAULT = 300;
const IDLE_OPTIONS = [60, 120, 300, 600, 900, 1800]; // 1/2/5/10/15/30 min
const WORKDAY_DEFAULT = 28800; // 8h
const WORKDAY_MIN = 3600, WORKDAY_MAX = 86400;

let state = { productions: [], settings: { autoPause: true, idleThreshold: IDLE_DEFAULT } };
let selectedId = null;
let autoPausedId = null;
let autoPausedAt = null;
let saveTimer = null;

const $ = (id) => document.getElementById(id);

/* ---------------- Persistence ---------------- */
async function boot() {
  state = await window.api.load();
  if (!state || !Array.isArray(state.productions)) state = { productions: [] };
  if (!state.settings) state.settings = {};
  if (typeof state.settings.autoPause !== "boolean") state.settings.autoPause = true;
  if (!IDLE_OPTIONS.includes(state.settings.idleThreshold)) state.settings.idleThreshold = IDLE_DEFAULT;
  if (!(state.settings.workDaySeconds >= WORKDAY_MIN && state.settings.workDaySeconds <= WORKDAY_MAX)) state.settings.workDaySeconds = WORKDAY_DEFAULT;

  const active = state.productions.find((p) => p.status === "active");
  selectedId = active ? active.id : (state.productions[0] ? state.productions[0].id : null);

  renderAutoPause();
  renderWorkday();
  pushIdleConfig();
  renderSidebar();
  renderMain();
  tick();
  setInterval(tick, 1000);

  window.api.onIdle((d) => handleIdle(d.idleSeconds));
  window.api.onResumed(() => handleResumed());
  window.api.onSuspend(() => handleSuspend());
  window.api.onUpdateAvailable((d) => showUpdateNotice(d));
}
function saveNow() { clearTimeout(saveTimer); window.api.save(JSON.parse(JSON.stringify(state))); }
function pushIdleConfig() {
  window.api.setIdleConfig({ enabled: !!state.settings.autoPause, threshold: state.settings.idleThreshold || IDLE_DEFAULT });
}

/* ---------------- Time helpers ---------------- */
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }
function startOfWeek(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.getTime(); }
function startOfMonth(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(1); return x.getTime(); }
function overlapSec(s, e, rs, re) { const a = Math.max(s, rs), b = Math.min(e, re); return b > a ? (b - a) / 1000 : 0; }
function prodSessions(p, now) { const l = (p.sessions || []).map((x) => [x.s, x.e]); if (p.running) l.push([p.running, now]); return l; }
function computeStats(p, now) {
  let total = 0, today = 0, week = 0, month = 0;
  const sod = startOfDay(now), sow = startOfWeek(now), som = startOfMonth(now);
  for (const [s, e] of prodSessions(p, now)) {
    total += (e - s) / 1000;
    today += overlapSec(s, e, sod, now);
    week += overlapSec(s, e, sow, now);
    month += overlapSec(s, e, som, now);
  }
  return { total, today, week, month, sessions: (p.sessions || []).length + (p.running ? 1 : 0), currentSession: p.running ? (now - p.running) / 1000 : 0 };
}
function pad(n) { return String(Math.floor(n)).padStart(2, "0"); }
function workDay() { return (state.settings && state.settings.workDaySeconds) || WORKDAY_DEFAULT; }
function dhm(sec) { sec = Math.max(0, Math.floor(sec)); const wd = workDay(); const d = Math.floor(sec / wd); const rem = sec - d * wd; return { d, h: Math.floor(rem / 3600), m: Math.floor((rem % 3600) / 60) }; }
function hmRaw(sec) { sec = Math.max(0, Math.floor(sec)); return `${Math.floor(sec / 3600)}h ${pad((sec % 3600) / 60)}m`; }
function compact(sec) { const { d, h, m } = dhm(sec); if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m`; if (h > 0) return `${h}h ${pad(m)}m`; return `${m}m`; }
function hms(sec) { sec = Math.max(0, Math.floor(sec)); return `${pad(sec / 3600)}:${pad((sec % 3600) / 60)}:${pad(sec % 60)}`; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }

/* ---------------- Actions ---------------- */
function selected() { return state.productions.find((p) => p.id === selectedId) || null; }
function stopAllRunning(now) { for (const q of state.productions) if (q.running) { q.sessions.push({ s: q.running, e: now }); q.running = null; } }

function newProd(name, client) {
  const p = { id: "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name.trim(), client: client.trim(), createdAt: Date.now(), status: "active", sessions: [], running: null };
  state.productions.unshift(p);
  selectedId = p.id;
  saveNow(); renderSidebar(); renderMain(); tick();
}
function toggleRun(p) {
  const now = Date.now();
  autoPausedId = null; autoPausedAt = null;
  if (p.running) { p.sessions.push({ s: p.running, e: now }); p.running = null; }
  else { stopAllRunning(now); p.running = now; }
  saveNow(); renderSidebar(); renderMain(); tick();
}
function terminate(p) {
  const now = Date.now();
  if (p.running) { p.sessions.push({ s: p.running, e: now }); p.running = null; }
  if (autoPausedId === p.id) { autoPausedId = null; autoPausedAt = null; }
  p.status = "done"; p.doneAt = now;
  saveNow(); renderSidebar(); renderMain(); openStats(p, true);
}
function deleteProd(id) {
  if (autoPausedId === id) { autoPausedId = null; autoPausedAt = null; }
  state.productions = state.productions.filter((p) => p.id !== id);
  if (selectedId === id) {
    const a = state.productions.find((p) => p.status === "active");
    selectedId = a ? a.id : (state.productions[0] ? state.productions[0].id : null);
  }
  saveNow(); renderSidebar(); renderMain(); tick();
}

/* ---------------- Idle / suspend ---------------- */
function handleIdle(idleSeconds) {
  const p = state.productions.find((x) => x.running);
  if (!p) return;
  let end = Date.now() - idleSeconds * 1000;
  if (end < p.running) end = p.running;
  p.sessions.push({ s: p.running, e: end });
  p.running = null; autoPausedId = p.id; autoPausedAt = end;
  saveNow(); renderSidebar(); renderMain(); tick();
}
function handleSuspend() {
  const p = state.productions.find((x) => x.running);
  if (!p) return;
  const t = Date.now();
  p.sessions.push({ s: p.running, e: t });
  p.running = null; autoPausedId = p.id; autoPausedAt = t;
  saveNow(); renderSidebar(); renderMain(); tick();
}
function handleResumed() {
  if (!autoPausedId) return;
  const p = state.productions.find((x) => x.id === autoPausedId && x.status === "active");
  autoPausedId = null; autoPausedAt = null;
  if (!p) return;
  const now = Date.now();
  stopAllRunning(now); p.running = now;
  saveNow(); renderSidebar(); renderMain(); tick();
}

/* ---------------- Auto-pause popover ---------------- */
function renderAutoPause() {
  const on = !!state.settings.autoPause;
  const min = (state.settings.idleThreshold || IDLE_DEFAULT) / 60;
  $("apLabel").textContent = on ? `AUTO-PAUSE ${min} MIN` : "AUTO-PAUSE OFF";
  $("autoToggle").classList.toggle("on", on);
  $("apSwitch").classList.toggle("on", on);
  $("apSeg").classList.toggle("disabled", !on);
  for (const b of $("apSeg").querySelectorAll("button")) {
    b.classList.toggle("on", parseInt(b.dataset.min, 10) * 60 === state.settings.idleThreshold);
  }
}
$("autoToggle").addEventListener("click", (e) => { e.stopPropagation(); $("wdPop").classList.remove("open"); $("apPop").classList.toggle("open"); });
$("apPop").addEventListener("click", (e) => e.stopPropagation());
$("apSwitch").addEventListener("click", () => {
  state.settings.autoPause = !state.settings.autoPause;
  if (!state.settings.autoPause) { autoPausedId = null; autoPausedAt = null; }
  renderAutoPause(); pushIdleConfig(); saveNow(); renderSidebar(); renderMain();
});
$("apSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  state.settings.idleThreshold = parseInt(b.dataset.min, 10) * 60;
  renderAutoPause(); pushIdleConfig(); saveNow();
});

/* ---------------- Work-day popover ---------------- */
function fmtWorkdayLabel(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return m ? `${h}H${pad(m)}` : `${h}H`;
}
function parseWorkday(str) {
  if (!str) return null;
  let s = String(str).trim().toLowerCase().replace(/\s/g, "").replace("h", ":").replace(",", ".");
  let sec;
  if (s.includes(":")) {
    const [hp, mp] = s.split(":");
    const H = parseInt(hp || "0", 10), M = parseInt(mp || "0", 10);
    if (isNaN(H)) return null;
    sec = H * 3600 + (isNaN(M) ? 0 : M) * 60;
  } else {
    const f = parseFloat(s);
    if (isNaN(f)) return null;
    sec = Math.round(f * 3600);
  }
  if (sec < WORKDAY_MIN || sec > WORKDAY_MAX) return null;
  return sec;
}
function renderWorkday() {
  const sec = workDay();
  $("wdLabel").textContent = "WORKDAY " + fmtWorkdayLabel(sec);
  const isPreset = sec === 8 * 3600 || sec === 10 * 3600;
  for (const b of $("wdSeg").querySelectorAll("button")) {
    const on = b.dataset.h === "custom" ? !isPreset : parseInt(b.dataset.h, 10) * 3600 === sec;
    b.classList.toggle("on", on);
  }
  const custom = !isPreset;
  $("wdCustomWrap").classList.toggle("show", custom);
  if (custom) $("wdCustom").value = fmtWorkdayLabel(sec).replace("H", ":").replace(/:$/, "");
}
function setWorkday(sec) {
  state.settings.workDaySeconds = sec;
  renderWorkday(); saveNow(); renderSidebar(); renderMain(); tick();
}
$("wdToggle").addEventListener("click", (e) => { e.stopPropagation(); $("apPop").classList.remove("open"); $("wdPop").classList.toggle("open"); });
$("wdPop").addEventListener("click", (e) => e.stopPropagation());
$("wdSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.h === "custom") {
    $("wdCustomWrap").classList.add("show");
    for (const x of $("wdSeg").querySelectorAll("button")) x.classList.toggle("on", x === b);
    setTimeout(() => $("wdCustom").focus(), 20);
  } else {
    setWorkday(parseInt(b.dataset.h, 10) * 3600);
  }
});
function applyCustomWorkday() {
  const sec = parseWorkday($("wdCustom").value);
  if (sec == null) { $("wdCustom").classList.add("bad"); return; }
  $("wdCustom").classList.remove("bad");
  setWorkday(sec);
}
$("wdApply").addEventListener("click", applyCustomWorkday);
$("wdCustom").addEventListener("keydown", (e) => { if (e.key === "Enter") applyCustomWorkday(); });

/* ---------------- Context menu ---------------- */
function openCtxMenu(p, x, y) {
  const m = $("ctxMenu");
  let html = "";
  if (p.status === "active") {
    html += `<div class="ctx-item" data-act="terminate">Finish</div>`;
    html += `<div class="ctx-sep"></div>`;
  }
  html += `<div class="ctx-item danger" data-act="delete">Delete</div>`;
  m.innerHTML = html;
  m.style.left = Math.min(x, window.innerWidth - 180) + "px";
  m.style.top = Math.min(y, window.innerHeight - 100) + "px";
  m.classList.add("open");
  m.querySelectorAll(".ctx-item").forEach((it) => {
    it.addEventListener("click", () => {
      closeCtxMenu();
      if (it.dataset.act === "terminate") openDone(p);
      else if (it.dataset.act === "delete") openDelete(p);
    });
  });
}
function closeCtxMenu() { $("ctxMenu").classList.remove("open"); }
document.addEventListener("click", closeCtxMenu);
document.addEventListener("scroll", closeCtxMenu, true);
window.addEventListener("blur", closeCtxMenu);

/* ---------------- Sidebar ---------------- */
function renderSidebar() {
  const list = $("prodList");
  list.innerHTML = "";
  const now = Date.now();
  const actives = state.productions.filter((p) => p.status === "active");
  const dones = state.productions.filter((p) => p.status === "done");

  const addItem = (p) => {
    const st = computeStats(p, now);
    const el = document.createElement("div");
    el.className = "prod-item" + (p.id === selectedId ? " active" : "") + (p.status === "done" ? " done" : "") + (p.running ? " running" : "");
    el.dataset.id = p.id;

    const row = document.createElement("div");
    row.className = "prod-row";
    const name = document.createElement("div");
    name.className = "prod-name"; name.textContent = p.name;
    row.appendChild(name);
    if (p.running) { const s = document.createElement("span"); s.className = "live-pill"; row.appendChild(s); }
    else if (autoPausedId === p.id) { const s = document.createElement("span"); s.className = "pause-pill"; row.appendChild(s); }
    else if (p.status === "done") { const t = document.createElement("span"); t.className = "done-tag"; t.textContent = "Done"; row.appendChild(t); }
    el.appendChild(row);

    const client = document.createElement("div");
    client.className = "prod-client"; client.textContent = p.client || "\u2014";
    el.appendChild(client);

    const time = document.createElement("div");
    time.className = "prod-time"; time.dataset.time = p.id; time.textContent = compact(st.total);
    el.appendChild(time);

    el.addEventListener("click", () => { selectedId = p.id; renderSidebar(); renderMain(); tick(); });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      selectedId = p.id; renderSidebar(); renderMain(); tick();
      openCtxMenu(p, e.clientX, e.clientY);
    });
    list.appendChild(el);
  };

  actives.forEach(addItem);
  if (dones.length) {
    const div = document.createElement("div");
    div.className = "list-divider"; div.textContent = "Finished";
    list.appendChild(div);
    dones.forEach(addItem);
  }
}

/* ---------------- Main ---------------- */
function renderMain() {
  const c = $("content");
  const p = selected();
  if (!p) {
    c.innerHTML = '<div class="empty"><div class="empty-title">No production yet</div><div class="empty-sub">Add your first production with the + button on the left.</div><button class="btn btn-green" id="emptyNew">New production</button></div>';
    $("emptyNew").addEventListener("click", openNew);
    return;
  }
  const done = p.status === "done";
  c.innerHTML = `
    <div class="prod-header">
      <div>
        <h1>${escapeHtml(p.name)}</h1>
        <div class="client">${escapeHtml(p.client || "\u2014")}</div>
      </div>
      <div class="t-spacer"></div>
      <div class="header-btns">
        <button class="btn btn-pro" id="btnStats">Detailed stats</button>
        ${done ? "" : '<button class="btn" id="btnTerminate">Finish</button>'}
        <button class="btn btn-del" id="btnDelete">Delete</button>
      </div>
    </div>
    <div class="chrono-wrap">
      <div class="chrono-label">Total time${done ? " \u2014 production finished" : ""} \u00b7 ${fmtWorkdayLabel(workDay()).toLowerCase()}/day</div>
      <div class="chrono ${p.running ? "" : "idle"}" id="chrono">
        <div class="seg"><div class="seg-num" data-seg="d">00</div><div class="seg-unit">Days</div></div>
        <div class="chrono-sep">:</div>
        <div class="seg"><div class="seg-num" data-seg="h">00</div><div class="seg-unit">Hours</div></div>
        <div class="chrono-sep">:</div>
        <div class="seg"><div class="seg-num" data-seg="m">00</div><div class="seg-unit">Min</div></div>
      </div>
      <div class="chrono-sub" id="chronoSub"></div>
      <div class="session-line" id="sessionLine"></div>
    </div>
    <button class="control ${done ? "disabled" : p.running ? "stop" : (autoPausedId === p.id ? "idle" : "start")}" id="btnControl">
      ${done ? "Production finished" : p.running ? "Running (press to stop)" : (autoPausedId === p.id ? "IDLE <span class='idle-dur' id='idleDur'>00:00:00</span>" : "\u25B6 Start")}
    </button>
    <div class="tiles">
      <div class="tile"><div class="tile-label">Today</div><div class="tile-value" data-tile="today">\u2014</div></div>
      <div class="tile"><div class="tile-label">This week</div><div class="tile-value" data-tile="week">\u2014</div></div>
      <div class="tile"><div class="tile-label">This month</div><div class="tile-value" data-tile="month">\u2014</div></div>
    </div>`;
  $("btnStats").addEventListener("click", () => openStats(p, false));
  $("btnDelete").addEventListener("click", () => openDelete(p));
  if (!done) {
    $("btnControl").addEventListener("click", () => toggleRun(p));
    $("btnTerminate").addEventListener("click", () => openDone(p));
  }
}

/* ---------------- Tick ---------------- */
function tick() {
  const now = Date.now();
  const p = selected();
  const anyRunning = state.productions.some((x) => x.running);
  const isIdle = !anyRunning && autoPausedId != null;
  const appEl = document.getElementById("app");
  appEl.classList.toggle("recording", anyRunning);
  appEl.classList.toggle("idle", isIdle);
  const idleDurEl = document.getElementById("idleDur");
  if (idleDurEl && autoPausedAt) idleDurEl.textContent = hms((now - autoPausedAt) / 1000);
  if (p) {
    const st = computeStats(p, now);
    const t = dhm(st.total);
    const segd = document.querySelector('[data-seg="d"]');
    if (segd) {
      segd.textContent = pad(t.d);
      document.querySelector('[data-seg="h"]').textContent = pad(t.h);
      document.querySelector('[data-seg="m"]').textContent = pad(t.m);
    }
    const sub = document.getElementById("chronoSub");
    if (sub) sub.textContent = hmRaw(st.total);
    const tToday = document.querySelector('[data-tile="today"]');
    if (tToday) {
      tToday.textContent = compact(st.today);
      document.querySelector('[data-tile="week"]').textContent = compact(st.week);
      document.querySelector('[data-tile="month"]').textContent = compact(st.month);
    }
    const line = $("sessionLine");
    if (line) {
      if (p.running) { line.className = "session-line rec"; line.innerHTML = `<span class="live-pill"></span> Running &nbsp;<span class="mono">${hms(st.currentSession)}</span>`; }
      else if (autoPausedId === p.id) { line.className = "session-line paused"; line.innerHTML = `<span class="pause-pill"></span> Paused \u2014 inactivity detected, auto-resume when you're back`; }
      else { line.className = "session-line"; line.textContent = p.status === "done" ? "" : "Paused"; }
    }
  }
  for (const q of state.productions) {
    const el = document.querySelector(`[data-time="${q.id}"]`);
    if (el) el.textContent = compact(computeStats(q, now).total);
  }
}

/* ---------------- Modals ---------------- */
function openNew() { $("inNewName").value = ""; $("inNewClient").value = ""; $("modalNew").classList.add("open"); setTimeout(() => $("inNewName").focus(), 30); }
function closeNew() { $("modalNew").classList.remove("open"); }
$("btnNew").addEventListener("click", openNew);
$("btnCancelNew").addEventListener("click", closeNew);
$("btnCreate").addEventListener("click", () => { const name = $("inNewName").value.trim(); if (!name) { $("inNewName").focus(); return; } newProd(name, $("inNewClient").value); closeNew(); });
$("inNewName").addEventListener("keydown", (e) => { if (e.key === "Enter") $("inNewClient").focus(); });
$("inNewClient").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btnCreate").click(); });

let doneTarget = null;
function openDone(p) { doneTarget = p; $("doneMsg").textContent = `\u201c${p.name}\u201d will move to your finished productions. The timer stops and you'll get the recap. Stats stay available.`; $("modalDone").classList.add("open"); }
$("btnCancelDone").addEventListener("click", () => $("modalDone").classList.remove("open"));
$("btnConfirmDone").addEventListener("click", () => { $("modalDone").classList.remove("open"); if (doneTarget) terminate(doneTarget); });

let deleteTarget = null;
function openDelete(p) {
  deleteTarget = p;
  const total = compact(computeStats(p, Date.now()).total);
  $("delMsg").textContent = `\u201c${p.name}\u201d${p.client ? " (" + p.client + ")" : ""} will be removed from the app.`;
  $("delWarn").innerHTML = `<b>This is permanent.</b> The time tracked on this production (${total}) will be lost and cannot be recovered.`;
  $("modalDelete").classList.add("open");
}
$("btnCancelDelete").addEventListener("click", () => $("modalDelete").classList.remove("open"));
$("btnConfirmDelete").addEventListener("click", () => { $("modalDelete").classList.remove("open"); if (deleteTarget) deleteProd(deleteTarget.id); });

function openStats(p, isRecap) {
  const now = Date.now();
  const st = computeStats(p, now);
  $("statsTitle").textContent = (isRecap ? "Recap \u2014 " : "Statistics \u2014 ") + p.name;
  const days = []; let maxDay = 1;
  for (let i = 13; i >= 0; i--) {
    const dRef = new Date(now); dRef.setHours(0, 0, 0, 0); dRef.setDate(dRef.getDate() - i);
    const ds = dRef.getTime(), de = ds + 86400000;
    let sec = 0;
    for (const [s, e] of prodSessions(p, now)) sec += overlapSec(s, e, ds, de);
    days.push({ label: dayLabel(dRef, i), sec });
    if (sec > maxDay) maxDay = sec;
  }
  const activeDays = days.filter((d) => d.sec > 0).length;
  const spanDays = Math.max(1, Math.round((now - p.createdAt) / 86400000) + 1);
  const avgPerActive = activeDays ? st.total / activeDays : 0;
  let html = '<div class="stats-grid">';
  html += cell("Total", compact(st.total));
  html += cell("Today", compact(st.today));
  html += cell("This week", compact(st.week));
  html += cell("This month", compact(st.month));
  html += cell("Sessions", String(st.sessions));
  html += cell("Active days", String(activeDays));
  html += cell("Avg / active day", compact(avgPerActive));
  html += cell(p.status === "done" ? "Project length" : "Open for", spanDays + " d");
  html += "</div>";
  html += '<div class="stats-sub">Last 14 days</div>';
  for (const d of days) {
    const pct = Math.max(2, (d.sec / maxDay) * 100);
    html += `<div class="bar-row ${d.sec === 0 ? "empty" : ""}"><div class="bar-day">${d.label}</div><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><div class="bar-val">${d.sec === 0 ? "\u2014" : compact(d.sec)}</div></div>`;
  }
  $("statsBody").innerHTML = html;
  $("modalStats").classList.add("open");
}
function cell(k, v) { return `<div class="stats-cell"><div class="k">${k}</div><div class="v">${v}</div></div>`; }
function dayLabel(date, i) { if (i === 0) return "Today"; if (i === 1) return "Yesterday"; const n = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; return `${n[date.getDay()]} ${pad(date.getDate())}/${pad(date.getMonth() + 1)}`; }
$("btnCloseStats").addEventListener("click", () => $("modalStats").classList.remove("open"));

for (const ov of ["modalNew", "modalStats", "modalDone", "modalDelete"]) {
  $(ov).addEventListener("click", (e) => { if (e.target.id === ov) $(ov).classList.remove("open"); });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    ["modalNew", "modalStats", "modalDone", "modalDelete"].forEach((m) => $(m).classList.remove("open"));
    $("apPop").classList.remove("open"); $("wdPop").classList.remove("open");
    closeCtxMenu();
  }
});
document.addEventListener("click", () => { $("apPop").classList.remove("open"); $("wdPop").classList.remove("open"); });

/* ---------------- Update notice (INGESTO idiom) ---------------- */
function showUpdateNotice({ version, url }) {
  if (version === state.settings.updateDismissedVersion) return;
  if (document.getElementById("update-ov")) return;
  const ov = document.createElement("div");
  ov.id = "update-ov";
  ov.innerHTML =
    `<div class="mi-card">` +
    `<div class="mi-h">New version available</div>` +
    `<div class="mi-sub">prod tracker v${escapeHtml(version)} is available. You're on v${escapeHtml(APP_VERSION)}.</div>` +
    `<div class="pw-actions"><button class="pw-back" id="upd-later">Later</button><button class="pw-use" id="upd-go">Get it</button></div>` +
    `</div>`;
  document.body.appendChild(ov);
  const dismiss = () => { state.settings.updateDismissedVersion = version; saveNow(); ov.remove(); };
  ov.querySelector("#upd-later").onclick = dismiss;
  ov.querySelector("#upd-go").onclick = () => { window.api.openExternal(url); dismiss(); };
  ov.onclick = (e) => { if (e.target === ov) dismiss(); };
}

boot();
