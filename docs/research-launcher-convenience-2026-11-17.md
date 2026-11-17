# 启动器便利功能调研 · 2026-11-17

本轮参考 **Axolotl Launcher（美西螈）**、**HMCL**、**SJMCL**。美西螈不是 XMCL。调研采用官方文档、发布记录，以及玩家在 GitHub、Reddit、MC 百科社群中的实际反馈。社区建议代表使用需求，不代表对应启动器已经实现。

对照 KJMCL 0.7.2 的 README、账户页、日志页及实例配置：版本隔离、Java 检测、模组依赖、批量启停、拖入导入、备份、崩溃报告、磁盘清理等已经存在，不重复计算成本轮新增功能。没有读取或复制 `SJMCL/` 参考目录的实现。

## 官方功能依据

| 来源 | 与本轮相关的能力 |
| --- | --- |
| [Axolotl 官方项目介绍](https://github.com/Axolotl-Launcher/Axolotl) | 将模组、资源包、光影的搜索与安装放进同一客户端，减少网页下载与目录切换。 |
| [Axolotl 官方发布记录](https://github.com/Axolotl-Launcher/Axolotl/releases) | 1.11.0-beta.4 列出账号排序、收藏分类与安装、完整源日志导出等细节。 |
| [HMCL 官方文档](https://docs.hmcl.net/) | 版本隔离、加载器与模组安装、光影和设置说明。 |
| [HMCL 设置说明](https://docs.hmcl.net/launcher/set-item-details.html) | 游戏级启动配置和 Java、内存、启动器可见性。该文章标注编写版本较旧，仅用于功能设计背景。 |
| [HMCL 实例设置公开 schema](https://github.com/HMCL-dev/HMCL/blob/main/docs/schemas/instance-game-settings/1.0.0.json) | 游戏窗口模式包含窗口、全屏、最大化。仅参考公开数据规范，不复制实现。 |
| [HMCL 稳定版更新记录](https://docs.hmcl.net/changelog/stable.html) | GP-6424 提供游戏日志自动换行开关；KJMCL 对照提供换行显示控制。 |
| [HMCL 光影说明](https://docs.hmcl.net/launcher/shader.html) | 光影包和 Iris/OptiFine 等运行支持是不同内容；下载光影包不等于已安装运行支持。 |
| [SJMCL 官方介绍](https://mc.sjtu.cn/sjmcl/docs/) | 多游戏目录、实例内资源管理、资源包与光影下载、多账户系统。 |
| [SJMCL 官方新手教程](https://mc.sjtu.cn/sjmcl/docs/beginners-guide.html) | 新建实例、账户和资源下载流程，用于对照操作入口。 |
| [SJMCL 1.0.0 发布记录](https://mc.sjtu.cn/2026/05/06/sjmcl-1-0-0-%E6%9B%B4%E6%96%B0%E6%97%A5%E5%BF%97/) | 拖入导入等便利功能已在 KJMCL 实现，本轮不重复列为新增。 |
| [Minecraft 官方 23w14a 技术说明](https://www.minecraft.net/en-us/article/minecraft-snapshot-23w14a) | Quick Play 参数支持直接进入世界/服务器；世界使用文件夹名，服务器使用地址。此版本移除了旧 server/port 参数。实现应检测实际元数据能力，不只比较版本号。 |

## 功能选择与玩家需求

以下为本轮选取的独立便利功能；实际交付及测试状态由本轮交接记录列明。

| 功能 | 当前缺口与预期操作 | 玩家依据 |
| --- | --- | --- |
| 1. 实例绑定账户 | 实例设置选择账户，日后启动不用反复切换；账户移除后提示重新选择，不默用其他账户。 | [HMCL #2973](https://github.com/HMCL-dev/HMCL/issues/2973)、[HMCL #6311](https://github.com/HMCL-dev/HMCL/issues/6311)：不同实例需要不同 UUID 或认证服务器，忘记切换会影响游戏数据。 |
| 2. 账户排序 | 常用账户上移、下移，重启保留顺序，不顺带切换当前账户。 | [HMCL #3046](https://github.com/HMCL-dev/HMCL/issues/3046)、[Axolotl #1126](https://github.com/Axolotl-Launcher/Axolotl/issues/1126)：账号多时希望按使用习惯排列，避免编辑配置文件。 |
| 3. 全屏启动 | 实例设置提供简短的全屏开关，传入游戏启动参数。 | HMCL 公开设置规范；[Prism #6346](https://github.com/PrismLauncher/PrismLauncher/issues/6346) 体现全屏模式与分辨率关系的需求。本轮仅原生全屏，不宣称支持独占/无边框切换。 |
| 4. 启动直进服务器 | 实例保存服务器目标，支持时使用 Quick Play。 | [Prism #2124](https://github.com/PrismLauncher/PrismLauncher/issues/2124)、[Reddit 玩家询问启动参数](https://www.reddit.com/r/Minecraft/comments/1povbgx/join_server_on_startup_minecraft_java_arguments/)：一个实例对应一个常玩服务器时，希望省去菜单操作。 |
| 5. 启动直进存档 | 从已有存档选择启动目标，避免手填复杂参数。 | [Reddit 玩家询问直进单人世界](https://www.reddit.com/r/PrismLauncher/comments/1k7qagi)、[Minecraft Quick Play 官方反馈帖](https://feedback.minecraft.net/hc/en-us/community/posts/18189595004173-Java-Quick-Play-in-the-Launcher)：直接继续上次游玩。 |
| 6. 新建实例版本搜索与分类 | 正式版、快照、远古分类配合搜索，缩短长列表定位。 | [HMCL #2197](https://github.com/HMCL-dev/HMCL/issues/2197)、[HMCL #2013](https://github.com/HMCL-dev/HMCL/issues/2013)、[HMCL #2350](https://github.com/HMCL-dev/HMCL/issues/2350)、[HMCL #4094](https://github.com/HMCL-dev/HMCL/issues/4094)：大量版本难找。玩家原帖多讨论已安装版本，这里将同一检索需求应用于安装列表。 |
| 7. 在线安装资源包 | 在已有资源页按当前实例搜索兼容文件并安装。 | Axolotl/SJMCL 官方能力；[SJMCL #477](https://github.com/UNIkeEN/SJMCL/issues/477)：推荐应精确匹配版本，避免把附近快照称为兼容。 |
| 8. 在线安装光影包 | 光影分类直接搜索安装，兼容性依据项目文件声明。 | Axolotl/SJMCL 官方能力；[Axolotl #1115](https://github.com/Axolotl-Launcher/Axolotl/issues/1115) 反映跨实例重复管理光影的负担。本轮解决查找安装，跨实例同步另列后续。 |
| 9. 恢复资源收藏入口 | 收藏常用项目，按分类查看并选择兼容版本安装；保留原收藏数据。 | [Axolotl #683](https://github.com/Axolotl-Launcher/Axolotl/issues/683)、[Axolotl #1197](https://github.com/Axolotl-Launcher/Axolotl/issues/1197)、[Prism #3095](https://github.com/PrismLauncher/PrismLauncher/issues/3095)：换版本时重新寻找常用模组费事，收藏也需要兼容筛选。 |
| 10. 导出模组清单 | 输出可分享的文件名、版本、来源和启用状态，方便交流与报错。 | [HMCL #6158](https://github.com/HMCL-dev/HMCL/issues/6158)、[Prism #5061](https://github.com/PrismLauncher/PrismLauncher/issues/5061)：维护整合包列表和提交问题报告需要清单。KJMCL 通用清单不等同于 MC 百科专用导入格式。 |
| 11. 日志级别筛选与阅读控制 | 在现有搜索上补充级别、暂停显示、自动跟随与换行控件，便于抓住异常。 | [SJMCL #2119](https://github.com/UNIkeEN/SJMCL/issues/2119)、[Prism #745](https://github.com/PrismLauncher/PrismLauncher/issues/745)、[Axolotl #691](https://github.com/Axolotl-Launcher/Axolotl/issues/691)：需要筛选与连续阅读。暂停显示、手动上滚暂停跟随是交互设计推导，不声称原帖直接提出。 |
| 12. 复制筛选日志 | 直接复制当前筛选结果，避免鼠标跨大量行选取遗漏。 | [SJMCL #1462](https://github.com/UNIkeEN/SJMCL/issues/1462)、[HMCL #2879](https://github.com/HMCL-dev/HMCL/issues/2879)：大段选择复制出现漏行或选区混乱。 |
| 13. 完整启动日志导出 | 导出持久化的 `logs/kjmcl.log`，不受界面行数限制；这是已解码的启动日志，不是原始 stdout 字节。文件超过 64 MiB 时提示，不能静默截断。 | [Axolotl #935](https://github.com/Axolotl-Launcher/Axolotl/issues/935)、[Axolotl #1059](https://github.com/Axolotl-Launcher/Axolotl/issues/1059)：截断日志不应连导出一起截断，长日志云分享也可能失败。 |

## 额外查阅与未纳入本轮的需求

| 来源 | 观察与取舍 |
| --- | --- |
| [Axolotl #1212](https://github.com/Axolotl-Launcher/Axolotl/issues/1212) | 收藏多选分组；先恢复易用入口，再扩展整理。 |
| [Axolotl #1209](https://github.com/Axolotl-Launcher/Axolotl/issues/1209) | 收藏每页数量；列表需避免无限渲染。 |
| [Axolotl #1211](https://github.com/Axolotl-Launcher/Axolotl/issues/1211) | 清除选区不应清除已安装标记，UI 状态需分离。 |
| [Axolotl #1112](https://github.com/Axolotl-Launcher/Axolotl/issues/1112) | 排序应使用真正的时间/名称字段，不能只改变标签。 |
| [Axolotl #1201](https://github.com/Axolotl-Launcher/Axolotl/issues/1201) | 重复错误折叠、原文切换；作为后续日志改进，不计入本轮。 |
| [Axolotl #1194](https://github.com/Axolotl-Launcher/Axolotl/issues/1194) | 大量日志不能拖慢页面切换。 |
| [Axolotl #669](https://github.com/Axolotl-Launcher/Axolotl/issues/669) | 快速切换异步读取可能显示旧日志，实施时核对实例与请求生命周期。 |
| [SJMCL #1045](https://github.com/UNIkeEN/SJMCL/issues/1045) | 100k 以上日志导致前端卡顿；源文件导出与有限行显示应分开。 |
| [HMCL #5685](https://github.com/HMCL-dev/HMCL/issues/5685) | 大量实例日志造成启动器高资源占用；KJMCL 暂停视图仍只保留最近 2000 条消息，完整记录从文件导出。 |
| [SJMCL #1429](https://github.com/UNIkeEN/SJMCL/issues/1429) | 截图多时点击无响应；截图图库需分页及按需预览，本轮不仓促加入。 |
| [Prism #1450](https://github.com/PrismLauncher/PrismLauncher/issues/1450) | 日志页扫描整个实例会被大截图目录拖慢，应只读需要的目录。 |
| [SJMCL #1073](https://github.com/UNIkeEN/SJMCL/issues/1073) | 外部目录变化后索引过期；KJMCL 已有外部目录刷新，本轮不重复计数。 |
| [SJMCL #2089](https://github.com/UNIkeEN/SJMCL/issues/2089) | 群聊整理的反馈要求扩大卡片点击区；本轮新控件使用常规按钮/下拉。 |
| [SJMCL #1971](https://github.com/UNIkeEN/SJMCL/issues/1971) | 服务器列表与直接连接记录不一致；本轮只存明确选择的启动目标，不暗中同步列表。 |
| [HMCL #3003](https://github.com/HMCL-dev/HMCL/issues/3003) | 模组更新应指出无法找到版本的条目；需要后续更新工作流补充。 |
| [HMCL #6027](https://github.com/HMCL-dev/HMCL/issues/6027) | 更新生成重复文件会困扰玩家；新增资源安装需同名检查及事务收尾。 |
| [Reddit 日志获取讨论](https://www.reddit.com/r/MinecraftHelp/comments/1k3yptr) | 求助者需要同时理解游戏日志和启动前日志，导出入口应靠近查看入口。 |
| [Reddit 巨型启动器日志讨论](https://www.reddit.com/r/Minecraft/comments/1n29s7v) | 日志体积和轮转值得关注；不以无限积累换取完整显示。 |
| [MC 百科社群启动器讨论](https://bbs.mcmod.cn/forum.php?mod=viewthread&tid=24127) | 玩家比较替代启动器与熟悉的操作逻辑，提示应保持现有中文入口和目录习惯。该帖相关外部事件判断未作为实现依据。 |

## 检索范围记录

使用公开网页搜索及 GitHub issue 检索；对三款启动器共执行超过 30 个定向查询。实际查看/检索到的有效来源列在上述表中，无关、重复、广告或冒充官网的结果没有作为依据。以下保留代表性检索词，便于复查；`repo:` 表示 GitHub 仓库内检索。

| 范围 | 检索主题 |
| --- | --- |
| 官方与公开网页 | `Axolotl Launcher 美西螈 启动器 功能 github`；`SJMCL sjmc docs 功能 启动器`；`HMCL 官方 功能 启动器 模组管理`；`HMCL 实例 绑定账号 快速启动 服务器 issues` |
| HMCL 社区 | `repo:HMCL-dev/HMCL 绑定`；`账号 in:title`；`账户 绑定`；`全屏 游戏 in:title`；`模组 列表 导出`；`模组列表 导出`；`搜索 版本 in:title`；`日志 搜索`；`日志 滚动` |
| Axolotl 社区 | `repo:Axolotl-Launcher/Axolotl 收藏`；`排序 账号`；`日志 in:title`；`资源包 下载 in:title`；公开 issues 列表中的跨实例同步、收藏、日志和文件整理反馈 |
| SJMCL 社区 | `repo:UNIkeEN/SJMCL 日志`；`全屏`；`快照`；`截图`；`日志 in:title`；`启动 服务器`；`日志 暂停`；早期 `SJTU-Minecraft/SJMCL` 检索无有效对应后改用官网关联仓库 |
| 广泛玩家社区 | `Minecraft launcher quick play server account instance feature request`；`Minecraft launcher pause log autoscroll reddit`；`HMCL 启动器 模组管理 功能 建议 site:klpbbs.com`；`SJMCL 启动器 体验 site:mcmod.cn`；`美西螈 启动器 玩家 体验` |
| 补充对照社区 | `repo:PrismLauncher/PrismLauncher account instance default`；`default account`；`export mod list`；`fullscreen in:title` |

调研对应的源码审核阶段按要求未编译、打包或发布。后续 0.7.3 已获准进行 Windows 本地构建、验证和打包，不发布上传；实际结果见发行与验证记录。源码验证应区分静态检查、临时目录测试和真实游戏验收；在线调研不等于已验收下载服务或账户登录。
