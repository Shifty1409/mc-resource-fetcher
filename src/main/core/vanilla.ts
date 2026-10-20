import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VanillaVersion } from '../../shared/types'
import { config } from './config'
import { getJson } from './http'
import { log } from './log'
import { cacheRoot, gamePaths, versionDir } from './paths'
import type { TaskHandle } from './tasks'
import { downloadAll } from './http'
import { ensureDir, pathExists, writeFileAtomic } from './util'
import type { AssetIndexRef, VersionJson } from './mcmeta'
import { libraryAllowed, resolveLibrary } from './mcmeta'

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

export interface VersionManifest {
  latest: { release: string; snapshot: string }
  versions: VanillaVersion[]
}

let manifestCache: { at: number; data: VersionManifest } | null = null

export async function fetchVersionManifest(force = false): Promise<VersionManifest> {
  const TTL = 10 * 60 * 1000
  if (!force && manifestCache && Date.now() - manifestCache.at < TTL) return manifestCache.data
  const cacheFile = join(cacheRoot(), 'version_manifest_v2.json')
  try {
    const data = await getJson<VersionManifest>(MANIFEST_URL, { retries: 2 })
    manifestCache = { at: Date.now(), data }
    void ensureDir(cacheRoot()).then(() => writeFileAtomic(cacheFile, JSON.stringify({ at: Date.now(), data })))
    return data
  } catch (e) {
    // 离线兜底：磁盘缓存
    try {
      const raw = JSON.parse(readFileSync(cacheFile, 'utf-8')) as { data: VersionManifest }
      log('vanilla', `在线获取版本清单失败，使用缓存: ${e instanceof Error ? e.message : e}`)
      manifestCache = { at: Date.now(), data: raw.data }
      return raw.data
    } catch {
      throw e
    }
  }
}

export async function fetchVersionJson(id: string, force = false): Promise<VersionJson> {
  const cacheFile = join(cacheRoot(), 'versions', `${id}.json`)
  if (!force) {
    try {
      return JSON.parse(readFileSync(cacheFile, 'utf-8')) as VersionJson
    } catch {
      /* 未缓存 */
    }
  }
  const manifest = await fetchVersionManifest()
  const entry = manifest.versions.find((v) => v.id === id)
  if (!entry) throw new Error(`找不到 MC 版本 ${id}`)
  const json = await getJson<VersionJson>(entry.url)
  await ensureDir(join(cacheRoot(), 'versions'))
  await writeFileAtomic(cacheFile, JSON.stringify(json))
  return json
}

/** 资源索引文件名必须是 index id（游戏按 --assetIndex 的值读取） */
export function assetIndexLocalPath(indexId: string): string {
  return join(gamePaths().assetIndexes, `${indexId}.json`)
}

export function clientJarPath(versionId: string): string {
  return join(versionDir(versionId), `${versionId}.jar`)
}

export function versionJsonPath(versionId: string): string {
  return join(versionDir(versionId), `${versionId}.json`)
}

export function readInstalledVersionJson(versionId: string): VersionJson | null {
  try {
    return JSON.parse(readFileSync(versionJsonPath(versionId), 'utf-8')) as VersionJson
  } catch {
    return null
  }
}

export async function isVanillaInstalled(versionId: string): Promise<boolean> {
  return (await pathExists(versionJsonPath(versionId))) && (await pathExists(clientJarPath(versionId)))
}

