import { app, BrowserWindow, shell, session } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { registerIpc, setMainWindow } from './ipc'
import { config } from './core/config'
import { log, logError, openLauncherLog } from './core/log'
import { portableRoot } from './core/paths'
import { ensureDir } from './core/util'

/**
 * 启动探针：无条件写 <data>/boot.log。
 * 桌面版「双击没反应」时，这个文件就是唯一线索（诊断.bat 会打印它）。
 * 每条都带毫秒时间戳，方便判断卡在哪一步。
 */
const bootSeq = (): number => Math.round(performance.now())
const bootLog = (m: string): void => {
  try {
    mkdirSync(portableRoot, { recursive: true })
    appendFileSync(join(portableRoot, 'boot.log'), `[+${bootSeq()}ms] ${m}\n`)
  } catch {
    /* 写不了就算了，不能因为日志挂掉启动 */
  }
}

bootLog(`module loaded, argv=${process.argv.join(' ')}`)
bootLog(`electron=${process.versions.electron} chrome=${process.versions.chrome} node=${process.versions.node}`)
bootLog(`packaged=${app.isPackaged} dataRoot=${portableRoot}`)
bootLog(`exe=${process.execPath}`)

process.on('uncaughtException', (e) => bootLog(`uncaughtException: ${e?.stack ?? e}`))
process.on('unhandledRejection', (e) => bootLog(`unhandledRejection: ${String(e)}`))
process.on('exit', (code) => bootLog(`process exit code=${code}`))

// --safe-mode：GPU 与沙箱是这类机器上最常见的两个崩溃点
const safeMode = process.argv.includes('--safe-mode')
if (safeMode) {
  bootLog('safe mode: disable-gpu + no-sandbox')
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu')
}

app.on('child-process-gone', (_e, details) => {
  bootLog(`child-process-gone type=${details.type} reason=${details.reason} code=${details.exitCode}`)
})
app.on('render-process-gone', (_e, _wc, details) => {
  bootLog(`render-process-gone reason=${details.reason} code=${details.exitCode}`)
})

let win: BrowserWindow | null = null

/** 主窗口加载失败时显示的最小诊断页，避免「窗口一片白」什么都不说 */
function showFallbackWindow(reason: string): void {
  const html = `<!doctype html><meta charset="utf-8"><body style="font-family:'Microsoft YaHei UI',sans-serif;padding:28px;color:#1d2a24;background:#f6f8f6">
<h2 style="margin:0 0 8px">界面加载失败</h2>
<p style="color:#7b8a82;font-size:13px">启动器已经起来了，但渲染进程没能加载页面。</p>
<pre style="background:#fff;border:1px solid #e2e8e4;border-radius:8px;padding:12px;font-size:12px;white-space:pre-wrap;user-select:text">${reason.replace(
    /[<>&]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] as string
  )}</pre>
<p style="font-size:12px;color:#7b8a82">完整日志：${portableRoot}\\boot.log</p>
<p style="font-size:12px;color:#7b8a82">也可以改用浏览器模式：双击「浏览器版.bat」。</p>
</body>`
  try {
    if (win && !win.isDestroyed()) {
      void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      win.show()
    }
  } catch (e) {
    bootLog(`fallback window failed: ${String(e)}`)
  }
}

function createWindow(): void {
  bootLog('createWindow: begin')
  win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1100,
    minHeight: 720,
    // 直接显示：早先依赖 ready-to-show 才 show，一旦该事件不触发就永远没有窗口
    show: true,
    backgroundColor: '#f3f6f3',
    title: 'MC 资源下载器',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  bootLog('createWindow: BrowserWindow constructed, id=' + win.id)

  win.on('show', () => bootLog('window: show event'))
  win.on('closed', () => {
    bootLog('window: closed')
    win = null
  })
  win.webContents.on('did-start-loading', () => bootLog('webContents: did-start-loading'))
  win.webContents.on('did-finish-load', () => {
    bootLog('webContents: did-finish-load')
    win?.show()
    win?.focus()
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    bootLog(`webContents: did-fail-load code=${code} desc=${desc} url=${url}`)
    showFallbackWindow(`did-fail-load ${code} ${desc}\n${url}`)
  })
  win.webContents.on('preload-error', (_e, path, err) => {
    bootLog(`webContents: preload-error ${path} ${err?.stack ?? err}`)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    bootLog(`loadURL ${devUrl}`)
    void win.loadURL(devUrl)
  } else {
    const file = join(__dirname, '../renderer/index.html')
    bootLog(`loadFile ${file}`)
    void win.loadFile(file).catch((e) => {
      bootLog(`loadFile rejected: ${String(e)}`)
      showFallbackWindow(`loadFile 失败：${String(e)}\n${file}`)
    })
  }
}

bootLog('step: whenReady')
void app.whenReady().then(async () => {
  bootLog('whenReady resolved')
  app.setAppUserModelId('com.dsh.mclauncher')
  try {
    await openLauncherLog()
    await config.load()
    await ensureDir(config.get().gameRoot)
    bootLog(`config loaded, gameRoot=${config.get().gameRoot}`)
  } catch (e) {
    logError('boot', e)
    bootLog(`config load failed: ${String(e)}`)
  }

  // 无窗口端到端自检：electron . --smoke
  if (process.argv.includes('--smoke')) {
    const { runSmoke } = await import('./core/smoke')
    const code = await runSmoke()
    app.exit(code)
    return
  }

  // 某些机器上原始 session 的权限策略会挡住外部图片，放开 http(s) 图片
  try {
    session.defaultSession.webRequest.onBeforeSendHeaders((details, cb) => cb({ requestHeaders: details.requestHeaders }))
  } catch {
    /* ignore */
  }

  registerIpc()
  bootLog('ipc registered')
  createWindow()
  if (win) setMainWindow(win as BrowserWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  log('boot', `启动完成，游戏目录 ${config.get().gameRoot}`)
  bootLog('startup complete')
}).catch((e) => {
  bootLog(`whenReady failed: ${e?.stack ?? e}`)
  logError('boot', e)
})

app.on('window-all-closed', () => {
  bootLog('window-all-closed -> quit')
  app.quit()
})
