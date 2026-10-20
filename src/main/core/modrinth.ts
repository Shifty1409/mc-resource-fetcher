import type {
  ContentDetail,
  ContentFile,
  ContentHit,
  ContentKind,
  SearchQuery,
  SearchResult
} from '../../shared/types'
import { getJson } from './http'
import { log } from './log'

const API = 'https://api.modrinth.com/v2'

/** Modrinth 的 project_type ↔ 我们的 kind */
const KIND_TO_TYPE: Record<ContentKind, string> = {
  mod: 'mod',
  resourcepack: 'resourcepack',
  shader: 'shader',
  datapack: 'datapack',
  modpack: 'modpack',
  world: 'mod' // Modrinth 没有地图
}

const TYPE_TO_KIND: Record<string, ContentKind> = {
  mod: 'mod',
  resourcepack: 'resourcepack',
  shader: 'shader',
  datapack: 'datapack',
  modpack: 'modpack',
  plugin: 'mod'
}

const INDEX: Record<SearchQuery['sort'], string> = {
  relevance: 'relevance',
  downloads: 'downloads',
  follows: 'follows',
  newest: 'newest',
  updated: 'updated'
}

interface ModrinthHit {
  project_id: string
  slug: string
  title: string
  description: string
  author: string
  icon_url?: string
  downloads: number
  follows: number
  project_type: string
  categories: string[]
  versions: string[]
  date_modified?: string
  license?: string
  client_side?: string
  server_side?: string
}

interface ModrinthSearchResponse {
  hits: ModrinthHit[]
  offset: number
  limit: number
  total_hits: number
}

function loaderFacetName(loader: string): string {
  return loader.toLowerCase()
}

export async function searchModrinth(q: SearchQuery): Promise<SearchResult> {
  if (q.kind === 'world') {
    return { hits: [], total: 0, offset: 0, limit: q.limit }
  }
  const facets: string[][] = [[`project_type:${KIND_TO_TYPE[q.kind]}`]]
  if (q.gameVersion) facets.push([`versions:${q.gameVersion}`])
  if (q.loader && q.loader !== 'any') {
    const l = loaderFacetName(q.loader)
    facets.push([`categories:${l}`])
  }
  const params = new URLSearchParams({
    query: q.query ?? '',
    index: INDEX[q.sort] ?? 'relevance',
    offset: String(q.offset),
    limit: String(q.limit),
    facets: JSON.stringify(facets)
  })
  const res = await getJson<ModrinthSearchResponse>(`${API}/search?${params.toString()}`)
  const hits: ContentHit[] = res.hits.map((h) => ({
    provider: 'modrinth',
    id: h.project_id,
    slug: h.slug,
    title: h.title,
    description: h.description,
    author: h.author,
    iconUrl: h.icon_url,
    downloads: h.downloads,
    follows: h.follows ?? 0,
    kind: TYPE_TO_KIND[h.project_type] ?? 'mod',
    categories: h.categories ?? [],
    loaders: (h.categories ?? []).filter((c) =>
      ['fabric', 'forge', 'neoforge', 'quilt', 'liteloader', 'rift'].includes(c)
    ),
    gameVersions: h.versions ?? [],
    updatedAt: h.date_modified,
    pageUrl: `https://modrinth.com/${h.project_type}/${h.slug}`,
    downloadable: true
  }))
  return { hits, total: res.total_hits, offset: res.offset, limit: res.limit }
}

interface ModrinthProject {
  id: string
  slug: string
  title: string
  description: string
  body?: string
  icon_url?: string
  downloads: number
  followers: number
  project_type: string
  categories: string[]
  additional_categories?: string[]
  game_versions: string[]
  loaders: string[]
  gallery?: Array<{ url: string; featured: boolean }>
  license?: { id: string; name: string }
  updated?: string
}

interface ModrinthVersion {
  id: string
  name: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  date_published: string
  files: Array<{
    url: string
    filename: string
    size: number
    primary: boolean
    hashes?: { sha1?: string; sha512?: string }
  }>
}

