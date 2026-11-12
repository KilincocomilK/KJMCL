# 架构与开发约定

## 分层

`src/` 是无 Node 权限的 React 渲染层。`shared/types.ts` 是桌面 API 契约；`shared/schema.ts` 是主进程的输入验证。`electron/preload.ts` 只暴露命名操作，不暴露任意 IPC、文件读写、命令执行或 Node 对象。

`electron/main.ts` 负责应用生命周期、窗口、文件选择、系统回收站和服务组装；`electron/features.ts` 集中连接新增功能的类型化处理器。`electron/core/` 按数据持久化、下载、任务、Minecraft 安装、Java、身份、模组、整合包、启动进程拆分。网络只存在于主进程。首次扩展建议先增加领域服务，再补类型、schema、IPC 和页面；不要把业务逻辑复制到组件里。

## 安全边界

- 渲染进程开启 sandbox / contextIsolation，关闭 nodeIntegration。CSP 限制脚本到本地，拦截任意导航、新窗口与权限请求。IPC 只接收本窗口主 frame 的调用。
- Microsoft access token 仅保存在主进程内存，refresh token 由 Electron safeStorage 加密。Linux basic_text 后备不可接受。日志不输出完整启动命令，脱敏访问与刷新令牌。
- 用户必须拥有正常 Microsoft / Minecraft 身份才能通过在线认证；离线模式的 UUID 按 Java `OfflinePlayer:<name>` MD5 算法计算。
- 安装目录 ID 由主进程生成。压缩包拒绝绝对路径、路径上跳、反斜杠、Windows 盘符与符号链接条目，并设定总解压大小上限。运行时下载按上游校验和校验。
- 所有 Java 启动使用 `spawn(executable, args, {shell:false})`；参数以数组传递，路径包含空格时不会被 shell 拆分。JVM 自定义参数是一行一个参数，不进行 shell 求值。
- 对实例的安装、模组变更、导入、删除与启动互斥；运行中的实例禁止写操作。下载和解压只发生在应用管理的数据目录或玩家明确选择并标记的实例目录，原参考目录不参与运行。自定义路径使用规范化绝对路径、所有权标记及重叠检测。模组 staging 位于目标实例所在文件系统，避免跨卷 rename 破坏安装和回滚。

## 状态与异常

状态以临时文件写入后 rename，保存上一份 `.bak`。v2 把旧实例位置固定到 `gameDir`，迁移前保存 `state.json.v1.bak`。改变默认实例根目录不搬动既有数据。schemaVersion 的升级必须配套迁移；不认识的格式直接报错，避免覆盖用户数据。中断的 installing 状态下次启动恢复为 error；修复任务可重试并复用已校验文件。

v3 新增实例性能选项，从 v1/v2 迁移时保留对应版本原始备份，旧实例默认手动内存、JVM 自动 GC、关闭 GC 记录。会话历史与视频预设还原数据分别存储，避免将日志正文放进主状态。短时试运行/视频变更通过 `Tasks.exclusive` 与实例启动和安装共享互斥键。

任务状态由 `Tasks` 管理，取消通过 AbortSignal 传递。资源下载到 `.part`，大小与哈希验证成功后提交；失败删除临时文件。模组安装先解析依赖并下载到 staging，验证本地文件后提交，提交失败恢复备份。模组更新保留用户的 disabled 状态。

游戏标准输出 / 错误按行处理，内存保留最多 2000 条，脱敏后写入实例日志。错误退出展示退出码与日志，不假定某一具体原因。

## 新增领域服务

