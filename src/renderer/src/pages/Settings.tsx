import { useEffect, useState } from 'react'
import type { AppConfig, JavaInfo, SnapshotInfo } from '@shared/types'
import type { UiCtx } from '../App'
import { errText } from '../lib/format'
import { IconCheck, IconFolder, IconJava, IconRefresh } from '../components/Icons'

interface Props {
  snapshot: SnapshotInfo
  ctx: UiCtx
  onSaved: () => Promise<void>
}

export default function SettingsPage({ snapshot, ctx, onSaved }: Props): React.JSX.Element {
  const [cfg, setCfg] = useState<AppConfig>(snapshot.config)
  const [javaList, setJavaList] = useState<JavaInfo[]>(snapshot.javaList)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setCfg(snapshot.config)
    setJavaList(snapshot.javaList)
  }, [snapshot])

  const patch = (p: Partial<AppConfig>): void => setCfg((c) => ({ ...c, ...p }))

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.mc.saveConfig(cfg)
      ctx.toast('设置已保存')
      await onSaved()
    } catch (e) {
      ctx.toast(errText(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const pickDir = async (): Promise<void> => {
    const dir = await window.mc.selectDir(cfg.gameRoot)
    if (dir) patch({ gameRoot: dir })
  }

  const refreshJava = async (): Promise<void> => {
    try {
      const list = await window.mc.javas(true)
      setJavaList(list)
      ctx.toast(`检测到 ${list.length} 个 Java`)
    } catch (e) {
      ctx.toast(errText(e), 'error')
    }
  }

  const downloadJava = async (major: number): Promise<void> => {
    try {
      await window.mc.downloadJava(major)
      ctx.toast(`已开始下载 Java ${major}`)
    } catch (e) {
      ctx.toast(errText(e), 'error')
    }
  }

  return (
    <div className="settings-grid">
      <div className="card">
        <div className="setting-row">
          <div className="label">
            游戏目录
            <div className="desc">versions / libraries / assets / instances 都放这里</div>
          </div>
          <div className="control">
            <input className="input mono" style={{ maxWidth: 420 }} value={cfg.gameRoot} readOnly />
            <button className="btn sm" onClick={() => void pickDir()}>
              选择
            </button>
            <button className="btn sm ghost" onClick={() => void window.mc.openPath(cfg.gameRoot)}>
              <IconFolder />
            </button>
          </div>
        </div>

        <div className="setting-row">
          <div className="label">
            BMCLAPI 镜像
            <div className="desc">国内加速原版、运行库、Fabric/Forge 下载；失败自动回退官方源</div>
          </div>
          <div className="control">
            <div className={`switch${cfg.useMirror ? ' on' : ''}`} onClick={() => patch({ useMirror: !cfg.useMirror })} />
          </div>
        </div>

        <div className="setting-row">
          <div className="label">
            下载并发
            <div className="desc">同时下载的文件数，网络差时建议 4~8</div>
          </div>
          <div className="control">
            <input
              className="input"
              type="number"
              min={1}
              max={32}
              value={cfg.concurrency}
              style={{ width: 90 }}
              onChange={(e) => patch({ concurrency: Number(e.target.value) || 8 })}
            />
          </div>
        </div>

        <div className="setting-row">
          <div className="label">
            默认内存
            <div className="desc">新建实例的默认最大内存（MB）</div>
          </div>
          <div className="control">
            <input
              className="input"
              type="number"
              min={512}
              max={65536}
              step={512}
              value={cfg.defaultMemoryMb}
              style={{ width: 120 }}
              onChange={(e) => patch({ defaultMemoryMb: Number(e.target.value) || 2048 })}
            />
          </div>
        </div>

        <div className="setting-row">
          <div className="label">
            离线玩家名
            <div className="desc">不加 - 不加空格，最长 16 字符；离线 UUID 由它推导</div>
          </div>
          <div className="control">
            <input
              className="input"
              maxLength={16}
              value={cfg.offlineName}
              style={{ width: 220 }}
              onChange={(e) => patch({ offlineName: e.target.value })}
            />
          </div>
        </div>

        <div className="setting-row">
          <div className="label">
            自动下载 Java
            <div className="desc">缺失匹配版本时自动从 Mojang / Adoptium 下载运行环境</div>
          </div>
          <div className="control">
            <div
              className={`switch${cfg.autoDownloadJava ? ' on' : ''}`}
              onClick={() => patch({ autoDownloadJava: !cfg.autoDownloadJava })}
            />
          </div>
        </div>

        <div className="setting-row">
          <div className="label">
            CurseForge API Key
            <div className="desc">可选。填了才能搜 CurseForge 与安装 CF 整合包</div>
          </div>
          <div className="control">
            <input
              className="input mono"
              type="password"
              placeholder="$2a$10$..."
              value={cfg.curseforgeApiKey}
              style={{ maxWidth: 420 }}
              onChange={(e) => patch({ curseforgeApiKey: e.target.value })}
            />
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', padding: 12 }}>
          <button className="btn primary" disabled={saving} onClick={() => void save()}>
            {saving ? <span className="spinner" /> : <IconCheck />} 保存设置
          </button>
        </div>
      </div>

      <div className="card">
        <div className="setting-row">
          <div className="label">
            Java 运行时
            <div className="desc">
              自动检测到 {javaList.length} 个。MC 1.16- 需 Java 8，1.17 需 16，1.18~1.20.4 需 17，1.20.5+ 需 21
            </div>
          </div>
          <div className="control">
            <button className="btn sm" onClick={() => void refreshJava()}>
              <IconRefresh /> 重新检测
            </button>
          </div>
        </div>

        {javaList.map((j) => (
          <div className="setting-row" key={j.path} style={{ paddingLeft: 26 }}>
            <div className="label" style={{ width: 70, flex: '0 0 70px' }}>
              <span className="chip accent">Java {j.major}</span>
            </div>
            <div className="control" style={{ justifyContent: 'space-between' }}>
              <span className="mono muted" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {j.path}
              </span>
              <span className="chip line">{j.vendor}</span>
              <span className={`chip ${j.source === 'downloaded' ? 'warn' : ''}`}>
                {j.source === 'downloaded' ? '启动器下载' : '系统'}
              </span>
            </div>
          </div>
        ))}

        {javaList.length === 0 && (
          <div className="setting-row">
            <div className="control" style={{ justifyContent: 'flex-start', color: 'var(--muted)' }}>
              未检测到 Java，可点下面的按钮让启动器自动下载
            </div>
          </div>
        )}

        <div className="setting-row">
          <div className="label">
            下载 Java
            <div className="desc">从 Mojang 官方运行时清单获取，缺失版本时启动也会自动装</div>
          </div>
          <div className="control">
            {[8, 17, 21, 25].map((m) => (
              <button key={m} className="btn sm" onClick={() => void downloadJava(m)}>
                <IconJava /> {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>
          关于 <span className="line" />
        </div>
        <div style={{ fontSize: 12.5, lineHeight: 1.8, color: 'var(--text-soft)' }}>
          <div>MC 资源下载器 · 参考 PCL2 的交互设计，仅供个人使用。</div>
          <div>
            资源来源：Modrinth（开放 API）、CurseForge（需自带 Key）、Mojang 官方清单、BMCLAPI 镜像、FabricMC /
            QuiltMC / Forge / NeoForge 官方元数据。
          </div>
          <div className="muted" style={{ marginTop: 6 }}>
            离线模式仅在你本机生成离线身份（OfflinePlayer UUID），不连接微软账号体系；仅可用于单人游戏与离线服务器，
            请勿用于需要正版验证的服务器。
          </div>
        </div>
      </div>

      {window.location.protocol === 'http:' && (
        <div className="card" style={{ padding: 14 }}>
          <div className="section-title" style={{ marginTop: 0 }}>
            退出 <span className="line" />
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-soft)', lineHeight: 1.7 }}>
            当前运行在「应用窗口」模式下，直接关掉窗口可能残留后台服务。点下面的按钮可以连服务一起彻底退出。
          </div>
          <button
            className="btn danger"
            style={{ marginTop: 10 }}
            onClick={async () => {
              try {
                await fetch('/api/shutdown', { method: 'POST' })
                document.body.innerHTML =
                  '<div style="font-family:\'Microsoft YaHei UI\',sans-serif;padding:40px;color:#48584f">启动器已退出，可以关闭这个窗口了。</div>'
              } catch {
                ctx.toast('退出请求失败，请手动关闭', 'error')
              }
            }}
          >
            退出启动器
          </button>
        </div>
      )}
    </div>
  )
}
