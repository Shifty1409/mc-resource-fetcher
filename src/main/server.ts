/**
 * 浏览器模式服务端：不依赖 Electron，把同一套核心能力用 HTTP + SSE 暴露给渲染层。
 * 启动：node .harness/main/server.js [--port=19388] [--open]
 * 前端由 out/renderer 静态托管，window.mc 由 browser-api.ts 的 HTTP 适配层提供。
 */
import { createReadStream, readdirSync, statSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import { basename, dirname, extname, join, normalize, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import type { ContentKind, InstanceMeta, LoaderKind, SearchQuery } from '../shared/types'
import { config } from './core/config'
import { installContent, listInstalled } from './core/content'
import { getCurseforgeDetail, hasCurseforgeKey, searchCurseforge } from './core/curseforge'
import { createInstance, deleteInstance, getInstance, listInstances, saveInstance } from './core/instances'
import { ensureJava, listJavas } from './core/java'
import { launchInstance } from './core/launch'
import { installVersionStack, listLoaderVersions } from './core/loaders'
import { log, logError, openLauncherLog } from './core/log'
import { installModpack } from './core/modpack'
import { getModrinthDetail, searchModrinth } from './core/modrinth'
import { instanceDir, portableRoot } from './core/paths'
import { tasks } from './core/tasks'
import { fetchVersionManifest } from './core/vanilla'
import { ensureDir } from './core/util'

const ROOT = join(__dirname, '..', '..')

/** 渲染层目录：打包后是 resources/renderer，开发时是 out/renderer */
function resolveRendererDir(): string {
  const candidates = [
    process.env.MCL_RENDERER_DIR,
    join(ROOT, 'renderer'),
    join(ROOT, 'out', 'renderer'),
    join(ROOT, 'app.asar', 'out', 'renderer')
  ].filter(Boolean) as string[]
  const { existsSync } = require('node:fs') as typeof import('node:fs')
  for (const c of candidates) {
    try {
      if (existsSync(join(c, 'index.html'))) return c
    } catch {
      /* ignore */
    }
  }
  return candidates[1] ?? join(ROOT, 'out', 'renderer')
}

const RENDERER = resolveRendererDir()

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
}

const clients = new Set<ServerResponse>()

function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of clients) {
    try {
      res.write(payload)
    } catch {
      clients.delete(res)
    }
  }
}

function json(res: ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body ?? null)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  res.end(text)
}

/** 列出目录内容（应用内文件浏览用，不依赖系统外壳） */
async function listDir(target: string): Promise<{
  path: string
  parent: string | null
  entries: Array<{ name: string; isDir: boolean; size: number }>
}> {
  const abs = resolve(target)
  const st = await stat(abs)
  if (!st.isDirectory()) throw new Error('不是有效目录')
  const items = await readdir(abs, { withFileTypes: true })
  const entries = items
    .map((d) => {
      let size = 0
      if (!d.isDirectory()) {
        try {
          size = statSync(join(abs, d.name)).size
        } catch {
          size = 0
        }
      }
      return { name: d.name, isDir: d.isDirectory(), size }
    })
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh') : a.isDir ? -1 : 1))
  const parentDir = dirname(abs)
  return { path: abs, parent: parentDir === abs ? null : parentDir, entries }
}

async function existingService(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) })
    return r.ok
  } catch {
    return false
  }
}

async function readBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function serveStatic(res: ServerResponse, urlPath: string): Promise<void> {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^([/\\])+/, '')
  let file = join(RENDERER, clean || 'index.html')
  if (!file.startsWith(RENDERER)) {
    res.writeHead(403).end()
    return
  }
  try {
    const st = await stat(file)
    if (st.isDirectory()) file = join(file, 'index.html')
  } catch {
    file = join(RENDERER, 'index.html')
  }
  try {
    const st = await stat(file)
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': st.size,
      'cache-control': 'no-cache'
    })
    createReadStream(file).pipe(res)
  } catch {
    res.writeHead(404).end('not found')
  }
}

