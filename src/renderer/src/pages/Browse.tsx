import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ContentHit,
  ContentKind,
  InstanceMeta,
  SearchQuery,
  SearchResult,
  VanillaVersion
} from '@shared/types'
import { CONTENT_LABEL } from '@shared/types'
import type { UiCtx } from '../App'
import { errText, formatCount, formatDate } from '../lib/format'
import { IconDownload, IconLink, IconSearch, IconX } from '../components/Icons'
import DetailModal from '../components/DetailModal'

interface Props {
  instances: InstanceMeta[]
  ctx: UiCtx
}

const KINDS: ContentKind[] = ['mod', 'resourcepack', 'shader', 'datapack', 'world', 'modpack']
const PAGE_SIZE = 20

const LOADER_OPTIONS = [
  { value: 'any', label: '任意加载器' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'forge', label: 'Forge' },
  { value: 'neoforge', label: 'NeoForge' },
  { value: 'quilt', label: 'Quilt' }
]

const SORT_OPTIONS: Array<{ value: SearchQuery['sort']; label: string }> = [
  { value: 'relevance', label: '相关度' },
  { value: 'downloads', label: '下载量' },
  { value: 'newest', label: '最新发布' },
  { value: 'updated', label: '最近更新' },
  { value: 'follows', label: '收藏数' }
]

