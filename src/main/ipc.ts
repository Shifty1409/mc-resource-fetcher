import { BrowserWindow, ipcMain, shell } from 'electron'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { IPC, type GameExitEvent, type GameLogEvent } from '../shared/ipc'
import type { ContentKind, InstanceMeta, SearchQuery } from '../shared/types'
import type { CreateInstancePayload, InstallContentPayload, InstallModpackPayload, InstalledContent } from '../shared/api'
import { config } from './core/config'
import { installContent, listInstalled } from './core/content'
import { installModpack } from './core/modpack'
import { getCurseforgeDetail, hasCurseforgeKey, searchCurseforge } from './core/curseforge'
import { searchModrinth, getModrinthDetail } from './core/modrinth'
import { createInstance, deleteInstance, getInstance, listInstances, saveInstance } from './core/instances'
import { ensureJava, listJavas, invalidateJavaCache } from './core/java'
import { looksCrashed, launchInstance, resolveVersionChain } from './core/launch'
import { listLoaderVersions, installVersionStack } from './core/loaders'
import { log, logError } from './core/log'
import { fetchVersionManifest } from './core/vanilla'
import { tasks } from './core/tasks'
import { instanceDir, gamePaths, portableRoot } from './core/paths'
import { ensureDir, formatBytes } from './core/util'

let mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

async function emitInstances(): Promise<void> {
  const list = await listInstances()
  send(IPC.instancesChanged, list)
}

