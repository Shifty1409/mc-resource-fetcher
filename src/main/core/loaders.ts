import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import type { LoaderKind, LoaderVersion } from '../../shared/types'
import { config } from './config'
import { downloadAll, getJson, getText } from './http'
import { log } from './log'
import { cacheRoot, gamePaths, runtimeRoot, versionDir } from './paths'
import { runToLog } from './proc'
import type { TaskHandle } from './tasks'
import { ensureDir, pathExists, writeFileAtomic } from './util'
import type { VersionJson } from './mcmeta'
import { fetchVersionJson, installVanilla } from './vanilla'
import { ensureJava, listJavas } from './java'
import { requiredJavaMajor } from './java'

const FABRIC_META = 'https://meta.fabricmc.net'
const QUILT_META = 'https://meta.quiltmc.org'
const FORGE_META = 'https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json'
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge'
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged'

interface FabricLoaderEntry {
  loader: { version: string; stable?: boolean }
  intermediary?: { version: string }
}

export async function listFabricLoaders(mcVersion: string): Promise<LoaderVersion[]> {
  const list = await getJson<FabricLoaderEntry[]>(`${FABRIC_META}/v2/versions/loader/${encodeURIComponent(mcVersion)}`)
  return list
    .map((e) => ({ version: e.loader.version, stable: e.loader.stable !== false }))
    .sort((a, b) => compareVersions(b.version, a.version))
}

interface QuiltLoaderEntry {
  loader: { version: string }
}

export async function listQuiltLoaders(mcVersion: string): Promise<LoaderVersion[]> {
  const list = await getJson<QuiltLoaderEntry[]>(`${QUILT_META}/v3/versions/loader/${encodeURIComponent(mcVersion)}`)
  return list.map((e) => ({ version: e.loader.version, stable: !e.loader.version.includes('-') }))
}

export async function listForgeVersions(mcVersion: string): Promise<LoaderVersion[]> {
  // 只保留正式版（形如 1.20.1-47.2.0，排除 -beta 之类仍保留但标记为非稳定）
  const meta = await getJson<Record<string, string[]>>(FORGE_META)
  const raw = meta[mcVersion] ?? []
  return raw
    .map((full) => {
      const v = full.startsWith(`${mcVersion}-`) ? full.slice(mcVersion.length + 1) : full
      return { version: v, stable: !/beta|alpha/i.test(v) }
    })
    .sort((a, b) => compareVersions(b.version, a.version))
}

function neoforgePrefix(mcVersion: string): string[] {
  // 1.21.1 → 21.1. ; 1.20.4 → 20.4. ; 1.21 → 21.0.
  const m = mcVersion.match(/^1\.(\d+)(?:\.(\d+))?$/)
  if (!m) return []
  const major = m[1]
  const minor = m[2]
  return minor ? [`${major}.${minor}.`] : [`${major}.0.`]
}

/** NeoForge 在 1.20.1 时代用 net/neoforged/forge 且版本号带 MC 前缀 */
async function listNeoForgeVersionsInner(mcVersion: string): Promise<LoaderVersion[]> {
  const out: LoaderVersion[] = []
  if (mcVersion === '1.20.1') {
    const xml = await getText(`${NEOFORGE_MAVEN}/forge/maven-metadata.xml`)
    const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])
    for (const v of versions) {
      if (v.startsWith('1.20.1-')) out.push({ version: v.slice('1.20.1-'.length), stable: !/beta/i.test(v) })
    }
  } else {
    const xml = await getText(`${NEOFORGE_MAVEN}/neoforge/maven-metadata.xml`)
    const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])
    const prefixes = neoforgePrefix(mcVersion)
    for (const v of versions) {
      if (prefixes.some((p) => v.startsWith(p))) out.push({ version: v, stable: !/beta/i.test(v) })
    }
  }
  return out.sort((a, b) => compareVersions(b.version, a.version))
}

export async function listNeoForgeVersions(mcVersion: string): Promise<LoaderVersion[]> {
  return listNeoForgeVersionsInner(mcVersion)
}

export async function listLoaderVersions(kind: LoaderKind, mcVersion: string): Promise<LoaderVersion[]> {
  switch (kind) {
    case 'fabric':
      return listFabricLoaders(mcVersion)
    case 'quilt':
      return listQuiltLoaders(mcVersion)
    case 'forge':
      return listForgeVersions(mcVersion)
    case 'neoforge':
      return listNeoForgeVersions(mcVersion)
    case 'vanilla':
      return [{ version: mcVersion, stable: true }]
    default:
      return []
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.\-_+]/).map((x) => (Number.isFinite(Number(x)) ? Number(x) : x))
  const pb = b.split(/[.\-_+]/).map((x) => (Number.isFinite(Number(x)) ? Number(x) : x))
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i]
    const y = pb[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x - y
    } else {
      const sx = String(x)
      const sy = String(y)
      if (sx !== sy) return sx < sy ? -1 : 1
    }
  }
  return 0
}

/* ---------------- 安装实现 ---------------- */

export interface LoaderInstallResult {
  versionId: string
  loaderVersion: string
}

