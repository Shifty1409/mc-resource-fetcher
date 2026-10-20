const asar = require('@electron/asar')
const path = require('node:path')

const file = path.join(__dirname, '..', 'dist', 'win-unpacked', 'resources', 'app.asar')
const list = asar.listPackage(file).map((p) => p.split('\\').join('/').toLowerCase())
const need = [
  '/out/main/index.js',
  '/out/preload/index.js',
  '/out/renderer/index.html',
  '/package.json',
  '/node_modules/adm-zip/adm-zip.js'
]
for (const n of need) console.log(`${list.includes(n) ? 'PASS' : 'FAIL'}  ${n}`)
console.log('文件总数:', list.length)
console.log('--- renderer 资源 ---')
for (const p of list.filter((x) => x.includes('/out/renderer/'))) console.log('  ' + p)
