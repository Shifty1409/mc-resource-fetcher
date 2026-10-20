import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { JavaInfo } from '../../shared/types'
import { getJson, downloadAll } from './http'
import { log } from './log'
import { runtimeRoot } from './paths'
import type { TaskHandle } from './tasks'
import { ensureDir, pathExists, runPool } from './util'
import { ARCH_BITS, OS_ARCH, type VersionJson } from './mcmeta'

const JAVA_RUNTIME_MANIFEST =
  'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'

const PLATFORM = OS_ARCH === 'arm64' ? 'windows-arm64' : 'windows-x64'

interface RuntimeManifestEntry {
  manifest?: { url: string; sha1?: string; size?: number }
  version?: { name: string; released?: string }
}

interface RuntimeFileEntry {
  type: 'file' | 'directory' | 'link'
  target?: string
  executable?: boolean
  downloads?: { raw?: { url: string; sha1?: string; size?: number } }
}

function readReleaseFile(home: string): { version: string; vendor: string } | null {
  try {
    const raw = readFileSync(join(home, 'release'), 'utf-8')
    const get = (k: string): string => {
      const m = raw.match(new RegExp(`^${k}="?([^"\\n]+)"?$`, 'm'))
      return m ? m[1].trim() : ''
    }
    const version = get('JAVA_VERSION') || get('JAVA_RUNTIME_VERSION')
    const vendor = get('IMPLEMENTOR') || get('JAVA_VENDOR') || 'Unknown'
    if (!version) return null
    return { version, vendor }
  } catch {
    return null
  }
}

export function majorFromVersionString(v: string): number {
  if (!v) return 0
  // 1.8.0_202 这种老写法
  if (v.startsWith('1.')) {
    const n = Number(v.split('.')[1])
    return Number.isFinite(n) ? n : 0
  }
  // 8u202 这种 Java 8 update 写法
  const update = v.match(/^(\d+)u/i)
  if (update) return Number(update[1])
  const n = Number(v.split(/[._+\-]/)[0])
  if (Number.isFinite(n)) return n
  const lead = v.match(/^(\d+)/)
  return lead ? Number(lead[1]) : 0
}

