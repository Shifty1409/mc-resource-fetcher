import type { McApi } from '@shared/api'
import type { AppConfig, InstanceMeta, TaskInfo } from '@shared/types'
import type { GameExitEvent, GameLogEvent } from '@shared/ipc'

/**
 * 浏览器模式适配层：Electron 里 window.mc 由 preload 注入；
 * 用浏览器直接打开时（node .harness/main/server.js），这里用 HTTP + SSE 补一个同签名实现。
 * 注意 EventSource 在 jsdom / 老浏览器可能不存在，做了降级。
 */

type Json = Record<string, unknown>

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  const text = await res.text()
  const data = text ? (JSON.parse(text) as Json) : {}
  if (!res.ok) {
    throw new Error((data.message as string) ?? `HTTP ${res.status}`)
  }
  return data as T
}

const get = <T>(path: string): Promise<T> => req<T>(path)
const post = <T>(path: string, body?: unknown): Promise<T> =>
  req<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {})
  })
const put = <T>(path: string, body: unknown): Promise<T> =>
  req<T>(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })

export function installBrowserApi(): boolean {
  if (typeof window === 'undefined') return false
  if (window.mc) return false

  const taskSubs = new Set<(t: TaskInfo) => void>()
  const logSubs = new Set<(e: GameLogEvent) => void>()
  const exitSubs = new Set<(e: GameExitEvent) => void>()
  const instSubs = new Set<(i: InstanceMeta[]) => void>()

  try {
    if (typeof EventSource !== 'undefined') {
      const es = new EventSource('/api/events')
      es.addEventListener('task', (e) => {
        const data = JSON.parse((e as MessageEvent).data) as TaskInfo
        taskSubs.forEach((f) => f(data))
      })
      es.addEventListener('log', (e) => {
        const data = JSON.parse((e as MessageEvent).data) as GameLogEvent
        logSubs.forEach((f) => f(data))
      })
      es.addEventListener('exit', (e) => {
        const data = JSON.parse((e as MessageEvent).data) as GameExitEvent
        exitSubs.forEach((f) => f(data))
      })
      es.addEventListener('instances', (e) => {
        const data = JSON.parse((e as MessageEvent).data) as InstanceMeta[]
        instSubs.forEach((f) => f(data))
      })
    }
  } catch {
    /* 无 SSE 时不动 */
  }

  const qs = (o: Record<string, string | number | undefined>): string => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(o)) {
      if (v !== undefined && v !== '') p.set(k, String(v))
    }
    return p.toString()
  }

  const api: McApi = {
    snapshot: () => get('/api/snapshot'),
    saveConfig: (patch: Partial<AppConfig>) => post('/api/config', patch),
    openPath: async (path: string) => {
      await post('/api/open-path', { path })
    },
    selectDir: async () => null,
    versions: (force?: boolean) => get(`/api/versions?force=${force ? 1 : 0}`),
    loaderVersions: (kind, mcVersion) => get(`/api/loader-versions?kind=${kind}&mc=${encodeURIComponent(mcVersion)}`),
    createInstance: (payload) => post('/api/instance', payload),
    deleteInstance: async (id: string) => {
      await req(`/api/instance/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
    updateInstance: (meta: InstanceMeta) => put('/api/instance', meta),
    openInstanceDir: async () => {
      await post('/api/open-dir', {})
    },
    launch: (id: string) => post('/api/launch', { id }),
    search: (q) =>
      get(
        `/api/search?${qs({
          kind: q.kind,
          query: q.query,
          provider: q.provider,
          gameVersion: q.gameVersion,
          loader: q.loader,
          sort: q.sort,
          offset: q.offset,
          limit: q.limit
        })}`
      ),
    detail: (provider, id, kind) =>
      get(`/api/detail?provider=${provider}&id=${encodeURIComponent(id)}&kind=${kind}`),
    installContent: (payload) => post('/api/install-content', payload),
    installModpack: (payload) => post('/api/install-modpack', payload),
    installedList: (instanceId: string) => get(`/api/installed/${encodeURIComponent(instanceId)}`),
    tasks: () => get('/api/tasks'),
    cancelTask: (taskId: string) => post(`/api/task/${encodeURIComponent(taskId)}/cancel`, {}),
    javas: () => get('/api/javas'),
    downloadJava: (major: number) => post('/api/download-java', { major }),
    readLog: async () => '',
    onTask: (cb) => {
      taskSubs.add(cb)
      return () => taskSubs.delete(cb)
    },
    onLog: (cb) => {
      logSubs.add(cb)
      return () => logSubs.delete(cb)
    },
    onGameExit: (cb) => {
      exitSubs.add(cb)
      return () => exitSubs.delete(cb)
    },
    onInstances: (cb) => {
      instSubs.add(cb)
      return () => instSubs.delete(cb)
    }
  }

  window.mc = api
  return true
}
