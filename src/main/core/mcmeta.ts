import { join } from 'node:path'
import { gamePaths } from './paths'

export const OS_NAME = 'windows'
export const OS_ARCH: string = process.arch === 'arm64' ? 'arm64' : 'x64'
export const ARCH_BITS = OS_ARCH === 'arm64' ? 'arm64' : '64'

export interface Rule {
  action: 'allow' | 'disallow'
  os?: { name?: string; arch?: string; version?: string }
  features?: Record<string, boolean>
}

export interface DownloadsEntry {
  path?: string
  sha1?: string
  size?: number
  url?: string
}

export interface Library {
  name: string
  downloads?: { artifact?: DownloadsEntry; classifiers?: Record<string, DownloadsEntry> }
  natives?: Record<string, string>
  rules?: Rule[]
  extract?: { exclude?: string[] }
  url?: string
  clientreq?: boolean
  serverreq?: boolean
  checksums?: string[]
}

export interface ArgumentNode {
  rules?: Rule[]
  value: string | string[]
}

export interface AssetIndexRef {
  id: string
  url: string
  sha1?: string
  size?: number
  totalSize?: number
  virtual?: boolean
  map_to_resources?: boolean
}

export interface VersionJson {
  id: string
  type?: string
  inheritsFrom?: string
  mainClass?: string
  minecraftArguments?: string
  arguments?: { game?: Array<string | ArgumentNode>; jvm?: Array<string | ArgumentNode> }
  libraries?: Library[]
  downloads?: { client?: DownloadsEntry; server?: DownloadsEntry }
  assetIndex?: AssetIndexRef
  assets?: string
  javaVersion?: { component: string; majorVersion: number }
  logging?: { client?: { argument: string; file: { id: string; url: string; sha1?: string; size?: number } } }
  releaseTime?: string
  time?: string
  complianceLevel?: number
  legacy?: boolean
  jar?: string
}

/** 离线启动时固定的 feature 开关（不支持演示模式/快捷进入） */
export const LAUNCH_FEATURES: Record<string, boolean> = {
  is_demo_user: false,
  has_custom_resolution: false,
  has_quick_plays_support: false,
  is_quick_play_singleplayer: false,
  is_quick_play_multiplayer: false,
  is_quick_play_realms: false
}

function ruleMatches(rule: Rule): boolean {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== OS_NAME) return false
    if (rule.os.arch && rule.os.arch !== OS_ARCH) {
      // 旧版本用 "x86" 表示 32 位，本机为 64 位 arm64/x64 时不匹配
      return false
    }
  }
  if (rule.features) {
    for (const [k, v] of Object.entries(rule.features)) {
      if (LAUNCH_FEATURES[k] !== v) return false
    }
  }
  return true
}

/** 原版语义：从 false 开始，按顺序被匹配到的规则覆盖 */
export function rulesAllow(rules?: Rule[]): boolean {
  if (!rules || rules.length === 0) return true
  let allowed = false
  for (const r of rules) {
    if (ruleMatches(r)) allowed = r.action === 'allow'
  }
  return allowed
}

export function libraryAllowed(lib: Library): boolean {
  return rulesAllow(lib.rules)
}

export function isNativeLibrary(lib: Library): boolean {
  if (lib.natives && Object.keys(lib.natives).length > 0) return true
  return lib.name.includes(':natives-')
}

/**
 * 原生库分两类，处理方式完全不同：
 *  - legacy：老版本用 natives 映射 + classifiers，需要解压到 natives 目录，且不能进 classpath；
 *  - lwjgl3：1.19+ 把 natives 作为独立 artifact（名称带 :natives-windows），
 *    LWJGL 自己从 classpath 里解压 dll，所以必须进 classpath（否则报 Failed to locate library: lwjgl.dll）。
 */
export type LibKind = 'artifact' | 'legacy-native' | 'lwjgl3-native'

export function libKind(lib: Library): LibKind {
  if (lib.natives && Object.keys(lib.natives).length > 0) return 'legacy-native'
  if (lib.name.includes(':natives-')) return 'lwjgl3-native'
  return 'artifact'
}

