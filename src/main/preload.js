// prodtracker - working-time tracker for post-production
// Copyright (C) 2026 Just Edit
// Licensed under the GNU General Public License v3 or later. See LICENSE.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke("get-version"),
  load: () => ipcRenderer.invoke("load-data"),
  save: (data) => ipcRenderer.invoke("save-data", data),
  saveSync: (data) => ipcRenderer.sendSync("save-data-sync", data),
  setIdleConfig: (cfg) => ipcRenderer.send("set-idle-config", cfg),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  onIdle: (cb) => ipcRenderer.on("activity-idle", (_e, p) => cb(p)),
  onResumed: (cb) => ipcRenderer.on("activity-resumed", () => cb()),
  onSuspend: (cb) => ipcRenderer.on("system-suspend", () => cb()),
  onUpdateAvailable: (cb) => ipcRenderer.on("update-available", (_e, d) => cb(d))
});
