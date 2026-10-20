import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { launcherLogRoot } from './paths'
import { ensureDir } from './util'

let stream: import('node:fs').WriteStream | null = null
let currentFile = ''

export async function openLauncherLog(name = 'launcher.log'): Promise<void> {
  try {
    await ensureDir(launcherLogRoot())
    currentFile = join(launcherLogRoot(), name)
    stream = createWriteStream(currentFile, { flags: 'w' })
  } catch {
    stream = null
  }
}

export function launcherLogPath(): string {
  return currentFile
}

export function log(scope: string, message: string): void {
  const line = `[${new Date().toISOString()}] [${scope}] ${message}`
  // eslint-disable-next-line no-console
  console.log(line)
  try {
    stream?.write(line + '\n')
  } catch {
    /* ignore */
  }
}

export function logError(scope: string, err: unknown): void {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
  log(scope, `ERROR ${msg}`)
}
