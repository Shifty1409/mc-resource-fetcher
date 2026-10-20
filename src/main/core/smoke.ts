import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ContentKind, InstanceMeta, LoaderKind, SearchQuery } from '../../shared/types'
import { config } from './config'
import { installContent } from './content'
import { getModrinthDetail, searchModrinth } from './modrinth'
import { createInstance, listInstances } from './instances'
import { listJavas } from './java'
import { launchInstance } from './launch'
import { installVersionStack, listFabricLoaders, listForgeVersions } from './loaders'
import { log, logError } from './log'
import { gamePaths, portableRoot } from './paths'
import { tasks } from './tasks'
import { fetchVersionManifest } from './vanilla'

export interface SmokeOptions {
  mc?: string
  loader?: LoaderKind
  loaderVersion?: string
  skipLaunch?: boolean
  skipContent?: boolean
  reuseInstanceId?: string
  query?: string
  contentKind?: ContentKind
}

let buffer = ''

function out(line: string): void {
  buffer += line + '\n'
  // eslint-disable-next-line no-console
  console.log(`[SMOKE] ${line}`)
}

const results: Array<{ name: string; ok: boolean; detail: string }> = []

async function check(name: string, fn: () => Promise<string>): Promise<boolean> {
  const t0 = Date.now()
  try {
    const detail = await fn()
    results.push({ name, ok: true, detail })
    out(`PASS  ${name}  (${Date.now() - t0}ms)  ${detail}`)
    return true
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}` : String(e)
    results.push({ name, ok: false, detail: msg })
    out(`FAIL  ${name}  (${Date.now() - t0}ms)  ${msg}`)
    logError('smoke', e)
    return false
  }
}

/** 端到端自检：网络 / 清单 / 安装 / 资源搜索与安装 / 真实拉起游戏进程 */
export async function runSmoke(opts: SmokeOptions = {}): Promise<number> {
  const mc = opts.mc ?? process.env.MC_SMOKE_MC ?? '1.20.1'
  const loader: LoaderKind = opts.loader ?? (process.env.MC_SMOKE_LOADER as LoaderKind) ?? 'fabric'
  const started = Date.now()

  try {
    mkdirSync(join(portableRoot, 'logs'), { recursive: true })
  } catch {
    /* ignore */
  }

  out(`时间 ${new Date().toLocaleString()}  目标 MC ${mc} / ${loader}`)
  out(`数据目录 ${portableRoot}`)
  out(`游戏目录 ${config.get().gameRoot}`)
  out(`镜像 ${config.get().useMirror ? '开启' : '关闭'} · 并发 ${config.get().concurrency}`)

  const javas = await listJavas(true)
  out(`检测到 Java: ${javas.map((j) => `${j.major}(${j.vendor})`).join(', ') || '无'}`)

  await check('版本清单', async () => {
    const m = await fetchVersionManifest(true)
    if (!m.versions.length) throw new Error('清单为空')
    return `${m.versions.length} 个版本，最新正式版 ${m.latest.release}`
  })

  if (loader === 'fabric') {
    await check('Fabric 版本列表', async () => {
      const l = await listFabricLoaders(mc)
      if (!l.length) throw new Error(`Fabric 不支持 ${mc}`)
      return `${l.length} 个加载器版本，最新 ${l[0].version}`
    })
  }
  if (loader === 'forge') {
    await check('Forge 版本列表', async () => {
      const l = await listForgeVersions(mc)
      if (!l.length) throw new Error(`Forge 不支持 ${mc}`)
      return `${l.length} 个版本，最新 ${l[0].version}`
    })
  }

  await check('Modrinth 搜索', async () => {
    const q: SearchQuery = {
      kind: 'mod',
      query: opts.query ?? 'jei',
      provider: 'modrinth',
      gameVersion: mc,
      // 原版没有加载器概念，带 loader facet 会搜不到东西
      loader: loader === 'vanilla' ? undefined : loader,
      sort: 'downloads',
      offset: 0,
      limit: 5
    }
    const res = await searchModrinth(q)
    if (!res.hits.length) throw new Error('没有搜索结果')
    return `${res.total} 条，首个「${res.hits[0].title}」by ${res.hits[0].author}`
  })

  let instance: InstanceMeta | null = null
  if (opts.reuseInstanceId) {
    const list = await listInstances()
    instance = list.find((i) => i.id === opts.reuseInstanceId) ?? null
    out(`复用已有实例：${instance?.id ?? '未找到'}`)
    if (!instance) throw new Error(`实例 ${opts.reuseInstanceId} 不存在`)
    await check('复用实例', async () => `${instance?.name} (${instance?.versionId})`)
  }
  const installed = opts.reuseInstanceId
    ? true
    : await check(`安装 ${mc} + ${loader}`, async () => {
    const { handle } = tasks.start('smoke 安装版本')
    try {
      const stack = await installVersionStack(
        { mcVersion: mc, loader, loaderVersion: opts.loaderVersion },
        handle
      )
      handle.finish()
      instance = await createInstance({
        name: `SMOKE-${mc}-${loader}-${Date.now().toString(36).slice(-4)}`,
        mcVersion: mc,
        loader,
        loaderVersion: stack.loaderVersion,
        versionId: stack.versionId
      })
      return `版本 ${stack.versionId} → 实例 ${instance.id}`
    } catch (e) {
      handle.fail(e)
      throw e
    }
  })

  const target = instance as InstanceMeta | null

  if (installed && target) {
    if (!opts.skipContent) {
      await check('安装 Modrinth 资源（含依赖）', async () => {
      const res = await searchModrinth({
        kind: 'mod',
        query: opts.query ?? 'jei',
        gameVersion: mc,
        loader,
        sort: 'downloads',
        offset: 0,
        limit: 1
      })
      const hit = res.hits[0]
      if (!hit) throw new Error('没有搜索结果')
      const { handle } = tasks.start('smoke 安装资源')
      try {
        // 不指定文件：让安装器自己挑适配版本并补齐 required 依赖
        const r = await installContent(
          target,
          {
            instanceId: target.id,
            provider: 'modrinth',
            projectId: hit.slug,
            kind: 'mod'
          },
          handle
        )
        handle.finish()
        return `${hit.title} → ${r.relative}`
      } catch (e) {
        handle.fail(e)
        throw e
      }
      })
    }

    if (!opts.skipLaunch) {
      await check('离线启动游戏', async () => {
        const { handle } = tasks.start('smoke 启动')
        const lines: string[] = []
        let exited = false
        let exitCode: number | null = null
        const launched = await launchInstance(target, handle, {
          onLine: (l) => {
            lines.push(l)
            if (lines.length <= 6) out(`   | ${l.slice(0, 160)}`)
          },
          onExit: (code) => {
            exited = true
            exitCode = code
          }
        })
        handle.finish()
        out(`   pid=${launched.result.pid}`)

        const deadline = Date.now() + 150_000
        let sawStart = false
        let hardFail = ''
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1000))
          const joined = lines.join('\n')
          if (/Sound engine started|Backend library: LWJGL|Created: .*minecraft:textures/i.test(joined)) {
            sawStart = true
            break
          }
          const fail = joined.match(
            /(Incompatible mods found|Mod resolution failed|A fatal error has been detected|Could not find or load main class[^\n]*|UnsupportedClassVersionError[^\n]*)/
          )
          if (fail) {
            hardFail = fail[0]
            break
          }
          if (exited) break
        }
        const tail = lines.slice(-14).join('\n   | ').slice(0, 1200)
        if (sawStart) {
          launched.process?.kill()
          return `游戏已初始化并运行（pid=${launched.result.pid}），随后关闭`
        }
        if (hardFail) {
          launched.process?.kill()
          throw new Error(`游戏启动失败：${hardFail}\n   | ${tail}`)
        }
        throw new Error(`未在 150s 内看到初始化标志（exited=${exited} code=${exitCode}）\n   | ${tail}`)
      })
    }
  }

  await check('实例列表', async () => {
    const list = await listInstances()
    return `${list.length} 个实例：${list.map((i) => i.name).join(' / ')}`
  })

  out(`游戏根目录 ${gamePaths().root}`)
  const failed = results.filter((r) => !r.ok)
  out(
    `\n==== 结果 ${results.length - failed.length}/${results.length} 通过，耗时 ${Math.round(
      (Date.now() - started) / 1000
    )}s ====`
  )
  if (failed.length) out(`失败：${failed.map((f) => `${f.name} → ${f.detail}`).join(' ; ')}`)

  try {
    appendFileSync(join(portableRoot, 'logs', 'smoke.log'), `\n${buffer}`)
  } catch {
    /* ignore */
  }
  log('smoke', `完成 ${results.length - failed.length}/${results.length}`)
  return failed.length === 0 ? 0 : 1
}
