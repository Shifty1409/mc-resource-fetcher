import { useEffect, useState } from 'react'
import type { ContentDetail, ContentHit, InstanceMeta } from '@shared/types'
import { CONTENT_LABEL } from '@shared/types'
import type { UiCtx } from '../App'
import { errText, formatBytes, formatCount, formatDate } from '../lib/format'
import { IconDownload, IconLink, IconX } from './Icons'

interface Props {
  hit: ContentHit
  target: InstanceMeta | undefined
  ctx: UiCtx
  onClose: () => void
  onInstall: (file?: { url: string; fileName: string; versionId?: string }) => void
}

export default function DetailModal({ hit, target, ctx, onClose, onInstall }: Props): React.JSX.Element {
  const [detail, setDetail] = useState<ContentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [pickedFile, setPickedFile] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.mc
      .detail(hit.provider, hit.id, hit.kind)
      .then((d) => {
        if (cancelled) return
        setDetail(d)
        // 默认选中与实例匹配的文件
        const match = target
          ? d.files.find(
              (f) =>
                f.gameVersions.includes(target.mcVersion) &&
                (target.loader === 'vanilla' || f.loaders.length === 0 || f.loaders.includes(target.loader))
            )
          : undefined
        setPickedFile((match ?? d.files[0])?.url ?? '')
      })
      .catch((e) => {
        if (!cancelled) ctx.toast(`获取详情失败：${errText(e)}`, 'error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [hit, target, ctx])

  const file = detail?.files.find((f) => f.url === pickedFile)

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          {hit.iconUrl ? <img src={hit.iconUrl} alt="" /> : <div className="hit-icon" />}
          <div className="grow">
            <h2>{hit.title}</h2>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="chip accent">{CONTENT_LABEL[hit.kind]}</span>
              <span className="chip">{hit.provider === 'modrinth' ? 'Modrinth' : 'CurseForge'}</span>
              <span className="chip line">{formatCount(hit.downloads)} 下载</span>
              {detail?.license && <span className="chip line">{detail.license}</span>}
              {hit.updatedAt && <span className="chip line">更新 {formatDate(hit.updatedAt)}</span>}
            </div>
            <div className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>
              {hit.description}
            </div>
          </div>
          <button className="btn ghost sm" onClick={onClose}>
            <IconX />
          </button>
        </div>

        <div className="modal-body">
          {loading && (
            <div className="row muted" style={{ padding: 12 }}>
              <span className="spinner" /> 正在加载详情…
            </div>
          )}

          {!loading && (
            <>
              {target ? (
                <div className="row" style={{ marginBottom: 12, fontSize: 12.5 }}>
                  <span className="muted">安装到</span>
                  <b>{target.name}</b>
                  <span className="chip accent">
                    MC {target.mcVersion}
                  </span>
                  <span className="chip">{target.loader}</span>
                  {hit.kind === 'modpack' && <span className="chip warn">整合包会新建独立实例</span>}
                </div>
              ) : (
                <div className="row" style={{ marginBottom: 12 }}>
                  <span className="chip danger">尚未选择实例</span>
                  <span className="muted">请先在列表顶部选择「安装到」的实例</span>
                </div>
              )}

              {detail && detail.files.length > 0 && hit.kind !== 'modpack' && (
                <div style={{ marginBottom: 12 }}>
                  <div className="section-title" style={{ fontSize: 12.5 }}>
                    可选文件 <span className="hint">{detail.files.length} 个版本</span>
                    <span className="line" />
                  </div>
                  <div style={{ maxHeight: 210, overflowY: 'auto' }}>
                    {detail.files.slice(0, 60).map((f) => {
                      const fits =
                        !target ||
                        (f.gameVersions.includes(target.mcVersion) &&
                          (target.loader === 'vanilla' || f.loaders.length === 0 || f.loaders.includes(target.loader)))
                      return (
                        <label
                          key={f.url}
                          className="file-row"
                          style={{ cursor: 'pointer', borderColor: pickedFile === f.url ? 'var(--accent)' : undefined }}
                        >
                          <input
                            type="radio"
                            name="file"
                            checked={pickedFile === f.url}
                            onChange={() => setPickedFile(f.url)}
                          />
                          <span className="grow" title={f.fileName}>
                            {f.versionName} · {f.fileName}
                          </span>
                          {fits ? <span className="chip accent">适配</span> : <span className="chip warn">未适配</span>}
                          <span className="muted" style={{ fontSize: 11 }}>
                            {formatBytes(f.size)}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}

              {detail?.body && (
                <div>
                  <div className="section-title" style={{ fontSize: 12.5 }}>
                    简介 <span className="line" />
                  </div>
                  <div className="prose">{detail.body.slice(0, 6000)}</div>
                </div>
              )}

              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="btn" onClick={() => void window.mc.openPath(hit.pageUrl)}>
                  <IconLink /> 打开项目页
                </button>
                <button
                  className="btn primary"
                  disabled={!target && hit.kind !== 'modpack'}
                  onClick={() =>
                    onInstall(
                      file ? { url: file.url, fileName: file.fileName, versionId: file.versionId } : undefined
                    )
                  }
                >
                  <IconDownload /> 安装{file ? ` ${file.versionName}` : ''}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
