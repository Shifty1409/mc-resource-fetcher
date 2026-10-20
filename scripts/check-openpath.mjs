/** 验证应用窗口模式下的「打开目录 / 选择目录」是否真的生效 */
async function main() {
  const base = 'http://127.0.0.1:19388'
  const snap = await (await fetch(base + '/api/snapshot')).json()
  const gameRoot = snap.gameRoot
  console.log('gameRoot =', gameRoot)
  console.log('新配置字段 downloadThreads =', snap.config.downloadThreads)

  const r1 = await fetch(base + '/api/open-path', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: gameRoot })
  })
  const j1 = await r1.json()
  console.log('打开游戏目录:', r1.status, JSON.stringify(j1))

  const inst = snap.instances[0]
  if (inst) {
    const r2 = await fetch(base + '/api/open-dir', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: inst.id })
    })
    console.log('打开实例目录:', r2.status, JSON.stringify(await r2.json()), '->', inst.id)
  }

  const r3 = await fetch(base + '/api/open-path', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'https://github.com/Shifty1409/mc-resource-fetcher' })
  })
  console.log('打开链接:', r3.status, JSON.stringify(await r3.json()))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
