/** 主进程与渲染进程共享的类型定义 */

export type LoaderKind = 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'

export const LOADER_LABEL: Record<LoaderKind, string> = {
  vanilla: '原版',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge'
}

export interface VanillaVersion {
  id: string
  type: string
  releaseTime: string
  url: string
}

export interface LoaderVersion {
  version: string
  stable: boolean
}

export type ContentKind = 'mod' | 'resourcepack' | 'shader' | 'datapack' | 'modpack' | 'world'

export const CONTENT_LABEL: Record<ContentKind, string> = {
  mod: '模组',
  resourcepack: '资源包',
  shader: '光影',
  datapack: '数据包',
  modpack: '整合包',
  world: '地图'
}

/** 一个“实例”= 隔离的游戏目录，共享 libraries / assets / versions */
export interface InstanceMeta {
  id: string
  name: string
  mcVersion: string
  loader: LoaderKind
  loaderVersion?: string
  /** versions/ 下的版本目录名 */
  versionId: string
  createdAt: number
  lastPlayedAt?: number
  memoryMb: number
  javaPath?: string
  javaMajor?: number
  extraJvmArgs?: string
  iconText?: string
  iconColor?: string
  /** 是否隔离存档/模组（默认 true，即独立实例目录） */
  isolated: boolean
}

export interface TaskInfo {
  id: string
  title: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  phase: string
  message: string
  done: number
  total: number
  speed: number
  startedAt: number
  endedAt?: number
  error?: string
  logTail: string[]
}

export interface JavaInfo {
  path: string
  major: number
  version: string
  vendor: string
  source: 'system' | 'downloaded'
  arch?: string
}

export interface AppConfig {
  gameRoot: string
  useMirror: boolean
  concurrency: number
  /** 单个大文件的分段下载线程数 */
  downloadThreads: number
  curseforgeApiKey: string
  defaultMemoryMb: number
  offlineName: string
  autoDownloadJava: boolean
  keepLauncherOpen: boolean
}

/** 统一的资源条目（Modrinth / CurseForge 归一化） */
export interface ContentHit {
  provider: 'modrinth' | 'curseforge'
  id: string
  slug: string
  title: string
  description: string
  author: string
  iconUrl?: string
  downloads: number
  follows: number
  kind: ContentKind
  categories: string[]
  loaders: string[]
  gameVersions: string[]
  updatedAt?: string
  pageUrl: string
  /** 是否可被启动器直接下载（CurseForge 有些作者禁止第三方下载） */
  downloadable: boolean
}

export interface ContentFile {
  name: string
  url: string
  size: number
  sha1?: string
  primary: boolean
  gameVersions: string[]
  loaders: string[]
  versionName: string
  versionId: string
  fileName: string
}

export interface ContentDetail extends ContentHit {
  body?: string
  gallery: string[]
  files: ContentFile[]
  license?: string
}

export interface SearchQuery {
  kind: ContentKind
  query: string
  provider?: 'modrinth' | 'curseforge' | 'all'
  gameVersion?: string
  loader?: string
  sort: 'relevance' | 'downloads' | 'newest' | 'updated' | 'follows'
  offset: number
  limit: number
}

export interface SearchResult {
  hits: ContentHit[]
  total: number
  offset: number
  limit: number
}

export interface LaunchResult {
  started: boolean
  pid?: number
  message: string
}

export interface SnapshotInfo {
  instances: InstanceMeta[]
  config: AppConfig
  gameRoot: string
  dataRoot: string
  javaList: JavaInfo[]
  dataVersion: number
}
