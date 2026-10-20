import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { McApi } from '../shared/api'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener as never)
  return () => ipcRenderer.removeListener(channel, listener as never)
}

const api: McApi = {
  snapshot: () => ipcRenderer.invoke(IPC.snapshot),
  saveConfig: (patch) => ipcRenderer.invoke(IPC.configSave, patch),
  openPath: (path, reveal) => ipcRenderer.invoke(IPC.openPath, path, reveal),
  fsList: (path) => ipcRenderer.invoke(IPC.fsList, path),
  fsDrives: () => ipcRenderer.invoke(IPC.fsDrives),
  selectDir: (path) => ipcRenderer.invoke(IPC.selectDir, path),
  versions: (force) => ipcRenderer.invoke(IPC.versions, force),
  loaderVersions: (kind, mcVersion) => ipcRenderer.invoke(IPC.loaderVersions, kind, mcVersion),
  createInstance: (payload) => ipcRenderer.invoke(IPC.instanceCreate, payload),
  deleteInstance: (id) => ipcRenderer.invoke(IPC.instanceDelete, id),
  updateInstance: (meta) => ipcRenderer.invoke(IPC.instanceUpdate, meta),
  openInstanceDir: (id) => ipcRenderer.invoke(IPC.instanceOpenDir, id),
  launch: (id) => ipcRenderer.invoke(IPC.instanceLaunch, id),
  search: (q) => ipcRenderer.invoke(IPC.search, q),
  detail: (provider, id, kind) => ipcRenderer.invoke(IPC.detail, provider, id, kind),
  installContent: (payload) => ipcRenderer.invoke(IPC.installContent, payload),
  installModpack: (payload) => ipcRenderer.invoke(IPC.installModpack, payload),
  installedList: (instanceId) => ipcRenderer.invoke(IPC.installedList, instanceId),
  tasks: () => ipcRenderer.invoke(IPC.tasks),
  cancelTask: (taskId) => ipcRenderer.invoke(IPC.taskCancel, taskId),
  javas: (force) => ipcRenderer.invoke(IPC.javaList, force),
  downloadJava: (major) => ipcRenderer.invoke(IPC.javaDownload, major),
  readLog: (instanceId) => ipcRenderer.invoke(IPC.logs, instanceId),
  onTask: (cb) => subscribe(IPC.taskUpdate, cb),
  onLog: (cb) => subscribe(IPC.logEvent, cb),
  onGameExit: (cb) => subscribe(IPC.gameExit, cb),
  onInstances: (cb) => subscribe(IPC.instancesChanged, cb)
}

contextBridge.exposeInMainWorld('mc', api)
