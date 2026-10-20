/** IPC 通道名，主/渲染共用，避免手写字符串 */
export const IPC = {
  snapshot: 'app:snapshot',
  configSave: 'app:config-save',
  openPath: 'app:open-path',
  selectDir: 'app:select-dir',
  instancesChanged: 'app:instances-changed',

  versions: 'mc:versions',
  loaderVersions: 'mc:loader-versions',
  instanceCreate: 'mc:instance-create',
  instanceDelete: 'mc:instance-delete',
  instanceUpdate: 'mc:instance-update',
  instanceOpenDir: 'mc:instance-open-dir',
  instanceLaunch: 'mc:instance-launch',

  search: 'content:search',
  detail: 'content:detail',
  installContent: 'content:install',
  installModpack: 'content:install-modpack',
  installedList: 'content:installed',
  modpackManifest: 'content:modpack-manifest',

  tasks: 'task:list',
  taskCancel: 'task:cancel',
  taskUpdate: 'task:update',

  javaList: 'java:list',
  javaDownload: 'java:download',

  logs: 'log:read',
  logEvent: 'log:event',
  gameExit: 'game:exit'
} as const

export interface GameLogEvent {
  instanceId: string
  line: string
  stream: 'stdout' | 'stderr' | 'system'
}

export interface GameExitEvent {
  instanceId: string
  code: number | null
  crashed: boolean
  message: string
}
