import type { TaskInfo } from '@shared/types'
import { useState } from 'react'
import { formatBytes, ratio } from '../lib/format'
import { IconChevron, IconDownload, IconX } from '../components/Icons'

interface Props {
  tasks: TaskInfo[]
  onCancel: (id: string) => void
  onClear: () => void
}

export default function TaskDock({ tasks, onCancel, onClear }: Props): React.JSX.Element | null {
  const [open, setOpen] = useState(true)
  if (tasks.length === 0) return null
  const running = tasks.filter((t) => t.status === 'running')
  const primary = running[0] ?? tasks[0]
  const r = ratio(primary.done, primary.total)
  const hasFinished = tasks.some((t) => t.status !== 'running')

  return (
    <div className="dock">
      <div className="dock-head" onClick={() => setOpen((v) => !v)}>
        <IconChevron
          style={{
            width: 14,
            height: 14,
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform .15s',
            color: 'var(--muted)'
          }}
        />
        <span className="count">
          {running.length > 0 ? `${running.length} 个任务进行中` : '任务已完成'}
        </span>
        {primary.status === 'running' && (
          <>
            <span className="muted" style={{ fontSize: 12 }}>
              {primary.title} · {primary.phase}
            </span>
            <div className={`progress${primary.total > 0 ? '' : ' indeterminate'}`} style={{ maxWidth: 320 }}>
              <i style={{ width: `${r * 100}%` }} />
            </div>
            <span className="muted" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
              {primary.total > 0 ? `${Math.round(r * 100)}%` : ''} {formatBytes(primary.speed)}/s
            </span>
          </>
        )}
        <div className="spacer" style={{ flex: 1 }} />
        {hasFinished && (
          <button
            className="btn sm ghost"
            onClick={(e) => {
              e.stopPropagation()
              onClear()
            }}
          >
            <IconX /> 清理已完成
          </button>
        )}
      </div>

      {open && (
        <div className="dock-body">
          {tasks.map((t) => {
            const p = ratio(t.done, t.total)
            return (
              <div className="task-row" key={t.id}>
                <IconDownload
                  style={{
                    width: 14,
                    height: 14,
                    color: t.status === 'failed' ? 'var(--danger)' : 'var(--accent)'
                  }}
                />
                <span className="task-title" title={t.title}>
                  {t.title}
                </span>
                <span className="task-phase" title={t.message || t.phase}>
                  {t.status === 'running' ? t.phase : t.status === 'done' ? '完成' : t.status === 'cancelled' ? '已取消' : '失败'}
                  {t.message ? ` · ${t.message}` : ''}
                </span>
                <div className={`progress${t.total > 0 ? '' : t.status === 'running' ? ' indeterminate' : ''}`}>
                  <i
                    style={{
                      width: `${p * 100}%`,
                      background:
                        t.status === 'failed'
                          ? 'var(--danger)'
                          : t.status === 'done'
                            ? 'linear-gradient(90deg,#26c67c,#0e9457)'
                            : undefined
                    }}
                  />
                </div>
                <span className="task-stat">
                  {t.total > 0 ? `${formatBytes(t.done)} / ${formatBytes(t.total)}` : formatBytes(t.done)}
                  {t.status === 'running' && t.speed > 0 ? ` · ${formatBytes(t.speed)}/s` : ''}
                </span>
                {t.status === 'running' && (
                  <button className="btn sm ghost" onClick={() => onCancel(t.id)} title="取消">
                    <IconX />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
