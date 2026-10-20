import { createHash } from 'node:crypto'
import { cpSync, readdirSync, rmSync, copyFileSync, existsSync } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { InstanceMeta, LaunchResult } from '../../shared/types'
import { appVersion } from './host'
import { config } from './config'
import { downloadAll } from './http'
import { log } from './log'
import { gamePaths, instanceDir, versionDir } from './paths'
import { spawnToLog, type RunningProcess } from './proc'
import type { TaskHandle } from './tasks'
import { ensureDir, pathExists, stamp } from './util'
import type { Library, VersionJson } from './mcmeta'
import { flattenArgs, libKind, libraryAllowed, mergeVersion, resolveLibrary } from './mcmeta'
import { ensureJava, requiredJavaMajor } from './java'
import { fetchVersionJson, readInstalledVersionJson } from './vanilla'
import AdmZip from 'adm-zip'

export function offlineUuid(name: string): string {
  const h = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  h[6] = (h[6] & 0x0f) | 0x30
  h[8] = (h[8] & 0x3f) | 0x80
  const hex = h.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** 沿 inheritsFrom 链合并出最终版本描述 */
export async function resolveVersionChain(versionId: string): Promise<VersionJson> {
  let current = readInstalledVersionJson(versionId) ?? (await fetchVersionJson(versionId))
  const seen = new Set<string>([versionId])
  let rootId = versionId
  let guard = 0
  while (current.inheritsFrom && guard++ < 8) {
    const parentId = current.inheritsFrom
    if (seen.has(parentId)) break
    seen.add(parentId)
    const parent = readInstalledVersionJson(parentId) ?? (await fetchVersionJson(parentId))
    current = mergeVersion(parent, { ...current, inheritsFrom: undefined })
    rootId = parentId
  }
  return { ...current, __rootId: rootId } as VersionJson & { __rootId: string }
}

/** 找出该版本实际使用的客户端 jar */
function clientJarFor(merged: VersionJson & { __rootId?: string }, versionId: string): string {
  const explicit = merged.jar
  if (explicit) return join(versionDir(explicit), `${explicit}.jar`)
  const rootId = merged.__rootId ?? versionId
  return join(versionDir(rootId), `${rootId}.jar`)
}

/** 解压原生库到 versions/<id>/natives */
export async function extractNatives(
  merged: VersionJson,
  versionId: string,
  task?: TaskHandle
): Promise<string> {
  const gp = gamePaths()
  const nativesDir = join(versionDir(versionId), 'natives')
  await ensureDir(nativesDir)
  const libs = (merged.libraries ?? []).filter((l) => libraryAllowed(l))
  const natives = libs.filter((l) => libKind(l) !== 'artifact')
  // 每次启动重新解压，避免上一版本残留（成本很低）
  try {
    for (const f of readdirSync(nativesDir)) rmSync(join(nativesDir, f), { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  for (const lib of natives) {
    const resolved = resolveLibrary(lib, gp.libraries)
    if (!resolved) continue
    if (!(await pathExists(resolved.path))) {
      if (resolved.url) {
        await downloadAll(
          [{ url: resolved.url, dest: resolved.path, sha1: resolved.sha1, size: resolved.size, label: lib.name }],
          {
            addBytes: (n) => task?.addBytes(n),
            setTotal: () => undefined,
            shouldStop: () => task?.cancelRequested ?? false
          },
          1
        )
      } else {
        continue
      }
    }
    try {
      const zip = new AdmZip(resolved.path)
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue
        const name = entry.entryName
        if (/^META-INF\//i.test(name)) continue
        if (resolved.extractExclude.some((ex) => name.startsWith(ex))) continue
        const dest = join(nativesDir, name.replace(/^.*[\\/]/, ''))
        await ensureDir(join(dest, '..'))
        zip.extractEntryTo(entry, nativesDir, false, true)
      }
    } catch (e) {
      log('launch', `解压原生库失败 ${lib.name}: ${e instanceof Error ? e.message : e}`)
    }
  }
  return nativesDir
}

/** 老版本（1.6~1.7）资源需要展开成虚拟目录或资源包 */
async function prepareLegacyAssets(
  merged: VersionJson,
  instDir: string
): Promise<string | null> {
  const gp = gamePaths()
  const indexId = merged.assetIndex?.id ?? merged.assets
  if (!indexId) return null
  const indexPath = join(gp.assetIndexes, `${indexId}.json`)
  if (!(await pathExists(indexPath))) return null
  let index: { objects: Record<string, { hash: string }>; virtual?: boolean; map_to_resources?: boolean }
  try {
    index = JSON.parse(await (await import('node:fs/promises')).readFile(indexPath, 'utf-8'))
  } catch {
    return null
  }
  if (!index.virtual && !index.map_to_resources) return null
  const targetRoot = index.map_to_resources
    ? join(instDir, 'resources')
    : join(gp.assets, 'virtual', indexId)
  await ensureDir(targetRoot)
  let copied = 0
  for (const [name, obj] of Object.entries(index.objects)) {
    const src = join(gp.assetObjects, obj.hash.slice(0, 2), obj.hash)
    if (!existsSync(src)) continue
    const dest = join(targetRoot, name)
    await ensureDir(join(dest, '..'))
    try {
      copyFileSync(src, dest)
      copied++
    } catch {
      /* ignore */
    }
  }
  log('launch', `展开旧版资源 ${copied} 个 → ${targetRoot}`)
  return index.virtual ? targetRoot : null
}

export interface LaunchCallbacks {
  onLine?: (line: string) => void
  onExit?: (code: number | null) => void
}

export interface LaunchOutcome {
  result: LaunchResult
  process?: RunningProcess
  commandLine?: string
}

function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{([^}]+)\}/g, (m, key: string) => {
    const v = vars[key]
    return v === undefined ? m : v
  })
}

export async function launchInstance(
  inst: InstanceMeta,
  task: TaskHandle,
  cb: LaunchCallbacks = {}
): Promise<LaunchOutcome> {
  const gp = gamePaths()
  const instDir = instanceDir(inst.id)
  await ensureDir(instDir)

  task.setPhase('解析版本', inst.versionId)
  const merged = (await resolveVersionChain(inst.versionId)) as VersionJson & {
    __rootId?: string
  }
  if (!merged.mainClass) throw new Error(`版本 ${inst.versionId} 缺少 mainClass，安装可能不完整`)

  const rootId = merged.__rootId ?? inst.versionId
  const jarPath = clientJarFor(merged, inst.versionId)
  if (!(await pathExists(jarPath))) {
    throw new Error(`缺少客户端 jar: ${jarPath}。请重新安装该版本。`)
  }

  task.setPhase('准备运行库')
  const nativesDir = await extractNatives(merged, inst.versionId, task)

  // 缺失的运行库补下载
  const libEntries = (merged.libraries ?? [])
    .filter((l) => libraryAllowed(l))
    .map((l) => resolveLibrary(l, gp.libraries))
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
  const missing = libEntries.filter((e) => e.url && !existsSync(e.path))
  if (missing.length) {
    task.setPhase('补全运行库', `${missing.length} 个`)
    await downloadAll(
      missing.map((e) => ({ url: e.url as string, dest: e.path, sha1: e.sha1, size: e.size, label: e.name })),
      {
        addBytes: (n) => task.addBytes(n),
        setTotal: (n) => task.setTotal(n),
        shouldStop: () => task.cancelRequested,
        setMessage: (m) => task.setMessage(m)
      }
    )
  }

  task.checkCancel()

  // Java
  const needed = requiredJavaMajor(merged, inst.mcVersion)
  task.setPhase('准备 Java', `需要 Java ${needed}`)
  let javaPath = inst.javaPath
  let javaMajor = inst.javaMajor ?? needed
  if (!javaPath || !(await pathExists(javaPath))) {
    const java = await ensureJava(needed, merged.javaVersion?.component, task)
    javaPath = java.path
    javaMajor = java.major
    log('launch', `使用 Java ${java.major} (${java.vendor}) ${java.path}`)
  }

  // 资源根目录（旧版需要展开）
  let assetsRoot = gp.assets
  try {
    const virtual = await prepareLegacyAssets(merged, instDir)
    if (virtual) assetsRoot = virtual
  } catch (e) {
    log('launch', `旧版资源处理失败: ${e instanceof Error ? e.message : e}`)
  }

  const assetsIndexId = merged.assetIndex?.id ?? merged.assets ?? rootId
  /**
   * LWJGL3 的 natives jar 必须在 classpath 上（它自己解压 dll）；只有老式 natives 需要排除。
   *
   * Forge / NeoForge 1.17+ 的 mainClass 是 cpw.mods.bootstraplauncher.BootstrapLauncher，
   * 它会把整个 classpath 转成模块层，而原版 <mc>.jar 会被当成 `_1._20._1` 模块，
   * 与 Forge 自己的 `minecraft` 模块导出同名包 →
   *   java.lang.module.ResolutionException: Module minecraft contains package ...
   * 这类版本的游戏本体由 Forge 的 processor 生成、由 BootstrapLauncher 自行加载，
   * 因此不能再把原版 jar 塞进 classpath。
   */
  const usesBootstrapLauncher = /bootstraplauncher/i.test(merged.mainClass ?? '')
  const hasMcClientLib = libEntries.some((e) => e.name.startsWith('net.minecraft:client:'))
  const classpathEntries = [
    ...libEntries.filter((e) => e.kind !== 'legacy-native').map((e) => e.path),
    ...(usesBootstrapLauncher || hasMcClientLib ? [] : [jarPath])
  ]
  const classpath = classpathEntries.join(';')

  const playerName = (inst as InstanceMeta & { playerName?: string }).playerName || config.get().offlineName || 'Steve'
  const uuid = offlineUuid(playerName)
  const accessToken = createHash('md5').update(`offline:${playerName}:${uuid}`).digest('hex')

  const vars: Record<string, string> = {
    natives_directory: nativesDir,
    launcher_name: 'MCLauncher',
    launcher_version: appVersion(),
    classpath,
    classpath_separator: ';',
    library_directory: gp.libraries,
    version_name: inst.versionId,
    version_type: merged.type ?? 'release',
    game_directory: instDir,
    assets_root: assetsRoot,
    game_assets: assetsRoot,
    assets_index_name: assetsIndexId,
    auth_player_name: playerName,
    auth_uuid: uuid.replace(/-/g, ''),
    auth_access_token: accessToken,
    auth_session: accessToken,
    auth_xuid: '0',
    clientid: '0',
    user_type: 'legacy',
    user_properties: '{}',
    resolution_width: '1280',
    resolution_height: '720',
    primary_jar: jarPath
  }

  const jvmArgs: string[] = []
  const mem = Math.max(512, inst.memoryMb || config.get().defaultMemoryMb)
  jvmArgs.push(`-Xmx${mem}M`, `-Xms${Math.min(1024, mem)}M`)
  jvmArgs.push(`-Djava.library.path=${nativesDir}`)
  jvmArgs.push('-Dminecraft.launcher.brand=MCLauncher', '-Dminecraft.launcher.version=0.1.0')
  jvmArgs.push('-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8')
  // 中文路径/乱码与部分 LWJGL 兼容性
  jvmArgs.push('-Dorg.lwjgl.util.Debug=false')
  jvmArgs.push('-Dlog4j2.formatMsgNoLookups=true')

  const jvmFromJson = flattenArgs(merged.arguments?.jvm)
  if (jvmFromJson.length) {
    for (const a of jvmFromJson) jvmArgs.push(substitute(a, vars))
  } else {
    jvmArgs.push('-cp', classpath)
  }
  if (merged.logging?.client) {
    const logCfg = join(gp.assets, 'log_configs', merged.logging.client.file.id)
    if (existsSync(logCfg)) {
      jvmArgs.push(substitute(merged.logging.client.argument, { ...vars, path: logCfg }))
    }
  }
  if (inst.extraJvmArgs) {
    for (const a of inst.extraJvmArgs.split(/\s+/).filter(Boolean)) jvmArgs.push(a)
  }

  const gameArgsJson = flattenArgs(merged.arguments?.game).map((a) => substitute(a, vars))
  let gameArgs: string[]
  if (gameArgsJson.length) {
    gameArgs = gameArgsJson
  } else if (merged.minecraftArguments) {
    gameArgs = merged.minecraftArguments.split(/\s+/).filter(Boolean).map((a) => substitute(a, vars))
  } else {
    gameArgs = [
      '--username',
      playerName,
      '--version',
      inst.versionId,
      '--gameDir',
      instDir,
      '--assetsDir',
      assetsRoot,
      '--assetIndex',
      assetsIndexId,
      '--uuid',
      uuid.replace(/-/g, ''),
      '--accessToken',
      accessToken,
      '--userType',
      'legacy',
      '--versionType',
      'release'
    ]
  }

  const args = [...jvmArgs, merged.mainClass, ...gameArgs]
  const logFile = join(instDir, 'logs', `console-${stamp()}.log`)
  task.setPhase('启动游戏', playerName)

  const commandLine = `"${javaPath}" ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`
  log('launch', `启动 ${inst.name} (Java ${javaMajor}) → ${logFile}`)

  const running = await spawnToLog(javaPath as string, args, {
    cwd: instDir,
    logFile,
    // 必须 false：否则游戏窗口会被 windowsHide 的 SW_HIDE 压住，只有声音没有画面。
    // MC_HIDE_GAME_WINDOW=1 是排查开关，用来复现「没画面」的问题。
    hideWindow: process.env.MC_HIDE_GAME_WINDOW === '1',
    // 游戏脱离启动器的进程组：关掉启动器窗口后游戏继续跑，不会被 CTRL_CLOSE 带走
    detach: true,
    onLine: (line) => cb.onLine?.(line)
  })

  running.done.then((r) => {
    log('launch', `进程退出 code=${r.code}`)
    cb.onExit?.(r.code)
  })

  return {
    result: { started: true, pid: running.child.pid, message: `已启动 ${inst.name}` },
    process: running,
    commandLine
  }
}

/** 判断一段日志是否像崩溃 */
export function looksCrashed(lines: string[]): boolean {
  const bad = [
    'Could not find or load main class',
    'UnsupportedClassVersionError',
    'java.lang.NoClassDefFoundError: net/minecraft',
    'A fatal error has been detected by the Java Runtime Environment',
    'Exception in thread "main"',
    'The game crashed',
    'java.lang.ClassNotFoundException'
  ]
  return lines.some((l) => bad.some((b) => l.includes(b)))
}

export async function listInstanceContents(instId: string): Promise<{
  mods: string[]
  resourcepacks: string[]
  shaderpacks: string[]
  saves: string[]
}> {
  const dir = instanceDir(instId)
  const read = async (sub: string): Promise<string[]> => {
    try {
      return (await readdir(join(dir, sub))).filter((f) => !f.startsWith('.'))
    } catch {
      return []
    }
  }
  return {
    mods: await read('mods'),
    resourcepacks: await read('resourcepacks'),
    shaderpacks: await read('shaderpacks'),
    saves: await read('saves')
  }
}

export { cpSync, mkdir }