export async function getModrinthDetail(idOrSlug: string, kind: ContentKind): Promise<ContentDetail> {
  const project = await getJson<ModrinthProject>(`${API}/project/${encodeURIComponent(idOrSlug)}`)
  let versions: ModrinthVersion[] = []
  try {
    versions = await getJson<ModrinthVersion[]>(`${API}/project/${encodeURIComponent(project.id)}/version`)
  } catch (e) {
    log('modrinth', `获取版本列表失败: ${e instanceof Error ? e.message : e}`)
  }
  const files: ContentFile[] = []
  for (const v of versions.slice(0, 40)) {
    const primary = v.files.find((f) => f.primary) ?? v.files[0]
    if (!primary) continue
    files.push({
      name: primary.filename,
      url: primary.url,
      size: primary.size,
      sha1: primary.hashes?.sha1,
      primary: true,
      gameVersions: v.game_versions,
      loaders: v.loaders,
      versionName: v.version_number,
      versionId: v.id,
      fileName: primary.filename
    })
  }
  return {
    provider: 'modrinth',
    id: project.id,
    slug: project.slug,
    title: project.title,
    description: project.description,
    author: '',
    iconUrl: project.icon_url,
    downloads: project.downloads,
    follows: project.followers,
    kind: TYPE_TO_KIND[project.project_type] ?? kind,
    categories: [...(project.categories ?? []), ...(project.additional_categories ?? [])],
    loaders: project.loaders ?? [],
    gameVersions: project.game_versions ?? [],
    updatedAt: project.updated,
    pageUrl: `https://modrinth.com/${project.project_type}/${project.slug}`,
    downloadable: true,
    body: project.body,
    gallery: (project.gallery ?? []).map((g) => g.url),
    files,
    license: project.license?.name
  }
}

/** 精确挑一个适配实例的文件：优先 game version + loader 匹配，再退化为最新 */
export async function pickModrinthFile(
  projectId: string,
  mcVersion: string,
  loader: string | undefined
): Promise<ContentFile | null> {
  const params = new URLSearchParams()
  params.set('game_versions', JSON.stringify([mcVersion]))
  if (loader && loader !== 'any') params.set('loaders', JSON.stringify([loader]))
  let versions: ModrinthVersion[] = []
  try {
    versions = await getJson<ModrinthVersion[]>(
      `${API}/project/${encodeURIComponent(projectId)}/version?${params.toString()}`
    )
  } catch (e) {
    log('modrinth', `按条件查版本失败: ${e instanceof Error ? e.message : e}`)
  }
  if (!versions.length && loader) {
    // 该版本没有对应加载器，放宽一次
    try {
      versions = await getJson<ModrinthVersion[]>(
        `${API}/project/${encodeURIComponent(projectId)}/version?game_versions=${encodeURIComponent(
          JSON.stringify([mcVersion])
        )}`
      )
    } catch {
      /* ignore */
    }
  }
  if (!versions.length) {
    try {
      versions = await getJson<ModrinthVersion[]>(`${API}/project/${encodeURIComponent(projectId)}/version`)
    } catch {
      /* ignore */
    }
  }
  const v = versions[0]
  if (!v) return null
  const primary = v.files.find((f) => f.primary) ?? v.files[0]
  if (!primary) return null
  return {
    name: primary.filename,
    url: primary.url,
    size: primary.size,
    sha1: primary.hashes?.sha1,
    primary: true,
    gameVersions: v.game_versions,
    loaders: v.loaders,
    versionName: v.version_number,
    versionId: v.id,
    fileName: primary.filename
  }
}

export interface ModrinthDependency {
  version_id: string | null
  project_id: string | null
  file_name?: string | null
  dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded'
}

export interface ModrinthVersionRaw {
  id: string
  project_id: string
  name?: string
  version_number?: string
  game_versions: string[]
  loaders: string[]
  dependencies?: ModrinthDependency[]
  files: Array<{ url: string; filename: string; size: number; primary: boolean; hashes?: { sha1?: string } }>
}

export async function getModrinthVersion(versionId: string): Promise<ModrinthVersionRaw> {
  return getJson<ModrinthVersionRaw>(`${API}/version/${encodeURIComponent(versionId)}`)
}

export interface ResolvedModrinthFile extends ContentFile {
  dependencies: ModrinthDependency[]
}

/** 取版本 + 依赖信息，供依赖递归安装使用 */
export async function pickModrinthFileWithDeps(
  projectId: string,
  mcVersion: string,
  loader: string | undefined
): Promise<ResolvedModrinthFile | null> {
  const file = await pickModrinthFile(projectId, mcVersion, loader)
  if (!file) return null
  let deps: ModrinthDependency[] = []
  try {
    const v = await getModrinthVersion(file.versionId)
    deps = v.dependencies ?? []
  } catch (e) {
    log('modrinth', `获取依赖失败 ${projectId}: ${e instanceof Error ? e.message : e}`)
  }
  return { ...file, dependencies: deps }
}

/** 指定 versionId 时也拿到依赖 */
export async function getModrinthFileByVersion(versionId: string): Promise<ResolvedModrinthFile | null> {
  const v = await getModrinthVersion(versionId)
  const primary = v.files.find((f) => f.primary) ?? v.files[0]
  if (!primary) return null
  return {
    name: primary.filename,
    url: primary.url,
    size: primary.size,
    sha1: primary.hashes?.sha1,
    primary: true,
    gameVersions: v.game_versions,
    loaders: v.loaders,
    versionName: v.version_number ?? versionId,
    versionId: v.id,
    fileName: primary.filename,
    dependencies: v.dependencies ?? []
  }
}