const ctxOf = (task: TaskHandle): {
  addBytes: (n: number) => void
  setTotal: (n: number) => void
  shouldStop: () => boolean
  setMessage: (m: string) => void
} => ({
  addBytes: (n) => task.addBytes(n),
  setTotal: (n) => task.setTotal(n),
  shouldStop: () => task.cancelRequested,
  setMessage: (m) => task.setMessage(m)
})

/** 把一个 profile 形式的版本 json 落到 versions/<id>/<id>.json */
async function writeProfileVersion(profile: VersionJson & { id: string }): Promise<string> {
  const dir = versionDir(profile.id)
  await ensureDir(dir)
  await writeFileAtomic(join(dir, `${profile.id}.json`), JSON.stringify(profile, null, 2))
  return profile.id
}

export async function installFabric(
  mcVersion: string,
  loaderVersion: string | undefined,
  task: TaskHandle
): Promise<LoaderInstallResult> {
  task.setPhase('获取 Fabric 版本', mcVersion)
  let ver = loaderVersion
  if (!ver) {
    const list = await listFabricLoaders(mcVersion)
    const stable = list.find((l) => l.stable)
    if (!stable) throw new Error(`Fabric 没有支持 ${mcVersion} 的加载器`)
    ver = stable.version
  }
  task.setMessage(`Fabric ${ver}`)
  const profile = await getJson<VersionJson & { id: string }>(
    `${FABRIC_META}/v2/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(ver)}/profile/json`
  )
  const versionId = await writeProfileVersion(profile)
  return { versionId, loaderVersion: ver }
}

export async function installQuilt(
  mcVersion: string,
  loaderVersion: string | undefined,
  task: TaskHandle
): Promise<LoaderInstallResult> {
  task.setPhase('获取 Quilt 版本', mcVersion)
  let ver = loaderVersion
  if (!ver) {
    const list = await listQuiltLoaders(mcVersion)
    if (!list.length) throw new Error(`Quilt 没有支持 ${mcVersion} 的加载器`)
    ver = list.find((l) => l.stable)?.version ?? list[0].version
  }
  task.setMessage(`Quilt ${ver}`)
  const profile = await getJson<VersionJson & { id: string }>(
    `${QUILT_META}/v3/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(ver)}/profile/json`
  )
  const versionId = await writeProfileVersion(profile)
  return { versionId, loaderVersion: ver }
}

async function ensureLauncherProfiles(): Promise<void> {
  const p = join(gamePaths().root, 'launcher_profiles.json')
  if (await pathExists(p)) return
  await writeFileAtomic(
    p,
    JSON.stringify({ profiles: {}, settings: {}, version: 3 }, null, 2)
  )
}

interface InstallerLibrary {
  name?: string
  downloads?: {
    artifact?: { path?: string; url?: string; sha1?: string; size?: number }
  }
}

/**
 * 官方 installer（Forge / NeoForge）会强制从 maven.minecraftforge.net /
 * maven.neoforged.net 直连下载依赖，国内常常超时或拒绝连接。
 * 这里先解析 installer jar 里的 install_profile.json / version.json，
 * 用我们自己的下载器（带 BMCLAPI 镜像与校验）把这些库预取到 libraries/，
 * installer 发现文件已存在且校验通过就会跳过下载。
 */
async function prefetchInstallerLibraries(jarPath: string, task: TaskHandle): Promise<number> {
  let zip: AdmZip
  try {
    zip = new AdmZip(jarPath)
  } catch {
    return 0
  }
  const found = new Map<string, { url: string; sha1?: string; size?: number }>()
  for (const fileName of ['install_profile.json', 'version.json']) {
    const entry = zip.getEntry(fileName)
    if (!entry) continue
    try {
      const json = JSON.parse(entry.getData().toString('utf-8')) as { libraries?: InstallerLibrary[] }
      for (const lib of json.libraries ?? []) {
        const a = lib.downloads?.artifact
        if (!a?.url || !a.path) continue
        found.set(a.path, { url: a.url, sha1: a.sha1, size: a.size })
      }
    } catch (e) {
      log('loader', `解析 ${fileName} 失败: ${e instanceof Error ? e.message : e}`)
    }
  }
  if (!found.size) return 0
  const items = [...found.entries()].map(([rel, v]) => ({
    url: v.url,
    dest: join(gamePaths().libraries, rel),
    sha1: v.sha1,
    size: v.size,
    label: rel
  }))
  task.setPhase('预取安装器依赖', `${items.length} 个库`)
  await downloadAll(items, ctxOf(task), config.get().concurrency)
  log('loader', `安装器依赖预取完成 ${items.length} 个`)
  return items.length
}

