import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import type { ContentKind, InstanceMeta } from '../../shared/types'
import { downloadAll, type DlItem } from './http'
import { instanceDir } from './paths'
import type { TaskHandle } from './tasks'
import { ensureDir, pathExists, safeName } from './util'
import { pickModrinthFile, getModrinthDetail, getModrinthFileByVersion, pickModrinthFileWithDeps, getModrinthVersion } from './modrinth'
import { pickCurseforgeFile } from './curseforge'
import { log } from './log'

/** 内容类型 → 实例内目录 */
export function targetDir(kind: ContentKind): string {
  switch (kind) {
    case 'mod':
      return 'mods'
    case 'resourcepack':
      return 'resourcepacks'
    case 'shader':
      return 'shaderpacks'
    case 'datapack':
      return 'datapacks'
    case 'world':
      return 'saves'
    case 'modpack':
      return 'modpacks'
    default:
      return 'mods'
  }
}

export interface InstallContentRequest {
  instanceId: string
  provider: 'modrinth' | 'curseforge'
  projectId: string
  kind: ContentKind
  /** 指定具体文件（详情页选择） */
  fileUrl?: string
  fileName?: string
  fileSha1?: string
  fileSize?: number
  /** Modrinth version id，用于解析依赖 */
  versionId?: string
  /** 是否自动安装 required 依赖（默认 true） */
  withDependencies?: boolean
}

