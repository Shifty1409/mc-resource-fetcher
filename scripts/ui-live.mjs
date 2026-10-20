/**
 * 浏览器模式端到端自检：真实 HTTP 服务 + 真实渲染层 + 真实 Modrinth 搜索
 * 运行前需先启动： node .harness/main/server.js --port=19388
 */
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const BASE = process.env.UI_BASE ?? 'http://127.0.0.1:19388'

const html = await (await fetch(BASE + '/')).text()
if (!html.includes('id="root"')) throw new Error('服务端没有返回 index.html')

const bundle = readdirSync(join(root, 'out', 'renderer', 'assets')).find((f) => f.endsWith('.js'))
if (!bundle) throw new Error('缺少构建产物')

const dom = new JSDOM(html, { url: BASE + '/', pretendToBeVisual: true })
const { window } = dom

const define = (name, value) => {
  try {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  } catch {
    /* ignore */
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
window.matchMedia = window.matchMedia ?? (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))

// Node 的 fetch 不接受相对路径，这里补上服务端 origin
const realFetch = globalThis.fetch
define('fetch', (input, init) => {
  const url = typeof input === 'string' && input.startsWith('/') ? BASE + input : input
  return realFetch(url, init)
})

const errors = []
window.addEventListener('error', (e) => errors.push(String(e.message)))
const origError = console.error
console.error = (...a) => {
  origError(...a)
  errors.push(a.map(String).join(' '))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const text = () => document.getElementById('root')?.innerHTML ?? ''
const clickByText = (needle) => {
  const el = [...document.querySelectorAll('button')].find((n) => (n.textContent ?? '').includes(needle))
  if (!el) return false
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  return true
}

await import(pathToFileURL(join(root, 'out', 'renderer', 'assets', bundle)).href)
await sleep(1200)

const checks = []
const check = (name, ok, extra = '') => {
  checks.push([name, ok])
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  → ' + extra : ''}`)
}

check('window.mc 由 HTTP 适配层注入', Boolean(window.mc), typeof window.mc?.snapshot)
check('首屏渲染', text().length > 200)

const snapshot = await window.mc.snapshot()
check('读到了实例', snapshot.instances.length > 0, snapshot.instances.map((i) => i.name).join(','))
check('实例名出现在页面', text().includes(snapshot.instances[0].name))

// 下载页 + 真实搜索
clickByText('下载资源')
await sleep(2500)
const browseHtml = text()
check('切到下载页', browseHtml.includes('安装到'))

const cards = document.querySelectorAll('.hit').length
const search = await window.mc.search({
  kind: 'mod',
  query: 'jei',
  provider: 'modrinth',
  gameVersion: '1.20.1',
  loader: 'fabric',
  sort: 'relevance',
  offset: 0,
  limit: 5
})
check('Modrinth 搜索（HTTP 层）', search.hits.length > 0, `${search.total} 条，首个 ${search.hits[0]?.title}`)
check('搜索结果渲染为卡片', cards > 0, `${cards} 张卡片`)
check('卡片内容非空', browseHtml.includes('下载') && browseHtml.includes('安装'))

// 详情
const detail = await window.mc.detail('modrinth', search.hits[0].slug, 'mod')
check('详情接口', Boolean(detail.title), `${detail.title} · ${detail.files.length} 个文件`)

// 安装页 / 设置页
clickByText('安装版本')
await sleep(600)
check('安装页渲染版本列表', text().includes('1.20.1') || text().includes('开始安装'))
clickByText('设置')
await sleep(500)
check('设置页渲染', text().includes('游戏目录') && text().includes('BMCLAPI'))
clickByText('主页')
await sleep(500)
check('回到主页', text().includes('新建实例'))

if (errors.length) {
  console.log('\n渲染期错误:')
  for (const e of errors.slice(0, 8)) console.log('  - ' + e.slice(0, 240))
}
const failed = checks.filter(([, ok]) => !ok)
console.log(`\n==== ${checks.length - failed.length}/${checks.length} 通过 ====`)
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1)