- `forge.ts`：官方 Maven 元数据、安装器校验、无 shell Java 子进程、隔离安装 staging、生成配置合并。`Minecraft` 保留统一安装状态机。
- `instances.ts`：受管实例目录声明、复制克隆、迁移与存档备份索引。`game-folders.ts`：外部文件夹只做索引、运行目录识别、原版本继承解析、刷新和解除索引；外部实例不声明目录所有权，不允许搬移或受管安装。`archives.ts` 通过 yazl / yauzl 流式读写存档；校验在恢复之前完成，恢复目标必须为新目录。
- `vault.ts` / `yggdrasil.ts` / `skins.ts`：操作系统密钥存储、第三方角色与令牌验证、authlib-injector、皮肤服务。只向渲染层传账户公开档案和受限 PNG 数据。
- `curseforge.ts`：独立 `curseforge-lock.json`；兼容筛选、固定文件 ID、必需依赖、SHA-1、禁用状态和回滚。不会绕过作者禁用第三方分发的限制。
- `publishing.ts`：可审阅标准包、摘要和有时效的一次性发布票据；只对已有 Modrinth 整合包项目创建版本。票据在网络写入前消耗，未知网络结果禁止自动重试。
- `client-version.ts`：有界读取客户端 JAR 内的真实游戏版本，修正重命名导入配置。`game-logs.ts`：有界流式解析 Mojang Log4j XML，同时保留普通模组输出及异常级别。启动器在 Java 进程启动前校验 / 补齐日志配置，显式停止请求单独记录。
- `performance.ts`：纯函数内存预算与参数计划，主进程执行版本/架构/文件检查及有限 JVM 探测。探测剔除系统 Java 注入变量且不执行用户 agent；正常游戏启动保留用户环境并给出差异提示。自动选择精确大版本与进程架构，手选较新版本会提示兼容风险。
- `diagnostics.ts`：串行原子写入会话历史、证据式错误提示和 GC 统计。只保留 12 次、每次 150 条截断日志；GC 轮转文件随历史淘汰清理。上次未完成会话显示结果未知，不假设游戏崩溃。退出信号不作为单独确定病因。
- `video-settings.ts`：字段级预设与还原。只处理已存在字段；临时文件独占创建，提交前复核原文件；拒绝符号链接、超大文件及重复字段。备份先落盘，后替换 options.txt；恢复不会覆盖后续冲突修改。
- `storage.ts`：独立版本的目录定位与归属、便携重定位、复制/校验/切换/原数据清理。主进程在 Electron ready 前选择稳定控制目录，迁移只改变 Store 数据根，保留 Chromium 加密配置锚点。迁移时主 IPC 阻止其他写入；等待重启状态也阻止继续写旧数据。详见 [STORAGE.md](STORAGE.md)。
- `uninstall.ts` 与 `build/installer.nsh`：Windows 手动卸载的数据保留审阅，默认保留；更新及静默跳过清理，拒绝宽泛 profile 删除参数。应用用临时配置启动卸载审阅，不占用将清理的数据文件；清理以归属与受管目录白名单为边界。
- `shared/version.ts`：版本来源统一为 package.json，网络标识、启动参数与布局预览同步。

`src/pages/` 按领域拆分，扩展对话框在 `src/dialogs/`。新 API 必须同时更改 types、schema、preload 白名单和处理器，`tsc` 校验契约完整。

0.7 状态 v5 增加 `gameFolders`、选中文件夹与 `Instance.external`，迁移保留原版本备份及 v4 收藏。`Store.runtime()` 对外部实例返回原共享目录，`Minecraft.resolved()` 每次读取原版本元数据和客户端路径；工作目录仍由实例索引决定。普通写操作检查同文件夹和重叠工作目录的运行/任务互斥。`Workspace.tsx` 组合存档与诊断页面。0.7.1 的资源页面独立整合分类、本地文件操作及 `ModResources.tsx` 的模组搜索/管理，保持唯一实例选择器；切换实例会销毁旧请求状态，任务完成后重读文件。

## 测试

