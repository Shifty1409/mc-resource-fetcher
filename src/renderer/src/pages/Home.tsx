import { useState } from 'react'
import type { InstanceMeta, JavaInfo, AppConfig } from '@shared/types'
import { LOADER_LABEL } from '@shared/types'
import { formatBytes, ratio, timeAgo } from '../lib/format'
import type { ConsoleLine, UiCtx } from '../App'
import { errText } from '../lib/format'
import {
  IconConsole,
  IconCube,
  IconFolder,
  IconPlay,
  IconPlus,
  IconSettings,
  IconTrash,
  IconX
} from '../components/Icons'

interface Props {
  instances: InstanceMeta[]
  config: AppConfig | null
  javaList: JavaInfo[]
  runningId: string | null
  consoleLines: ConsoleLine[]
  onLaunch: (inst: InstanceMeta) => void
  onNew: () => void
  onClearConsole: () => void
  ctx: UiCtx
}

export default function Home({
  instances,
  config,
  javaList,
  runningId,
  consoleLines,
  onLaunch,
  onNew,
  onClearConsole,
  ctx
}: Props): React.JSX.Element {
  const [editing, setEditing] = useState<InstanceMeta | null>(null)
  const [showConsole, setShowConsole] = useState(false)

  const remove = async (inst: InstanceMeta): Promise<void> => {
    if (!window.confirm(`确定删除实例「${inst.name}」？\n该实例的存档与模组会一起删除，已下载的原版文件会保留。`))
      return
    try {
      await window.mc.deleteInstance(inst.id)
      ctx.toast('实例已删除')
      void ctx.refresh()
    } catch (e) {
      ctx.toast(errText(e), 'error')
    }
  }

  const openDir = async (inst: InstanceMeta): Promise<void> => {
    try {
      await window.mc.openInstanceDir(inst.id)
    } catch (e) {
      ctx.toast(errText(e), 'error')
    }
  }

  return (
    <div>
      <div className="section-title">
        实例 <span className="hint">{instances.length} 个 · 点「启动」直接进游戏</span>
        <span className="line" />
        {config && (
          <button
            className="btn sm"
            onClick={() => window.mc.openPath(config.gameRoot).catch((e) => ctx.toast(errText(e), 'error'))}
          >
            <IconFolder /> 游戏目录
          </button>
        )}
        <button className="btn sm primary" onClick={onNew}>
          <IconPlus /> 新建实例
        </button>
      </div>

      {instances.length === 0 ? (
        <div className="empty">
          <b>还没有任何实例</b>
          先到「安装版本」选一个 MC 版本（可附加 Fabric/Forge 等加载器），装好后回来一键启动。
          <div style={{ marginTop: 14 }}>
            <button className="btn primary lg" onClick={onNew}>
              <IconCube /> 去安装第一个版本
            </button>
          </div>
        </div>
      ) : (
        <div className="instances">
          {instances.map((inst) => {
            const busy = runningId === inst.id
            return (
              <div key={inst.id} className="card instance-card">
                <div className="instance-icon" style={{ background: inst.iconColor ?? '#3aa757' }}>
                  {inst.iconText ?? inst.name.slice(0, 2)}
                </div>
                <div className="instance-body">
                  <div className="instance-name" title={inst.name}>
                    {inst.name}
                  </div>
                  <div className="instance-meta">
                    <span className="chip accent">{inst.mcVersion}</span>
                    <span className="chip">
                      {LOADER_LABEL[inst.loader]}
                      {inst.loader !== 'vanilla' && inst.loaderVersion ? ` ${inst.loaderVersion}` : ''}
                    </span>
                    <span className="chip line">{inst.memoryMb} MB</span>
                  </div>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {timeAgo(inst.lastPlayedAt)}
                  </div>
                  <div className="instance-actions" style={{ marginTop: 9 }}>
                    <button className="btn primary instance-play" disabled={busy} onClick={() => onLaunch(inst)}>
                      {busy ? <span className="spinner" /> : <IconPlay />}
                      {busy ? '启动中' : '启动'}
                    </button>
                    <button className="btn sm" onClick={() => openDir(inst)}>
                      <IconFolder /> 目录
                    </button>
                    <button className="btn sm ghost" onClick={() => setEditing(inst)}>
                      <IconSettings /> 设置
                    </button>
                    <button className="btn sm danger" onClick={() => void remove(inst)}>
                      <IconTrash />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
          <button className="card new-instance" onClick={onNew}>
            <IconPlus />
            <span style={{ marginTop: 6 }}>新建实例</span>
          </button>
        </div>
      )}

      {consoleLines.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div className="section-title">
            游戏控制台 <span className="hint">{consoleLines.length} 行</span>
            <span className="line" />
            <button className="btn sm ghost" onClick={() => setShowConsole((v) => !v)}>
              {showConsole ? '收起' : '展开'}
            </button>
            <button className="btn sm ghost" onClick={onClearConsole}>
              <IconX /> 清空
            </button>
          </div>
          {showConsole && (
            <div className="console">
              {consoleLines.map((l) => (
                <div key={l.id} className={l.err ? 'err' : ''}>
                  {l.text}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!showConsole && consoleLines.length === 0 && instances.length > 0 && (
        <div className="muted" style={{ marginTop: 18, fontSize: 12 }}>
          <IconConsole style={{ width: 14, height: 14, verticalAlign: -2 }} /> 启动后这里会显示游戏控制台输出
        </div>
      )}

      {editing && (
        <InstanceSettings
          inst={editing}
          javaList={javaList}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            ctx.toast('实例设置已保存')
            void ctx.refresh()
          }}
          ctx={ctx}
        />
      )}
    </div>
  )
}

function InstanceSettings({
  inst,
  javaList,
  onClose,
  onSaved,
  ctx
}: {
  inst: InstanceMeta
  javaList: JavaInfo[]
  onClose: () => void
  onSaved: () => void
  ctx: UiCtx
}): React.JSX.Element {
  const [name, setName] = useState(inst.name)
  const [mem, setMem] = useState(inst.memoryMb)
  const [java, setJava] = useState(inst.javaPath ?? '')
  const [jvm, setJvm] = useState(inst.extraJvmArgs ?? '')
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const major = javaList.find((j) => j.path === java)?.major
      await window.mc.updateInstance({
        ...inst,
        name: name.trim() || inst.name,
        memoryMb: mem,
        javaPath: java || undefined,
        javaMajor: major,
        extraJvmArgs: jvm.trim() || undefined
      })
      onSaved()
    } catch (e) {
      ctx.toast(errText(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="grow">
            <h2>实例设置</h2>
            <div className="muted" style={{ fontSize: 12 }}>
              {inst.mcVersion} · {LOADER_LABEL[inst.loader]} {inst.loaderVersion ?? ''}
            </div>
          </div>
          <button className="btn ghost sm" onClick={onClose}>
            <IconX />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <label>实例名称</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-row">
            <label>最大内存 (MB)</label>
            <input
              className="input"
              type="number"
              min={512}
              max={65536}
              step={512}
              value={mem}
              onChange={(e) => setMem(Number(e.target.value) || 2048)}
            />
            <span className="hint">建议 2048~8192；分配越大启动越慢但更少卡顿</span>
          </div>
          <div className="form-row">
            <label>Java 运行时</label>
            <select className="select" value={java} onChange={(e) => setJava(e.target.value)}>
              <option value="">自动选择（推荐）</option>
              {javaList.map((j) => (
                <option key={j.path} value={j.path}>
                  Java {j.major} · {j.vendor} · {j.source === 'downloaded' ? '已下载' : '系统'}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>额外 JVM 参数</label>
            <input
              className="input"
              placeholder="例如 -XX:+UseG1GC"
              value={jvm}
              onChange={(e) => setJvm(e.target.value)}
            />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn" onClick={onClose}>
              取消
            </button>
            <button className="btn primary" disabled={saving} onClick={() => void save()}>
              {saving ? <span className="spinner" /> : null} 保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export { formatBytes, ratio }