export default function Browse({ instances, ctx }: Props): React.JSX.Element {
  const [kind, setKind] = useState<ContentKind>('mod')
  const [provider, setProvider] = useState<'modrinth' | 'curseforge' | 'all'>('modrinth')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [gameVersion, setGameVersion] = useState('')
  const [loader, setLoader] = useState('any')
  const [sort, setSort] = useState<SearchQuery['sort']>('relevance')
  const [offset, setOffset] = useState(0)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [versions, setVersions] = useState<VanillaVersion[]>([])
  const [targetId, setTargetId] = useState('')
  const [detail, setDetail] = useState<ContentHit | null>(null)
  const reqId = useRef(0)

  const target = instances.find((i) => i.id === targetId)

  useEffect(() => {
    if (!targetId && instances.length) setTargetId(instances[0].id)
  }, [instances, targetId])

  useEffect(() => {
    void window.mc
      .versions(false)
      .then((list) => setVersions(list.filter((v) => v.type === 'release').slice(0, 80)))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 380)
    return () => window.clearTimeout(t)
  }, [query])

  useEffect(() => {
    setOffset(0)
  }, [debounced, kind, provider, gameVersion, loader, sort])

  useEffect(() => {
    const id = ++reqId.current
    setLoading(true)
    const q: SearchQuery = {
      kind,
      query: debounced,
      provider,
      gameVersion: gameVersion || undefined,
      loader,
      sort,
      offset,
      limit: PAGE_SIZE
    }
    window.mc
      .search(q)
      .then((res) => {
        if (id === reqId.current) setResult(res)
      })
      .catch((e) => {
        if (id === reqId.current) {
          setResult({ hits: [], total: 0, offset, limit: PAGE_SIZE })
          ctx.toast(`搜索失败：${errText(e)}`, 'error')
        }
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false)
      })
  }, [debounced, kind, provider, gameVersion, loader, sort, offset, ctx])

  const install = async (
    hit: ContentHit,
    fileInfo?: { url: string; fileName: string; versionId?: string }
  ): Promise<void> => {
    if (hit.kind === 'modpack') {
      try {
        await window.mc.installModpack({ provider: hit.provider, projectId: hit.id })
        ctx.toast('已开始安装整合包，进度见任务栏')
      } catch (e) {
        ctx.toast(errText(e), 'error')
      }
      return
    }
    if (!targetId) {
      ctx.toast('请先在顶部选择「安装到」哪个实例', 'warn')
      return
    }
    try {
      await window.mc.installContent({
        instanceId: targetId,
        provider: hit.provider,
        projectId: hit.id,
        kind: hit.kind,
        fileUrl: fileInfo?.url,
        fileName: fileInfo?.fileName,
        versionId: fileInfo?.versionId
      })
      ctx.toast(`已开始下载「${hit.title}」`)
      setDetail(null)
    } catch (e) {
      ctx.toast(errText(e), 'error')
    }
  }

  const showLoader = kind === 'mod' || kind === 'modpack' || kind === 'datapack'
  const hits = result?.hits ?? []
  const total = result?.total ?? 0
  const maxOffset = useMemo(() => Math.min(total, 1000), [total])

  return (
    <div>
      <div className="tabs" style={{ marginBottom: 12, width: 'fit-content' }}>
        {KINDS.map((k) => (
          <button key={k} className={`tab${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>
            {CONTENT_LABEL[k]}
          </button>
        ))}
      </div>

      <div className="card filter-bar">
        <div className="search-box">
          <IconSearch />
          <input
            className="input"
            placeholder={`搜索${CONTENT_LABEL[kind]}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select className="select" value={provider} onChange={(e) => setProvider(e.target.value as never)}>
          <option value="modrinth">Modrinth</option>
          <option value="curseforge">CurseForge</option>
          <option value="all">两边都搜</option>
        </select>
        <select className="select" value={gameVersion} onChange={(e) => setGameVersion(e.target.value)}>
          <option value="">全部版本</option>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.id}
            </option>
          ))}
        </select>
        {showLoader && (
          <select className="select" value={loader} onChange={(e) => setLoader(e.target.value)}>
            {LOADER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as never)}>
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          title="下载后安装到哪个实例"
          style={{ maxWidth: 190 }}
        >
          <option value="">安装到…</option>
          {instances.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </div>

      {target && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          将安装到 <b style={{ color: 'var(--accent-strong)' }}>{target.name}</b> · MC {target.mcVersion} ·{' '}
          {target.loader}
          {kind === 'world' && ' · 地图会解压到该实例的 saves 目录'}
        </div>
      )}

      {loading && (
        <div className="row" style={{ padding: 20, color: 'var(--muted)' }}>
          <span className="spinner" /> 正在搜索…
        </div>
      )}

      {!loading && hits.length === 0 && (
        <div className="empty">
          <b>没有结果</b>
          {kind === 'world' && provider !== 'curseforge'
            ? 'Modrinth 不提供地图资源，请把来源切换成 CurseForge（需要 API Key）'
            : '换个关键词或放宽版本 / 加载器筛选试试'}
        </div>
      )}

      <div className="hits">
        {hits.map((hit) => (
          <div className="card hit" key={`${hit.provider}-${hit.id}`} onClick={() => setDetail(hit)}>
            {hit.iconUrl ? (
              <img className="hit-icon" src={hit.iconUrl} alt="" loading="lazy" />
            ) : (
              <div className="hit-icon" style={{ display: 'grid', placeItems: 'center', fontWeight: 700, color: '#8aa197' }}>
                {hit.title.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="hit-body">
              <div className="hit-title">
                {hit.title}
                <span className={`chip ${hit.provider === 'modrinth' ? 'accent' : ''}`} style={{ fontSize: 10 }}>
                  {hit.provider === 'modrinth' ? 'MR' : 'CF'}
                </span>
              </div>
              <div className="hit-desc">{hit.description}</div>
              <div className="hit-foot">
                <span className="chip line">{formatCount(hit.downloads)} 下载</span>
                {hit.loaders.slice(0, 3).map((l) => (
                  <span className="chip" key={l}>
                    {l}
                  </span>
                ))}
                {hit.updatedAt && <span className="muted" style={{ fontSize: 11 }}>{formatDate(hit.updatedAt)}</span>}
              </div>
            </div>
            <div className="hit-actions">
              <button
                className="btn sm primary"
                disabled={!hit.downloadable}
                onClick={(e) => {
                  e.stopPropagation()
                  void install(hit)
                }}
              >
                <IconDownload /> 安装
              </button>
              <button
                className="btn sm ghost"
                onClick={(e) => {
                  e.stopPropagation()
                  void window.mc.openPath(hit.pageUrl)
                }}
              >
                <IconLink /> 网页
              </button>
            </div>
          </div>
        ))}
      </div>

      {total > PAGE_SIZE && (
        <div className="pager">
          <button className="btn sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            上一页
          </button>
          <span>
            第 {Math.floor(offset / PAGE_SIZE) + 1} 页 · 约 {formatCount(total)} 条
            {total > maxOffset ? '+' : ''}
          </span>
          <button
            className="btn sm"
            disabled={offset + PAGE_SIZE >= maxOffset}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            下一页
          </button>
        </div>
      )}

      {detail && (
        <DetailModal
          hit={detail}
          target={target}
          ctx={ctx}
          onClose={() => setDetail(null)}
          onInstall={(file) => void install(detail, file)}
        />
      )}
    </div>
  )
}

export { IconX }
