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
const IDLE_TIMEOUT_MS = 45_000
/** 小于这个大小不值得分段（分段反而更慢） */
const SEGMENT_MIN_SIZE = 4 * 1024 * 1024

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
  label?: string
}

export interface DlCtx {
  addBytes(n: number): void
  setTotal(n: number): void
  shouldStop(): boolean
  setMessage?(msg: string): void
}

/* ------------------------------------------------------------------ *
 *  多线程分段下载
 *  思路参考 PCL2 的 ModNet：Range 分段 + 段长度校验 + 不支持 Range 时降级单线程
 * ------------------------------------------------------------------ */

interface ProbeResult {
  url: string
  size: number
  ranges: boolean
}

/** 用 Range: bytes=0-0 探测文件大小与是否支持分段 */
async function probe(url: string): Promise<ProbeResult | null> {
  try {
    const res = await doFetch(url, { headers: { range: 'bytes=0-0', accept: '*/*' }, timeoutMs: 25_000 })
    const cr = res.headers.get('content-range')
    const len = Number(res.headers.get('content-length') ?? 0)
    if (res.status === 206 && cr) {
      const m = cr.match(/\/(\d+)\s*$/)
      return m ? { url, size: Number(m[1]), ranges: true } : null
    }
    if (res.status === 200 && len > 0) return { url, size: len, ranges: false }
    return null
  } catch (e) {
    log('dl', `探测失败 ${url}: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

function idleGuard(): { signal: AbortSignal; bump: () => void; done: () => void } {
  const ac = new AbortController()
  let timer: NodeJS.Timeout | null = null
  const arm = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => ac.abort(new Error('传输停滞超过 45 秒')), IDLE_TIMEOUT_MS)
  }
  arm()
  return {
    signal: ac.signal,
    bump: arm,
    done: () => {
      if (timer) clearTimeout(timer)
    }
  }
}

async function hashExisting(hash: ReturnType<typeof createHash>, file: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const rs = createReadStream(file)
    rs.on('data', (c) => hash.update(c))
    rs.on('error', reject)
    rs.on('end', () => resolve())
  })
}

async function sha1FileOf(file: string): Promise<string> {
  const h = createHash('sha1')
  await hashExisting(h, file)
  return h.digest('hex')
}

/** 下载一个分段（可续传：分段文件已存在且长度正确则跳过） */
async function downloadSegment(url: string, segFile: string, start: number, end: number, ctx: DlCtx): Promise<number> {
  const want = end - start + 1
  try {
    const st = await stat(segFile)
    if (st.size === want) {
      ctx.addBytes(want)
      return want
    }
    if (st.size >= want) {
      await rm(segFile, { force: true })
    } else {
      // 半截分段：从断点续传
      start += st.size
    }
  } catch {
    /* 不存在 */
  }

  await ensureDir(dirname(segFile))
  const guard = idleGuard()
  let res: Response
  try {
    res = await httpFetch(url, {
      headers: { range: `bytes=${start}-${end}`, accept: '*/*', 'user-agent': USER_AGENT },
      signal: guard.signal
    })
  } catch (e) {
    guard.done()
    throw e
  }
  if (res.status !== 206 || !res.body) {
    guard.done()
    throw new Error(`分段请求失败 HTTP ${res.status}`)
  }
  const body = Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream)
  let got = 0
  body.on('data', (chunk: Buffer) => {
    got += chunk.length
    guard.bump()
    ctx.addBytes(chunk.length)
    // 取消检查放在数据回调里：不等整段下完就能停
    if (ctx.shouldStop()) body.destroy(new CancelledError())
  })
  try {
    await pipeline(body, createWriteStream(segFile, { flags: 'a' }))
  } finally {
    guard.done()
  }
  if (got !== want) throw new Error(`分段长度不符 ${got} != ${want}`)
  return got
}

/** 分段并发下载并合并；返回 false 表示应降级单线程 */
async function segmentedDownload(info: ProbeResult, item: DlItem, ctx: DlCtx, threads: number): Promise<boolean> {
  const { url, size } = info
  const tmp = `${item.dest}.part`
  // 每个分段至少 512KB，避免小文件被切得过碎
  const n = Math.max(2, Math.min(threads, 16, Math.floor(size / (512 * 1024))))
  const segSize = Math.ceil(size / n)
  const segs: Array<{ start: number; end: number; file: string }> = []
  for (let i = 0; i < n; i++) {
    const start = i * segSize
    const end = Math.min(size - 1, start + segSize - 1)
    if (start > end) break
    segs.push({ start, end, file: `${tmp}.seg${i}` })
  }
  log('dl', `${item.label ?? item.dest}: 分段下载 ${segs.length} 线程 / ${(size / 1048576).toFixed(2)} MB`)

  let failed = false
  await runPool(
    segs,
    6,
    async (seg) => {
      if (ctx.shouldStop() || failed) return
      try {
        await downloadSegment(url, seg.file, seg.start, seg.end, ctx)
      } catch (e) {
        if (e instanceof CancelledError) throw e
        failed = true
        log('dl', `分段失败 ${seg.start}-${seg.end}: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
    () => ctx.shouldStop()
  )
  if (ctx.shouldStop()) throw new CancelledError()
  if (failed) {
    for (const s of segs) await rm(s.file, { force: true }).catch(() => undefined)
    return false
  }

  ctx.setMessage?.(`合并分段 ${item.label ?? ''}`)
  const mergePath = `${tmp}.merge`
  // 用 write/drain 逐段追加，避免反复 pipeline 同一个输出流导致监听器堆叠
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(mergePath)
    let i = 0
    const fail = (e: Error): void => {
      out.destroy()
      reject(e)
    }
    out.on('error', fail)
    const next = (): void => {
      ;(async () => {
        if (ctx.shouldStop()) return fail(new CancelledError())
        if (i >= segs.length) {
          out.end(() => resolve())
          return
        }
        const seg = segs[i++]
        for await (const chunk of createReadStream(seg.file)) {
          if (ctx.shouldStop()) return fail(new CancelledError())
          if (!out.write(chunk)) {
            await new Promise<void>((r) => out.once('drain', () => r()))
          }
        }
        next()
      })().catch((e: unknown) => fail(e instanceof Error ? e : new Error(String(e))))
    }
    next()
  })
  for (const s of segs) await rm(s.file, { force: true }).catch(() => undefined)
  await rm(tmp, { force: true }).catch(() => undefined)
  await rename(mergePath, tmp)
  return true
}

