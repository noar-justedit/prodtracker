// prodtracker - working-time tracker for post-production
// Copyright (C) 2026 Just Edit
// Licensed under the GNU General Public License v3 or later. See LICENSE.

const { app, BrowserWindow, ipcMain, shell, powerMonitor } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");

const DATA_FILE = path.join(app.getPath("userData"), "prodtracker-data.json");

/* ---------------- Update check (version.json, INGESTO-style) ---------------- */
// Same mechanism as the other Just Edit apps (INGESTO, etc.): a small JSON file
// hosted on the repo, keyed per app. Never blocks startup; fails silently on any
// network issue. If you fork, point GITHUB_REPO at your own repo, or leave it
// empty to disable update checks.
const GITHUB_REPO = "noar-justedit/prodtracker";
const UPDATE_BRANCH = "main";
const UPDATE_URL = GITHUB_REPO
  ? `https://raw.githubusercontent.com/${GITHUB_REPO}/${UPDATE_BRANCH}/version.json`
  : "";

function semverGt(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}
function fetchFollow(url, hops, cb) {
  if (hops > 3) return cb(null);
  let done = false;
  const once = (v) => { if (!done) { done = true; cb(v); } };
  try {
    const opts = { timeout: 4000, headers: { "User-Agent": "prodtracker" } };
    const req = https.get(url, opts, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        let next;
        try { next = new URL(res.headers.location, url).toString(); } catch (e) { return once(null); }
        done = true;
        return fetchFollow(next, hops + 1, cb);
      }
      if (res.statusCode !== 200) { res.resume(); return once(null); }
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => once(body));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => once(null));
  } catch (e) { once(null); }
}
function checkForUpdate() {
  if (!UPDATE_URL) return;
  fetchFollow(UPDATE_URL, 0, (body) => {
    if (!body) return;
    let data; try { data = JSON.parse(body); } catch (e) { return; }
    const info = data && data.prodtracker;
    if (!info || !info.version) return;
    if (semverGt(info.version, app.getVersion()) && mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send("update-available", {
        version: info.version,
        url: info.url || `https://github.com/${GITHUB_REPO}/releases`
      });
    }
  });
}

/* ---------------- Persistence ---------------- */
// Until 0.3.2 the productName was "PROD TRACKER" (with a space), so Electron used a
// userData folder of the same name. From 0.3.3 it's "prodtracker". Migrate once.
function legacyDataFile() {
  try { return path.join(app.getPath("appData"), "PROD TRACKER", "prodtracker-data.json"); }
  catch (e) { return null; }
}
function loadData() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (parsed && Array.isArray(parsed.productions)) return parsed;
  } catch (e) { /* no current file */ }
  const legacy = legacyDataFile();
  if (legacy && legacy !== DATA_FILE && fs.existsSync(legacy)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(legacy, "utf8"));
      if (parsed && Array.isArray(parsed.productions)) { saveData(parsed); return parsed; }
    } catch (e) { /* legacy unreadable */ }
  }
  return { productions: [], settings: { autoPause: true, idleThreshold: 300 } };
}
function saveData(data) {
  try {
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, DATA_FILE);
    return { ok: true };
  } catch (e) {
    console.error("saveData failed:", e.message);
    return { ok: false, error: String(e.message || e) };
  }
}

/* ---------------- Idle / power monitoring ---------------- */
let mainWin = null;
let idleCfg = { enabled: true, threshold: 300 };
let wasIdle = false;
let pollTimer = null;

function send(channel, payload) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload);
}
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (!idleCfg.enabled) { wasIdle = false; return; }
    const idle = powerMonitor.getSystemIdleTime();
    if (idle >= idleCfg.threshold && !wasIdle) {
      wasIdle = true;
      send("activity-idle", { idleSeconds: idle });
    } else if (idle < idleCfg.threshold && wasIdle) {
      wasIdle = false;
      send("activity-resumed");
    }
  }, 5000);
}

/* ---------------- Window ---------------- */
function createWindow() {
  const isMac = process.platform === "darwin";
  mainWin = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0c0c0e",
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    titleBarOverlay: isMac ? false : { color: "#0c0c0e", symbolColor: "#a8a8c0", height: 52 },
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWin.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  mainWin.webContents.once("did-finish-load", () => setTimeout(checkForUpdate, 1500));
}

// The app is typically left open for days or weeks; re-check daily so update
// notices actually reach long-running instances, not only fresh launches.
const UPDATE_RECHECK_MS = 24 * 60 * 60 * 1000;
setInterval(checkForUpdate, UPDATE_RECHECK_MS);

/* ---------------- IPC ---------------- */
ipcMain.handle("load-data", () => loadData());
ipcMain.handle("save-data", (_e, data) => saveData(data));
// Synchronous save, used only from the renderer's "beforeunload" handler: when the
// window is closing there is no time left for an async round-trip, and this is what
// guarantees a running timer is closed at the real quit time instead of being left
// open (which used to keep counting until the next STOP after relaunch).
ipcMain.on("save-data-sync", (e, data) => { e.returnValue = saveData(data); });
ipcMain.handle("get-version", () => app.getVersion());
ipcMain.on("set-idle-config", (_e, cfg) => {
  idleCfg = { enabled: !!cfg.enabled, threshold: Math.max(60, cfg.threshold | 0 || 300) };
  wasIdle = false;
});
ipcMain.handle("open-external", (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

/* ---------------- Lifecycle ---------------- */
app.whenReady().then(() => {
  createWindow();
  startPolling();
  powerMonitor.on("suspend", () => { wasIdle = true; send("system-suspend"); });
  powerMonitor.on("lock-screen", () => { wasIdle = true; send("system-suspend"); });
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
