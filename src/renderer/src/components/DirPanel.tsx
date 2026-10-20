import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { DirListing } from '../../../shared/api'

interface Props {
  initialPath: string
  onClose: () => void
  onToast: (msg: string, kind?: 'ok' | 'error') => void
  /** 传入后显示「选为游戏目录」按钮 */
  onPick?: (path: string) => void
}

function fmtSize(n: number): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}

/** 应用内目录浏览面板：不依赖系统外壳，打包版/浏览器版行为一致 */
export default function DirPanel({ initialPath, onClose, onToast, onPick }: Props): ReactElement {
  const [listing, setListing] = useState<DirListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [drives, setDrives] = useState<string[]>([])
  const [manual, setManual] = useState('')

  const load = useCallback(
    async (p: string) => {
      setLoading(true)
      setError('')
      try {
        const res = await window.mc.fsList(p)
        setListing(res)
        setPicked([])
        setManual(res.path)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    void load(initialPath)
  }, [initialPath, load])

  useEffect(() => {
    void window.mc
      .fsDrives()
      .then((d) => setDrives(d))
      .catch(() => setDrives([]))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copyPath = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      onToast('已复制路径', 'ok')
    } catch {
      onToast('复制失败，请手动选择路径文本', 'error')
    }
  }

  const crumbs = listing ? listing.path.split(/[\\/]/).filter(Boolean) : []

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal dir-panel" onClick={(e) => e.stopPropagation()}>
        <div className="dir-head">
          <b>游戏目录</b>
          <div className="spacer" />
          <button className="btn sm ghost" onClick={() => void copyPath(listing?.path ?? initialPath)}>
            复制路径
          </button>
          {onPick && listing && (
            <button
              className="btn sm"
              onClick={() => {
                onPick(listing.path)
                onToast(`游戏目录已设为 ${listing.path}`, 'ok')
                onClose()
              }}
            >
              选为游戏目录
            </button>
          )}
          <button className="btn sm ghost" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="dir-bar">
          {drives.map((d) => (
            <button key={d} className="btn sm ghost dir-drive" onClick={() => void load(d)}>
              {d}
            </button>
          ))}
          <input
            className="input mono"
            style={{ flex: 1, minWidth: 180 }}
            placeholder="直接粘贴路径后按回车"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && manual.trim()) void load(manual.trim())
            }}
          />
          <button className="btn sm ghost" onClick={() => manual.trim() && void load(manual.trim())}>
            转到
          </button>
        </div>

        <div className="dir-crumbs">
          {crumbs.map((c, i) => {
            const target = listing ? listing.path.split(/[\\/]/).slice(0, i + 1).join('\\') : ''
            return (
              <span key={`${c}-${i}`}>
                <a onClick={() => void load(target)}>{c}</a>
                {i < crumbs.length - 1 && <i>›</i>}
              </span>
            )
          })}
        </div>

        <div className="dir-body">
          {loading && <div className="dir-tip">读取中…</div>}
          {error && <div className="dir-tip err">{error}</div>}
          {!loading && !error && listing && (
            <>
              {listing.parent && (
                <div className="dir-row" onClick={() => void load(listing.parent as string)}>
                  <span className="dir-icon">↩</span>
                  <span className="dir-name">上一层</span>
                </div>
              )}
              {listing.entries.length === 0 && <div className="dir-tip">（空目录）</div>}
              {listing.entries.map((e) => (
                <div
                  key={e.name}
                  className={'dir-row' + (e.isDir ? ' is-dir' : '') + (picked.includes(e.name) ? ' picked' : '')}
                  onClick={() => {
                    if (e.isDir) void load(`${listing.path}\\${e.name}`)
                    else setPicked([e.name])
                  }}
                >
                  <span className="dir-icon">{e.isDir ? '📁' : '📄'}</span>
                  <span className="dir-name">{e.name}</span>
                  <span className="dir-size">{fmtSize(e.size)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
