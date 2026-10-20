import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppConfig, JavaInfo } from '../../shared/types'
import { appVersion } from './host'
import { configFile, portableRoot, setGameRoot } from './paths'
import { ensureDir, pathExists, readJsonSync, writeFileAtomic } from './util'

const DEFAULTS = (): AppConfig => ({
  gameRoot: join(portableRoot, 'Minecraft'),
  useMirror: true,
  concurrency: 6,
  curseforgeApiKey: '',
  defaultMemoryMb: 4096,
  offlineName: 'Steve',
  autoDownloadJava: true,
  keepLauncherOpen: true
})

class ConfigStore {
  private data: AppConfig = DEFAULTS()
  private loaded = false

  get(): AppConfig {
    if (!this.loaded) this.loadSync()
    return this.data
  }

  private loadSync(): void {
    this.loaded = true
    const parsed = readJsonSync<Partial<AppConfig>>(configFile())
    this.data = parsed ? { ...DEFAULTS(), ...parsed } : DEFAULTS()
    if (!this.data.gameRoot) this.data.gameRoot = DEFAULTS().gameRoot
    setGameRoot(this.data.gameRoot)
  }

  async load(): Promise<void> {
    await ensureDir(portableRoot)
    this.loaded = true
    if (await pathExists(configFile())) {
      const parsed = readJsonSync<Partial<AppConfig>>(configFile())
      this.data = parsed ? { ...DEFAULTS(), ...parsed } : DEFAULTS()
      setGameRoot(this.data.gameRoot || DEFAULTS().gameRoot)
    } else {
      await this.save()
    }
  }

  async save(patch?: Partial<AppConfig>): Promise<AppConfig> {
    if (patch) this.data = { ...this.data, ...patch }
    if (!this.data.gameRoot) this.data.gameRoot = DEFAULTS().gameRoot
    this.data.concurrency = Math.max(1, Math.min(32, this.data.concurrency || 8))
    this.data.defaultMemoryMb = Math.max(512, Math.min(65536, this.data.defaultMemoryMb || 4096))
    setGameRoot(this.data.gameRoot)
    await ensureDir(portableRoot)
    await writeFileAtomic(configFile(), JSON.stringify(this.data, null, 2))
    return this.data
  }
}

export const config = new ConfigStore()

export { appVersion }

export type { JavaInfo }
