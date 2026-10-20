import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import type { ContentKind, InstanceMeta, LoaderKind } from '../../shared/types'
import { config } from './config'
import { downloadAll, getJson } from './http'
import { log } from './log'
import { cacheRoot, instanceDir } from './paths'
import type { TaskHandle } from './tasks'
import { ensureDir, pathExists } from './util'
import { createInstance } from './instances'
import { installVersionStack } from './loaders'
import { pickModrinthFile } from './modrinth'
import { pickCurseforgeFile } from './curseforge'
import { hasCurseforgeKey } from './curseforge'

interface MrpackIndex {
  formatVersion: number
  name: string
  versionId?: string
  summary?: string
  files: Array<{
    path: string
    hashes: { sha1?: string; sha512?: string }
    env?: { client?: string; server?: string }
    downloads: string[]
    fileSize?: number
  }>
  dependencies: Record<string, string>
}

interface CfManifest {
  minecraft: { version: string; modLoaders: Array<{ id: string; primary: boolean }> }
  manifestType: string
  manifestVersion: number
  name: string
  version: string
  author: string
  files: Array<{ projectID: number; fileID: number; required: boolean }>
  overrides?: string
}

export interface ModpackInstallRequest {
  provider: 'modrinth' | 'curseforge'
  /** modrinth: project id；curseforge: mod id */
  projectId: string
  /** 可指定具体文件 */
  fileUrl?: string
  fileName?: string
  /** 实例显示名，默认用整合包名 */
  instanceName?: string
}

function ctxOf(task: TaskHandle): {
  addBytes: (n: number) => void
  setTotal: (n: number) => void
  shouldStop: () => boolean
  setMessage: (m: string) => void
} {
  return {
    addBytes: (n) => task.addBytes(n),
    setTotal: (n) => task.setTotal(n),
    shouldStop: () => task.cancelRequested,
    setMessage: (m) => task.setMessage(m)
  }
}

function loaderFromDependencies(deps: Record<string, string>): { loader: LoaderKind; version?: string } {
  if (deps['fabric-loader']) return { loader: 'fabric', version: deps['fabric-loader'] }
  if (deps['quilt-loader']) return { loader: 'quilt', version: deps['quilt-loader'] }
  if (deps['neoforge']) return { loader: 'neoforge', version: deps.neoforge }
  if (deps['forge']) return { loader: 'forge', version: deps.forge }
  return { loader: 'vanilla' }
}

function loaderFromCfId(id: string): { loader: LoaderKind; version?: string } {
  // 形如 forge-47.2.0 / fabric-0.15.11 / neoforge-21.1.80 / quilt-0.20.0
  const [kind, ...rest] = id.split('-')
  const version = rest.join('-')
  if (kind === 'forge') return { loader: 'forge', version }
  if (kind === 'fabric') return { loader: 'fabric', version }
  if (kind === 'neoforge') return { loader: 'neoforge', version }
  if (kind === 'quilt') return { loader: 'quilt', version }
  return { loader: 'vanilla' }
}

/** 解压 overrides 目录到实例 */
function extractOverrides(zip: AdmZip, prefix: string, destRoot: string): number {
  let count = 0
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    if (!entry.entryName.startsWith(`${prefix}/`)) continue
    const rel = entry.entryName.slice(prefix.length + 1)
    if (!rel) continue
    const out = join(destRoot, rel)
    mkdirSync(join(out, '..'), { recursive: true })
    try {
      writeFileSync(out, entry.getData())
      count++
    } catch {
      /* ignore */
    }
  }
  return count
}