/** 单连接下载（支持 Range 断点续传） */
async function streamToFile(url: string, item: DlItem, ctx: DlCtx): Promise<void> {
  await ensureDir(dirname(item.dest))
  const tmp = `${item.dest}.part`

  let start = 0
  try {
    start = (await stat(tmp)).size
  } catch {
    start = 0
  }
  if (item.size && start > item.size) {
    await rm(tmp, { force: true })
    start = 0
  }

  const guard = idleGuard()
  let res: Response
  try {
    res = await httpFetch(url, {
      headers: { accept: '*/*', 'user-agent': USER_AGENT, ...(start > 0 ? { range: `bytes=${start}-` } : {}) },
      signal: guard.signal
    })
  } catch (e) {
    guard.done()
    throw e
  }

  if (res.status === 416) {
    guard.done()
    await rm(tmp, { force: true })
    throw new Error('范围请求被拒绝（文件可能已损坏），稍后重试')
  }
  if (!res.ok) {
    guard.done()
    throw new Error(`HTTP ${res.status}`)
  }
  if (!res.body) {
    guard.done()
    throw new Error('响应为空')
  }

  const resumed = start > 0 && res.status === 206
  if (start > 0 && !resumed) {
    start = 0
    await rm(tmp, { force: true })
  } else if (resumed) {
    ctx.addBytes(start)
  }

  const hash = createHash('sha1')
  if (resumed) await hashExisting(hash, tmp)

  const body = Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream)
  body.on('data', (chunk: Buffer) => {
    guard.bump()
    hash.update(chunk)
    ctx.addBytes(chunk.length)
    if (ctx.shouldStop()) body.destroy(new CancelledError())
  })

  try {
    await pipeline(body, createWriteStream(tmp, { flags: resumed ? 'a' : 'w' }))
  } finally {
    guard.done()
  }

  if (item.sha1) {
    const got = hash.digest('hex')
    if (got !== item.sha1.toLowerCase()) {
      await rm(tmp, { force: true })
      throw new Error(`校验失败 ${got.slice(0, 8)}… != ${item.sha1.slice(0, 8)}…`)
    }
  } else if (item.size) {
    const actual = (await stat(tmp)).size
    if (actual !== item.size) throw new Error(`大小不符 ${actual} != ${item.size}，下次续传`)
  }

  await rm(item.dest, { force: true })
  await rename(tmp, item.dest)
}

