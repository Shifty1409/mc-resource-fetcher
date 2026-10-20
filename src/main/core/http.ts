import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { altUrls, mirrorSuspended, reportMirrorResult } from './mirror'
import { CancelledError } from './tasks'
import { httpFetch } from './host'
import { log } from './log'
import { ensureDir, pathExists, runPool, sha1Ok, sleep } from './util'

export const USER_AGENT = 'MCLauncher/0.1.0 (Minecraft-Offline-Launcher)'

export interface FetchOptions {
  headers?: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
  method?: string
  body?: string
}

const DEFAULT_TIMEOUT = 40_000

async function doFetch(url: string, opts: FetchOptions = {}): Promise<Response> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(new Error(`请求超时: ${url}`)), opts.timeoutMs ?? DEFAULT_TIMEOUT)
  const signals = [ac.signal]
  if (opts.signal) signals.push(opts.signal)
  try {
    return await httpFetch(url, {
      method: opts.method ?? 'GET',
      body: opts.body,
      headers: { 'user-agent': USER_AGENT, ...(opts.headers ?? {}) },
      signal: signals.length > 1 ? AbortSignal.any(signals) : ac.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

export interface JsonOptions extends FetchOptions {
  retries?: number
  /** 直接返回文本而非解析 */
  raw?: boolean
}

/** 带镜像回退 + 重试的文本请求 */
export async function getText(url: string, opts: JsonOptions = {}): Promise<string> {
  const urls = altUrls(url)
  const retries = opts.retries ?? 2
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    for (const u of urls) {
      if (opts.signal?.aborted) throw new CancelledError()
      try {
        const res = await doFetch(u, opts)
        if (!res.ok) throw new Error(`HTTP ${res.status} ${u}`)
        return await res.text()
      } catch (e) {
        lastErr = e
        log('http', `GET 失败(${attempt + 1}) ${u}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (attempt < retries) await sleep(350 * (attempt + 1))
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export async function getJson<T>(url: string, opts: JsonOptions = {}): Promise<T> {
  const txt = await getText(url, opts)
  try {
    return JSON.parse(txt) as T
  } catch {
    throw new Error(`返回的不是合法 JSON: ${url}`)
  }
}

export async function getBuffer(url: string, opts: FetchOptions = {}): Promise<Buffer> {
  const urls = altUrls(url)
  let lastErr: unknown
  for (const u of urls) {
    try {
      const res = await doFetch(u, opts)
      if (!res.ok) throw new Error(`HTTP ${res.status} ${u}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export interface DlItem {
  url: string
  dest: string
  sha1?: string
  size?: number
  /** 仅用于日志 */
  label?: string
}

export interface DlCtx {
  addBytes(n: number): void
  setTotal(n: number): void
  shouldStop(): boolean
  setMessage?(msg: string): void
}

const IDLE_TIMEOUT_MS = 45_000

/** 把已存在的 .part 内容喂进哈希（断点续传时用） */
async function hashExisting(hash: ReturnType<typeof createHash>, file: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const rs = createReadStream(file)
    rs.on('data', (c) => hash.update(c))
    rs.on('error', reject)
    rs.on('end', () => resolve())
  })
}

async function streamToFile(url: string, item: DlItem, ctx: DlCtx): Promise<void> {
  await ensureDir(dirname(item.dest))
  const tmp = `${item.dest}.part`

  let start = 0
  try {
    start = (await stat(tmp)).size
  } catch {
    start = 0
  }
  // 已有 .part 比目标还大 → 视为脏数据
  if (item.size && start > item.size) {
    await rm(tmp, { force: true })
    start = 0
  }

  const ac = new AbortController()
  let idle: NodeJS.Timeout | null = null
  const bumpIdle = (): void => {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => ac.abort(new Error('传输停滞超过 45 秒')), IDLE_TIMEOUT_MS)
  }
  bumpIdle()

  let res: Response
  try {
    res = await httpFetch(url, {
      headers: { accept: '*/*', ...(start > 0 ? { range: `bytes=${start}-` } : {}) },
      signal: ac.signal
    })
  } catch (e) {
    if (idle) clearTimeout(idle)
    throw e
  }

  if (res.status === 416) {
    // 服务端认为已完整，删掉重来一次
    if (idle) clearTimeout(idle)
    await rm(tmp, { force: true })
    throw new Error('范围请求被拒绝（文件可能已损坏），稍后重试')
  }
  if (!res.ok) {
    if (idle) clearTimeout(idle)
    throw new Error(`HTTP ${res.status}`)
  }
  if (!res.body) {
    if (idle) clearTimeout(idle)
    throw new Error('响应为空')
  }

  const resumed = start > 0 && res.status === 206
  if (start > 0 && !resumed) {
    // 服务器不支持断点续传
    start = 0
    await rm(tmp, { force: true })
  } else if (resumed) {
    ctx.addBytes(start)
  }

  const hash = createHash('sha1')
  if (resumed) await hashExisting(hash, tmp)

  const body = Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream)
  body.on('data', (chunk: Buffer) => {
    bumpIdle()
    hash.update(chunk)
    ctx.addBytes(chunk.length)
  })

  try {
    await pipeline(body, createWriteStream(tmp, { flags: resumed ? 'a' : 'w' }))
  } catch (e) {
    // 保留 .part 以便下次续传
    throw e
  } finally {
    if (idle) clearTimeout(idle)
  }

  if (item.sha1) {
    const got = hash.digest('hex')
    if (got !== item.sha1.toLowerCase()) {
      await rm(tmp, { force: true })
      throw new Error(`校验失败 ${got.slice(0, 8)}… != ${item.sha1.slice(0, 8)}…`)
    }
  } else if (item.size) {
    const actual = (await stat(tmp)).size
    if (actual !== item.size) {
      throw new Error(`大小不符 ${actual} != ${item.size}，下次续传`)
    }
  }

  await rm(item.dest, { force: true })
  await rename(tmp, item.dest)
}

async function downloadOne(item: DlItem, ctx: DlCtx): Promise<void> {
  const urls = altUrls(item.url)
  const official = item.url
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    if (ctx.shouldStop()) throw new CancelledError()
    for (const u of urls) {
      if (mirrorSuspended() && u !== official) continue
      try {
        await streamToFile(u, item, ctx)
        if (u !== official) reportMirrorResult(true)
        return
      } catch (e) {
        lastErr = e
        if (e instanceof CancelledError) throw e
        if (u !== official) reportMirrorResult(false)
        const cause = (e as { cause?: { code?: string } })?.cause?.code
        log(
          'dl',
          `下载失败 ${item.label ?? item.dest} <- ${u}: ${e instanceof Error ? e.message : e}${
            cause ? ` [${cause}]` : ''
          }`
        )
      }
    }
    await sleep(300 * (attempt + 1))
  }
  throw new Error(`下载失败: ${item.label ?? item.dest} (${lastErr instanceof Error ? lastErr.message : lastErr})`)
}

/**
 * 批量下载：可续传（已存在且 sha1 匹配则跳过）、并发、聚合进度。
 * 必须提供 sha1 或 size 才能正确统计进度；都缺失时按完成文件累加。
 */
export async function downloadAll(items: DlItem[], ctx: DlCtx, concurrency?: number): Promise<void> {
  const { config } = await import('./config')
  const conc = concurrency ?? config.get().concurrency ?? 8
  const total = items.reduce((a, b) => a + (b.size ?? 0), 0)
  ctx.setTotal(total)
  let doneCount = 0
  await runPool(
    items,
    conc,
    async (item) => {
      if (ctx.shouldStop()) throw new CancelledError()
      const exists = await pathExists(item.dest)
      if (exists && (await sha1Ok(item.dest, item.sha1))) {
        ctx.addBytes(item.size ?? 0)
        doneCount++
        return
      }
      await downloadOne(item, ctx)
      doneCount++
      if (item.size === undefined) ctx.addBytes(0)
      if (ctx.setMessage && doneCount % 20 === 0) ctx.setMessage(`${doneCount}/${items.length} 个文件`)
    },
    () => ctx.shouldStop()
  )
  if (ctx.setMessage) ctx.setMessage(`${items.length}/${items.length} 个文件`)
}
