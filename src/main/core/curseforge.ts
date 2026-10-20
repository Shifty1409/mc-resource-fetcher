import type {
  ContentDetail,
  ContentFile,
  ContentHit,
  ContentKind,
  SearchQuery,
  SearchResult
} from '../../shared/types'
import { config } from './config'
import { getJson, type FetchOptions } from './http'

const API = 'https://api.curseforge.com/v1'
const GAME_ID = 432

export const CF_CLASS: Record<ContentKind, number> = {
  mod: 6,
  modpack: 4471,
  resourcepack: 12,
  world: 17,
  shader: 6552,
  datapack: 6945
}

const CLASS_TO_KIND: Record<number, ContentKind> = {
  6: 'mod',
  4471: 'modpack',
  12: 'resourcepack',
  17: 'world',
  6552: 'shader',
  6945: 'datapack'
}

const LOADER_ID: Record<string, number> = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6
}

const ID_TO_LOADER: Record<number, string> = {
  1: 'forge',
  2: 'cauldron',
  3: 'liteloader',
  4: 'fabric',
  5: 'quilt',
  6: 'neoforge'
}

const SORT_FIELD: Record<SearchQuery['sort'], number> = {
  relevance: 2,
  downloads: 6,
  follows: 2,
  newest: 11,
  updated: 3
}

export function hasCurseforgeKey(): boolean {
  return Boolean(config.get().curseforgeApiKey?.trim())
}

function opts(): FetchOptions {
  const key = config.get().curseforgeApiKey?.trim()
  if (!key) throw new Error('未配置 CurseForge API Key，请在设置里填写')
  return { headers: { 'x-api-key': key, accept: 'application/json' } }
}

interface CfMod {
  id: number
  name: string
  slug: string
  summary: string
  downloadCount: number
  classId: number
  links?: { websiteUrl?: string }
  logo?: { thumbnailUrl?: string; url?: string }
  authors?: Array<{ name: string }>
  categories?: Array<{ name: string }>
  latestFiles?: CfFile[]
  latestFilesIndexes?: Array<{ gameVersion: string; modLoader: number; filename: string }>
  dateModified?: string
  allowModDistribution?: boolean
}

interface CfFile {
  id: number
  modId: number
  displayName: string
  fileName: string
  fileLength: number
  fileDate: string
  downloadUrl: string | null
  releaseType: number
  hashes?: Array<{ value: string; algo: number }>
  gameVersions: string[]
  dependencies?: Array<{ modId: number; relationType: number }>
}

const CF_HOST = 'https://www.curseforge.com'

function hostFor(kind: ContentKind): string {
  switch (kind) {
    case 'resourcepack':
      return `${CF_HOST}/minecraft/texture-packs`
    case 'world':
      return `${CF_HOST}/minecraft/worlds`
    case 'shader':
      return `${CF_HOST}/minecraft/shaders`
    case 'datapack':
      return `${CF_HOST}/minecraft/data-packs`
    case 'modpack':
      return `${CF_HOST}/minecraft/modpacks`
    default:
      return `${CF_HOST}/minecraft/mc-mods`
  }
}

function toHit(m: CfMod, kind: ContentKind): ContentHit {
  const loaders = [...new Set((m.latestFilesIndexes ?? []).map((x) => ID_TO_LOADER[x.modLoader]).filter(Boolean))]
  const versions = [...new Set((m.latestFilesIndexes ?? []).map((x) => x.gameVersion).filter(Boolean))]
  const downloadable = m.allowModDistribution !== false && (m.latestFiles ?? []).some((f) => f.downloadUrl)
  return {
    provider: 'curseforge',
    id: String(m.id),
    slug: m.slug,
    title: m.name,
    description: m.summary ?? '',
    author: m.authors?.[0]?.name ?? '',
    iconUrl: m.logo?.thumbnailUrl ?? m.logo?.url,
    downloads: m.downloadCount ?? 0,
    follows: 0,
    kind,
    categories: (m.categories ?? []).map((c) => c.name),
    loaders,
    gameVersions: versions,
    updatedAt: m.dateModified,
    pageUrl: m.links?.websiteUrl ?? `${hostFor(kind)}/${m.slug}`,
    downloadable
  }
}

