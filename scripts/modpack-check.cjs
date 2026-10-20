/**
 * 整合包安装自检：造一个迷你 .mrpack（一个文件 + overrides），
 * 通过本地 HTTP 服务提供，验证「解析 index → 建实例 → 装加载器 → 下文件 → 铺 overrides」全流程。
 * 运行前先启动 node .harness/main/server.js --port=19388
 */
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const AdmZip = require('adm-zip')

const root = path.join(__dirname, '..')
const renderDir = path.join(root, 'out', 'renderer')
const BASE = 'http://127.0.0.1:19388'

async function main() {
  const { config } = require('../.harness/main/core/config')
  const { tasks } = require('../.harness/main/core/tasks')
  const { installModpack } = require('../.harness/main/core/modpack')
  const { listInstances, deleteInstance } = require('../.harness/main/core/instances')
  const { instanceDir } = require('../.harness/main/core/paths')

  await config.load()

  // 1) 造一个「模组」文件（内容不重要，只验证落盘位置）
  const fakeJar = Buffer.from('PK\u0003\u0004 fake mod jar for smoke test')
  const jarName = '_test-mod.jar'
  fs.writeFileSync(path.join(renderDir, jarName), fakeJar)
  const sha1 = createHash('sha1').update(fakeJar).digest('hex')

  // 2) 造 .mrpack
  const zip = new AdmZip()
  const index = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: '1.0.0',
    name: '自检整合包',
    summary: '仅用于验证安装流程',
    files: [
      {
        path: 'mods/test-mod.jar',
        hashes: { sha1 },
        env: { client: 'required', server: 'unsupported' },
        downloads: [`${BASE}/${jarName}`],
        fileSize: fakeJar.length
      },
      {
        path: 'mods/skipped-server-mod.jar',
        hashes: { sha1 },
        env: { client: 'unsupported', server: 'required' },
        downloads: [`${BASE}/${jarName}`],
        fileSize: fakeJar.length
      }
    ],
    dependencies: { minecraft: '1.20.1', 'fabric-loader': '0.19.5' }
  }
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(index, null, 2)))
  zip.addFile('overrides/config/modpack-test.txt', Buffer.from('来自整合包 overrides 的文件'))
  zip.addFile('overrides/shaderpacks/demo/readme.txt', Buffer.from('hello'))
  const packPath = path.join(renderDir, '_test.mrpack')
  zip.writeZip(packPath)
  console.log(`已生成测试整合包 ${packPath} (${fs.statSync(packPath).size} 字节)`)

  // 3) 安装
  const { handle } = tasks.start('自检：安装整合包')
  const t0 = Date.now()
  const inst = await installModpack(
    { provider: 'modrinth', projectId: 'local-test', fileUrl: `${BASE}/_test.mrpack`, fileName: 'test.mrpack' },
    handle
  )
  handle.finish()
  console.log(`\n安装完成，用时 ${Math.round((Date.now() - t0) / 1000)}s → 实例 ${inst.id} (${inst.name})`)

  // 4) 校验
  const dir = instanceDir(inst.id)
  const checks = []
  checks.push(['实例 MC 版本', inst.mcVersion === '1.20.1', inst.mcVersion])
  checks.push(['实例加载器', inst.loader === 'fabric', `${inst.loader} ${inst.loaderVersion}`])
  checks.push(['版本目录已装', fs.existsSync(path.join(root, '.mcdata/Minecraft/versions', inst.versionId, `${inst.versionId}.json`)), inst.versionId])

  const modFile = path.join(dir, 'mods', 'test-mod.jar')
  checks.push(['客户端模组已落盘', fs.existsSync(modFile) && fs.readFileSync(modFile).equals(fakeJar), modFile])
  checks.push([
    'server-only 文件被跳过',
    !fs.existsSync(path.join(dir, 'mods', 'skipped-server-mod.jar')),
    'skipped-server-mod.jar'
  ])
  checks.push(['overrides/config 已铺开', fs.existsSync(path.join(dir, 'config', 'modpack-test.txt')), 'config/modpack-test.txt'])
  checks.push(['overrides/shaderpacks 已铺开', fs.existsSync(path.join(dir, 'shaderpacks', 'demo', 'readme.txt')), 'shaderpacks/demo/readme.txt'])

  let failed = 0
  for (const [name, ok, extra] of checks) {
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  → ' + extra : ''}`)
  }

  // 5) 清理
  await deleteInstance(inst.id)
  fs.rmSync(packPath, { force: true })
  fs.rmSync(path.join(renderDir, jarName), { force: true })
  const left = await listInstances()
  console.log(`\n已删除测试实例，剩余 ${left.length} 个实例`)
  console.log(`==== ${checks.length - failed}/${checks.length} 通过 ====`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