- `tests/core.test.ts`：路径边界、UUID、OS / feature rules、继承、Maven、参数、存储、IPC schema、任务锁、取消、脱敏。
- `tests/services.test.ts`：合成的完整安装图、哈希错误、缓存复用、原生库过滤、失败恢复、模组依赖与更新、整合包导出。
- `tests/advanced.test.ts`：迁移、目录边界、克隆、备份校验 / 流式恢复、已有版本导入、加载器元数据、Yggdrasil 令牌、CurseForge 依赖、公开整合包与 PNG 校验。
- `tests/performance.test.ts`：内存预算边界、Java 版本/架构与 ZGC 参数矩阵、冲突与文件检查、互斥、预设往返与冲突保护、v2 迁移、会话持久化、脱敏与 GC 统计。桌面 smoke 额外验证真实 JVM 的 G1 探测、GC 文件、视频 UI 和重开历史；不把 JVM 测试类误称为 Minecraft。
- `tests/storage.test.ts` / `scripts/storage-smoke.mjs`：数据目录边界、迁移与清理恢复、卸载保留/取消/删除、便携重定位；Windows 实际跨卷 Electron 回归包含凭据解密，避免只验证文件复制成功。
- `scripts/uninstall-smoke.mjs`：实际 Electron 主进程卸载入口、三种对话框响应和退出码、受管数据清理范围；对话框响应由测试提供，不安装或卸载系统应用。
- `scripts/portable-storage-smoke.mjs`：设置 `KJMCL_PORTABLE` 为 Windows 便携 EXE 后执行；复制到隔离目录，验证真实外层程序、旁置数据、迁移重启及旧解压目录清理后重新加载界面。
- `scripts/forge-smoke.ts`：本地编译的安装器测试程序，真实运行 Java CLI，验证 Forge / NeoForge 适配器的原版种子、生成配置与运行库提交。不会下载官方安装器。
- `scripts/desktop-smoke.mjs`：实际 Electron 界面 / preload / IPC，离线账户、Java、实例设置、模组切换、数据重开，并编译一个本地 Java 测试程序验证 JVM 进程启动和日志。

集成测试使用系统临时目录 `kjmcl-*`，不会使用真实用户的游戏目录和账户；截图写入忽略的 `.local/`。下载网络不参与测试。文件选择 / 保存对话框由测试提供临时路径，后续执行实际 IPC、服务、文件与界面逻辑；远程发布未执行。不要用“按钮存在”代替行为测试，也不要用假成功遮蔽网络错误。

Unix 的 Rust 测试先解析临时目录的真实路径，保持与 Store 一致，避免 macOS `/var` 系统链接触发存档路径保护；存档内部链接仍必须拒绝。桌面测试等待原生窗口显示并绘制后才操作。Linux CI 使用 Xvfb 和 Openbox，以覆盖轻量模式需要的焦点、最小化和恢复行为，而非仅提供一个显示服务。

## 发布

锁定直接依赖并提交 package-lock。使用 `npm ci`，先 typecheck / tests，再 build / package。打包产物按版本写入 `release/<version>/`，避免覆盖正在使用的旧版目录。三平台由各自 runner 构建；不要用 Windows 上存在 macOS 配置作为 macOS 已通过的证据。

Node 版本见 `.node-version`，npm 版本见 `package.json` 的 `packageManager`；CI 同时固定两者。更新锁文件后必须在没有 `node_modules` 的隔离目录验证 `npm ci`，不能用已有依赖目录下的 build 代替。可复制 package.json 和 package-lock.json 到临时目录，用固定版本 npm 执行 `install --package-lock-only --ignore-scripts` 修复依赖记录，再检查差异并验证干净安装；不要用跳过可选依赖或宽松 peer 检查来掩盖不完整锁文件。

修改 package.json 版本后运行 `npm run notices`，同步产物内的第三方许可清单版本。网络不可用时可使用 electron-builder 的 `electronDist` 指向本机已验证、版本相同的 Electron 分发目录；该覆盖只用于本机临时构建配置，不写入跨平台发布配置。

代码已按用户授权采用 MIT 并署名 KilincocomilK；第三方声明保留各自许可证。正式发行前仍需补齐 Microsoft 应用授权、Windows 签名、macOS Developer ID / 公证及图标 / 名称权利。自动更新必须引入签名及验证机制，初版不从任意 URL 执行更新包。

当前 npm 生产依赖审计无已知漏洞；开发构建链 electron-builder 的 minimatch 存在中等级审计告警。不要为了消除告警直接降级或全局覆盖跨主版本依赖；跟踪上游并在更新后复跑打包。构建链只在受控源码 / CI 中运行。