/** 跑官方 installer（Forge / NeoForge 都走这条路），返回安装出的版本目录名 */
async function runInstaller(
  jarUrl: string,
  jarName: string,
  task: TaskHandle,
  installJavaMajor: number
): Promise<string> {
  const cacheJar = join(cacheRoot(), 'installers', jarName)
  task.setPhase('下载安装器', jarName)
  await downloadAll([{ url: jarUrl, dest: cacheJar, label: jarName }], ctxOf(task), 1)
  task.checkCancel()

  // 先把 installer 需要的库拉齐（走镜像），避免 installer 直连国外 maven 超时
  try {
    const n = await prefetchInstallerLibraries(cacheJar, task)
    if (n > 0) task.log(`已预取 ${n} 个依赖库`)
  } catch (e) {
    task.log(`依赖预取失败（继续尝试）：${e instanceof Error ? e.message : e}`)
  }
  task.checkCancel()

  const java = await ensureJava(installJavaMajor, undefined, task)
  task.setPhase('运行安装器', `Java ${java.major}`)
  await ensureLauncherProfiles()

  const before = new Set(await listDirs(gamePaths().versions))
  const logFile = join(runtimeRoot(), 'installer-logs', `${jarName}.log`)
  const res = await runToLog(
    java.path,
    ['-jar', cacheJar, '--installClient', gamePaths().root],
    {
      cwd: gamePaths().root,
      logFile,
      onLine: (line) => task.log(line)
    }
  )
  const after = await listDirs(gamePaths().versions)
  const created = after.filter((d) => !before.has(d))
  task.checkCancel()
  if (res.code !== 0) {
    throw new Error(
      `安装器退出码 ${res.code}，详见日志。${created.length ? '' : '可能原因：网络无法访问 maven.minecraftforge.net 或 Java 版本不匹配。'}`
    )
  }
  if (created.length === 0) {
    // 可能已安装过：用预期名字兜底
    const fallback = after.find((d) => d.includes('forge'))
    if (fallback) return fallback
    throw new Error('安装器没有生成版本目录，请查看日志')
  }
  // 优先返回带 forge/neoforge 的那个（安装器还会生成 base 版本）
  const real = created.find((d) => /forge/i.test(d)) ?? created[0]
  return real
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}

export async function installForge(
  mcVersion: string,
  loaderVersion: string | undefined,
  task: TaskHandle
): Promise<LoaderInstallResult> {
  task.setPhase('获取 Forge 版本', mcVersion)
  let ver = loaderVersion
  if (!ver) {
    const list = await listForgeVersions(mcVersion)
    const stable = list.find((l) => l.stable)
    if (!stable) throw new Error(`Forge 没有支持 ${mcVersion} 的版本`)
    ver = stable.version
  }
  const full = `${mcVersion}-${ver}`
  const jarName = `forge-${full}-installer.jar`
  const vjson = await fetchVersionJson(mcVersion)
  const javaMajor = requiredJavaMajor(vjson, mcVersion)
  const versionId = await runInstaller(`${FORGE_MAVEN}/${full}/${jarName}`, jarName, task, javaMajor)
  return { versionId, loaderVersion: ver }
}

export async function installNeoForge(
  mcVersion: string,
  loaderVersion: string | undefined,
  task: TaskHandle
): Promise<LoaderInstallResult> {
  task.setPhase('获取 NeoForge 版本', mcVersion)
  let ver = loaderVersion
  if (!ver) {
    const list = await listNeoForgeVersions(mcVersion)
    const stable = list.find((l) => l.stable)
    if (!stable) throw new Error(`NeoForge 没有支持 ${mcVersion} 的版本`)
    ver = stable.version
  }
  const vjson = await fetchVersionJson(mcVersion)
  const javaMajor = requiredJavaMajor(vjson, mcVersion)
  let url: string
  let jarName: string
  if (mcVersion === '1.20.1') {
    const full = `1.20.1-${ver}`
    jarName = `forge-${full}-installer.jar`
    url = `${NEOFORGE_MAVEN}/forge/${full}/${jarName}`
  } else {
    jarName = `neoforge-${ver}-installer.jar`
    url = `${NEOFORGE_MAVEN}/neoforge/${ver}/${jarName}`
  }
  const versionId = await runInstaller(url, jarName, task, javaMajor)
  return { versionId, loaderVersion: ver }
}

export interface FullInstallRequest {
  mcVersion: string
  loader: LoaderKind
  loaderVersion?: string
}

/** 原版 → 加载器，完整安装链 */
export async function installVersionStack(req: FullInstallRequest, task: TaskHandle): Promise<LoaderInstallResult> {
  task.setPhase('安装原版', req.mcVersion)
  await installVanilla(req.mcVersion, task)
  task.checkCancel()
  if (req.loader === 'vanilla') {
    return { versionId: req.mcVersion, loaderVersion: req.mcVersion }
  }
  const result =
    req.loader === 'fabric'
      ? await installFabric(req.mcVersion, req.loaderVersion, task)
      : req.loader === 'quilt'
        ? await installQuilt(req.mcVersion, req.loaderVersion, task)
        : req.loader === 'forge'
          ? await installForge(req.mcVersion, req.loaderVersion, task)
          : await installNeoForge(req.mcVersion, req.loaderVersion, task)
  // 确认版本 json 存在
  const p = join(versionDir(result.versionId), `${result.versionId}.json`)
  if (!(await pathExists(p))) throw new Error(`加载器安装失败：缺少 ${p}`)
  log('loader', `安装完成 ${result.versionId} (Java ${(await listJavas()).length} 个可用)`)
  return result
}