export function registerIpc(): void {
  tasks.on('update', (info) => send(IPC.taskUpdate, info))

  ipcMain.handle(IPC.snapshot, async () => {
    const cfg = config.get()
    return {
      instances: await listInstances(),
      config: cfg,
      gameRoot: cfg.gameRoot,
      dataRoot: portableRoot,
      javaList: await listJavas(),
      dataVersion: 1
    }
  })

  ipcMain.handle(IPC.configSave, async (_e, patch) => {
    const saved = await config.save(patch)
    invalidateJavaCache()
    await emitInstances()
    return saved
  })

  ipcMain.handle(IPC.openPath, async (_e, path: string, reveal?: boolean) => {
    await ensureDir(path).catch(() => undefined)
    if (reveal) {
      shell.showItemInFolder(path)
    } else {
      const err = await shell.openPath(path)
      if (err) throw new Error(err)
    }
  })

  ipcMain.handle(IPC.selectDir, async (_e, path: string) => {
    const { dialog } = await import('electron')
    const res = await dialog.showOpenDialog({
      title: '选择游戏目录',
      defaultPath: path || gamePaths().root,
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths.length) return null
    return res.filePaths[0]
  })

  ipcMain.handle(IPC.versions, async (_e, force?: boolean) => {
    const manifest = await fetchVersionManifest(Boolean(force))
    return manifest.versions
  })

  ipcMain.handle(IPC.loaderVersions, async (_e, kind, mcVersion: string) => {
    return listLoaderVersions(kind, mcVersion)
  })

  ipcMain.handle(IPC.instanceCreate, async (_e, payload: CreateInstancePayload) => {
    const { handle } = tasks.start(`安装 ${payload.name || payload.mcVersion}`)
    void (async () => {
      try {
        handle.setPhase('开始安装', `${payload.mcVersion} / ${payload.loader}`)
        const stack = await installVersionStack(
          {
            mcVersion: payload.mcVersion,
            loader: payload.loader,
            loaderVersion: payload.loaderVersion
          },
          handle
        )
        handle.setPhase('创建实例')
        const inst = await createInstance({
          name: payload.name || `${payload.mcVersion}-${payload.loader}`,
          mcVersion: payload.mcVersion,
          loader: payload.loader,
          loaderVersion: stack.loaderVersion,
          versionId: stack.versionId
        })
        handle.finish(`实例「${inst.name}」已就绪`)
        await emitInstances()
      } catch (e) {
        logError('install', e)
        handle.fail(e)
      }
    })()
    return { taskId: handle.id }
  })

  ipcMain.handle(IPC.instanceDelete, async (_e, id: string) => {
    await deleteInstance(id)
    await emitInstances()
  })

  ipcMain.handle(IPC.instanceUpdate, async (_e, meta: InstanceMeta) => {
    const saved = await saveInstance(meta)
    await emitInstances()
    return saved
  })

  ipcMain.handle(IPC.instanceOpenDir, async (_e, id: string) => {
    const dir = instanceDir(id)
    await ensureDir(dir)
    const err = await shell.openPath(dir)
    if (err) throw new Error(err)
  })

  ipcMain.handle(IPC.instanceLaunch, async (_e, id: string) => {
    const inst = await getInstance(id)
    if (!inst) throw new Error('实例不存在')
    const { handle } = tasks.start(`启动 ${inst.name}`)
    const recent: string[] = []
    try {
      handle.setPhase('准备启动')
      const out = await launchInstance(inst, handle, {
        onLine: (line) => {
          recent.push(line)
          if (recent.length > 400) recent.shift()
          const ev: GameLogEvent = { instanceId: id, line, stream: 'stdout' }
          send(IPC.logEvent, ev)
        },
        onExit: (code) => {
          const ev: GameExitEvent = {
            instanceId: id,
            code,
            crashed: code !== 0,
            message:
              code === 0
                ? '游戏已正常退出'
                : looksCrashed(recent)
                  ? '游戏崩溃了，请查看日志'
                  : `进程退出，代码 ${code}`
          }
          send(IPC.gameExit, ev)
        }
      })
      const fresh = await getInstance(id)
      if (fresh) {
        fresh.lastPlayedAt = Date.now()
        await saveInstance(fresh)
      }
      handle.finish(`已启动 ${inst.name}`)
      await emitInstances()
      return out.result
    } catch (e) {
      handle.fail(e)
      logError('launch', e)
      throw e
    }
  })

  ipcMain.handle(IPC.search, async (_e, q: SearchQuery) => {
    const provider = q.provider ?? 'modrinth'
    if (provider === 'curseforge') {
      if (!hasCurseforgeKey()) throw new Error('未配置 CurseForge API Key，请在设置里填写或改用 Modrinth')
      return searchCurseforge(q)
    }
    if (provider === 'all') {
      const [mr, cf] = await Promise.all([
        searchModrinth(q).catch((e) => {
          log('search', `Modrinth 搜索失败: ${e instanceof Error ? e.message : e}`)
          return { hits: [], total: 0, offset: q.offset, limit: q.limit }
        }),
        hasCurseforgeKey()
          ? searchCurseforge(q).catch(() => ({ hits: [], total: 0, offset: q.offset, limit: q.limit }))
          : Promise.resolve({ hits: [], total: 0, offset: q.offset, limit: q.limit })
      ])
      const merged = []
      const max = Math.max(mr.hits.length, cf.hits.length)
      for (let i = 0; i < max; i++) {
        if (mr.hits[i]) merged.push(mr.hits[i])
        if (cf.hits[i]) merged.push(cf.hits[i])
      }
      return { hits: merged, total: mr.total + cf.total, offset: q.offset, limit: q.limit }
    }
    return searchModrinth(q)
  })

  ipcMain.handle(IPC.detail, async (_e, provider: 'modrinth' | 'curseforge', id: string, kind: ContentKind) => {
    return provider === 'modrinth' ? getModrinthDetail(id, kind) : getCurseforgeDetail(id, kind)
  })

  ipcMain.handle(IPC.installContent, async (_e, payload: InstallContentPayload) => {
    const inst = await getInstance(payload.instanceId)
    if (!inst) throw new Error('请先选择一个实例')
    const { handle } = tasks.start(`安装 ${payload.kind}`)
    void (async () => {
      try {
        const r = await installContent(inst, payload, handle)
        handle.finish(`已安装 ${r.fileName}`)
      } catch (e) {
        logError('content', e)
        handle.fail(e)
      }
    })()
    return { taskId: handle.id }
  })

  ipcMain.handle(IPC.installModpack, async (_e, payload: InstallModpackPayload) => {
    const { handle } = tasks.start(`安装整合包`)
    void (async () => {
      try {
        const inst = await installModpack(payload, handle)
        handle.finish(`整合包「${inst.name}」已就绪`)
        await emitInstances()
      } catch (e) {
        logError('modpack', e)
        handle.fail(e)
      }
    })()
    return { taskId: handle.id }
  })

  ipcMain.handle(IPC.installedList, async (_e, instanceId: string): Promise<InstalledContent> => {
    return listInstalled(instanceId)
  })

  ipcMain.handle(IPC.tasks, async () => tasks.list())

  ipcMain.handle(IPC.taskCancel, async (_e, taskId: string) => tasks.cancel(taskId))

  ipcMain.handle(IPC.javaList, async (_e, force?: boolean) => {
    if (force) invalidateJavaCache()
    return listJavas(true)
  })

  ipcMain.handle(IPC.javaDownload, async (_e, major: number) => {
    const { handle } = tasks.start(`下载 Java ${major}`)
    void (async () => {
      try {
        const j = await ensureJava(major, undefined, handle)
        handle.finish(`Java ${j.major} 就绪`)
      } catch (e) {
        handle.fail(e)
      }
    })()
    return { taskId: handle.id }
  })

  ipcMain.handle(IPC.logs, async (_e, instanceId: string) => {
    try {
      const dir = join(instanceDir(instanceId), 'logs')
      const fs = await import('node:fs/promises')
      const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.log')).sort()
      if (!files.length) return ''
      const latest = files[files.length - 1]
      const content = await fs.readFile(join(dir, latest), 'utf-8')
      return content.split('\n').slice(-800).join('\n')
    } catch {
      return ''
    }
  })

  ipcMain.handle(IPC.modpackManifest, async (_e, instanceId: string) => {
    const inst = await getInstance(instanceId)
    if (!inst) return null
    return resolveVersionChain(inst.versionId).catch(() => null)
  })

  log('ipc', `已注册 IPC，游戏目录 ${formatBytes(0) && gamePaths().root}`)
}

export { readFileSync, dirname }