export interface InstallContentResult {
  fileName: string
  dest: string
  relative: string
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

/** 递归收集 Modrinth 的 required 依赖（最多 6 层） */
async function collectDeps(
  root: { versionId?: string; projectId: string },
  inst: InstanceMeta,
  task: TaskHandle,
  seen: Set<string>,
  depth: number
): Promise<DlItem[]> {
  if (depth > 6) return []
  let deps: Array<{ version_id: string | null; project_id: string | null; dependency_type: string }> = []
  if (root.versionId) {
    try {
      const v = await getModrinthVersion(root.versionId)
      deps = v.dependencies ?? []
    } catch (e) {
      log('content', `读取依赖失败 ${root.projectId}: ${e instanceof Error ? e.message : e}`)
    }
  }
  const items: DlItem[] = []
  const loader = inst.loader === 'vanilla' ? undefined : inst.loader
  for (const dep of deps) {
    if (dep.dependency_type !== 'required' || !dep.project_id) continue
    if (seen.has(dep.project_id)) continue
    seen.add(dep.project_id)
    task.checkCancel()
    let file = null as Awaited<ReturnType<typeof pickModrinthFileWithDeps>> | null
    if (dep.version_id) {
      const exact = await getModrinthFileByVersion(dep.version_id).catch(() => null)
      if (exact && (exact.gameVersions.length === 0 || exact.gameVersions.includes(inst.mcVersion))) {
        file = exact
      }
    }
    if (!file) file = await pickModrinthFileWithDeps(dep.project_id, inst.mcVersion, loader)
    if (!file) continue
    task.log(`依赖：${file.fileName}`)
    items.push({
      url: file.url,
      dest: join(instanceDir(inst.id), 'mods', safeName(file.fileName)),
      sha1: file.sha1,
      size: file.size,
      label: file.fileName
    })
    items.push(
      ...(await collectDeps(
        { versionId: file.versionId, projectId: dep.project_id },
        inst,
        task,
        seen,
        depth + 1
      ))
    )
  }
  return items
}

export async function installContent(
  inst: InstanceMeta,
  req: InstallContentRequest,
  task: TaskHandle
): Promise<InstallContentResult> {
  const dir = instanceDir(inst.id)
  task.setPhase('解析下载地址')

  let fileName = req.fileName
  let url = req.fileUrl
  let sha1 = req.fileSha1
  let size = req.fileSize
  let versionId = req.versionId

  if (!url) {
    if (req.provider === 'modrinth') {
      const f = await pickModrinthFileWithDeps(
        req.projectId,
        inst.mcVersion,
        inst.loader === 'vanilla' ? undefined : inst.loader
      )
      if (!f) throw new Error('没有找到适配该实例的游戏版本 / 加载器的文件')
      fileName = f.fileName
      url = f.url
      sha1 = f.sha1
      size = f.size
      versionId = f.versionId
      task.log(`选中 ${f.versionName} · ${f.fileName}`)
    } else {
      const f = await pickCurseforgeFile(
        req.projectId,
        inst.mcVersion,
        inst.loader === 'vanilla' ? undefined : inst.loader
      )
      if (!f) throw new Error('CurseForge 上没有可用文件')
      fileName = f.fileName
      url = f.url
      sha1 = f.sha1
      size = f.size
    }
  }
  if (!url) throw new Error('下载地址为空')
  task.checkCancel()

  if (req.kind === 'world') {
    return await installWorld(dir, url, fileName ?? 'world.zip', task, sha1, size)
  }

  const rel = join(targetDir(req.kind), safeName(fileName ?? 'download.jar'))
  const dest = join(dir, rel)
  const items: DlItem[] = []

  // 模组：自动补齐 required 依赖（否则 JEI 之类的模组会直接拒绝启动）
  if (req.withDependencies !== false && req.provider === 'modrinth' && req.kind === 'mod') {
    task.setPhase('解析依赖')
    const seen = new Set<string>([req.projectId])
    try {
      items.push(...(await collectDeps({ versionId, projectId: req.projectId }, inst, task, seen, 0)))
    } catch (e) {
      log('content', `依赖解析失败（继续装本体）: ${e instanceof Error ? e.message : e}`)
    }
  }

  items.push({ url, dest, sha1, size, label: fileName })
  // 去重（同一目标文件只下一次）
  const unique = new Map(items.map((i) => [i.dest, i]))
  const list = [...unique.values()]

  task.setPhase('下载文件', `${list.length} 个文件`)
  await downloadAll(list, ctxOf(task), Math.min(4, list.length))
  task.setMessage(
    list.length > 1 ? `已安装 ${list.length} 个文件（含依赖）到 ${targetDir(req.kind)}/` : `已安装到 ${targetDir(req.kind)}/`
  )
  return { fileName: fileName ?? '', dest, relative: rel }
}

async function installWorld(
  instDirPath: string,
  url: string,
  fileName: string,
  task: TaskHandle,
  sha1?: string,
  size?: number
): Promise<InstallContentResult> {
  const tmpZip = join(instDirPath, '.downloads', safeName(fileName))
  task.setPhase('下载地图', fileName)
  await downloadAll([{ url, dest: tmpZip, sha1, size, label: fileName }], ctxOf(task), 1)
  task.checkCancel()
  task.setPhase('解压地图')
  const zip = new AdmZip(tmpZip)
  const entries = zip.getEntries()
  // 判断是否有单一根目录
  const roots = new Set<string>()
  for (const e of entries) {
    const first = e.entryName.split('/')[0]
    if (first) roots.add(first)
  }
  const singleRoot = roots.size === 1 && entries.some((e) => e.entryName.includes('/'))
  const destName = safeName(singleRoot ? [...roots][0] : fileName.replace(/\.(zip|jar|mrpack)$/i, ''))
  const savesDir = join(instDirPath, 'saves')
  await ensureDir(savesDir)
  let dest = join(savesDir, destName)
  let n = 2
  while (await pathExists(join(dest, 'level.dat'))) {
    dest = join(savesDir, `${destName}-${n++}`)
  }
  await ensureDir(dest)
  if (singleRoot) {
    // 去掉外层目录
    for (const e of entries) {
      if (e.isDirectory) continue
      const rel = e.entryName.split('/').slice(1).join('/')
      if (!rel) continue
      const out = join(dest, rel)
      await ensureDir(join(out, '..'))
      zip.extractEntryTo(e, dest, true, true)
    }
  } else {
    zip.extractAllTo(dest, true)
  }
  task.setMessage(`已解压到 saves/${destName}`)
  log('content', `地图安装到 ${dest}`)
  return { fileName, dest, relative: join('saves', destName) }
}

/** 已安装的内容文件名，用于 UI 标记 */
export async function listInstalled(instId: string): Promise<Record<ContentKind, string[]>> {
  const dir = instanceDir(instId)
  const read = async (sub: string): Promise<string[]> => {
    try {
      return (await readdir(join(dir, sub))).filter((f) => !f.startsWith('.'))
    } catch {
      return []
    }
  }
  return {
    mod: await read('mods'),
    resourcepack: await read('resourcepacks'),
    shader: await read('shaderpacks'),
    datapack: await read('datapacks'),
    world: await read('saves'),
    modpack: []
  }
}

export async function getProjectTitle(
  provider: 'modrinth' | 'curseforge',
  projectId: string,
  kind: ContentKind
): Promise<string> {
  try {
    if (provider === 'modrinth') {
      const d = await getModrinthDetail(projectId, kind)
      return d.title
    }
    const { getCurseforgeDetail } = await import('./curseforge')
    const d = await getCurseforgeDetail(projectId, kind)
    return d.title
  } catch {
    return projectId
  }
}