/** group:artifact:version[:classifier][@ext] → 相对 maven 路径 */
export function mavenPath(name: string): string {
  const [coord, ext] = name.split('@')
  const parts = coord.split(':')
  const group = parts[0]
  const artifact = parts[1]
  const version = parts[2]
  const classifier = parts[3]
  const extension = ext || 'jar'
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${extension}`
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${file}`
}

export interface ResolvedLib {
  name: string
  /** 本地绝对路径 */
  path: string
  url?: string
  sha1?: string
  size?: number
  kind: LibKind
  /** 原生库需要解压时排除的条目前缀 */
  extractExclude: string[]
}

/** 把一条 library 解析成本地文件描述（考虑下载源、maven 推导、原生库分类器） */
export function resolveLibrary(lib: Library, libRoot: string): ResolvedLib | null {
  const base = libRoot
  const kind = libKind(lib)
  if (kind === 'legacy-native') {
    const classifierTpl = lib.natives?.[OS_NAME]
    if (!classifierTpl) return null
    const classifier = classifierTpl.replace('${arch}', ARCH_BITS)
    const entry = lib.downloads?.classifiers?.[classifier]
    const relPath = entry?.path ?? mavenPath(`${lib.name}:${classifier}`)
    return {
      name: lib.name,
      path: join(base, relPath),
      url: entry?.url ?? (lib.url ? joinUrl(lib.url, relPath) : undefined),
      sha1: entry?.sha1,
      size: entry?.size,
      kind,
      extractExclude: lib.extract?.exclude ?? []
    }
  }

  const artifact = lib.downloads?.artifact
  const relPath = artifact?.path ?? mavenPath(lib.name)
  return {
    name: lib.name,
    path: join(base, relPath),
    url: artifact?.url ?? (lib.url ? joinUrl(lib.url, relPath) : undefined),
    sha1: artifact?.sha1,
    size: artifact?.size,
    kind,
    extractExclude: lib.extract?.exclude ?? []
  }
}

function joinUrl(base: string, rel: string): string {
  return base.endsWith('/') ? base + rel : `${base}/${rel}`
}

/** 合并父子版本（Fabric/Quilt/Forge 的 inheritsFrom） */
export function mergeVersion(parent: VersionJson, child: VersionJson): VersionJson {
  const libs = [...(parent.libraries ?? []), ...(child.libraries ?? [])]
  const seen = new Set<string>()
  const libraries: Library[] = []
  for (const l of libs) {
    if (seen.has(l.name)) continue
    seen.add(l.name)
    libraries.push(l)
  }
  const merged: VersionJson = {
    ...parent,
    ...child,
    id: child.id ?? parent.id,
    mainClass: child.mainClass ?? parent.mainClass,
    libraries,
    arguments: {
      game: [...(parent.arguments?.game ?? []), ...(child.arguments?.game ?? [])],
      jvm: [...(child.arguments?.jvm ?? []), ...(parent.arguments?.jvm ?? [])]
    },
    assetIndex: child.assetIndex ?? parent.assetIndex,
    assets: child.assets ?? parent.assets,
    downloads: child.downloads ?? parent.downloads,
    javaVersion: child.javaVersion ?? parent.javaVersion,
    logging: child.logging ?? parent.logging
  }
  if (child.minecraftArguments) merged.minecraftArguments = child.minecraftArguments
  else if (parent.minecraftArguments) merged.minecraftArguments = parent.minecraftArguments
  return merged
}

export function flattenArgs(nodes: Array<string | ArgumentNode> | undefined): string[] {
  if (!nodes) return []
  const out: string[] = []
  for (const node of nodes) {
    if (typeof node === 'string') {
      out.push(node)
      continue
    }
    if (node.rules && !rulesAllow(node.rules)) continue
    if (Array.isArray(node.value)) out.push(...node.value)
    else out.push(node.value)
  }
  return out
}

export function librariesRoot(root?: string): string {
  return gamePaths(root).libraries
}
