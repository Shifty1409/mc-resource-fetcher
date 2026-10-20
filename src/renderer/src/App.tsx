import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InstanceMeta, SnapshotInfo, TaskInfo } from '@shared/types'
import type { GameExitEvent, GameLogEvent } from '@shared/ipc'
import Home from './pages/Home'
import Browse from './pages/Browse'
import Install from './pages/Install'
import SettingsPage from './pages/Settings'
import TaskDock from './components/TaskDock'
import DirPanel from './components/DirPanel'
import { errText } from './lib/format'
import { IconCube, IconDownload, IconHome, IconSettings } from './components/Icons'

export type Page = 'home' | 'browse' | 'install' | 'settings'

export interface ToastItem {
  id: number
  kind: 'ok' | 'warn' | 'error'
  text: string
}

export interface ConsoleLine {
  id: number
  text: string
  err: boolean
}

export interface UiCtx {
  toast: (text: string, kind?: ToastItem['kind']) => void
  refresh: () => Promise<void>
  setPage: (p: Page) => void
}

const NAV: Array<{ id: Page; label: string; icon: typeof IconHome }> = [
  { id: 'home', label: '主页', icon: IconHome },
  { id: 'browse', label: '下载资源', icon: IconDownload },
  { id: 'install', label: '安装版本', icon: IconCube },
  { id: 'settings', label: '设置', icon: IconSettings }
]

const TITLES: Record<Page, { title: string; sub: string }> = {
  home: { title: '我的实例', sub: '一键启动，无需微软账号' },
  browse: { title: '资源下载', sub: 'Modrinth / CurseForge 免费资源' },
  install: { title: '安装游戏版本', sub: '原版 与 Fabric / Quilt / Forge / NeoForge' },
  settings: { title: '设置', sub: '目录、下载、Java 与账号' }
}

export default function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<SnapshotInfo | null>(null)
  const [dirPath, setDirPath] = useState<string | null>(null)
  const [page, setPage] = useState<Page>('home')
  const [taskList, setTaskList] = useState<TaskInfo[]>([])
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([])
  const [runningId, setRunningId] = useState<string | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const lineId = useRef(0)

  const toast = useCallback((text: string, kind: ToastItem['kind'] = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev.slice(-3), { id, kind, text }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, kind === 'error' ? 7000 : 3500)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const snap = await window.mc.snapshot()
      setSnapshot(snap)
    } catch (e) {
      setBootError(errText(e))
    }
  }, [])

  useEffect(() => {
    if (!window.mc) {
      setBootError('preload 脚本未加载（window.mc 不存在）')
      return
    }
    void refresh()
    void window.mc.tasks().then(setTaskList)

    const offTask = window.mc.onTask((t) => {
      setTaskList((prev) => {
        const rest = prev.filter((x) => x.id !== t.id)
        return [t, ...rest].slice(0, 60)
      })
      if (t.status === 'done' && t.title.includes('安装')) {
        void refresh()
      }
      if (t.status === 'failed') toast(`${t.title} 失败：${t.error ?? ''}`, 'error')
    })
    const offLog = window.mc.onLog((e: GameLogEvent) => {
      setConsoleLines((prev) =>
        [...prev, { id: ++lineId.current, text: e.line, err: /error|exception|failed|could not/i.test(e.line) }].slice(-400)
      )
    })
    const offExit = window.mc.onGameExit((e: GameExitEvent) => {
      setRunningId(null)
      if (e.crashed) toast(`游戏退出（代码 ${e.code}）：${e.message}`, 'error')
      else toast('游戏已退出')
    })
    const offInst = window.mc.onInstances((list: InstanceMeta[]) => {
      setSnapshot((s) => (s ? { ...s, instances: list } : s))
    })
    return () => {
      offTask()
      offLog()
      offExit()
      offInst()
    }
  }, [refresh, toast])

  const launch = useCallback(
    async (inst: InstanceMeta) => {
      setRunningId(inst.id)
      try {
        const r = await window.mc.launch(inst.id)
        toast(r.message)
      } catch (e) {
        setRunningId(null)
        toast(`启动失败：${errText(e)}`, 'error')
      }
    },
    [toast]
  )

  // 必须保持引用稳定：各页面的 effect 把 ctx 放进了依赖数组，
  // 每次渲染都新建对象会导致搜索/详情接口被无限重复调用
  const ctx: UiCtx = useMemo(() => ({ toast, refresh, setPage }), [toast, refresh])

  if (bootError) {
    return (
      <div style={{ padding: 40, fontFamily: 'inherit' }}>
        <h2>启动异常</h2>
        <pre style={{ whiteSpace: 'pre-wrap', color: '#b3261e' }}>{bootError}</pre>
        <p className="muted">请查看 MCLauncherData/logs/launcher.log</p>
      </div>
    )
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">MC</div>
          <div className="brand-text">
            <b>资源下载器</b>
            <span>PCL 风格 · 离线启动</span>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={`nav-item${page === item.id ? ' active' : ''}`}
                onClick={() => setPage(item.id)}
              >
                <Icon />
                {item.label}
              </button>
            )
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="kv">
            <span>实例</span>
            <b>{snapshot?.instances.length ?? 0}</b>
          </div>
          <div className="kv">
            <span>Java</span>
            <b>{snapshot?.javaList.length ?? 0} 个</b>
          </div>
          <div className="kv">
            <span>离线玩家</span>
            <b>{snapshot?.config.offlineName ?? '-'}</b>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <h1>{TITLES[page].title}</h1>
            <div className="sub">{TITLES[page].sub}</div>
          </div>
          <div className="spacer" />
          {snapshot && (
            <button className="btn sm" onClick={() => setDirPath(snapshot.gameRoot)}>
              打开游戏目录
            </button>
          )}
        </header>

        <main className="content">
          {page === 'home' && (
            <Home
              instances={snapshot?.instances ?? []}
              config={snapshot?.config ?? null}
              javaList={snapshot?.javaList ?? []}
              runningId={runningId}
              consoleLines={consoleLines}
              onLaunch={launch}
              onNew={() => setPage('install')}
              onClearConsole={() => setConsoleLines([])}
              ctx={ctx}
            />
          )}
          {page === 'browse' && <Browse instances={snapshot?.instances ?? []} ctx={ctx} />}
          {page === 'install' && (
            <Install
              instances={snapshot?.instances ?? []}
              ctx={ctx}
              onCreated={() => {
                void refresh()
                setPage('home')
              }}
            />
          )}
          {page === 'settings' && snapshot && (
            <SettingsPage
              snapshot={snapshot}
              ctx={ctx}
              onSaved={refresh}
              onOpenDir={(start) => setDirPath(start)}
            />
          )}
        </main>
      </div>

      <TaskDock
        tasks={taskList}
        onCancel={(id) => {
          void window.mc.cancelTask(id)
        }}
        onClear={() => setTaskList((prev) => prev.filter((t) => t.status === 'running'))}
      />

      {dirPath && (
        <DirPanel
          initialPath={dirPath}
          onClose={() => setDirPath(null)}
          onToast={(msg, kind) => toast(msg, kind === 'error' ? 'error' : 'ok')}
          onPick={async (p) => {
            await window.mc.saveConfig({ gameRoot: p })
            void refresh()
          }}
        />
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'ok' ? '' : t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}