/** 下载原版核心文件（客户端 jar / 运行库 / 资源索引 / 全部资源 / 日志配置） */
export async function installVanilla(mcVersion: string, task: TaskHandle): Promise<VersionJson> {
  const gp = gamePaths()
  await ensureDir(gp.libraries)
  await ensureDir(gp.assetObjects)
  await ensureDir(gp.assetIndexes)
  await ensureDir(versionDir(mcVersion))

  task.setPhase('获取版本信息', mcVersion)
  const vjson = await fetchVersionJson(mcVersion, await isVanillaInstalled(mcVersion) ? false : true)
  task.checkCancel()

  // 1. 客户端 jar
  if (vjson.downloads?.client?.url) {
    task.setPhase('下载游戏本体', mcVersion)
    await downloadAll(
      [
        {
          url: vjson.downloads.client.url,
          dest: clientJarPath(mcVersion),
          sha1: vjson.downloads.client.sha1,
          size: vjson.downloads.client.size,
          label: 'client.jar'
        }
      ],
      {
        addBytes: (n) => task.addBytes(n),
        setTotal: (n) => task.setTotal(n + 1),
        shouldStop: () => task.cancelRequested,
        setMessage: (m) => task.setMessage(m)
      },
      config.get().concurrency
    )
  }
  task.checkCancel()

  // 2. 运行库
  task.setPhase('下载运行库', `${vjson.libraries?.length ?? 0} 个库`)
  const libItems = (vjson.libraries ?? [])
    .filter((l) => libraryAllowed(l))
    .map((l) => resolveLibrary(l, gp.libraries))
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .filter((x) => Boolean(x.url))
    .map((x) => ({ url: x.url as string, dest: x.path, sha1: x.sha1, size: x.size, label: x.name }))
  if (libItems.length) {
    await downloadAll(
      libItems,
      {
        addBytes: (n) => task.addBytes(n),
        setTotal: (n) => task.setTotal(n + 1),
        shouldStop: () => task.cancelRequested,
        setMessage: (m) => task.setMessage(m)
      },
      config.get().concurrency
    )
  }
  task.checkCancel()

  // 3. 资源索引
  const assetsId = vjson.assetIndex?.id ?? vjson.assets ?? mcVersion
  let index: { objects: Record<string, { hash: string; size: number }>; virtual?: boolean; map_to_resources?: boolean } | null = null
  if (vjson.assetIndex?.url) {
    task.setPhase('下载资源索引', assetsId)
    const indexPath = assetIndexLocalPath(assetsId)
    index = await getJson(vjson.assetIndex.url)
    await ensureDir(gp.assetIndexes)
    await writeFileAtomic(indexPath, JSON.stringify(index))
  }
  task.checkCancel()

  // 4. 资源对象
  if (index?.objects) {
    const entries = Object.entries(index.objects)
    task.setPhase('下载游戏资源', `${entries.length} 个文件`)
    const items = entries.map(([, o]) => {
      const sub = o.hash.slice(0, 2)
      return {
        url: `https://resources.download.minecraft.net/${sub}/${o.hash}`,
        dest: join(gp.assetObjects, sub, o.hash),
        sha1: o.hash,
        size: o.size,
        label: o.hash
      }
    })
    await downloadAll(
      items,
      {
        addBytes: (n) => task.addBytes(n),
        setTotal: (n) => task.setTotal(n + 1),
        shouldStop: () => task.cancelRequested,
        setMessage: (m) => task.setMessage(m)
      },
      config.get().concurrency
    )
  }
  task.checkCancel()

  // 5. 日志配置
  if (vjson.logging?.client?.file?.url) {
    task.setPhase('下载日志配置')
    const f = vjson.logging.client.file
    try {
      await downloadAll(
        [
          {
            url: f.url,
            dest: join(gp.assets, 'log_configs', f.id),
            sha1: f.sha1,
            size: f.size,
            label: f.id
          }
        ],
        {
          addBytes: (n) => task.addBytes(n),
          setTotal: (n) => task.setTotal(n + 1),
          shouldStop: () => task.cancelRequested
        },
        1
      )
    } catch (e) {
      log('vanilla', `日志配置下载失败（忽略）: ${e instanceof Error ? e.message : e}`)
    }
  }

  // 6. 写入版本 json（本地副本）
  await writeFileAtomic(versionJsonPath(mcVersion), JSON.stringify(vjson, null, 2))
  task.setMessage('原版安装完成')
  return vjson
}

export async function listLocalVersions(): Promise<string[]> {
  const dir = gamePaths().versions
  const { readdir } = await import('node:fs/promises')
  try {
    const items = await readdir(dir, { withFileTypes: true })
    return items.filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
}

export type { AssetIndexRef }