function parseQuery(url: URL): Record<string, string> {
  const out: Record<string, string> = {}
  url.searchParams.forEach((v, k) => {
    out[k] = v
  })
  return out
}

async function handleApi(
  req: import('node:http').IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<boolean> {
  const path = url.pathname
  const q = parseQuery(url)
  const method = req.method ?? 'GET'

  if (path === '/api/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    })
    res.write(`event: ready\ndata: {}\n\n`)
    clients.add(res)
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n')
      } catch {
        /* ignore */
      }
    }, 15000)
    req.on('close', () => {
      clearInterval(ping)
      clients.delete(res)
    })
    return true
  }

  if (path === '/api/snapshot' && method === 'GET') {
    json(res, 200, {
      instances: await listInstances(),
      config: config.get(),
      gameRoot: config.get().gameRoot,
      dataRoot: join(ROOT, '.mcdata'),
      javaList: await listJavas(),
      dataVersion: 1
    })
    return true
  }

  if (path === '/api/config' && method === 'POST') {
    const patch = await readBody(req)
    const saved = await config.save(patch)
    broadcast('instances', await listInstances())
    json(res, 200, saved)
    return true
  }

  if (path === '/api/fs/drives' && method === 'GET') {
    const drives: string[] = []
    for (let c = 65; c <= 90; c++) {
      const d = `${String.fromCharCode(c)}:\\`
      try {
        if (statSync(d).isDirectory()) drives.push(d)
      } catch {
        /* 不存在的盘符跳过 */
      }
    }
    json(res, 200, { drives })
    return true
  }

  if (path === '/api/fs/list' && method === 'GET') {
    const target = String(q.path || config.get().gameRoot)
    try {
      json(res, 200, await listDir(target))
    } catch (e) {
      json(res, 400, { message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  if (path === '/api/versions' && method === 'GET') {
    const m = await fetchVersionManifest(q.force === '1')
    json(res, 200, m.versions)
    return true
  }

  if (path === '/api/loader-versions' && method === 'GET') {
    json(res, 200, await listLoaderVersions(q.kind as LoaderKind, q.mc ?? ''))
    return true
  }

  if (path === '/api/instance' && method === 'POST') {
    const p = (await readBody(req)) as unknown as {
      name: string
      mcVersion: string
      loader: LoaderKind
      loaderVersion?: string
    }
    const { handle } = tasks.start(`安装 ${p.name || p.mcVersion}`)
    void (async () => {
      try {
        const stack = await installVersionStack(
          { mcVersion: p.mcVersion, loader: p.loader, loaderVersion: p.loaderVersion },
          handle
        )
        const inst = await createInstance({
          name: p.name,
          mcVersion: p.mcVersion,
          loader: p.loader,
          loaderVersion: stack.loaderVersion,
          versionId: stack.versionId
        })
        handle.finish(`实例「${inst.name}」已就绪`)
        broadcast('instances', await listInstances())
      } catch (e) {
        logError('server-install', e)
        handle.fail(e)
      }
    })()
    json(res, 200, { taskId: handle.id })
    return true
  }

  if (path.startsWith('/api/instance/') && method === 'DELETE') {
    const id = path.slice('/api/instance/'.length)
    await deleteInstance(id)
    broadcast('instances', await listInstances())
    json(res, 200, { ok: true })
    return true
  }

  if (path === '/api/instance' && method === 'PUT') {
    const meta = (await readBody(req)) as unknown as InstanceMeta
    const saved = await saveInstance(meta)
    broadcast('instances', await listInstances())
    json(res, 200, saved)
    return true
  }

  if (path === '/api/launch' && method === 'POST') {
    const body = await readBody(req)
    const inst = await getInstance(String(body.id))
    if (!inst) {
      json(res, 404, { message: '实例不存在' })
      return true
    }
    const { handle } = tasks.start(`启动 ${inst.name}`)
    try {
      const out = await launchInstance(inst, handle, {
        onLine: (line) => broadcast('log', { instanceId: inst.id, line, stream: 'stdout' }),
        onExit: (code) =>
          broadcast('exit', {
            instanceId: inst.id,
            code,
            crashed: code !== 0,
            message: code === 0 ? '游戏已正常退出' : `进程退出，代码 ${code}`
          })
      })
      handle.finish(`已启动 ${inst.name}`)
      const fresh = await getInstance(inst.id)
      if (fresh) {
        fresh.lastPlayedAt = Date.now()
        await saveInstance(fresh)
      }
      broadcast('instances', await listInstances())
      json(res, 200, out.result)
    } catch (e) {
      handle.fail(e)
      json(res, 500, { message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  if (path === '/api/search' && method === 'GET') {
    const kind = (q.kind ?? 'mod') as ContentKind
    const sq: SearchQuery = {
      kind,
      query: q.query ?? '',
      provider: (q.provider as SearchQuery['provider']) ?? 'modrinth',
      gameVersion: q.gameVersion || undefined,
      loader: q.loader || undefined,
      sort: (q.sort as SearchQuery['sort']) ?? 'relevance',
      offset: Number(q.offset ?? 0),
      limit: Number(q.limit ?? 20)
    }
    if (sq.provider === 'curseforge' && !hasCurseforgeKey()) {
      json(res, 400, { message: '未配置 CurseForge API Key' })
      return true
    }
    if (sq.provider === 'all') {
      const [mr, cf] = await Promise.all([
        searchModrinth(sq).catch(() => ({ hits: [], total: 0, offset: sq.offset, limit: sq.limit })),
        hasCurseforgeKey()
          ? searchCurseforge(sq).catch(() => ({ hits: [], total: 0, offset: sq.offset, limit: sq.limit }))
          : Promise.resolve({ hits: [], total: 0, offset: sq.offset, limit: sq.limit })
      ])
      const merged = []
      for (let i = 0; i < Math.max(mr.hits.length, cf.hits.length); i++) {
        if (mr.hits[i]) merged.push(mr.hits[i])
        if (cf.hits[i]) merged.push(cf.hits[i])
      }
      json(res, 200, { hits: merged, total: mr.total + cf.total, offset: sq.offset, limit: sq.limit })
      return true
    }
    json(res, 200, sq.provider === 'curseforge' ? await searchCurseforge(sq) : await searchModrinth(sq))
    return true
  }

  if (path === '/api/detail' && method === 'GET') {
    const id = q.id ?? ''
    const kind = (q.kind ?? 'mod') as ContentKind
    json(res, 200, q.provider === 'curseforge' ? await getCurseforgeDetail(id, kind) : await getModrinthDetail(id, kind))
    return true
  }

  if (path === '/api/install-content' && method === 'POST') {
    const p = (await readBody(req)) as unknown as {
      instanceId: string
      provider: 'modrinth' | 'curseforge'
      projectId: string
      kind: ContentKind
      fileUrl?: string
      fileName?: string
      versionId?: string
    }
    const inst = await getInstance(p.instanceId)
    if (!inst) {
      json(res, 400, { message: '请先选择一个实例' })
      return true
    }
    const { handle } = tasks.start(`安装 ${p.kind}`)
    void (async () => {
      try {
        const r = await installContent(inst, p, handle)
        handle.finish(`已安装 ${r.fileName}`)
      } catch (e) {
        logError('server-content', e)
        handle.fail(e)
      }
    })()
    json(res, 200, { taskId: handle.id })
    return true
  }

  if (path === '/api/install-modpack' && method === 'POST') {
    const p = (await readBody(req)) as unknown as {
      provider: 'modrinth' | 'curseforge'
      projectId: string
      instanceName?: string
    }
    const { handle } = tasks.start('安装整合包')
    void (async () => {
      try {
        const inst = await installModpack(p, handle)
        handle.finish(`整合包「${inst.name}」已就绪`)
        broadcast('instances', await listInstances())
      } catch (e) {
        logError('server-modpack', e)
        handle.fail(e)
      }
    })()
    json(res, 200, { taskId: handle.id })
    return true
  }

  if (path.startsWith('/api/installed/') && method === 'GET') {
    json(res, 200, await listInstalled(path.slice('/api/installed/'.length)))
    return true
  }

  if (path === '/api/tasks' && method === 'GET') {
    json(res, 200, tasks.list())
    return true
  }

  if (path.startsWith('/api/task/') && path.endsWith('/cancel') && method === 'POST') {
    const id = path.slice('/api/task/'.length, -'/cancel'.length)
    json(res, 200, tasks.cancel(id))
    return true
  }

  if (path === '/api/javas' && method === 'GET') {
    json(res, 200, await listJavas(true))
    return true
  }

  if (path === '/api/download-java' && method === 'POST') {
    const body = await readBody(req)
    const major = Number(body.major ?? 21)
    const { handle } = tasks.start(`下载 Java ${major}`)
    void (async () => {
      try {
        const j = await ensureJava(major, undefined, handle)
        handle.finish(`Java ${j.major} 就绪`)
      } catch (e) {
        handle.fail(e)
      }
    })()
    json(res, 200, { taskId: handle.id })
    return true
  }

  // 桌面应用窗口模式下，关窗后由前端调用它退出服务
  if (path === '/api/shutdown' && method === 'POST') {
    json(res, 200, { ok: true })
    setTimeout(() => {
      log('server', '收到 shutdown 请求，退出')
      process.exit(0)
    }, 150)
    return true
  }

  if (path === '/api/health' && method === 'GET') {
    json(res, 200, { ok: true, port: Number(process.env.MCL_PORT ?? 0) })
    return true
  }

  return false
}

async function main(): Promise<void> {
  const portArg = process.argv.find((a) => a.startsWith('--port='))
  const wantPort = portArg ? Number(portArg.split('=')[1]) : 19388
  await config.load()
  await openLauncherLog('server.log')
  await ensureDir(config.get().gameRoot)

  tasks.on('update', (info) => broadcast('task', info))

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
        if (url.pathname.startsWith('/api/')) {
          const handled = await handleApi(req, res, url)
          if (!handled) json(res, 404, { message: `未知接口 ${url.pathname}` })
          return
        }
        await serveStatic(res, url.pathname)
      } catch (e) {
        logError('server', e)
        if (!res.headersSent) json(res, 500, { message: e instanceof Error ? e.message : String(e) })
        else res.end()
      }
    })()
  })

  let port = wantPort
  let announced = false

  const announce = (): void => {
    if (announced) return
    announced = true
    const url = `http://127.0.0.1:${port}/`
    // 把实际端口写出来，桌面应用窗口模式的启动脚本靠它拼 URL
    try {
      require('node:fs').writeFileSync(require('node:path').join(portableRoot, 'server-port.txt'), String(port))
    } catch {
      /* ignore */
    }
    log('server', `浏览器模式已启动：${url}`)
    // eslint-disable-next-line no-console
    console.log(`\n  MC 资源下载器（浏览器模式）已启动\n  ${url}\n  用浏览器打开上面的地址即可；Ctrl+C 停止\n`)
    if (process.argv.includes('--open')) {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
    }
  }

  // 端口被占用时自动往后找一个（用户可能已经开着一个实例）
  const tryListen = (attempt: number): void => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && attempt < 12) {
        const next = wantPort + attempt + 1
        log('server', `端口 ${port} 被占用，尝试 ${next}`)
        port = next
        tryListen(attempt + 1)
        return
      }
      // eslint-disable-next-line no-console
      console.error(`\n  启动失败：${err.message}\n`)
      process.exit(1)
    })
    server.listen(port, '127.0.0.1', announce)
  }
  tryListen(0)

  process.on('SIGINT', () => {
    server.close()
    process.exit(0)
  })
}

void main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  process.exit(1)
})

export { instanceDir, readFile }
