import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { TaskInfo } from '../../shared/types'
import { log } from './log'

export class CancelledError extends Error {
  constructor(msg = '操作已取消') {
    super(msg)
    this.name = 'CancelledError'
  }
}

class InternalTask {
  info: TaskInfo
  lastEmit = 0
  lastBytes = 0
  lastTs = Date.now()
  speedEma = 0
  cancelRequested = false
  /** 内部私有进度，不受 total 截断影响 */
  private rawDone = 0

  constructor(info: TaskInfo) {
    this.info = info
  }

  addBytes(n: number): void {
    this.rawDone += n
    this.info.done = this.rawDone
  }

  get raw(): number {
    return this.rawDone
  }
}

export interface TaskHandle {
  id: string
  readonly cancelRequested: boolean
  setPhase(phase: string, message?: string): void
  setMessage(message: string): void
  setTotal(total: number): void
  addBytes(n: number): void
  log(line: string): void
  finish(message?: string): void
  fail(err: unknown): void
  /** 让任务内可等待的取消检查 */
  checkCancel(): void
}

const MAX_LOG_LINES = 200

export class TaskManager extends EventEmitter {
  private tasks = new Map<string, InternalTask>()
  private order: string[] = []

  start(title: string): { handle: TaskHandle; done: Promise<void> } {
    const id = randomUUID()
    const info: TaskInfo = {
      id,
      title,
      status: 'running',
      phase: '准备中',
      message: '',
      done: 0,
      total: 0,
      speed: 0,
      startedAt: Date.now(),
      logTail: []
    }
    const t = new InternalTask(info)
    this.tasks.set(id, t)
    this.order.push(id)
    this.emit('update', info)

    let resolveDone: () => void = () => undefined
    const done = new Promise<void>((r) => {
      resolveDone = r
    })

    const handle: TaskHandle = {
      id,
      get cancelRequested() {
        return t.cancelRequested
      },
      setPhase(phase: string, message?: string) {
        info.phase = phase
        if (message !== undefined) info.message = message
        mgr.flush(id)
      },
      setMessage(message: string) {
        info.message = message
        mgr.flush(id)
      },
      setTotal(total: number) {
        info.total = total
        mgr.flush(id)
      },
      addBytes(n: number) {
        t.addBytes(n)
        mgr.tick(id)
      },
      log(line: string) {
        info.logTail.push(line)
        if (info.logTail.length > MAX_LOG_LINES) info.logTail.splice(0, info.logTail.length - MAX_LOG_LINES)
        log('task', `[${title}] ${line}`)
        mgr.tick(id)
      },
      finish(message?: string) {
        if (info.status !== 'running') return
        info.status = 'done'
        info.phase = '完成'
        if (message) info.message = message
        info.done = Math.max(info.done, info.total)
        info.endedAt = Date.now()
        info.speed = 0
        mgr.emit('update', { ...info })
        resolveDone()
      },
      fail(err: unknown) {
        if (info.status !== 'running') return
        const cancelled = err instanceof CancelledError || t.cancelRequested
        info.status = cancelled ? 'cancelled' : 'failed'
        info.phase = cancelled ? '已取消' : '失败'
        info.error = err instanceof Error ? err.message : String(err)
        info.message = info.error ?? ''
        info.endedAt = Date.now()
        info.speed = 0
        log('task', `[${title}] ${info.status}: ${info.error ?? ''}`)
        mgr.emit('update', { ...info })
        resolveDone()
      },
      checkCancel() {
        if (t.cancelRequested) throw new CancelledError()
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const mgr = this
    return { handle, done }
  }

  tick(id: string): void {
    const t = this.tasks.get(id)
    if (!t) return
    const now = Date.now()
    if (now - t.lastEmit < 120) return
    const dt = (now - t.lastTs) / 1000
    if (dt > 0.2) {
      const inst = (t.raw - t.lastBytes) / dt
      t.info.speed = t.info.speed ? t.info.speed * 0.6 + inst * 0.4 : inst
      t.lastBytes = t.raw
      t.lastTs = now
    }
    // 已完成字节不超过总量太多
    if (t.info.total > 0) t.info.done = Math.min(t.info.done, Math.round(t.info.total * 1.02))
    t.lastEmit = now
    this.emit('update', { ...t.info })
  }

  flush(id: string): void {
    const t = this.tasks.get(id)
    if (!t) return
    if (t.info.total > 0) t.info.done = Math.min(t.info.done, Math.round(t.info.total * 1.02))
    t.lastEmit = Date.now()
    this.emit('update', { ...t.info })
  }

  list(): TaskInfo[] {
    return this.order
      .map((id) => this.tasks.get(id)?.info)
      .filter((x): x is TaskInfo => Boolean(x))
      .slice(-50)
      .reverse()
      .map((x) => ({ ...x }))
  }

  cancel(id: string): boolean {
    const t = this.tasks.get(id)
    if (!t || t.info.status !== 'running') return false
    t.cancelRequested = true
    t.info.message = '正在取消…'
    this.emit('update', { ...t.info })
    return true
  }

  /** 清理已结束任务 */
  clearFinished(): void {
    for (const [id, t] of this.tasks) {
      if (t.info.status !== 'running') this.tasks.delete(id)
    }
    this.order = this.order.filter((id) => this.tasks.has(id))
  }
}

export const tasks = new TaskManager()
