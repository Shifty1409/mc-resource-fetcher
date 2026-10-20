/**
 * 下载引擎实测：分段 vs 单连接速度对比 + 取消响应时间
 * 运行：node scripts/download-check.cjs
 */
const fs = require('node:fs')
const path = require('node:path')
const { config } = require('../.harness/main/core/config')
const { downloadAll } = require('../.harness/main/core/http')

const URL_7MB = 'https://cdn.modrinth.com/data/u6dRKJwZ/versions/URCP0LiD/jei-1.20.1-fabric-15.74.0.225.jar'
const TMP = path.join(__dirname, '..', '.mcdata', 'tmp-dlcheck')

function fmt(n) {
  return (n / 1048576).toFixed(2) + ' MB'
}

async function measure(label, threads, { cancelAfterMs } = {}) {
  const dest = path.join(TMP, `test-${threads}.jar`)
  fs.rmSync(dest, { force: true })
  const prev = config.get().downloadThreads
  await config.save({ downloadThreads: threads })

  let stopped = false
  let bytes = 0
  let speedSamples = []
  const ctx = {
    addBytes(n) {
      bytes += n
    },
    setTotal() {},
    shouldStop: () => stopped,
    setMessage() {}
  }
  const t0 = Date.now()
  let cancelAt = 0
  let cancelResolved = 0
  if (cancelAfterMs) {
    setTimeout(() => {
      stopped = true
      cancelAt = Date.now()
    }, cancelAfterMs)
  }
  let err = null
  try {
    await downloadAll([{ url: URL_7MB, dest, label: label }], ctx)
  } catch (e) {
    err = e
  }
  const dt = (Date.now() - t0) / 1000
  if (cancelAt) cancelResolved = Date.now() - cancelAt
  await config.save({ downloadThreads: prev })

  const size = bytes
  console.log(
    `${label.padEnd(22)} 线程=${String(threads).padEnd(2)} 用时=${dt.toFixed(2)}s  收到=${fmt(size)}  ` +
      `平均=${(size / dt / 1024).toFixed(0)} KB/s` +
      (cancelAt ? `  | 取消响应=${cancelResolved}ms  (${err ? err.message : '无异常'})` : err ? `  | ${err.message}` : '')
  )
  return { dt, size, cancelResolved, err }
}

async function main() {
  fs.mkdirSync(TMP, { recursive: true })
  await config.load()
  console.log('目标文件:', URL_7MB)
  console.log('（单连接实测约 45 KB/s，所以 7MB 大概要 2 分半）\n')

  const single = await measure('单连接（基线）', 1)
  const multi = await measure('分段 8 线程', 8)
  if (single.dt > 0 && multi.dt > 0) {
    console.log(`\n提速: ${(single.dt / multi.dt).toFixed(1)}x`)
  }

  console.log('\n--- 取消响应测试 ---')
  const cancel = await measure('8 线程下载中途取消', 8, { cancelAfterMs: 2500 })

  fs.rmSync(TMP, { recursive: true, force: true })
  const ok = multi.size > 0 && cancel.cancelResolved > 0 && cancel.cancelResolved < 1500
  console.log(`\n==== ${ok ? 'PASS' : 'CHECK'} ===="`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
