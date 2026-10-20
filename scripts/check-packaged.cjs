const fs = require('node:fs')
const path = require('node:path')

async function main() {
  const portFile = path.join(__dirname, '..', 'dist', 'win-unpacked', 'MCLauncherData', 'server-port.txt')
  let port = 19388
  try {
    port = Number(fs.readFileSync(portFile, 'utf-8').trim())
  } catch {
    /* 用默认端口 */
  }
  console.log('port =', port)
  const snap = await fetch(`http://127.0.0.1:${port}/api/snapshot`)
  const j = await snap.json()
  console.log('API', snap.status, '| 实例', j.instances.length, '| Java', j.javaList.length)
  console.log('gameRoot =', j.gameRoot)

  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text()
  console.log('页面', html.length, '字节 | root div:', html.includes('id="root"'))
  const m = html.match(/assets\/(index-[^"]+\.js)/)
  if (m) {
    const js = await fetch(`http://127.0.0.1:${port}/assets/${m[1]}`)
    console.log('JS 资源:', js.status, js.headers.get('content-type'), (await js.text()).length, '字节')
  }
  const css = html.match(/assets\/(index-[^"]+\.css)/)
  if (css) {
    const r = await fetch(`http://127.0.0.1:${port}/assets/${css[1]}`)
    console.log('CSS 资源:', r.status, r.headers.get('content-type'))
  }
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