export async function installModpack(
  req: ModpackInstallRequest,
  task: TaskHandle
): Promise<InstanceMeta> {
  // 1. 拿到整合包压缩包
  task.setPhase('获取整合包')
  let fileName = req.fileName
  let url = req.fileUrl
  if (!url) {
    const f2 =
      req.provider === 'modrinth'
        ? await pickModrinthFileLoose(req.projectId)
        : await pickCurseforgeFileLoose(req.projectId)
    if (!f2) throw new Error('找不到整合包文件')
    fileName = f2.fileName
    url = f2.url
  }
  if (!url) throw new Error('整合包下载地址为空')
  const work = join(cacheRoot(), 'modpacks')
  await ensureDir(work)
  const zipPath = join(work, `${Date.now()}-${fileName ?? 'pack.zip'}`)
  task.setPhase('下载整合包', fileName ?? '')
  await downloadAll([{ url, dest: zipPath, label: fileName }], ctxOf(task), 1)
  task.checkCancel()

  const zip = new AdmZip(zipPath)
  let mcVersion = ''
  let loader: LoaderKind = 'vanilla'
  let loaderVersion: string | undefined
  let packName = req.instanceName ?? (fileName ?? '整合包').replace(/\.(zip|mrpack)$/i, '')
  let files: Array<{ path: string; url: string; sha1?: string; size?: number }> = []

  // 2. 识别格式
  const mrEntry = zip.getEntry('modrinth.index.json')
  const cfEntry = zip.getEntry('manifest.json')
  const overridesPrefix = mrEntry ? 'overrides' : 'overrides'

  if (mrEntry) {
    const index = JSON.parse(mrEntry.getData().toString('utf-8')) as MrpackIndex
    mcVersion = index.dependencies.minecraft
    const l = loaderFromDependencies(index.dependencies)
    loader = l.loader
    loaderVersion = l.version
    packName = req.instanceName ?? index.name ?? packName
    files = (index.files ?? [])
      .filter((f) => f.env?.client !== 'unsupported')
      .filter((f) => f.downloads?.[0])
      .map((f) => ({ path: f.path, url: f.downloads[0], sha1: f.hashes?.sha1, size: f.fileSize }))
    task.log(`Modrinth 整合包 ${packName}: MC ${mcVersion} / ${loader} ${loaderVersion ?? ''}`)
  } else if (cfEntry) {
    if (!hasCurseforgeKey()) {
      throw new Error('该整合包是 CurseForge 格式，需要先在设置里填写 CurseForge API Key')
    }
    const manifest = JSON.parse(cfEntry.getData().toString('utf-8')) as CfManifest
    mcVersion = manifest.minecraft.version
    const primary = manifest.minecraft.modLoaders.find((m) => m.primary) ?? manifest.minecraft.modLoaders[0]
    const l = primary ? loaderFromCfId(primary.id) : { loader: 'vanilla' as LoaderKind }
    loader = l.loader
    loaderVersion = l.version
    packName = req.instanceName ?? manifest.name ?? packName
    task.setPhase('解析 CurseForge 文件列表', `${manifest.files.length} 个`)
    const cfKey = config.get().curseforgeApiKey?.trim() ?? ''
    for (const f of manifest.files) {
      if (!f.required) continue
      try {
        const res = await getJson<{
          data: {
            downloadUrl: string | null
            fileName: string
            fileLength: number
            hashes?: Array<{ value: string; algo: number }>
          }
        }>(`https://api.curseforge.com/v1/mods/${f.projectID}/files/${f.fileID}`, {
          headers: { 'x-api-key': cfKey }
        })
        const d = res.data
        if (!d.downloadUrl) continue
        files.push({
          path: `mods/${d.fileName}`,
          url: d.downloadUrl,
          sha1: d.hashes?.find((h) => h.algo === 1)?.value,
          size: d.fileLength
        })
      } catch (e) {
        log('modpack', `CurseForge 文件 ${f.projectID}/${f.fileID} 解析失败: ${e instanceof Error ? e.message : e}`)
      }
    }
    task.log(`CurseForge 整合包 ${packName}: MC ${mcVersion} / ${loader} ${loaderVersion ?? ''}`)
  } else {
    throw new Error('无法识别的整合包格式（需要 modrinth.index.json 或 manifest.json）')
  }

  if (!mcVersion) throw new Error('整合包缺少 Minecraft 版本信息')

  // 3. 安装 原版 + 加载器
  const stack = await installVersionStack(
    { mcVersion, loader, loaderVersion: loaderVersion },
    task
  )
  task.checkCancel()

  // 4. 建实例
  const inst = await createInstance({
    name: packName,
    mcVersion,
    loader,
    loaderVersion: stack.loaderVersion,
    versionId: stack.versionId
  })
  const dir = instanceDir(inst.id)
  task.setPhase('写入整合包内容', `${files.length} 个文件`)
  if (files.length) {
    await downloadAll(
      files.map((f) => ({ url: f.url, dest: join(dir, f.path), sha1: f.sha1, size: f.size, label: f.path })),
      ctxOf(task)
    )
  }
  task.checkCancel()

  // 5. overrides
  task.setPhase('解压覆盖文件')
  const od = overridesPrefix
  const hasOverrides = zip.getEntries().some((e) => e.entryName.startsWith(`${od}/`))
  if (hasOverrides) {
    const n = extractOverrides(zip, od, dir)
    task.log(`覆盖文件 ${n} 个`)
  }
  await rm(zipPath, { force: true }).catch(() => undefined)
  task.setMessage(`整合包 ${packName} 安装完成`)
  log('modpack', `安装完成 ${packName} → ${dir}`)
  return inst
}

async function pickModrinthFileLoose(projectId: string): Promise<{ url: string; fileName: string } | null> {
  const versions = await getJson<Array<{ files: Array<{ url: string; filename: string; primary: boolean }> }>>(
    `https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version`
  )
  const v = versions[0]
  const f = v?.files.find((x) => x.primary) ?? v?.files[0]
  return f ? { url: f.url, fileName: f.filename } : null
}

async function pickCurseforgeFileLoose(projectId: string): Promise<{ url: string; fileName: string } | null> {
  const key = config.get().curseforgeApiKey?.trim()
  if (!key) return null
  const res = await getJson<{ data: Array<{ downloadUrl: string | null; fileName: string }> }>(
    `https://api.curseforge.com/v1/mods/${projectId}/files?pageSize=10`,
    { headers: { 'x-api-key': key } }
  )
  const f = res.data.find((x) => x.downloadUrl)
  return f?.downloadUrl ? { url: f.downloadUrl, fileName: f.fileName } : null
}