/** 单个文件：优先多线程分段，不行再单连接 */
async function downloadOne(item: DlItem, ctx: DlCtx, threads: number): Promise<void> {
  const urls = altUrls(item.url)
  const official = item.url
  let lastErr: unknown

  for (let attempt = 0; attempt < 3; attempt++) {
    if (ctx.shouldStop()) throw new CancelledError()
    for (const u of urls) {
      if (mirrorSuspended() && u !== official) continue
      try {
        if (threads > 1) {
          const info = await probe(u)
          const known = info?.size ?? item.size ?? 0
          if (info?.ranges && known >= SEGMENT_MIN_SIZE) {
            const ok = await segmentedDownload(info, item, ctx, threads)
            if (ok) {
              if (item.sha1) {
                const got = await sha1FileOf(item.dest).catch(() => '')
                if (got !== item.sha1.toLowerCase()) {
                  await rm(item.dest, { force: true })
                  throw new Error(`分段合并后校验失败 ${got.slice(0, 8)}…`)
                }
              } else if (item.size) {
                const actual = (await stat(item.dest)).size
                if (actual !== item.size) {
                  await rm(item.dest, { force: true })
                  throw new Error(`分段合并后大小不符 ${actual} != ${item.size}`)
                }
              }
              if (u !== official) reportMirrorResult(true)
              return
            }
            log('dl', `${item.label ?? item.dest}: 分段不可用，降级单线程`)
          }
        }
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
 * 批量下载：已存在且 sha1 匹配则跳过；大文件走多线程分段；聚合进度。
 */
export async function downloadAll(items: DlItem[], ctx: DlCtx, concurrency?: number): Promise<void> {
  const { config } = await import('./config')
  const cfg = config.get()
  const conc = concurrency ?? cfg.concurrency ?? 6
  const threads = Math.max(1, cfg.downloadThreads ?? 8)
  const total = items.reduce((a, b) => a + (b.size ?? 0), 0)
  ctx.setTotal(total)

  // 大文件单独串行（每个文件内部已经多线程），小文件批量并发，避免连接数爆炸
  const big = items.filter((i) => (i.size ?? 0) >= SEGMENT_MIN_SIZE)
  const small = items.filter((i) => (i.size ?? 0) < SEGMENT_MIN_SIZE)

  let doneCount = 0
  const handle = async (item: DlItem): Promise<void> => {
    if (ctx.shouldStop()) throw new CancelledError()
    if (await pathExists(item.dest)) {
      if (await sha1Ok(item.dest, item.sha1)) {
        ctx.addBytes(item.size ?? 0)
        doneCount++
        return
      }
    }
    await downloadOne(item, ctx, threads)
    doneCount++
    if (ctx.setMessage && doneCount % 10 === 0) ctx.setMessage(`${doneCount}/${items.length} 个文件`)
  }

  if (small.length) {
    await runPool(small, conc, handle, () => ctx.shouldStop())
  }
  for (const item of big) {
    if (ctx.shouldStop()) throw new CancelledError()
    await handle(item)
  }
  if (ctx.setMessage) ctx.setMessage(`${items.length}/${items.length} 个文件`)
}
