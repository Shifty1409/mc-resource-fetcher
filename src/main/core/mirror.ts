import { config } from './config'

/**
 * BMCLAPI 镜像映射（已实测）：
 *  - piston-meta / launchermeta / piston-data / launcher.mojang.com → bmclapi2 同路径
 *  - resources.download.minecraft.net/{a}/{h}                     → bmclapi2/assets/{a}/{h}
 *  - libraries.minecraft.net/{path}                               → bmclapi2/libraries/{path}
 *  - maven.fabricmc.net / maven.minecraftforge.net
 *    / maven.neoforged.net/releases                                → bmclapi2/maven/{path}
 *  - meta.fabricmc.net/v2/...                                     → bmclapi2/fabric-meta/v2/...
 */
const RULES: Array<[string, string]> = [
  ['https://piston-meta.mojang.com/', 'https://bmclapi2.bangbang93.com/'],
  ['https://launchermeta.mojang.com/', 'https://bmclapi2.bangbang93.com/'],
  ['https://piston-data.mojang.com/', 'https://bmclapi2.bangbang93.com/'],
  ['https://launcher.mojang.com/', 'https://bmclapi2.bangbang93.com/'],
  ['https://resources.download.minecraft.net/', 'https://bmclapi2.bangbang93.com/assets/'],
  ['https://libraries.minecraft.net/', 'https://bmclapi2.bangbang93.com/libraries/'],
  ['https://maven.fabricmc.net/', 'https://bmclapi2.bangbang93.com/maven/'],
  ['https://maven.minecraftforge.net/', 'https://bmclapi2.bangbang93.com/maven/'],
  ['https://maven.neoforged.net/releases/', 'https://bmclapi2.bangbang93.com/maven/'],
  ['https://meta.fabricmc.net/', 'https://bmclapi2.bangbang93.com/fabric-meta/']
]

export function mirrorUrl(url: string): string {
  for (const [from, to] of RULES) {
    if (url.startsWith(from)) return to + url.slice(from.length)
  }
  return url
}

/* ---------- 熔断：镜像连续失败时临时直连官方 ---------- */

const FAIL_THRESHOLD = 10
const BASE_COOLDOWN_MS = 4 * 60 * 1000
let consecutiveFails = 0
let disabledUntil = 0
let trips = 0

export function reportMirrorResult(ok: boolean): void {
  if (ok) {
    consecutiveFails = 0
    return
  }
  consecutiveFails++
  if (consecutiveFails >= FAIL_THRESHOLD && Date.now() >= disabledUntil) {
    trips++
    consecutiveFails = 0
    // 指数退避，最多 30 分钟；反复不可用则本次会话内彻底停用
    const cooldown = Math.min(BASE_COOLDOWN_MS * Math.pow(2, trips - 1), 30 * 60 * 1000)
    disabledUntil = Date.now() + cooldown
    // eslint-disable-next-line no-console
    console.warn(
      `[mirror] BMCLAPI 连续失败 ${trips} 次，暂停 ${Math.round(cooldown / 60000)} 分钟改直连官方源`
    )
  }
}

export function mirrorSuspended(): boolean {
  return Date.now() < disabledUntil
}

export function resetMirrorState(): void {
  consecutiveFails = 0
  disabledUntil = 0
}

/**
 * 返回按优先级排列的候选地址：开启镜像时先镜像、失败再回退官方。
 * 官方地址始终作为兜底，保证镜像挂了也能装。
 */
export function altUrls(official: string): string[] {
  if (!config.get().useMirror) return [official]
  if (mirrorSuspended()) return [official]
  const m = mirrorUrl(official)
  if (m === official) return [official]
  return [m, official]
}
