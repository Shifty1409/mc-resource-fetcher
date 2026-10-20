# MC 资源下载器

参考 PCL2 交互设计的 Minecraft 资源筛选下载器 + 离线启动器。
Electron + React + TypeScript，中文浅色卡片式界面。

**当前状态**：核心链路（下载 → 安装 → 装模组及依赖 → 真实启动游戏）已在本机真机验证；
界面有三种打开方式，其中「应用窗口模式」已在本机验证可正常出窗口。

> **下载**：[Releases · v0.1.0](https://github.com/Shifty1409/mc-resource-fetcher/releases/tag/v0.1.0)　
> **源码**：[Shifty1409/mc-resource-fetcher](https://github.com/Shifty1409/mc-resource-fetcher)

---

## 三种运行方式

### 1. 桌面版（推荐）双击 `启动.bat`

内部按优先级尝试：

1. **原生 Electron 窗口**（大多数机器可用，最顺滑）
2. 若本机 Chromium 内核无法初始化 → 自动切到 **应用窗口模式**（见下）

### 2. 应用窗口模式 双击 `启动桌面版.bat`

用系统自带的 **Edge / Chrome 的 `--app` 模式**打开界面：

- 独立窗口（1400×880，无地址栏、无标签页、独立任务栏图标）
- 自带独立浏览器配置目录（不打扰你日常的浏览记录）
- **关窗即退出**本地服务；也可以在「设置 → 退出启动器」手动退出
- 界面与功能与 Electron 版**完全一致**（同一套渲染层 + 同一个服务端）

> 为什么需要它：本机实测 Chromium 内核（Electron 33/44 都试过、空壳应用也一样）
> 在 `app.whenReady()` 阶段必定 `0xC0000005` 崩溃，连空窗口都建不出来；
> 而 Java/GLFW 的游戏窗口、Edge 窗口都完全正常，所以是 Chromium 与本机环境的兼容问题，
> 不是应用代码问题。应用窗口模式绕开 Chromium 内核，已验证可用。

### 3. 浏览器版 双击 `浏览器版.bat`

起本地服务并自动用默认浏览器打开 <http://127.0.0.1:19388/>。
端口被占用会自动顺延到 19389/19390… 并打印真实地址。

开发模式（带热更新）：

```powershell
$env:ELECTRON_RUN_AS_NODE = ""
npm run dev
```

> 所有 `.bat` 都是 **CRLF 换行 + 纯 ASCII 内容**（早期版本误用 LF 换行导致 cmd 吃掉行首，
> 已修复）。`.gitattributes` 里对 `*.bat` 设了 `-text`，保证 clone / 下载 zip 后仍然是 CRLF。

---

## 发布 / 更新流程

仓库已上线：<https://github.com/Shifty1409/mc-resource-fetcher>（`main` 分支）

日常更新：

```powershell
git add -A
git commit -m "说明"
git push
```

首次在别的机器上推送（`推送.bat` 会做这件事）：

```powershell
git remote add origin https://github.com/Shifty1409/mc-resource-fetcher.git
git push -u origin main
```

> `推送.bat` 里提示的是 **GitHub 账号名**（`github.com/XXXX` 里的 XXXX），不是项目名。
> 注意 `github.com/mc-launcher` 是别人的账号，跟本项目无关。

**打包好的 exe 不能进仓库**（GitHub 单文件上限 100 MB，zip 是 145.8 MB），
只能作为 Release 附件；`v0.1.0` 已经这样发过：

```powershell
gh release create v0.1.0 "dist\MC-Launcher-0.1.0-win-x64.zip" --title "v0.1.0" --notes "首个可用版本"
```

---

## 打包（绿色免安装版）

**已发布**：<https://github.com/Shifty1409/mc-resource-fetcher/releases/tag/v0.1.0>
（145.8 MB 的 zip 是 Release 附件，不在仓库里——GitHub 单文件上限 100 MB）

本地成品：

```
dist\MC-Launcher-0.1.0-win-x64.zip     145.8 MB   发给别人就发这个
dist\app\                              已解压的同一份绿色目录，可直接双击运行
```

> `dist\win-unpacked` 是打包过程中留下的空目录（被浏览器进程占用暂时删不掉），
> 重启后可以手动删除，不影响使用。

包内结构：

```
MC-Launcher.exe           Electron 主程序（原生窗口模式用）
启动.bat                   推荐入口：原生窗口 → 失败自动切应用窗口
启动桌面版.bat              直接进应用窗口模式
浏览器版.bat                起服务 + 默认浏览器
使用说明.txt                给最终用户看的说明
resources\app.asar         界面与主进程（Electron 模式）
resources\server\          应用窗口模式用的服务端（含 adm-zip）
resources\renderer\        静态界面文件
```

重新打包：双击 **`打包.bat`**，或手动：

```powershell
node node_modules\electron-vite\bin\electron-vite.js build
node node_modules\electron-builder\out\cli\cli.js --win zip --x64
```

说明：

- 复用 `node_modules/electron/dist`（`electronDist`），不会再去 GitHub 拉一份 Electron
- NSIS / 7zip 走 `ELECTRON_BUILDER_BINARIES_MIRROR`（npmmirror）
- 单文件 `--win portable` 需要 makensis；本机报 `error creating mmap`，故默认出 zip 绿色版
- 图标 `build/icon.ico` 由 `scripts/make-icon.py`（Pillow）生成

---

## 已实现功能

| 模块 | 说明 |
| --- | --- |
| 版本安装 | 原版（Mojang 清单，919 个版本）、Fabric、Quilt、Forge、NeoForge |
| 资源下载 | Modrinth（模组 / 资源包 / 光影 / 数据包 / 整合包）；CurseForge 需自带 API Key（额外支持地图） |
| 依赖自动补齐 | 安装模组时递归解析 Modrinth 的 `required` 依赖（JEI 会自动带上 fabric-api） |
| 一键安装 | 按「实例的 MC 版本 + 加载器」自动挑适配文件，装进实例的 mods / resourcepacks / shaderpacks / saves |
| 整合包 | 支持 `.mrpack` 与 CurseForge 整合包 zip（需 Key）：自动建实例、装加载器、铺 overrides |
| Java | 扫描系统 Java；缺 component 时按主版本号在 Mojang 清单里自动匹配（Java 8 → `jre-legacy`），Adoptium 兜底 |
| 安装器预取 | Forge/NeoForge 的 installer 依赖先由镜像预取，规避 `maven.neoforged.net` 不可达 |
| 离线启动 | 玩家名 → `OfflinePlayer:<name>` MD5 → v3 UUID，`userType=legacy`，全程不连微软 |
| 镜像加速 | BMCLAPI 优先、官方兜底；连续失败自动熔断直连（指数退避） |
| 多线程下载 | 大文件（≥4MB）按 Range 分段并发，默认 12 线程，可在设置里调；分段失败自动降级单连接 |
| 下载器 | sha1 校验、`.part` 断点续传（Range）、45s 空闲超时、并发池、进度聚合 |
| 秒级取消 | 取消检查放在数据回调里，不等整段下完；实测取消响应 140ms（旧版要等两分钟） |
| 实例隔离 | 每个实例独立 mods / saves / config，共享 libraries 与 assets |
| 任务栏 | 全局下载任务进度、速度、取消、失败原因 |

---

## 验证结果（本机真机实测）

### 加载器启动矩阵

判定标准：拉起游戏 → 等到初始化完成（`Sound engine started` / LWJGL backend）→ **再用 Win32
`IsWindowVisible` 确认游戏窗口真的可见** → 关闭。

| 实例 | 版本 | 启动耗时 | 窗口可见 |
| --- | --- | --- | --- |
| 1.20.1 · 原版 | 1.20.1 | 5.2s | PASS |
| 1.20.1 · Fabric | fabric-loader-0.19.5 | 11.3s | PASS |
| 1.20.1 · Quilt | quilt-loader-0.24.0 | 6.2s | PASS |
| 1.20.1 · Forge | 1.20.1-forge-47.4.28 | 7.2s | PASS |
| 1.20.1 · NeoForge | 1.20.1-forge-47.1.106 | 7.2s | PASS |
| 1.12.2 · 原版（Java 8） | 1.12.2 | 4.1s | PASS |

### 其他子系统

| 项目 | 结果 |
| --- | --- |
| Modrinth 搜索 + 详情 + 安装 | PASS（JEI + 自动补齐 `fabric-api`、`mezz_config`） |
| 整合包安装（`.mrpack`） | 7/7 PASS：解析 index → 建实例 → 装加载器 → 下客户端文件 → 跳过 server-only → 铺 overrides |
| JRE 自动下载（Mojang 清单） | PASS：Java 17.0.15 / 87MB |
| JRE 主版本自动匹配 | PASS：缺 Java 8 时自动匹配 `jre-legacy`（8u51）/ 143MB |
| 老版本 natives | PASS：1.12.2 解压出 lwjgl.dll / jinput / OpenAL 等 11 个 dll 并成功启动 |
| 应用窗口模式（打包版） | PASS：`MC 资源下载器` 1400×880 `visible=True`，API 200，静态资源正常 |
| 渲染层（jsdom + 假 API） | 8/8 PASS |
| 浏览器模式实时链路 | 12/12 PASS |
| CurseForge 未配 Key 的降级 | PASS：明确提示而非崩溃 |

### 真机验证中定位并修掉的问题

1. **游戏有声音没画面**（最隐蔽）：`proc.ts` 给所有子进程传了 `windowsHide: true`，
   Node 会设 `STARTF_USESHOWWINDOW + SW_HIDE`；Win32 规定进程**第一次**调用 `ShowWindow`
   时请求值被忽略、改用 STARTUPINFO 的值 → GLFW/LWJGL 建出的游戏窗口**永久隐藏**。
   修复：启动游戏时 `hideWindow: false`。A/B 实测同一环境 `visible=False → True`。
2. **Forge 启动模块冲突**：BootstrapLauncher 把 classpath 转成模块层，原版 jar 变成
   `_1._20._1` 模块与 Forge 的 `minecraft` 模块撞包 → `ResolutionException`。
   判据改为 `mainClass` 含 `bootstraplauncher` 就不再塞原版 jar。
3. **NeoForge 装不上**：installer 硬连 `maven.neoforged.net` 超时。改为从 installer jar 解析
   `version.json` / `install_profile.json`，先用镜像预取依赖到 `libraries/`。
4. **LWJGL3 natives 必须在 classpath**，老式 `natives` 映射必须解压而非上 classpath。
5. **下载器**：`.part` 断点续传、45s 空闲超时、镜像熔断指数退避。
6. **UI**：`ctx` 每次渲染重建导致搜索 effect 死循环，`useMemo` 固定引用。
7. **健壮性**：JSON 读容忍 BOM；bat 必须 CRLF。
8. **桌面版入口**：Chromium 在本机无法初始化，增加应用窗口模式兜底。

---

## 目录结构

```
mc-launcher/
  src/
    shared/            主/渲染共用类型、IPC 通道、API 契约
    main/
      index.ts         Electron 入口（原生窗口、启动探针 boot.log）
      ipc.ts           IPC 注册
      server.ts        应用窗口/浏览器模式：静态托管 + HTTP API + SSE
      harness.ts       纯 Node 端到端自检
      java-check.ts    JRE 下载分支自检
      core/            host / http / mirror / mcmeta / vanilla / loaders /
                       java / launch / proc / instances / modrinth /
                       curseforge / content / modpack / tasks
    renderer/src/      React 界面（主页 / 下载 / 安装 / 设置）
  out/                 构建产物
  dist/                打包产物
  build/icon.ico       应用图标
  .mcdata/             开发/绿色版数据目录（配置、日志、游戏、实例）
  scripts/             自检与工具脚本
  启动.bat / 启动桌面版.bat / 浏览器版.bat / 打包.bat / 自检.bat / 诊断.bat
```

数据目录结构：

```
<数据目录>/
  config.json            设置
  boot.log               原生窗口启动探针（排障用）
  server-port.txt        应用窗口模式实际端口
  logs/                  launcher.log / server.log / smoke.log
  runtime/components/    自动下载的 JRE
  Minecraft/
    versions/<id>/       版本 json、client jar、natives
    libraries/           运行库
    assets/              资源（objects + indexes）
    instances/<实例>/     隔离的游戏目录
```

---

## 使用顺序

1. **安装版本** → 选 MC 版本 → 选加载器 → 起名 → 开始安装（进度在底部任务栏）
2. **主页** → 点实例卡片 **启动**（首次自动挑 Java）
3. **下载资源** → 选类型 / 搜索 / 版本与加载器 → 顶部「安装到」选实例 → 点 **安装**

开发目录里的 `.mcdata` 已预置 6 个可玩实例：1.20.1 原版 / Fabric（含 JEI）/ Quilt / Forge /
NeoForge，以及 1.12.2 原版（Java 8）。

---

## 离线模式说明

`OfflinePlayer:<玩家名>` 的 MD5 设为 UUID v3（等价于 Java 的
`UUID.nameUUIDFromBytes`），`accessToken` 用本地派生值。
不需要登录、不联网验证，适合单机与离线服务器；**不适用于需要正版验证的服务器**。

---

## 自检 / 测试

```powershell
# 端到端（会真实下载并启动一次游戏）
node .harness/main/harness.js --mc=1.20.1 --loader=fabric
node .harness/main/harness.js --reuse=1.20.1-fabric --skip-content

# JRE 下载两条分支
node .harness/main/java-check.js

# 渲染层（jsdom + 假 API）
node scripts/ui-smoke.mjs

# 浏览器/应用窗口模式实时链路
node .harness/main/server.js --port=19388
node scripts/ui-live.mjs

# 整合包安装流程
node scripts/modpack-check.cjs

# 打包产物校验
node scripts/check-asar.cjs
node scripts/check-packaged.cjs
```

> Fabric/Quilt 首次启动会在 `<实例>/.fabric/remappedJars/` 做一次 jar 重映射。
> **在带文件 ACL 限制的沙箱里运行会失败**（zipfs 无法写），正常桌面环境不受影响。

---

## 已知限制

- **原生 Electron 窗口在本机不可用**（Chromium 初始化即崩），已用应用窗口模式兜底；
  换一台机器通常会恢复（`启动.bat` 会优先尝试原生窗口）
- Forge / NeoForge 走官方 installer，依赖 `maven.minecraftforge.net` / BMCLAPI maven 可达
- 地图资源 Modrinth 不提供，只能走 CurseForge（需 Key）
- Quilt 元数据无国内镜像，走官方源
- CurseForge 部分作者禁止第三方启动器下载，这类文件会被跳过并提示
- **CurseForge / 地图资源未做真机实测**（需要你的 API Key）
- 应用窗口模式依赖系统装有 Edge 或 Chrome；两者都没有时会退回默认浏览器
