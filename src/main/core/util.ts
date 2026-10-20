import { createHash } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export function ensureDir(dir: string): Promise<void> {
  return mkdir(dir, { recursive: true }).then(() => undefined)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

export async function fileSize(p: string): Promise<number> {
  try {
    return (await stat(p)).size
  } catch {
    return -1
  }
}

export function sha1File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha1')
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')))
  })
}

export async function sha1Ok(file: string, expected?: string): Promise<boolean> {
  if (!expected) {
    return pathExists(file)
  }
  if (!(await pathExists(file))) return false
  try {
    return (await sha1File(file)) === expected.toLowerCase()
  } catch {
    return false
  }
}

export async function writeFileAtomic(file: string, data: string | Buffer): Promise<void> {
  await ensureDir(dirname(file))
  const tmp = `${file}.tmp${Math.random().toString(36).slice(2, 8)}`
  await new Promise<void>((resolve, reject) => {
    const fh = open(tmp, 'w')
    fh.then(async (h) => {
      try {
        await h.writeFile(data)
        await h.close()
        resolve()
      } catch (e) {
        reject(e)
      }
    }).catch(reject)
  })
  await rm(file, { force: true })
  await rename(tmp, file)
}

/** 读取并解析 JSON 文件，容忍 Windows 记事本写入的 BOM */
export function readJsonSync<T>(file: string): T | null {
  try {
    const raw = readFileSync(file, 'utf-8').replace(/^\uFEFF/, '')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function formatBytes(n: number): string {  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

export function slugify(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[\s\\/:*?"<>|]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return s || 'instance'
}

/** 仅保留文件名安全字符 */
export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'file'
}

/** 从 URL 或路径里取最后的文件名 */
export function baseName(p: string): string {
  const clean = p.split('?')[0].split('#')[0].replace(/\\/g, '/')
  const parts = clean.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? 'file'
}

export function joinPath(...parts: string[]): string {
  return join(...parts)
}

/** 运行器内简单并发池 */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop?: () => boolean
): Promise<void> {
  let cursor = 0
  const n = Math.max(1, Math.min(concurrency, items.length || 1))
  const runners: Promise<void>[] = []
  for (let i = 0; i < n; i++) {
    runners.push(
      (async () => {
        for (;;) {
          if (shouldStop?.()) return
          const idx = cursor++
          if (idx >= items.length) return
          await worker(items[idx], idx)
        }
      })()
    )
  }
  await Promise.all(runners)
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/** 时间戳目录名，如 2024-05-01_12-30-00 */
export function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}
