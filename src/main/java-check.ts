/**
 * 验证 Java 运行时自动下载的两条分支：
 *  1) Mojang 官方运行时清单（downloadMojangRuntime）
 *  2) Adoptium 兜底（ensureJava 找不到匹配版本时）
 * 运行：node .harness/main/java-check.js
 */
const { config } = require('./core/config')
const { tasks } = require('./core/tasks')
const { downloadMojangRuntime, ensureJava, listJavas, invalidateJavaCache, findComponentForMajor } = require('./core/java')

async function main() {
  await config.load()
  console.log('--- 已安装 Java ---')
  for (const j of await listJavas(true)) console.log(`  ${j.major}  ${j.vendor}  ${j.path}`)

  console.log('\n--- 1) Mojang 官方运行时 (java-runtime-gamma = Java 17) ---')
  const t1 = tasks.start('下载 Mojang JRE 17')
  const t0 = Date.now()
  try {
    const j = await downloadMojangRuntime('java-runtime-gamma', t1.handle)
    t1.handle.finish()
    console.log(`PASS  用时 ${Math.round((Date.now() - t0) / 1000)}s  →  Java ${j.major} (${j.version}) @ ${j.path}`)
  } catch (e) {
    t1.handle.fail(e)
    console.log('FAIL  ' + (e instanceof Error ? e.message : String(e)))
  }

  console.log('\n--- 2) 按主版本自动匹配组件 (Java 8) ---')
  const t2 = tasks.start('自动匹配并下载 Java 8')
  const t1s = Date.now()
  try {
    const comp = await findComponentForMajor(8)
    console.log(`  清单匹配组件: ${comp}`)
    const j = await ensureJava(8, undefined, t2.handle)
    t2.handle.finish()
    console.log(`PASS  用时 ${Math.round((Date.now() - t1s) / 1000)}s  →  Java ${j.major} (${j.version}) @ ${j.path}`)
  } catch (e) {
    t2.handle.fail(e)
    console.log('FAIL  ' + (e instanceof Error ? e.message : String(e)))
  }

  invalidateJavaCache()
  console.log('\n--- 下载后可用 Java ---')
  for (const j of await listJavas(true)) console.log(`  ${j.major}  ${j.source.padEnd(10)} ${j.path}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
