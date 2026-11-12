# KJMCL 本轮开发交接

交接日期：2026-11-12，Asia/Shanghai。项目：`F:\Project\2026.11.12_KJMCL`。当前版本：**0.7.0 开发版**。

0.7.0 改为“游戏文件夹 → 版本”两层索引，外部目录不复制、不搬移，启动引用原客户端、运行库、资源和工作目录；移除仅解除索引。状态升级 v5，旧副本和收藏均保留。左侧工作空间合并为七项，账户统一在左下角，资源、存档和诊断以标签页整合。实现与验证范围见 [游戏文件夹索引](GAME-FOLDERS.md)。本地 118 项测试和完整 Electron 桌面流程已通过，临时 JVM 用例不代表真实 Minecraft 联网验收。

用户已授权将源码提交到本人 [KilincocomilK/KJMCL](https://github.com/KilincocomilK/KJMCL) 私有仓库，并采用 MIT、署名 KilincocomilK。此授权不包含改为公开仓库或上传发行包；参考目录、构建产物、凭据和玩家数据继续排除。

0.6.1 新增自动轻量模式：游戏运行时释放完整渲染进程，切换为独立精简窗口；最后一个游戏退出后恢复完整界面，切换仅弹窗通知。实现与实测范围见 [轻量模式](LIGHTWEIGHT.md)。不改变 v4 持久化结构，模式只保存在当前进程中。

最新一轮参考 Axolotl 的公开功能，实现内容中心、收藏分组、实例整理、模组检查与批量启停、崩溃报告及磁盘管理。详细对照、验证范围与限制见 [0.6.0 迭代说明](AXOLOTL-ITERATION.md)。持久化状态升级为 v4，保留 `state.json.v3.bak`；数据目录恢复逻辑同步接受 v4。

0.5.0 新增 Rust 存档管理：区域索引、地表预览、多维度、过滤清理、属性编辑、备份撤销及中断恢复。实现、性能数据、测试范围和剩余能力见 [0.5.0 存档管理](SAVE-MANAGER.md)。构建需要 Rust stable / Cargo；原生二进制必须与 Electron 的系统和架构一致。存档编辑日志独立使用 v1。

上一轮新增全局拖入、按实例资源管理与预览、官方陶瓦 HTTP 接入，详见 [0.4.0 实现与验证](RESOURCES-MULTIPLAYER.md)。已验证 Windows 官方组件下载、启动、扫描和重置，尚未完成双机进入 Minecraft 世界的联机验收。下文的历史验证和本机清理记录仍保留，不能据此自动清理新数据。

本轮从基础启动器推进到高级功能、启动修复、性能诊断、数据迁移和卸载保留策略，并完成本机清理与发行包归档。下一轮在现有代码上继续完善可靠性和性能相关能力；目前尚未完成三平台实机验收、真实账户联调和正式发行准备，不能将当前版本称为已追平 HMCL / SJMCL 的成熟稳定版。

## 用户要求与工作边界

- 面向 Windows、macOS、Linux 的 Minecraft Java 启动器；长期可维护、分层开发。
- 中文、直角、黑橙、简约磨砂玻璃，参考 `kjmc.top` 的视觉风格，界面避免非必要文字。
- 允许借鉴其他启动器的公开功能与行为，禁止复制实现；本地 `SJMCL/` 是排除的参考仓库，不修改、不提交、不打包。
- 游戏目录可由玩家自定义。迁移、导入、备份恢复和卸载必须维护用户文件边界。
- 可用代理为 `http://127.0.0.1:7890`，不强制作为启动器默认配置。下载源可暂不在线测试。
- 用户多次要求将需要确认的问题保留到后续；以下待确认事项仍未回答，不要重复打断开发或代替用户作注册、发布、签名等决定。
- 2026-11-12 的本机删除是用户明确要求的一次清理，不应据此在以后自动删除新生成的数据。

先读根目录 `AGENTS.md`；开发约定和完整 API / 状态边界以仓库实际文件为准。

## 已交付内容

| 版本 | 本轮实现 |
| --- | --- |
| 0.1.0 | 基础桌面界面、账户、Minecraft 版本与实例、Java、模组、下载任务和游戏启动流程 |
| 0.2.0 | Forge / NeoForge、第三方 Yggdrasil、CurseForge、皮肤、标准整合包生成与发布入口、存档备份、实例克隆、自定义 MC 目录、已有目录复制导入 |
| 0.2.1 | 导入实例真实版本识别、Log4j 配置校验与补齐、XML 日志可读化、停止请求记录、启动与结束按钮分离 |
| 0.3.0 | Java 架构与补丁选择、自动内存、G1 / ZGC、启动检查、JVM 试运行、GC 摘要、持久化启动诊断、可撤销视频设置预设 |
| 0.3.1 | 安装版首次选择数据目录、整体数据迁移与原副本清理、便携数据旁置及重启、Windows 卸载时选择保留 / 删除 / 取消 |
| 0.4.0 | 全局文件拖入、按实例资源管理与预览、陶瓦联机官方 HTTP 接入 |
| 0.5.0 | Rust 存档引擎、多维度地图、区块过滤清理、属性编辑、事务备份与恢复 |
| 0.6.0 | 双源内容中心、内容收藏、实例分组与标签、批量模组检查、崩溃诊断包、磁盘与缓存管理 |
| 0.6.1 | 游戏运行时自动切换轻量界面、完整渲染进程释放、日志 IPC 暂停、退出自动恢复与通知 |

当前功能还包括：离线 / Microsoft 设备码登录、Fabric / Quilt、Modrinth、必需模组依赖、托管模组更新及失败回滚、资源修复、代理与并发下载、日志脱敏、目录入口。账户和网络服务的“实现完成”不等于真实服务验收完成。

整合包发布当前支持向**已有 Modrinth 整合包项目**上传版本；CurseForge 生成 ZIP 后由用户上传后台。离线皮肤只是启动器本地预览，第三方皮肤上传要求服务端支持相应扩展。

## 启动失败调查的结论

用户报告过 Java 21、4096 MiB、authlib-injector 的启动日志，其中出现 Log4j `Reconfiguration failed`，随后 `SIGTERM`。

0.2.1 修复了导入配置名称与 JAR 实际游戏版本不一致、缺失日志配置文件，以及原启动位置在启动后变成结束按钮导致重复点击可能结束进程的问题。现在显式结束会记录请求来源，日志按级别解析。

**原始日志没有停止来源证据，不能断言原始 SIGTERM 就是误点击、认证失败或某个模组崩溃。** 后续真实客户端检查使用隔离副本和离线身份，只验证到渲染 / 音频初始化；没有完成该用户真实第三方账户的登录、联机或世界内验证。

## 性能功能与比较报告

调研保存在 `docs/LAUNCHER-COMPARISON.md`。其中记录的是 2026-11-12 的固定基线：HMCL `411a4c86100c56c733eed74051f22bcfc14ef6be`、SJMCL `06c0c91bbf055cdcdbba45b6d606eeeae527ea84`。下一轮如需“最新仓库”，重新核实，不把旧报告当成实时状态。

- 自动内存考虑用户上限、总内存、可用内存和保留空间；旧实例保留原手动配置。
- GC 默认跟随 JVM；G1 / ZGC 可选。Java 21/22 的 ZGC 使用分代开关，后续版本按参数兼容性处理，不堆砌所谓万能优化参数。
- 启动前检查常见堆 / GC 参数冲突、客户端与 classpath；JVM 试运行不执行用户 agent，不等同于游戏或全部自定义参数验收。
- 最近 12 次启动记录持久化；记录阶段、退出码 / 信号、证据及有限日志。GC 日志轮转并汇总停顿。
- 视频预设仅修改已经存在的画距、模拟距离、实体距离和帧率上限字段，保存还原信息；遇到玩家后续修改会拒绝覆盖。

尚缺：本地 JAR 来源与重复 mod ID 识别、可预览的整批模组事务、版本限定性能模组组合、完整崩溃报告聚合、CPU / RSS / 帧时间采样、GPU 与驱动诊断、完整旧 Java / ARM 原生库适配、整合包差异升级与回退、下载续传和任务恢复。

没有世界内 FPS 对照结论；单次启动中的 GC 数值不能证明某个收集器更快，也不能承诺已经提升游戏帧率。

## 数据目录与卸载的关键决定

详细说明在 `docs/STORAGE.md`，不要在后续重构中丢失这些约束。

| 场景 | 当前行为 |
| --- | --- |
| 全新安装版 | 控制目录默认在平台用户目录；数据初始位于其 `data/` 下，首次界面可选择其他磁盘的独立空目录 |
| 旧版本升级 | 保持原数据位置，不暗中搬移或以空配置替代缺失磁盘的数据 |
| Windows 便携版 | 使用外层 EXE 旁的 `KJMCL-data`，与安装版默认环境独立 |
| 整体迁移 | 只复制受管内容，逐文件 SHA-256 校验，切换后重启；原副本保留，需明确执行清理 |
| 外部自定义 MC 目录 | 整体迁移和卸载清理保持原位置；不沿 state 中任意 gameDir 删除 |
| Windows 交互卸载 | 默认保留；也可永久删除受管数据或取消卸载 |
| 升级 / 普通静默卸载 | 保留数据，拒绝绕过该策略的 `--delete-app-data` |
| macOS / Linux / 直接删除便携 EXE | 没有 Windows 式卸载对话框钩子，数据默认保留 |

实现注意事项：

- `state.json` 为 schema v4；`storage-location.json` 和迁移记录各有独立版本 1。未知版本报错，不能静默重置。0.6 升级保留原 v3 文件副本；旧启动器不能直接打开新状态。
- **Electron 的 userData / sessionData 控制位置需稳定。** 本轮实际遇到更换 Chromium 配置位置后 safeStorage 密文无法解密，已修复为只迁移领域数据。HTTP 磁盘缓存上限 32 MiB 不包含全部 GPU / Chromium 元数据。
- 数据归属标记、规范路径、空目标、目录重叠、符号链接 / 联接检查必须保留。迁移和等待重启期间阻止新的写入。
- 复制阶段被强制结束可能留下未完成目标，但原数据保留；清理原副本先检查摘要，支持部分清理后重试。自定义 JVM / 模组配置中手写的绝对路径不自动猜测替换。
- 卸载永久删除不可回滚；I/O 失败可能已有部分受管文件被删除，错误会阻止继续卸载。
- 便携重启要启动 `PORTABLE_EXECUTABLE_FILE` 外层程序。当前固定的 electron-builder 26.18.0 用 `portable.unpackDirName: true` 才产生每次独立解压目录，实际实现与该版本类型注释的布尔描述不一致；升级构建器前核查生成脚本并复跑真实便携测试。

## 最近验证结果与边界

完整记录在 `docs/VALIDATION.md`。以下区分历史功能验证与本次交接检查。

| 检查 | 最近结果 |
| --- | --- |
| 核心 / 服务测试 | 82 / 82 通过，属于 0.3.1 完整开发验证；本次交接未重跑 |
| TypeScript / Vite / Electron 构建 | 0.3.1 通过；本次交接再次运行 `npm run build` 也通过 |
| 实际 Electron 桌面回归 | 账户、实例、模组、导入 / 克隆、备份、性能配置、真实 JVM 测试类等通过；最终 win-unpacked 也通过 |
| 数据迁移 | Windows 实际 C: → F: 临时目录通过，内部路径重写、外部目录保留、重开、凭据解密和明确清理通过 |
| 旧版加密配置 | 用 0.3.0 创建加密配置，再由 0.3.1 打开，账户保留且可解密 |
| 卸载三种选择 | 实际 Electron 主进程入口通过，测试提供对话框响应；不是系统级安装 / 卸载验收 |
| 实际便携 EXE | 旁置数据、迁移重启、新 PID、旧包装进程清理后重新加载界面通过 |
| 真实 Minecraft | 已有 1.21.11 Fabric 客户端的隔离副本，离线身份，Java 21 / ZGC / 4 GiB，完成渲染 / 音频 / 纹理初始化后主动结束 |
| 发行文件 | 整理后 5 个版本共 15 个 EXE / blockmap 的 SHA-256 核对通过 |

仍未验收：下载源整体在线可用性、完整真实游戏下载、Microsoft / 第三方真实账户、Forge / NeoForge 官方安装器联调、真实皮肤上传或远程发布、世界内性能对照、系统级 Windows 安装 / 卸载、macOS / Linux 实机、远程 CI。三平台 CI 配置存在不代表已经运行成功。

Windows 发行包未签名，未公开发布。历史生产依赖审计无告警、构建链 minimatch 有告警的记录不是本次重新审计结果，后续应重新检查，不以强制跨版本覆盖消除提示。

## 本机清理与交接时实际状态

用户已明确要求清理，并已完成一次删除：

- 原 `C:\Users\KilincocomilK\AppData\Roaming\KJMCL`，含旧账户配置、凭据和 2 个实例。
- `C:\Users\KilincocomilK\AppData\Local\kjmcl-updater` 安装缓存、已确认的测试和失败下载临时目录。
- 项目 `.local/`、`dist/`、`dist-electron/`、Vite / Vitest 缓存、旧版 win-unpacked、失败构建及 builder-debug 文件。

删除文件合计约 **5.04 GiB**，其中 C 盘约 **3.49 GiB**。保留源码、node_modules、SJMCL 参考目录、各版正式构建文件和 `0.3.1/win-unpacked`。历史截图、真实启动日志和 `.local` 临时测试脚本已清理，不能再声称这些证据文件仍可打开，也不能使用旧 C 盘实例作为测试源。

**交接核对发现了清理之后的新状态，必须保留：**

- 便携 KJMCL 正在运行，进程来自 NSIS 临时解压目录。
- 新控制 / 数据目录为 `F:\Project\2026.11.12_KJMCL\release\0.3.1\KJMCL-data`，位置记录已存在。它是正在使用的用户数据，**不是发行文件或可删构建缓存**，不得随 release 整理清理或上传。
- `%APPDATA%\KJMCL` 在北京时间 11:30:12 再次出现；本次检查时为空。没有证据表明旧数据恢复，也未在本次交接再次删除。便携启动为何仍创建空默认目录可列入后续排查，不能据此声称完全零 C 盘写入。
- 该次 0.3.1 清理交接时 Git 仓库尚无 HEAD 提交和 remote。此为历史记录；后续用户已授权初始化私有 GitHub 仓库及 MIT 许可证，当前提交与远程地址应以 Git 状态核对。

本次交接只更新文档和检查构建，不修改功能、版本号、既有发行包或当前用户数据。构建重新生成了 `dist/`、`dist-electron/`，与保留的 0.3.1 包内主进程、preload 和界面文件摘要一致；这些编译目录现已保留，不要把它们误认为上次清理未完成。

## 发行目录

```text
release/
  SHA256SUMS.txt                 # 15 个发行文件，使用版本子目录相对路径
  0.1.0/
  0.2.0/
  0.2.1/
  0.3.0/
  0.3.1/
    KJMCL 0.3.1.exe              # Windows x64 便携版
    KJMCL Setup 0.3.1.exe        # Windows x64 NSIS 安装版
    KJMCL Setup 0.3.1.exe.blockmap
    SHA256SUMS.txt
    win-unpacked/               # 当前版本可执行开发产物
    KJMCL-data/                 # 清理后新建的用户数据，不属于发行物
```

每个旧版本保留安装版、便携版、blockmap 和本版本 SHA256SUMS；旧解包目录已删除。根目录及各版校验清单已更新。

## 下一轮恢复开发

技术栈：Node.js 24、Electron 45.3.0、React 19、TypeScript 7、Vite 8、electron-builder 26.18.0。本机已有 JDK 21：`E:\java\java21\bin`；已有 node_modules，无需为了交接重新下载依赖。

以下命令是下一轮工作入口；新建 `.local` 是为了当前 storage smoke 的父目录要求。每条命令失败时先排查，不继续打包。

```powershell
Set-Location -LiteralPath 'F:\Project\2026.11.12_KJMCL'
$env:PATH = 'E:\java\java21\bin;' + $env:PATH
New-Item -ItemType Directory -Path '.local' -Force | Out-Null
npm run typecheck
npm test
npm run test:desktop
npm run test:storage
npm run test:uninstall
npm run test:installer
npm run build
```

开发运行使用 `npm run dev`。为不重建 C 盘测试档案或碰触当前便携数据，可在该开发进程的环境中设置 `KJMCL_DATA_DIR` 为新的绝对隔离路径；不要把测试路径设为当前实际数据目录。各 smoke 脚本有自己的隔离目录，不把合成账户写入生产状态。

打包后复验可设置 `KJMCL_EXECUTABLE` 指向该版本 `win-unpacked/KJMCL.exe`，然后执行 desktop / storage smoke；卸载入口归档测试使用 `KJMCL_ASAR` 指向该包的 `resources/app.asar`。真实便携测试入口：

```powershell
$env:KJMCL_PORTABLE = (Resolve-Path -LiteralPath 'release/0.3.1/KJMCL 0.3.1.exe').Path
node scripts/portable-storage-smoke.mjs
```

测试需新建临时目录，不能通过删除当前运行版数据来“恢复干净环境”。当前便携版正在运行，后续构建使用新版本输出目录，避免覆盖运行中的外层 EXE。

之前 Electron 下载超时时，用临时 JSON 构建配置复制 package.json 的 build，并添加本机 `node_modules/electron/dist` 的绝对 `electronDist`，成功完成打包；该临时文件已清理。必要时重建临时配置，不把机器绝对路径写入正式 package.json。修改版本后运行 `npm run notices`；按实际版本更新 SHA-256 清单。代理只在所需命令的环境中设置。

## 关键代码位置

以下为相对于项目根目录的模块索引；完整约定见 `docs/ARCHITECTURE.md`。

| 位置 | 职责 |
| --- | --- |
| `electron/main.ts`、`electron/features.ts` | 生命周期、服务组装、主进程 API、任务 / 写入互斥 |
| `shared/types.ts`、`shared/schema.ts`、`electron/preload.ts` | 桌面接口契约、输入校验、命名白名单；增加 API 时同步修改 |
| `electron/core/launcher.ts`、`minecraft.ts`、`java.ts` | 安装、Java 选择、启动与进程控制 |
| `electron/core/client-version.ts`、`game-logs.ts` | 导入版本识别、日志解析 |
| `electron/core/performance.ts`、`diagnostics.ts`、`video-settings.ts` | 性能计划、诊断、视频设置事务 |
| `electron/core/storage.ts`、`store.ts` | 数据位置、迁移 / 清理、状态 schema |
| `electron/uninstall.ts`、`build/installer.nsh` | Windows 卸载审阅和 NSIS 钩子 |
| `electron/core/instances.ts`、`archives.ts` | 自定义目录、导入 / 克隆、流式存档备份恢复 |
| `electron/core/forge.ts`、`yggdrasil.ts`、`vault.ts`、`skins.ts` | 加载器、第三方账户、加密凭据、皮肤 |
| `electron/core/mods.ts`、`curseforge.ts`、`packs.ts`、`publishing.ts` | 模组、整合包、可审阅发布 |
| `src/pages/`、`src/dialogs/` | 无 Node 权限的界面与对话框 |
| `tests/`、`scripts/*smoke*`、`.github/workflows/ci.yml` | 核心 / 合成服务 / 实际 Electron 测试和三平台 CI 配置 |

## 下一轮建议顺序

1. **整理开发基线和小型可靠性问题。** 先核对当前运行数据与 Git 状态；让 storage smoke 独立创建 `.local`，复核卸载审阅临时目录的退出清理，调查便携启动创建空 AppData 目录的原因。当前脚本直接在缺失的 `.local` 下 mkdtemp，是清理后独立运行的已知前置条件问题。
2. **优先推进模组治理。** 有界解析 Fabric / Quilt / Forge / NeoForge 元数据；区分本地和托管文件；检测重复 ID、缺失依赖、版本 / 加载器冲突；提供安装 / 更新计划和整批回滚，再增加版本限定、可撤销的性能模组组合。不要直接默认安装一组所谓优化模组。
3. **补诊断与真实测量。** 聚合 `hs_err_pid`、游戏 crash-reports、模组清单，再做 CPU / RSS、GC 时间线和可选 JFR。游戏内 FPS / 帧时间需要可靠采样；对照测试使用固定世界副本、路线、分辨率、预热及多轮样本。
4. **补真实兼容性和故障恢复。** 有条件时运行 Windows 安装 / 卸载、macOS / Linux 实机、官方加载器和真实账户；下载续传、磁盘满、权限拒绝、中断恢复、整合包差异升级 / 回退按具体任务逐项验收。仍可按用户要求暂缓下载源全面测试。
5. **再完善发行。** 签名、公证、受验证自动更新、渠道、SBOM 与供应链跟踪，需要已确认的项目身份和发布方案。

## 继续保留的待确认事项

1. Microsoft 应用 Client ID、所有者与 Minecraft 服务准入。
2. 仓库何时改为公开；已确定作者 KilincocomilK、MIT 许可证及 GitHub 私有托管，不能再将这些已授权项视为待确认。
3. Windows 证书、macOS Developer ID / 公证、发布渠道、更新服务和下载域名。
4. CurseForge API Key、Modrinth 发布令牌及真实账户联调条件；不把凭据写进源码、交接或日志。
5. KJMC 预置服务器、整合包、皮肤站及账户联动的具体方案。

这些事项没有因本轮结束而得到默认批准。详见 `docs/DECISIONS.md`，继续做不依赖答案的实现与隔离验证即可。

## 可复制到下一轮的开场说明

> 继续开发 F:\Project\2026.11.12_KJMCL。先读 AGENTS.md 和 docs/HANDOFF.md，再看 README、ARCHITECTURE、STORAGE、VALIDATION、LAUNCHER-COMPARISON、DECISIONS。当前为 0.3.1 开发版，最近完整核心测试 82 项通过；真实账户、官方 Forge / NeoForge、系统安装卸载和 macOS / Linux 尚未完整验收。旧 C 盘数据与临时证据已按要求清理，但现在 release/0.3.1/KJMCL-data 是新建且正在使用的便携数据，必须保留；不要重用已删除实例或清理该目录。原待确认问题继续保留。下一阶段优先完善模组元数据 / 冲突检测 / 批量事务，再推进可撤销性能组合与诊断测量。保持中文黑橙直角界面、沙箱与类型化 IPC、状态迁移和文件校验，不复制参考仓库代码，不代替用户公开发布。
