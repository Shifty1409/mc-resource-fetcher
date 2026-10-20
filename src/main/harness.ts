/**
 * 纯 Node 端到端自检入口（不依赖 Electron 窗口）：
 *   node .harness/main/harness.js --mc=1.20.1 --loader=fabric
 * 用于验证下载 / 安装 / 资源安装 / 真实拉起游戏进程。
 */
import type { LoaderKind } from '../shared/types'
import { config } from './core/config'
import { log } from './core/log'
import { runSmoke } from './core/smoke'

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

async function main(): Promise<void> {
  await config.load()
  const loader = (arg('loader') ?? 'fabric') as LoaderKind
  log('harness', `start mc=${arg('mc') ?? '1.20.1'} loader=${loader}`)
  const code = await runSmoke({
    mc: arg('mc'),
    loader,
    loaderVersion: arg('lv'),
    skipLaunch: process.argv.includes('--skip-launch'),
    skipContent: process.argv.includes('--skip-content'),
    reuseInstanceId: arg('reuse'),
    query: arg('query')
  })
  process.exit(code)
}

void main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  process.exit(1)
})
