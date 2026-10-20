import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { ensureDir } from './util'

export interface RunResult {
  code: number | null
  logFile: string
}

export interface SpawnOptions {
  cwd: string
  logFile: string
  env?: NodeJS.ProcessEnv
  onLine?: (line: string) => void
  /** 轮询日志间隔 */
  pollMs?: number
  /**
   * 是否隐藏子进程窗口，默认 true（安装器等控制台程序不弹黑窗）。
   * ⚠️ 启动游戏必须传 false：Node 的 windowsHide 会给子进程设
   * STARTF_USESHOWWINDOW + SW_HIDE，而 Win32 规定进程**第一次**调用
   * ShowWindow 时传入的显示方式会被忽略、改用 STARTUPINFO 的值。
   * 结果就是 GLFW/LWJGL 建出来的游戏窗口一直隐藏——进度正常、有声音、但没画面。
   */
  hideWindow?: boolean
  /**
   * 是否让子进程脱离父进程的进程组/控制台，默认 false。
   * ⚠️ 启动游戏必须传 true：否则关闭启动器窗口（或控制台）时
   * Windows 会把 CTRL_CLOSE 事件发给同一进程组的 java.exe，游戏跟着被杀。
   */
  detach?: boolean
}

export interface RunningProcess {
  child: ChildProcess
  logFile: string
  done: Promise<RunResult>
  kill: () => void
}

/**
 * 用文件重定向而不是管道启动子进程：
 * 1) 输出同时落盘，玩家可事后查日志；
 * 2) 不依赖管道缓冲，长跑进程（MC 本体）不会被阻塞。
 */
export async function spawnToLog(cmd: string, args: string[], opts: SpawnOptions): Promise<RunningProcess> {
  await ensureDir(opts.cwd)
  await ensureDir(require('node:path').dirname(opts.logFile))
  const fd = openSync(opts.logFile, 'w')
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: ['ignore', fd, fd],
    windowsHide: opts.hideWindow !== false,
    detached: opts.detach === true
  })
  closeSync(fd)
  // 脱离后不要因为父进程的句柄而让事件循环挂着
  if (opts.detach === true) child.unref()

  let offset = 0
  let pending = ''
  let timer: NodeJS.Timeout | null = null

  const pump = (): void => {
    try {
      const size = statSync(opts.logFile).size
      if (size > offset) {
        const len = size - offset
        const buf = Buffer.alloc(len)
        const f = openSync(opts.logFile, 'r')
        readSync(f, buf, 0, len, offset)
        closeSync(f)
        offset = size
        pending += buf.toString('utf-8')
        const lines = pending.split(/\r?\n/)
        pending = lines.pop() ?? ''
        for (const line of lines) {
          if (line.trim().length) opts.onLine?.(line)
        }
      }
    } catch {
      /* 文件可能尚未创建 */
    }
  }

  const stop = (): void => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    pump()
    if (pending.trim().length) {
      opts.onLine?.(pending)
      pending = ''
    }
  }

  timer = setInterval(pump, opts.pollMs ?? 400)
  timer.unref?.()

  const done = new Promise<RunResult>((resolve) => {
    child.on('error', (err) => {
      // 启动失败（如找不到 java.exe）
      opts.onLine?.(`[启动失败] ${err.message}`)
      stop()
      resolve({ code: -1, logFile: opts.logFile })
    })
    child.on('exit', (code) => {
      // 收尾：再读一次残留输出
      setTimeout(() => {
        stop()
        resolve({ code, logFile: opts.logFile })
      }, 120)
    })
  })

  return {
    child,
    logFile: opts.logFile,
    done,
    kill: () => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    }
  }
}

/** 一次性执行并收集完整输出（用于安装器之类的短任务） */
export async function runToLog(
  cmd: string,
  args: string[],
  opts: SpawnOptions
): Promise<RunResult & { output: string }> {
  const lines: string[] = []
  const p = await spawnToLog(cmd, args, {
    ...opts,
    onLine: (l) => {
      lines.push(l)
      opts.onLine?.(l)
    }
  })
  const r = await p.done
  return { ...r, output: lines.join('\n') }
}