function javaHomeCandidates(): string[] {
  const out: string[] = []
  const push = (p?: string): void => {
    if (p && p.trim()) out.push(p.trim())
  }
  push(process.env.JAVA_HOME)

  const roots = [
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Eclipse Foundation',
    'C:\\Program Files\\Microsoft',
    'C:\\Program Files\\Zulu',
    'C:\\Program Files\\Amazon Corretto',
    'C:\\Program Files\\BellSoft',
    'C:\\Program Files\\Semeru',
    'C:\\Program Files\\JetBrains',
    'C:\\Program Files (x86)\\Java',
    'C:\\Program Files\\Common Files\\Oracle\\Java'
  ]
  for (const root of roots) {
    try {
      for (const name of readdirSync(root)) {
        const full = join(root, name)
        try {
          if (statSync(full).isDirectory()) {
            out.push(full)
            // JetBrains 的 jbr 子目录
            const jbr = join(full, 'jbr')
            if (name.toLowerCase().includes('jetbrains') || name.toLowerCase().includes('studio')) out.push(jbr)
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* 目录不存在 */
    }
  }

  // PATH 中的 java
  for (const dir of (process.env.PATH ?? '').split(';')) {
    if (dir && /java|jdk|jre/i.test(dir)) out.push(join(dir, '..'))
  }

  // 启动器自己下载的运行时
  try {
    const rt = join(runtimeRoot(), 'components')
    for (const name of readdirSync(rt)) out.push(join(rt, name))
  } catch {
    /* ignore */
  }
  return out
}

export function findJavaExe(home: string): string | null {
  const win = join(home, 'bin', 'javaw.exe')
  if (safeExists(win)) return win
  const plain = join(home, 'bin', 'java.exe')
  if (safeExists(plain)) return plain
  return null
}

function safeExists(p: string): boolean {
  try {
    statSync(p)
    return true
  } catch {
    return false
  }
}

let cache: JavaInfo[] | null = null

export async function listJavas(force = false): Promise<JavaInfo[]> {
  if (cache && !force) return cache
  const found = new Map<string, JavaInfo>()
  for (const home of javaHomeCandidates()) {
    const exe = findJavaExe(home)
    if (!exe) continue
    const rel = readReleaseFile(home)
    const major = rel ? majorFromVersionString(rel.version) : 0
    if (!major) continue
    const key = exe.toLowerCase()
    if (found.has(key)) continue
    found.set(key, {
      path: exe,
      major,
      version: rel?.version ?? String(major),
      vendor: rel?.vendor ?? 'Unknown',
      source: home.includes(runtimeRoot()) ? 'downloaded' : 'system',
      arch: ARCH_BITS
    })
  }
  cache = [...found.values()].sort((a, b) => b.major - a.major)
  log('java', `检测到 ${cache.length} 个 Java: ${cache.map((j) => j.major).join(', ')}`)
  return cache
}

export function invalidateJavaCache(): void {
  cache = null
}

/** 版本 JSON 要求的主版本号 */
export function requiredJavaMajor(vjson: VersionJson, mcVersion: string): number {
  if (vjson.javaVersion?.majorVersion) return vjson.javaVersion.majorVersion
  const v = mcVersion.replace(/^.*?(\d+\.\d+(?:\.\d+)?).*$/, '$1')
  const [maj, min, patch] = v.split('.').map((x) => Number(x))
  if (!Number.isFinite(maj)) return 21
  if (maj === 1) {
    if (min >= 20 && patch >= 5) return 21
    if (min >= 18) return 17
    if (min === 17) return 16
    if (min >= 12) return 8
    return 8
  }
  // 年份式版本（26.x 等）需要 Java 25
  return 25
}

interface RuntimeAllJson {
  [platform: string]: Record<string, RuntimeManifestEntry[]>
}

/**
 * 从 Mojang 运行时清单里按「主版本号」找对应组件。
 * 版本 JSON 里的 javaVersion.component 缺失时用它兜底，
 * 避免「要 Java 8 却给了系统里最新的 27」这种错配。
 */
export async function findComponentForMajor(major: number): Promise<string | null> {
  try {
    const all = await getJson<RuntimeAllJson>(JAVA_RUNTIME_MANIFEST)
    const plat = all[PLATFORM]
    if (!plat) return null
    const candidates = Object.entries(plat).filter(([, list]) => Array.isArray(list) && list.length > 0)
    for (const [name, list] of candidates) {
      // 一个组件可能有多个平台条目，逐个看版本号
      for (const entry of list) {
        const ver = entry.version?.name ?? ''
        if (ver && majorFromVersionString(ver) === major) return name
      }
    }
  } catch (e) {
    log('java', `读取运行时清单失败: ${e instanceof Error ? e.message : e}`)
  }
  return null
}

/** 从 Mojang 官方运行时清单下载指定组件（最贴合该 MC 版本的 JRE） */
export async function downloadMojangRuntime(component: string, task: TaskHandle): Promise<JavaInfo> {
  task.setPhase('下载 Java 运行时', component)
  const all = await getJson<RuntimeAllJson>(JAVA_RUNTIME_MANIFEST)
  const plat = all[PLATFORM]
  if (!plat) throw new Error(`官方运行时不支持平台 ${PLATFORM}`)
  const entries = plat[component]
  if (!entries || entries.length === 0) throw new Error(`官方清单里没有组件 ${component}`)
  const target = entries[0]
  if (!target.manifest?.url) throw new Error(`组件 ${component} 缺少 manifest`)

  const manifest = await getJson<{ files: Record<string, RuntimeFileEntry> }>(target.manifest.url)
  const home = join(runtimeRoot(), 'components', component)
  const items: Array<{ url: string; dest: string; sha1?: string; size?: number; label: string }> = []
  for (const [rel, entry] of Object.entries(manifest.files)) {
    const dest = join(home, rel)
    if (entry.type === 'directory') {
      await ensureDir(dest)
      continue
    }
    if (entry.type === 'link') continue
    const raw = entry.downloads?.raw
    if (!raw?.url) continue
    items.push({ url: raw.url, dest, sha1: raw.sha1, size: raw.size, label: rel })
  }
  await ensureDir(home)
  await downloadAll(
    items,
    {
      addBytes: (n) => task.addBytes(n),
      setTotal: (n) => task.setTotal(n),
      shouldStop: () => task.cancelRequested,
      setMessage: (m) => task.setMessage(m)
    },
    8
  )
  const exe = findJavaExe(home)
  if (!exe) throw new Error('运行时下载完成但找不到 javaw.exe')
  invalidateJavaCache()
  return {
    path: exe,
    major: majorFromVersionString(target.version?.name ?? String(component)),
    version: target.version?.name ?? component,
    vendor: 'Mojang (Eclipse Temurin)',
    source: 'downloaded'
  }
}

/** Adoptium 兜底下载 */
export async function downloadAdoptiumJre(major: number, task: TaskHandle): Promise<JavaInfo> {
  task.setPhase('下载 Java 运行时', `Temurin ${major}`)
  const arch = OS_ARCH === 'arm64' ? 'aarch64' : 'x64'
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/windows/${arch}/jre/hotspot/normal/eclipse`
  const zipPath = join(runtimeRoot(), `temurin-${major}.zip`)
  await ensureDir(runtimeRoot())
  await downloadAll(
    [{ url, dest: zipPath, label: `Temurin ${major}` }],
    {
      addBytes: (n) => task.addBytes(n),
      setTotal: (n) => task.setTotal(n),
      shouldStop: () => task.cancelRequested
    },
    1
  )
  const AdmZip = (await import('adm-zip')).default
  const zip = new AdmZip(zipPath)
  const dest = join(runtimeRoot(), 'components', `temurin-${major}`)
  await ensureDir(dest)
  zip.extractAllTo(dest, true)
  // 压缩包里通常有一层 jdk-xx 目录
  let home = dest
  const subs = readdirSync(dest).filter((n) => statSync(join(dest, n)).isDirectory())
  if (subs.length === 1) home = join(dest, subs[0])
  const exe = findJavaExe(home)
  if (!exe) throw new Error('Temurin 解压后找不到 javaw.exe')
  invalidateJavaCache()
  return { path: exe, major, version: `Temurin ${major}`, vendor: 'Eclipse Adoptium', source: 'downloaded' }
}

/** 找到一个满足 major 要求的 Java；没有则按配置自动下载 */
export async function ensureJava(
  requiredMajor: number,
  component: string | undefined,
  task: TaskHandle
): Promise<JavaInfo> {
  const list = await listJavas()
  // 优先精确匹配，其次差距不大的新版 JVM（向下兼容）
  const exact = list.filter((j) => j.major === requiredMajor)
  if (exact.length) return exact[0]
  const newer = list.filter((j) => j.major > requiredMajor).sort((a, b) => a.major - b.major)
  // 跨 3 个 LTS 以上容易不兼容，宁可下载
  if (newer.length && newer[0].major - requiredMajor <= 4) return newer[0]

  // 1) 用版本 JSON 指定的组件
  if (component) {
    try {
      return await downloadMojangRuntime(component, task)
    } catch (e) {
      log('java', `官方运行时 ${component} 下载失败: ${e instanceof Error ? e.message : e}`)
    }
  }
  // 2) 从官方清单里按主版本号找组件（component 缺失时的关键兜底）
  try {
    const auto = await findComponentForMajor(requiredMajor)
    if (auto && auto !== component) {
      log('java', `按主版本 ${requiredMajor} 匹配到官方组件 ${auto}`)
      return await downloadMojangRuntime(auto, task)
    }
  } catch (e) {
    log('java', `自动匹配官方组件失败: ${e instanceof Error ? e.message : e}`)
  }
  // 3) Adoptium 兜底（国内常不可达）
  try {
    return await downloadAdoptiumJre(requiredMajor, task)
  } catch (e) {
    log('java', `Adoptium 下载失败: ${e instanceof Error ? e.message : e}`)
  }
  if (list.length) {
    log('java', `所有下载途径失败，退化使用现有 Java ${list[0].major}`)
    return list[0]
  }
  throw new Error(
    `找不到可用的 Java ${requiredMajor}，自动下载也失败了。请手动安装 JDK ${requiredMajor} 或在设置里指定 java.exe`
  )
}

export async function javasExist(): Promise<boolean> {
  return (await listJavas()).length > 0
}

export { runPool }
