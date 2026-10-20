import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { InstanceMeta, LoaderKind } from '../../shared/types'
import { config } from './config'
import { gamePaths, instanceDir } from './paths'
import { ensureDir, pathExists, readJsonSync, slugify, writeFileAtomic } from './util'

const META_FILE = 'instance.json'

const ICON_COLORS = [
  '#3aa757',
  '#2f8f5b',
  '#47a3d6',
  '#8a6fd1',
  '#d1893c',
  '#c2557a',
  '#5b9e8f',
  '#7a8f3a'
]

function metaPath(id: string): string {
  return join(instanceDir(id), META_FILE)
}

export interface CreateInstanceInput {
  name: string
  mcVersion: string
  loader: LoaderKind
  loaderVersion: string
  versionId: string
  memoryMb?: number
  iconText?: string
}

export async function listInstances(): Promise<InstanceMeta[]> {
  const dir = gamePaths().instances
  let ids: string[] = []
  try {
    ids = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
  const out: InstanceMeta[] = []
  for (const id of ids) {
    const meta = readJsonSync<InstanceMeta>(metaPath(id))
    if (!meta) continue
    meta.id = meta.id || id
    out.push(meta)
  }
  return out.sort((a, b) => (b.lastPlayedAt ?? b.createdAt) - (a.lastPlayedAt ?? a.createdAt))
}

export async function getInstance(id: string): Promise<InstanceMeta | null> {
  return readJsonSync<InstanceMeta>(metaPath(id))
}

async function uniqueId(base: string): Promise<string> {
  const root = gamePaths().instances
  let candidate = slugify(base)
  let i = 2
  while (await pathExists(join(root, candidate))) {
    candidate = `${slugify(base)}-${i++}`
  }
  return candidate
}

export async function createInstance(input: CreateInstanceInput): Promise<InstanceMeta> {
  const id = await uniqueId(input.name || `${input.mcVersion}-${input.loader}`)
  const dir = instanceDir(id)
  for (const sub of ['mods', 'resourcepacks', 'shaderpacks', 'saves', 'logs', 'config', 'datapacks']) {
    await ensureDir(join(dir, sub))
  }
  const meta: InstanceMeta = {
    id,
    name: input.name || id,
    mcVersion: input.mcVersion,
    loader: input.loader,
    loaderVersion: input.loaderVersion,
    versionId: input.versionId,
    createdAt: Date.now(),
    memoryMb: input.memoryMb ?? config.get().defaultMemoryMb,
    iconText: input.iconText ?? (input.name || id).slice(0, 2).toUpperCase(),
    iconColor: ICON_COLORS[Math.floor(Math.random() * ICON_COLORS.length)],
    isolated: true
  }
  await writeFileAtomic(metaPath(id), JSON.stringify(meta, null, 2))
  return meta
}

export async function saveInstance(meta: InstanceMeta): Promise<InstanceMeta> {
  await writeFileAtomic(metaPath(meta.id), JSON.stringify(meta, null, 2))
  return meta
}

export async function deleteInstance(id: string, removeFiles = true): Promise<void> {
  if (removeFiles) {
    await rm(instanceDir(id), { recursive: true, force: true })
  } else {
    await rm(metaPath(id), { force: true })
  }
}

export async function touchPlayed(id: string): Promise<void> {
  const meta = await getInstance(id)
  if (!meta) return
  meta.lastPlayedAt = Date.now()
  await saveInstance(meta)
}
