import type {
  AppConfig,
  ContentDetail,
  ContentKind,
  InstanceMeta,
  JavaInfo,
  LaunchResult,
  LoaderKind,
  LoaderVersion,
  SearchQuery,
  SearchResult,
  SnapshotInfo,
  TaskInfo,
  VanillaVersion
} from './types'
import type { GameExitEvent, GameLogEvent } from './ipc'

export interface InstallContentPayload {
  instanceId: string
  provider: 'modrinth' | 'curseforge'
  projectId: string
  kind: ContentKind
  fileUrl?: string
  fileName?: string
  fileSha1?: string
  fileSize?: number
  versionId?: string
  withDependencies?: boolean
}

export interface InstallModpackPayload {
  provider: 'modrinth' | 'curseforge'
  projectId: string
  fileUrl?: string
  fileName?: string
  instanceName?: string
}

export interface CreateInstancePayload {
  name: string
  mcVersion: string
  loader: LoaderKind
  loaderVersion?: string
}

export interface TaskRef {
  taskId: string
}

export interface InstalledContent {
  mod: string[]
  resourcepack: string[]
  shader: string[]
  datapack: string[]
  world: string[]
  modpack: string[]
}

export interface DirEntry {
  name: string
  isDir: boolean
  size: number
}

export interface DirListing {
  path: string
  parent: string | null
  entries: DirEntry[]
}

/** preload 暴露到 window.mc 的完整 API */
export interface McApi {
  snapshot(): Promise<SnapshotInfo>
  saveConfig(patch: Partial<AppConfig>): Promise<AppConfig>
  openPath(path: string, reveal?: boolean): Promise<void>
  fsList(path: string): Promise<DirListing>
  fsDrives(): Promise<string[]>
  selectDir(path: string): Promise<string | null>
  versions(force?: boolean): Promise<VanillaVersion[]>
  loaderVersions(kind: LoaderKind, mcVersion: string): Promise<LoaderVersion[]>
  createInstance(payload: CreateInstancePayload): Promise<TaskRef>
  deleteInstance(id: string): Promise<void>
  updateInstance(meta: InstanceMeta): Promise<InstanceMeta>
  openInstanceDir(id: string): Promise<void>
  launch(id: string): Promise<LaunchResult>
  search(q: SearchQuery): Promise<SearchResult>
  detail(provider: 'modrinth' | 'curseforge', id: string, kind: ContentKind): Promise<ContentDetail>
  installContent(payload: InstallContentPayload): Promise<TaskRef>
  installModpack(payload: InstallModpackPayload): Promise<TaskRef>
  installedList(instanceId: string): Promise<InstalledContent>
  tasks(): Promise<TaskInfo[]>
  cancelTask(taskId: string): Promise<boolean>
  javas(force?: boolean): Promise<JavaInfo[]>
  downloadJava(major: number): Promise<TaskRef>
  readLog(instanceId: string): Promise<string>
  onTask(cb: (t: TaskInfo) => void): () => void
  onLog(cb: (e: GameLogEvent) => void): () => void
  onGameExit(cb: (e: GameExitEvent) => void): () => void
  onInstances(cb: (instances: InstanceMeta[]) => void): () => void
}