export async function searchCurseforge(q: SearchQuery): Promise<SearchResult> {
  const params = new URLSearchParams({
    gameId: String(GAME_ID),
    classId: String(CF_CLASS[q.kind]),
    sortField: String(SORT_FIELD[q.sort] ?? 2),
    sortOrder: 'desc',
    index: String(q.offset),
    pageSize: String(Math.min(q.limit, 50))
  })
  if (q.query?.trim()) params.set('searchFilter', q.query.trim())
  if (q.gameVersion) params.set('gameVersion', q.gameVersion)
  if (q.loader && q.loader !== 'any' && LOADER_ID[q.loader]) {
    params.set('modLoaderType', String(LOADER_ID[q.loader]))
  }
  const res = await getJson<{ data: CfMod[]; pagination?: { totalCount: number } }>(
    `${API}/mods/search?${params.toString()}`,
    opts()
  )
  const hits = (res.data ?? []).map((m) => toHit(m, q.kind))
  return {
    hits,
    total: res.pagination?.totalCount ?? hits.length,
    offset: q.offset,
    limit: q.limit
  }
}

export async function getCurseforgeDetail(id: string, kind: ContentKind): Promise<ContentDetail> {
  const modRes = await getJson<{ data: CfMod }>(`${API}/mods/${id}`, opts())
  const mod = modRes.data
  let files: CfFile[] = []
  try {
    const fRes = await getJson<{ data: CfFile[] }>(`${API}/mods/${id}/files?pageSize=50`, opts())
    files = fRes.data ?? []
  } catch {
    files = mod.latestFiles ?? []
  }
  const contentFiles: ContentFile[] = files
    .filter((f) => f.downloadUrl)
    .map((f) => ({
      name: f.displayName || f.fileName,
      url: f.downloadUrl as string,
      size: f.fileLength,
      sha1: f.hashes?.find((h) => h.algo === 1)?.value,
      primary: false,
      gameVersions: f.gameVersions ?? [],
      loaders: [],
      versionName: f.displayName || f.fileName,
      versionId: String(f.id),
      fileName: f.fileName
    }))
  const hit = toHit(mod, kind)
  return {
    ...hit,
    body: mod.summary,
    gallery: [],
    files: contentFiles,
    license: undefined,
    downloadable: contentFiles.length > 0
  }
}

/** 选一个适配当前实例的文件 */
export async function pickCurseforgeFile(
  modId: string,
  mcVersion: string,
  loader: string | undefined
): Promise<ContentFile | null> {
  const params = new URLSearchParams({ gameVersion: mcVersion, pageSize: '50' })
  if (loader && loader !== 'any' && LOADER_ID[loader]) params.set('modLoaderType', String(LOADER_ID[loader]))
  let files: CfFile[] = []
  try {
    const res = await getJson<{ data: CfFile[] }>(`${API}/mods/${modId}/files?${params.toString()}`, opts())
    files = res.data ?? []
  } catch {
    const res = await getJson<{ data: CfMod }>(`${API}/mods/${modId}`, opts()).catch(() => null)
    files = res?.data?.latestFiles ?? []
  }
  const usable = files.filter((f) => f.downloadUrl)
  if (!usable.length) {
    throw new Error('该作者禁止第三方启动器下载此文件，请到 CurseForge 网页手动下载')
  }
  const f = usable[0]
  return {
    name: f.displayName || f.fileName,
    url: f.downloadUrl as string,
    size: f.fileLength,
    sha1: f.hashes?.find((h) => h.algo === 1)?.value,
    primary: true,
    gameVersions: f.gameVersions ?? [],
    loaders: [],
    versionName: f.displayName || f.fileName,
    versionId: String(f.id),
    fileName: f.fileName
  }
}

export { CLASS_TO_KIND, ID_TO_LOADER }
