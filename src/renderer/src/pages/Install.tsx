import { useEffect, useMemo, useState } from 'react'
import type { InstanceMeta, LoaderKind, LoaderVersion, VanillaVersion } from '@shared/types'
import { LOADER_LABEL } from '@shared/types'
import type { UiCtx } from '../App'
import { errText, formatDate } from '../lib/format'
import { IconCube, IconRefresh, IconSearch } from '../components/Icons'

interface Props {
  instances: InstanceMeta[]
  ctx: UiCtx
  onCreated: () => void
}

const LOADERS: LoaderKind[] = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']

export default function Install({ ctx, onCreated }: Props): React.JSX.Element {
  const [versions, setVersions] = useState<VanillaVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [onlyRelease, setOnlyRelease] = useState(true)
  const [selected, setSelected] = useState<VanillaVersion | null>(null)
  const [loader, setLoader] = useState<LoaderKind>('vanilla')
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[]>([])
  const [loaderVersion, setLoaderVersion] = useState('')
  const [loadingLoaders, setLoadingLoaders] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const loadVersions = async (force = false): Promise<void> => {
    setLoading(true)
    try {
      const list = await window.mc.versions(force)
      setVersions(list)
      if (!selected && list.length) {
        const release = list.find((v) => v.type === 'release')
        setSelected(release ?? list[0])
      }
    } catch (e) {
      ctx.toast(`获取版本列表失败：${errText(e)}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadVersions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selected) return
    setLoaderVersion('')
    setLoaderVersions([])
    if (loader === 'vanilla') return
    let cancelled = false
    setLoadingLoaders(true)
    window.mc
      .loaderVersions(loader, selected.id)
      .then((list) => {
        if (cancelled) return
        setLoaderVersions(list)
        const first = list.find((l) => l.stable) ?? list[0]
        setLoaderVersion(first?.version ?? '')
      })
      .catch((e) => {
        if (!cancelled) ctx.toast(`${LOADER_LABEL[loader]} 版本获取失败：${errText(e)}`, 'error')
      })
      .finally(() => {
        if (!cancelled) setLoadingLoaders(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected?.id, loader, ctx])

  // 切换 MC 版本时，若该版本太新/太旧导致加载器无版本，提示
  const filtered = useMemo(() => {
    const kw = filter.trim().toLowerCase()
    return versions.filter((v) => {
      if (onlyRelease && v.type !== 'release') return false
      if (!kw) return true
      return v.id.toLowerCase().includes(kw)
    })
  }, [versions, filter, onlyRelease])

  const suggestion = useMemo(() => {
    if (!selected) return ''
    if (loader === 'vanilla') return `${selected.id}`
    return `${selected.id}-${loader}`
  }, [selected, loader])

  const startInstall = async (): Promise<void> => {
    if (!selected) return
    if (loader !== 'vanilla' && !loaderVersion) {
      ctx.toast('请先选择加载器版本', 'warn')
      return
    }
    setBusy(true)
    try {
      await window.mc.createInstance({
        name: name.trim() || suggestion,
        mcVersion: selected.id,
        loader,
        loaderVersion: loader === 'vanilla' ? undefined : loaderVersion
      })
      ctx.toast('已开始安装，可在底部任务栏查看进度', 'ok')
      onCreated()
    } catch (e) {
      ctx.toast(`安装失败：${errText(e)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="split">
      <div className="card">
        <div className="row" style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
          <div className="search-box">
            <IconSearch />
            <input
              className="input"
              placeholder="搜索版本号，如 1.20 / 1.21.4"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <label className="row" style={{ fontSize: 12, gap: 5, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={onlyRelease} onChange={(e) => setOnlyRelease(e.target.checked)} />
            仅正式版
          </label>
          <button className="btn sm ghost" onClick={() => void loadVersions(true)} title="刷新清单">
            <IconRefresh />
          </button>
        </div>
        <div className="version-list">
          {loading && (
            <div className="row" style={{ padding: 16, color: 'var(--muted)' }}>
              <span className="spinner" /> 正在获取版本清单…
            </div>
          )}
          {!loading && filtered.length === 0 && <div className="empty">没有匹配的版本</div>}
          {filtered.slice(0, 500).map((v) => (
            <div
              key={v.id}
              className={`version-item${selected?.id === v.id ? ' active' : ''}`}
              onClick={() => setSelected(v)}
            >
              <span className="vid">{v.id}</span>
              {v.type === 'release' ? (
                <span className="chip accent">正式</span>
              ) : v.type === 'snapshot' ? (
                <span className="chip warn">快照</span>
              ) : (
                <span className="chip">旧版</span>
              )}
              <span className="vdate">{formatDate(v.releaseTime)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>
          <IconCube /> 安装配置
        </div>

        <div className="form-row">
          <label>Minecraft 版本</label>
          <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>
            {selected?.id ?? '未选择'}
          </div>
          {selected && (
            <span className="hint">
              {selected.type === 'release' ? '正式版' : selected.type === 'snapshot' ? '快照' : '旧版'} ·{' '}
              {formatDate(selected.releaseTime)}
            </span>
          )}
        </div>

        <div className="form-row">
          <label>加载器</label>
          <div className="tabs" style={{ width: 'fit-content' }}>
            {LOADERS.map((l) => (
              <button
                key={l}
                className={`tab${loader === l ? ' active' : ''}`}
                onClick={() => setLoader(l)}
                type="button"
              >
                {LOADER_LABEL[l]}
              </button>
            ))}
          </div>
        </div>

        {loader !== 'vanilla' && (
          <div className="form-row">
            <label>{LOADER_LABEL[loader]} 版本</label>
            <select
              className="select"
              value={loaderVersion}
              disabled={loadingLoaders || loaderVersions.length === 0}
              onChange={(e) => setLoaderVersion(e.target.value)}
            >
              {loadingLoaders && <option value="">正在获取…</option>}
              {!loadingLoaders && loaderVersions.length === 0 && <option value="">该 MC 版本无可用版本</option>}
              {loaderVersions.map((l) => (
                <option key={l.version} value={l.version}>
                  {l.version}
                  {l.stable ? '（推荐）' : ''}
                </option>
              ))}
            </select>
            <span className="hint">
              {loader === 'forge' || loader === 'neoforge'
                ? 'Forge 系需要运行官方安装器，首次安装会稍慢，请保持网络畅通'
                : '默认已选中最新稳定版'}
            </span>
          </div>
        )}

        <div className="form-row">
          <label>实例名称</label>
          <input
            className="input"
            placeholder={suggestion}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <span className="hint">名称只用于启动器内显示，可随时修改</span>
        </div>

        <button className="btn primary lg" style={{ width: '100%', marginTop: 6 }} disabled={busy || !selected} onClick={() => void startInstall()}>
          {busy ? <span className="spinner" /> : <IconCube />}
          {busy ? '正在创建…' : '开始安装'}
        </button>

        <div className="muted" style={{ fontSize: 11.5, marginTop: 10, lineHeight: 1.6 }}>
          安装会下载游戏本体、运行库与全部资源（约 300MB ~ 1.5GB）。已开启镜像加速时优先走 BMCLAPI，失败自动回退官方源。
        </div>
      </div>
    </div>
  )
}
