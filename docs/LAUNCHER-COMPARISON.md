# KJMCL 高级功能差距与成熟化路线

调研日期：2026-11-12，Asia/Shanghai。比较起点为 KJMCL 0.2.1；本文另外标明本轮 0.3.0 已落地的内容。仅观察公开功能、配置契约和行为边界，KJMCL 实现独立编写，没有复制 HMCL / SJMCL 的代码。本地排除目录 `SJMCL/` 未修改。

## 1. 可复核的比较基线

| 项目 | 调研时主分支提交 | GitHub latest 正式发布 |
| --- | --- | --- |
| HMCL | [411a4c8610](https://github.com/HMCL-dev/HMCL/commit/411a4c86100c56c733eed74051f22bcfc14ef6be)，2026-11-10 21:36（北京时间） | [v3.16.4](https://github.com/HMCL-dev/HMCL/releases/tag/v3.16.4)，2026-09-17 |
| SJMCL | [06c0c91bbf](https://github.com/UNIkeEN/SJMCL/commit/06c0c91bbf055cdcdbba45b6d606eeeae527ea84)，2026-11-12 00:47（北京时间） | [v1.4.1](https://github.com/UNIkeEN/SJMCL/releases/tag/v1.4.1)，2026-11-07 |

主分支可能含尚未发布的功能，因此不能把下面的主分支能力都等同于上述正式版。HMCL 当前主分支版本根已进入 3.18；GitHub latest 仍指向 3.16.4。本报告使用固定提交链接，避免以后仓库更新改变比较含义。Prism 仅作为 Java 设置交互的补充参考，没有做其全仓审计。

结论：KJMCL 已有账户、安装、实例、模组、整合包和备份的基础流程。主要差距是兼容性知识的深度、异常时的恢复能力、性能问题的证据采集和发布质量。继续增加入口数量，不能替代这些能力。

## 2. 与游戏性能直接相关的差距

### Java、内存与 GC

HMCL 不仅检测 Java 大版本，还维护游戏、加载器和旧运行库的 Java 约束；配置支持自动内存、初始/最大堆、设置继承和覆盖。SJMCL 将自动内存、优先级、GC 和 JVM 参数分别建模。KJMCL 0.2.1 只选择匹配的大版本，配置路径时仅检查最低版本，默认固定 4096 MiB；多套 Java 的架构和补丁版本没有充分参与选择。[HMCL Java 约束](https://github.com/HMCL-dev/HMCL/blob/411a4c86100c56c733eed74051f22bcfc14ef6be/HMCLCore/src/main/java/org/jackhuang/hmcl/game/JavaVersionConstraint.java)、[HMCL 设置](https://github.com/HMCL-dev/HMCL/blob/411a4c86100c56c733eed74051f22bcfc14ef6be/HMCL/src/main/java/org/jackhuang/hmcl/setting/GameSettings.java)、[SJMCL 配置](https://github.com/UNIkeEN/SJMCL/blob/06c0c91bbf055cdcdbba45b6d606eeeae527ea84/src-tauri/src/launcher_config/models.rs)。

| 能力 | 对游戏的实际作用 | 0.2.1 缺口 | 0.3.0 状态 / 后续 |
| --- | --- | --- | --- |
| Java 版本、架构、补丁选择 | 避免错误运行时、本地库加载失败及兼容性退化 | 自动选择不完整 | 已补架构筛选、数值补丁排序、路径去重、短期检测缓存；完整旧版约束库仍待做 |
| 内存预算 | 降低系统换页风险，同时给 native、纹理、线程和启动器留空间 | 只有固定 Xmx | 已补手动/自动模式、用户上限和内存压力提示；尚未根据实际工作集学习 |
| GC 选择 | 改变分配、回收与停顿特征，可能影响卡顿和吞吐 | 只能手写参数 | 已补自动/G1/ZGC；默认不附加大串调参；其他 VM/收集器待专门适配 |
| 参数冲突检查 | 避免多个 Xmx、多个收集器、Xms 大于 Xmx | 启动后才报错或被后续参数覆盖 | 已检查常见冲突和元数据覆盖，保留有效的模块访问参数 |
| JVM 试运行 | 在加载几百个模组前发现内存/GC 不支持 | 无独立入口 | 已补，不获取账户令牌，不加载客户端、模组和用户 javaagent |
| GC 证据 | 区分 GC 停顿与图形/区块问题 | 无记录/汇总 | 已有每次启动独立的轮转日志与停顿摘要；还没有时间轴、JFR 分析 |

自动内存的本轮策略是一个保守上限：取用户上限、物理内存的一半、当前空闲内存减 2 GiB、8 GiB 四者中较小值，按 256 MiB 向下取整，最低 512 MiB；低可用内存仍会提示。它不是模组需求预测器，大型整合包可以改为手动。旧实例迁移保留原手动内存，不悄悄改变运行行为。

不能把 GC 选项写成“高性能/低性能”评分。Oracle 建议先让 VM 选择收集器，再依据实际工作负载调整；低停顿与吞吐存在权衡。KJMCL 对 Java 21/22 的 ZGC 显式启用分代模式，23 及以后不再添加该开关；JDK 24 已移除 `ZGenerational` 参数。真正执行前还会运行所选 Java 验证管理的选项。[Oracle GC 选择指南](https://docs.oracle.com/en/java/javase/21/gctuning/available-collectors.html)、[JDK 24 ZGC](https://docs.oracle.com/en/java/javase/24/gctuning/z-garbage-collector.html)。

Java 要求以版本元数据为准。已知正式版缺元数据时才采用保守回退，包含 1.17 → Java 16、1.18～1.20.4 → 17、1.20.5～1.21.x → 21、26.x → 25；未知快照不能靠名称精确猜测。26.1 改用 Java 25 有官方发布说明支持。[Minecraft 26.1](https://www.minecraft.net/en-us/article/minecraft-java-edition-26-1)。

### 图形、游戏设置与模组

HMCL 的启动选项包含高性能 GPU、图形后端、进程优先级等；SJMCL 的高级设置提供图形 API/renderer、原生 GLFW/OpenAL、环境变量和兼容性开关。这些选项有平台条件，出现 Vulkan 枚举不意味着任意旧 Minecraft 都能切换到 Vulkan，更不意味着一定更快。[HMCL 启动选项](https://github.com/HMCL-dev/HMCL/blob/411a4c86100c56c733eed74051f22bcfc14ef6be/HMCLCore/src/main/java/org/jackhuang/hmcl/game/LaunchOptions.java)、[SJMCL 高级设置](https://github.com/UNIkeEN/SJMCL/blob/06c0c91bbf055cdcdbba45b6d606eeeae527ea84/src/components/game-advanced-settings-group.tsx)、[SJMCL 图形环境适配](https://github.com/UNIkeEN/SJMCL/blob/06c0c91bbf055cdcdbba45b6d606eeeae527ea84/src-tauri/src/launch/helpers/graphics_handler.rs)。

| 缺失能力 | 为什么值得做 | 优先级与实施边界 |
| --- | --- | --- |
| 可撤销的游戏设置预设 | 画距、模拟距离、实体距离及帧率上限更直接影响渲染/模拟负载 | 本轮已做四字段预设；只修改已有键、保留其他内容、拒绝覆盖后续冲突修改 |
| 性能模组组合与本地重复检测 | 用户需要适合当前游戏/加载器的组合，不能靠文件名猜版本 | 下一阶段 P1；先解析 JAR 元数据及来源，再做兼容计划、依赖锁和批量事务 |
| 高性能 GPU 与驱动诊断 | 双显卡可能选错设备；驱动/本地库问题会阻止图形初始化 | P1/P2；先检测与引导，再提供平台适配；不默改系统注册表或驱动设置 |
| 可选进程优先级 | 竞争资源时可能有帮助，但不能解决 GPU 瓶颈 | P2；保持 normal 默认，限制高优先级，不提供实时优先级 |
| ARM 原生库替换、系统 GLFW/OpenAL | 决定特定平台或旧版能否可靠运行 | P1；必须建立 OS/架构/游戏版本实机矩阵，不把下载可用当运行可用 |
| 游戏内帧时间、CPU/GPU/RSS 和区块指标 | 识别究竟是 GC、CPU 主线程、显卡、区块生成还是外部服务器慢 | P1；需要合适的采样后端/可选游戏侧桥接，当前没有 FPS 遥测 |
| 标准化 A/B 对照 | 验证设置是否对特定机器和整合包有效 | P1；固定世界副本、路线、分辨率、模组和预热，再比较多次中位数及尾延迟 |

性能模组不能全部默认勾选。后续候选需要按职责拆分：Sodium 偏重渲染；Lithium 面向游戏逻辑优化；ModernFix 包含启动、加载和内存优化。每个项目都必须查询**当前实例**的游戏版本、加载器、必需依赖及冲突信息，不假设项目最新文件兼容所有版本，也不承诺这些项目可以任意组合。KJMCL 已有 Modrinth/CurseForge 手动安装入口，本轮没有自动替玩家增删任何模组。[Sodium 官方项目](https://github.com/CaffeineMC/sodium)、[Lithium 官方项目](https://github.com/CaffeineMC/lithium)、[ModernFix 官方项目](https://github.com/embeddedt/ModernFix)。

### 故障诊断与性能归因

HMCL 有专门的崩溃报告分析器；SJMCL 的启动状态和进程监控能区分准备阶段、退出和主动取消。Prism 的 Java 页面还提供不用启动游戏的运行时测试。这些是 KJMCL 应补的使用体验，不需要复刻其内部实现。[HMCL 崩溃分析](https://github.com/HMCL-dev/HMCL/blob/411a4c86100c56c733eed74051f22bcfc14ef6be/HMCLCore/src/main/java/org/jackhuang/hmcl/game/CrashReportAnalyzer.java)、[SJMCL 进程监控](https://github.com/UNIkeEN/SJMCL/blob/06c0c91bbf055cdcdbba45b6d606eeeae527ea84/src-tauri/src/launch/helpers/process_monitor.rs)、[Prism Java 设置](https://prismlauncher.org/wiki/help-pages/java-settings/)。

0.3.0 已保存最近 12 次会话的运行时、有效内存、准备阶段、退出码/信号、日志末尾和诊断证据。规则覆盖堆内存、native/系统内存、Java 字节码、JVM 参数、部分 OpenGL、本地库、模组依赖和 Mixin 错误。主动停止不显示崩溃推断；只有 SIGTERM 或 Log4j 配置警告时，不伪造确定原因。启动器中途退出的旧记录标为“结果未知”。

剩余差距：还没有聚合 `hs_err_pid`、游戏 `crash-reports`、全部模组清单、驱动信息、长时间运行指标；规则匹配也不能取代因果分析。只读某条 Mixin 堆栈，通常不能安全决定删除哪个模组。

## 3. 性能以外的高级功能缺口

以下“缺口”以 KJMCL 实际实现为依据；未专门验证对比项目的某项功能，不等于断言对方没有。

| 领域 | KJMCL 当前基础 | 需要补齐的成熟能力 |
| --- | --- | --- |
| 加载器覆盖 | 原版、Fabric、Quilt、Forge、NeoForge | 旧版本安装器差异、Legacy Fabric/Cleanroom 等扩展；优先完善已有五类真实联调 |
| 资源管理 | 模组管理，资源包/光影/截图目录入口 | 资源包与光影浏览、版本筛选、启停，截图预览与世界信息，不只打开文件夹 |
| 模组治理 | 两个平台的依赖下载、锁定和提交失败回滚 | 未托管 JAR 识别、重复 mod ID、跨来源冲突、可预览更新计划、整批更新事务和历史回退 |
| 整合包生命周期 | 三种导入、两种标准导出、已有 Modrinth 项目发布 | MultiMC/Prism 格式、差异更新、服务端分发清单、配置合并、版本回退及用户文件保护 |
| 下载可靠性 | 哈希、并发、重试、取消、完整文件缓存 | HTTP Range 续传、镜像健康/故障转移、离线元数据、重启恢复任务、按引用清理缓存 |
| 实例配置 | 独立设置、克隆、自定义目录和复制导入 | 命名模板/分组、全局预设继承与差异展示、多实例批处理 |
| 账户体验 | Microsoft 设备码、Yggdrasil、皮肤上传和正面预览 | 自有 Client ID 真实联调、第三方 OAuth/浏览器登录、账号状态恢复、披风与可旋转皮肤 |
| 系统集成 | 桌面安装、目录入口 | Quick Play、deeplink、命令行、明确权限的扩展 API；MCP 不是性能优化前置条件 |
| 备份恢复 | 手动/启动前备份，恢复新世界 | 保留策略、容量预算、恢复演练、完整实例回滚；云同步需解决冲突与凭据 |
| 产品质量 | 黑橙界面、基本键盘操作、Windows 回归 | 三平台实机、不同 DPI/长文本/键盘可达性、异常恢复、崩溃自救、升级回滚 |
| 发行治理 | 版本化产物、锁定依赖、初步 CI | 签名、公证、受验证自动更新、可复现产物与 SBOM、稳定版/预览版渠道 |

加载器及多架构覆盖可以从 [HMCL 功能声明](https://github.com/HMCL-dev/HMCL/blob/411a4c86100c56c733eed74051f22bcfc14ef6be/docs/README_zh_Hans.md)核对。SJMCL 的资源管理、第三方 OAuth、deeplink/MCP 与扩展能力见其 [README](https://github.com/UNIkeEN/SJMCL/blob/06c0c91bbf055cdcdbba45b6d606eeeae527ea84/README.md)，MultiMC 导入在[独立模块](https://github.com/UNIkeEN/SJMCL/blob/06c0c91bbf055cdcdbba45b6d606eeeae527ea84/src-tauri/src/instance/helpers/modpack/multimc.rs)中。HMCL 与 SJMCL 均有更新相关实现，但本报告没有把“存在更新器”等同于完成更新链安全审计。[HMCL 更新检查](https://github.com/HMCL-dev/HMCL/blob/411a4c86100c56c733eed74051f22bcfc14ef6be/HMCL/src/main/java/org/jackhuang/hmcl/upgrade/UpdateChecker.java)、[SJMCL 更新模块](https://github.com/UNIkeEN/SJMCL/blob/06c0c91bbf055cdcdbba45b6d606eeeae527ea84/src-tauri/src/launcher_config/helpers/updater.rs)。

## 4. 本轮交付和明确边界

本轮是成熟化的第一批，不将 0.3.0 标为“已追平 HMCL/SJMCL”。实现集中在四个领域服务：`performance.ts`、`diagnostics.ts`、`video-settings.ts` 和增强的 `java.ts`；通过命名 IPC 接入单独页面，没有扩大渲染层权限。

- 启动检查仅检查客户端与 classpath 文件存在且非空，不是所有资源的完整哈希验收；完整安装/修复仍由原下载校验流程负责。
- 试运行验证管理的内存、GC、GC 日志和受支持的 Xms；不会执行用户 agent 或完整自定义参数。系统注入 Java 参数时会提示与试运行环境的差异。
- GC 文件按会话命名，每文件约 1 MiB，三个轮转备份；删除超过 12 条历史时清理对应受控 GC 文件。摘要仅覆盖保留的记录，不能解释为整个超长会话的完整统计。
- 视频预设只改 `renderDistance`、`simulationDistance`、`entityDistanceScaling`、`maxFps` 中已存在的键。均衡为 12/8/1.0/120，低负载为 8/5/0.75/60；并非对所有机器最佳。修改会改变画面距离或帧率上限，界面明确展示。
- 状态升到 v3，首次迁移保留 `.v1.bak` 或 `.v2.bak`。老实例保留手动内存和 JVM 默认 GC。诊断与视频还原记录另存，避免主状态膨胀。
- 本轮真实 Minecraft 检查使用本机 1.21.11 Fabric 客户端及模组的隔离复制件，离线测试身份，不复制存档和真实凭据。Java 21、ZGC、4 GiB 完成渲染/音频/纹理初始化后主动结束；没有世界内 FPS 对照，也没有真实第三方认证验收。完整证据范围见 [VALIDATION.md](VALIDATION.md)。

## 5. 下一阶段的交付顺序与验收条件

1. **P1：模组治理和可撤销优化组合。** 解析本地 Fabric/Quilt/Forge/NeoForge 元数据；区分未托管与托管模组；给出计划和冲突证据；安装失败整批回滚，既有存档与配置保持可恢复。再接入版本限定的性能模组推荐。
2. **P1：诊断与测量。** 聚合 JVM/游戏崩溃文件；提供 CPU/RSS、GC 时间线和可选 JFR；有游戏侧证据后才显示 FPS。固定世界副本的多轮对照报告同时给出平均帧时间、尾部卡顿、内存、加载耗时；记录硬件/驱动/模组/设置，不拿单次启动秒数当 FPS 提升。
3. **P1：兼容性验收。** Windows x64、macOS arm64/x64、Linux x64 实机；旧 Java 8、1.17 Java 16、1.18 Java 17、1.21 Java 21、26.x Java 25；优先验证现有加载器、导入、离线/真实登录及中文/空格路径。平台原生库替换必须逐项验收。
4. **P1：更新与安装可靠性。** 可预览更新计划、整合包版本回退、下载续传和恢复；注入断网、磁盘满、权限拒绝、中途取消等故障，验证不留半安装状态、不丢失用户文件。
5. **P2：扩展与发行。** 资源包/光影 UI、Quick Play、模板继承与可授权扩展；再完成签名、公证、自动更新和发行渠道。此前待确认的 Microsoft 应用、许可证、签名及公开发布事项继续保留，不擅自替用户决定。

这里的“成熟”以可验证的安装/启动成功率、故障恢复、用户数据保护和跨平台运行结果为标准。某个设置开关和对比启动器同名，不构成相同质量的证明。
