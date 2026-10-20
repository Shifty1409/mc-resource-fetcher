/**
 * 宿主适配层：核心逻辑（下载/安装/启动）既能跑在 Electron 主进程，
 * 也能跑在纯 Node（自检、CI、命令行）里。
 */
import { join } from 'node:path'

interface ElectronLike {
  app?: {
    getAppPath(): string
    getPath(name: string): string
    getVersion(): string
    isPackaged: boolean
  }
  net?: { fetch(input: string, init?: unknown): Promise<Response> }
}

function loadElectron(): ElectronLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('electron') as unknown
    if (mod && typeof mod === 'object' && 'app' in (mod as object)) {
      const app = (mod as ElectronLike).app
      if (app && typeof app.getAppPath === 'function') return mod as ElectronLike
    }
    return null
  } catch {
    return null
  }
}

const electron = loadElectron()

export const isElectron = electron !== null

export function getAppPath(): string {
  try {
    return electron?.app?.getAppPath() ?? process.cwd()
  } catch {
    return process.cwd()
  }
}

export function isPackaged(): boolean {
  try {
    return electron?.app?.isPackaged ?? false
  } catch {
    return false
  }
}

export function getExeDir(): string {
  try {
    const exe = electron?.app?.getPath('exe')
    if (exe) return join(exe, '..')
  } catch {
    /* ignore */
  }
  return process.cwd()
}

/** 打包后的可写用户目录（%APPDATA%/<appName>） */
export function getUserDataPath(): string {
  try {
    const p = electron?.app?.getPath('userData')
    if (p) return p
  } catch {
    /* ignore */
  }
  return join(process.env.APPDATA ?? process.cwd(), 'MCLauncher')
}

export function appVersion(): string {
  try {
    return electron?.app?.getVersion() ?? '0.1.0'
  } catch {
    return '0.1.0'
  }
}

/** Electron 下用 net.fetch（自动走系统代理），Node 下用全局 fetch */
export async function httpFetch(url: string, init?: Record<string, unknown>): Promise<Response> {
  if (electron?.net?.fetch) {
    return electron.net.fetch(url, init)
  }
  return fetch(url, init as RequestInit)
}
