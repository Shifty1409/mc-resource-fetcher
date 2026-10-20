/**
 * 渲染层自检：在 jsdom 里真实渲染构建产物，用假的 window.mc 验证
 * - 首屏能渲染出内容
 * - 四个页面切换不崩
 * - 搜索/实例卡片等交互路径不抛异常
 *
 * 运行：node scripts/ui-smoke.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const rendererDir = join(root, 'out', 'renderer')
const assetsDir = join(rendererDir, 'assets')

const bundle = readdirSync(assetsDir).find((f) => f.endsWith('.js'))
if (!bundle) throw new Error('找不到构建产物，请先执行 electron-vite build')

const html = readFileSync(join(rendererDir, 'index.html'), 'utf-8')

const dom = new JSDOM(html, {
  url: 'http://localhost/',
  pretendToBeVisual: true
})

const { window } = dom
const define = (name, value) => {
  try {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  } catch {
    /* 只读全局，跳过 */
  }
}
define('window', window)
define('document', window.document)
define('navigator', window.navigator)
define('HTMLElement', window.HTMLElement)
define('Element', window.Element)
define('Node', window.Node)
define('getComputedStyle', window.getComputedStyle.bind(window))
define('requestAnimationFrame', window.requestAnimationFrame?.bind(window) ?? ((cb) => setTimeout(cb, 16)))
define('cancelAnimationFrame', window.cancelAnimationFrame?.bind(window) ?? clearTimeout)
define('IS_REACT_ACT_ENVIRONMENT', false)
window.matchMedia = window.matchMedia ?? (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))

const errors = []
window.addEventListener('error', (e) => errors.push(String(e.message)))
const origError = console.error
console.error = (...a) => {
  origError(...a)
  errors.push(a.map(String).join(' '))
}

/* ---------- 假 API ---------- */
const instances = [
  {
    id: 'demo-1',
    name: '1.20.1 · Fabric',
    mcVersion: '1.20.1',
    loader: 'fabric',
    loaderVersion: '0.19.5',
    versionId: 'fabric-loader-0.19.5-1.20.1',
    createdAt: Date.now() - 86400000,
    lastPlayedAt: Date.now() - 3600000,
    memoryMb: 4096,
    iconText: '1.20',
    iconColor: '#3aa757',
    isolated: true
  }
]

const config = {
  gameRoot: 'C:/demo/Minecraft',
  useMirror: true,
  concurrency: 6,
  curseforgeApiKey: '',
  defaultMemoryMb: 4096,
  offlineName: 'Steve',
  autoDownloadJava: true,
  keepLauncherOpen: true
}

const hits = [
  {
    provider: 'modrinth',
    id: 'u6dRKJwZ',
    slug: 'jei',
    title: 'Just Enough Items',
    description: 'View Items and Recipes',
    author: 'mezz',
    iconUrl: 'https://cdn.modrinth.com/x.png',
    downloads: 123456789,
    follows: 12345,
    kind: 'mod',
    categories: ['fabric', 'forge'],
    loaders: ['fabric', 'forge'],
    gameVersions: ['1.20.1'],
    updatedAt: new Date().toISOString(),
    pageUrl: 'https://modrinth.com/mod/jei',
    downloadable: true
  }
]

const noop = () => () => {}
let calls = []
window.mc = {
  snapshot: async () => ({
    instances,
    config,
    gameRoot: config.gameRoot,
    dataRoot: 'C:/demo',
    javaList: [{ path: 'C:/jdk/bin/javaw.exe', major: 21, version: '21.0.1', vendor: 'Oracle', source: 'system' }],
    dataVersion: 1
  }),
  saveConfig: async (p) => {
    calls.push(['saveConfig', p])
    return { ...config, ...p }
  },
  openPath: async () => calls.push(['openPath']),
  selectDir: async () => 'C:/picked',
  versions: async () =>
    ['1.21.4', '1.20.1', '1.19.2'].map((id) => ({
      id,
      type: 'release',
      releaseTime: '2024-01-01T00:00:00+00:00',
      url: 'https://example.com/v.json'
    })),
  loaderVersions: async () => [{ version: '0.19.5', stable: true }],
  createInstance: async (p) => {
    calls.push(['createInstance', p])
    return { taskId: 't1' }
  },
  deleteInstance: async () => calls.push(['delete']),
  updateInstance: async (m) => m,
  openInstanceDir: async () => calls.push(['openDir']),
  launch: async () => {
    calls.push(['launch'])
    return { started: true, pid: 123, message: '已启动' }
  },
  search: async () => ({ hits, total: 1, offset: 0, limit: 20 }),
  detail: async () => ({
    ...hits[0],
    body: '这是模组简介',
    gallery: [],
    files: [
      {
        name: 'jei.jar',
        url: 'https://cdn.modrinth.com/jei.jar',
        size: 6928778,
        primary: true,
        gameVersions: ['1.20.1'],
        loaders: ['fabric'],
        versionName: '15.74.0',
        versionId: 'abc',
        fileName: 'jei-1.20.1.jar'
      }
    ],
    license: 'MIT'
  }),
  installContent: async (p) => {
    calls.push(['installContent', p])
    return { taskId: 't2' }
  },
  installModpack: async () => ({ taskId: 't3' }),
  installedList: async () => ({ mod: [], resourcepack: [], shader: [], datapack: [], world: [], modpack: [] }),
  tasks: async () => [],
  cancelTask: async () => true,
  javas: async () => [],
  downloadJava: async () => ({ taskId: 't4' }),
  readLog: async () => '',
  onTask: noop,
  onLog: noop,
  onGameExit: noop,
  onInstances: noop
}

/* ---------- 渲染 ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const mod = await import(pathToFileURL(join(assetsDir, bundle)).href)
void mod
await sleep(400)

const rootEl = document.getElementById('root')
const firstRender = rootEl?.innerHTML ?? ''
const checks = []

checks.push(['首屏渲染出内容', firstRender.length > 200])
checks.push(['出现实例名', firstRender.includes('1.20.1 · Fabric')])
checks.push(['出现导航', firstRender.includes('下载资源') && firstRender.includes('安装版本')])

// 切页：点导航按钮
const clickByText = (text) => {
  const nodes = [...document.querySelectorAll('button')]
  const el = nodes.find((n) => (n.textContent ?? '').includes(text))
  if (!el) return false
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  return true
}

for (const [label, expect] of [
  ['下载资源', '安装到'],
  ['安装版本', '开始安装'],
  ['设置', '游戏目录'],
  ['主页', '新建实例']
]) {
  const ok = clickByText(label)
  await sleep(350)
  const htmlNow = document.getElementById('root')?.innerHTML ?? ''
  checks.push([`切到「${label}」并渲染 (${expect})`, ok && htmlNow.includes(expect)])
}

// 在下载页点一次「安装」按钮
clickByText('下载资源')
await sleep(400)
const installed = clickByText('安装')
await sleep(350)
checks.push(['下载页安装按钮可点击', installed])

const failed = checks.filter(([, ok]) => !ok)
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log(`\n调用记录: ${JSON.stringify(calls)}`)
if (errors.length) {
  console.log('\n渲染期错误:')
  for (const e of errors.slice(0, 10)) console.log('  - ' + e.slice(0, 300))
}
console.log(`\n==== ${checks.length - failed.length}/${checks.length} 通过 ====`)
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1)
