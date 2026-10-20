// 把自检产生的 SMOKE-* 实例整理成友好的演示实例（无 BOM 写入）
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..', '.mcdata', 'Minecraft', 'instances')
if (!fs.existsSync(root)) {
  console.error('没有 instances 目录')
  process.exit(1)
}

// 注意顺序：neoforge 的目录名里也含 "forge"，必须先匹配
const plan = [
  { test: /neoforge/, id: '1.20.1-neoforge', name: '1.20.1 · NeoForge', icon: 'NF', color: '#d1893c' },
  { test: /forge/, id: '1.20.1-forge', name: '1.20.1 · Forge', icon: 'FG', color: '#47a3d6' },
  { test: /quilt/, id: '1.20.1-quilt', name: '1.20.1 · Quilt', icon: 'QT', color: '#8a6fd1' },
  { test: /fabric/, id: '1.20.1-fabric', name: '1.20.1 · Fabric', icon: 'FB', color: '#3aa757' },
  { test: /vanilla/, id: '1.20.1-vanilla', name: '1.20.1 · 原版', icon: '原', color: '#7a8f3a' }
]

const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
const used = new Set()

for (const item of plan) {
  const found = dirs.find((d) => !used.has(d) && item.test.test(d.toLowerCase()))
  if (!found) continue
  used.add(found)
  const from = path.join(root, found)
  const to = path.join(root, item.id)
  if (from === to) {
    // 已经是目标名字，只更新元数据
    const metaFile = path.join(to, 'instance.json')
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8').replace(/^\uFEFF/, ''))
    meta.id = item.id
    meta.name = item.name
    meta.iconText = item.icon
    meta.iconColor = item.color
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf-8')
    console.log(`${item.id} 已是目标名，仅更新元数据`)
    continue
  }
  if (fs.existsSync(to)) {
    console.log(`跳过 ${item.id}（目标已存在避免覆盖），保留 ${found}`)
    continue
  }
  fs.renameSync(from, to)
  const metaFile = path.join(to, 'instance.json')
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8').replace(/^\uFEFF/, ''))
  meta.id = item.id
  meta.name = item.name
  meta.iconText = item.icon
  meta.iconColor = item.color
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf-8')
  console.log(`${found} → ${item.id}  (${item.name}, version=${meta.versionId})`)
}

for (const d of dirs) {
  if (used.has(d)) continue
  if (/smoke-/i.test(d) || !fs.existsSync(path.join(root, d, 'instance.json'))) {
    fs.rmSync(path.join(root, d), { recursive: true, force: true })
    console.log(`删除 ${d}`)
  }
}

console.log('\n最终实例：')
for (const d of fs.readdirSync(root)) {
  const meta = JSON.parse(fs.readFileSync(path.join(root, d, 'instance.json'), 'utf-8').replace(/^\uFEFF/, ''))
  const modsDir = path.join(root, d, 'mods')
  const mods = fs.existsSync(modsDir) ? fs.readdirSync(modsDir).filter((f) => f.endsWith('.jar')).length : 0
  console.log(`  ${meta.name.padEnd(20)} version=${String(meta.versionId).padEnd(32)} mods=${mods}`)
}
