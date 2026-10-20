import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getAppPath, getExeDir, getUserDataPath, isPackaged } from './host'

/** 目录是否可写（绿色版优先把数据放在 exe 旁边） */
function writable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    const probe = join(dir, '.write-test')
    writeFileSync(probe, 'ok')
    rmSync(probe, { force: true })
    return true
  } catch {
    return false
  }
}

/**
 * 便携式数据根目录，优先级：
 *  1. MC_LAUNCHER_HOME 环境变量（测试 / 多开 / 自定义）
 *  2. electron-builder portable 包的 PORTABLE_EXECUTABLE_DIR（免安装 exe 旁边）
 *  3. 打包后：exe 同目录可写就用 MCLauncherData（绿色版），否则 %APPDATA%
 *  4. 开发：<项目根>/.mcdata
 */
export const portableRoot: string = (() => {
  const env = process.env.MC_LAUNCHER_HOME
  if (env && env.trim()) return env.trim()
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
  if (portableDir && portableDir.trim()) return join(portableDir.trim(), 'MCLauncherData')
  if (isPackaged()) {
    const beside = join(getExeDir(), 'MCLauncherData')
    if (writable(beside)) return beside
    return join(getUserDataPath(), 'storage')
  }
  return join(getAppPath(), '.mcdata')
})()

export const configFile = (): string => join(portableRoot, 'config.json')
export const cacheRoot = (): string => join(portableRoot, 'cache')
export const runtimeRoot = (): string => join(portableRoot, 'runtime')
export const launcherLogRoot = (): string => join(portableRoot, 'logs')

// 由 config 模块注入，避免循环依赖
let _gameRoot = join(portableRoot, 'Minecraft')

export function setGameRoot(p: string): void {
  _gameRoot = p
}

export function gameRoot(): string {
  return _gameRoot
}

export interface GamePaths {
  root: string
  versions: string
  libraries: string
  assets: string
  assetIndexes: string
  assetObjects: string
  instances: string
  logs: string
}

export function gamePaths(root = _gameRoot): GamePaths {
  return {
    root,
    versions: join(root, 'versions'),
    libraries: join(root, 'libraries'),
    assets: join(root, 'assets'),
    assetIndexes: join(root, 'assets', 'indexes'),
    assetObjects: join(root, 'assets', 'objects'),
    instances: join(root, 'instances'),
    logs: join(root, 'launcher-logs')
  }
}

export function instanceDir(id: string): string {
  return join(_gameRoot, 'instances', id)
}

export function versionDir(versionId: string): string {
  return join(_gameRoot, 'versions', versionId)
}
