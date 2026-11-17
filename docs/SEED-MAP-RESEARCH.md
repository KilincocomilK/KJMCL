# 种子地图功能与实现依据

调研日期：2026-11-17（Asia/Shanghai）。目标为 KJMCL 的 Minecraft Java 版种子地图；查看预测生成分布，与现有存档地图的已生成区块浏览分开。此文记录功能设计和验收依据，不表示全部条目已经实现或通过实机验收。

## 官方资料

| 编号 | 来源 | 核对要点 |
| --- | --- | --- |
| O1 | [Chunkbase Seed Map](https://www.chunkbase.com/apps/seed-map) | 种子、版本、维度、高度、图层、坐标跳转、标记、搜索、截图、展开视图与键鼠操作。 |
| O2 | [Cubiomes Viewer README](https://github.com/Cubitect/cubiomes-viewer) | 三维度地图、结构开关、区域分析和在固定种子中找位置；用于功能参考，不复制 GPL 界面代码。 |
| O3 | [Cubiomes README](https://github.com/Cubitect/cubiomes/blob/master/README.md) | Java 群系与结构算法库；范围生成接口、坐标缩放、64 位种子和结构可行性判断。 |
| O4 | [Cubiomes 版本定义](https://github.com/Cubitect/cubiomes/blob/master/biomes.h) 与 [版本名称转换](https://github.com/Cubitect/cubiomes/blob/master/util.c) | 精确版本枚举及别名不能仅从工具标题猜测。 |
| O5 | [Cubiomes finders.h](https://github.com/Cubitect/cubiomes/blob/master/finders.h) | 结构候选、可行性、出生点、要塞、末地通道和史莱姆区块相关接口。 |
| O6 | [Cubiomes 1.21.5+ PR #162](https://github.com/Cubitect/cubiomes/pull/162) | 苍白之园参数变动，说明后续小版本不能无条件沿用旧生成器。 |
| O7 | [Cubiomes Viewer 发布记录](https://github.com/Cubitect/cubiomes-viewer/releases) | 版本命名、出生点和地形显示修复记录。 |
| O8 | [Minecraft 官方：复制 Java 世界种子](https://help.minecraft.net/hc/en-us/articles/34467817926925) | 进入世界后以 `/seed` 获取可复用种子。 |
| O9 | [Cubiomes MIT License](https://github.com/Cubitect/cubiomes/blob/master/LICENSE) | 独立算法库的许可与版权声明；与 GPL Viewer 区分。 |

O1 的当前页面标注 2026-11-10、MC 26.3；这一标注只描述 Chunkbase。调研时 O4 官方 master 的最新枚举仍为 Winter Drop，对应 1.21.4。KJMCL 支持列表须由实际固定的算法版本提供，不能按其他网站的版本列表或 `1.21` 别名承诺后续版本准确。

## 较新版本后端核验

选用独立的 [xpple/cubiomes](https://github.com/xpple/cubiomes) 算法库 fork，固定提交 [`b99f6e472018cab903a096697117aab9d9170a19`](https://github.com/xpple/cubiomes/commit/b99f6e472018cab903a096697117aab9d9170a19)（2026-10-18，末地城地形检查修复）。此提交的 [LICENSE](https://github.com/xpple/cubiomes/blob/b99f6e472018cab903a096697117aab9d9170a19/LICENSE) 为 MIT，保留原版权和许可；没有引入 GPL 的 Viewer 或 Seed Atlas 界面实现。

核验不止检查版本名称：[biomenoise.c](https://github.com/xpple/cubiomes/blob/b99f6e472018cab903a096697117aab9d9170a19/biomenoise.c) 实际按版本切换 `btree215`、`btree262`、`btree263` 参数表，并为 26.3 调整远端末地环带；[finders.c](https://github.com/xpple/cubiomes/blob/b99f6e472018cab903a096697117aab9d9170a19/finders.c) 包含废弃营地的位置、群系资格及版本条件。1.21.5 的苍白之园表修改可追溯至 [4168027](https://github.com/xpple/cubiomes/commit/41680278231c0d03da355069cf846c42dbfa9cd0)。[Minecraft 1.21.5 官方说明](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21-5) 与 [26.3 官方说明](https://feedback.minecraft.net/hc/en-us/articles/48913133328013-Minecraft-Java-Edition-26-3) 分别提供相应世界生成变化的产品依据。

固定后端中的可重复参考值如下，坐标是方块坐标；使用粗采样接口时须换算为相应采样格坐标：

| 版本 / 维度 | 种子 | 坐标与条件 | 预期 | 直接来源 |
| --- | --- | --- | --- | --- |
| 1.18 / 主世界 | `262` | X 0, Y 63, Z 0，scale 1 | mushroom_fields | [README](https://github.com/xpple/cubiomes/blob/b99f6e472018cab903a096697117aab9d9170a19/README.md) |
| 26.3 / 主世界 | `-3829811542736183482` | X 68148, Y 77, Z 80990，scale 1 | dappled_forest（188） | [test_biomes.c](https://github.com/xpple/cubiomes/blob/b99f6e472018cab903a096697117aab9d9170a19/tests/test_biomes.c) |
| 26.2 / 末地 | `856461443495910397` | X -371136, Z -64，scale 16、64 | end_barrens（43），地形高度 0 | 同上 |
| 26.3 / 末地 | `856461443495910397` | X -371136, Z -64，scale 16、64 | end_highlands（42），地形高度 57 | 同上 |
| 1.9–1.12 / 末地 | `6983438112510666596` | 末地城 region (-40,-17) | 候选 X -12768, Z -5424，地形检查 60 | [test_structures.c](https://github.com/xpple/cubiomes/blob/b99f6e472018cab903a096697117aab9d9170a19/tests/test_structures.c) |
| 1.13+ 含 26.3 / 末地 | `6983438112510666596` | 同上 | 同一候选，但地形检查 0，不应显示为可生成 | 同上 |

[moffington 的验证记录](https://github.com/moffington/cubiomes-viewer-26.3/blob/mc26.3/VALIDATION.md) 对这一固定后端报告：上游测试通过，独立 Java RNG 实现核对 300 个结构候选，并用最终 26.3 数据核对营地群系资格。该记录明确限制为配置、位置和资格检查；没有独立全面比较群系噪声或地形，26.3 群系参数表源自快照，26.2 硫磺洞穴只有生成检查而无独立固定坐标参考。KJMCL 不把这些记录冒称自己的游戏内验收，也不复制其 GPL 测试实现。

原生编译应采用支持该 fork 的 Clang/GCC，保留 `-fwrapv`，避免 fast-math；这关系到 Java 整数溢出与噪声运算的可重复性。1.21.5–26.1 使用同一群系参数表是该 fork 的明确分支；未知版本仍必须拒绝或等待玩家明确选择，不自动假定等价。[fork README](https://github.com/xpple/cubiomes/blob/b99f6e472018cab903a096697117aab9d9170a19/README.md)

## 可验收的产品清单

以下验收设计由本项目根据资料和现有架构整理；功能是否完成以代码与实际测试记录为准。

| ID | 功能 | 可验证行为 | 依据 |
| --- | --- | --- | --- |
| M01 | 工具箱入口 | 侧栏统一「工具箱」，皮肤编辑器和种子地图都能进入，返回后保留各自编辑状态。 | 用户要求 |
| M02 | 完整种子 | 正负 64 位十进制不经 JS Number 失真；文本种子遵循 Java 字符串语义。 | O1/O3 |
| M03 | 随机种子 | 生成真实随机种子，显示实际参与计算的规范化数值，可复制复现。 | O1 |
| M04 | 明确版本 | 选择真实支持版本；未知版本不会默默换成另一个版本。 | O4/O6 |
| M05 | 三维度 | 主世界、下界、末地切换；结构和群系列表与维度匹配。 | O1/O2 |
| M06 | 高度 | 按 Y 层查询群系，地下群系不是地表颜色的假叠层。 | O1/O3 |
| M07 | 从存档读取 | 选择真实实例与世界，导入种子、版本、出生点；不修改世界文件。 | O1/KJMCL |
| M08 | 平移缩放 | 鼠标拖动、光标锚点滚轮缩放、缩放按钮和复位，负坐标方向正确。 | O1 |
| M09 | 坐标导航 | X/Z 跳转、当前位置、区块坐标、原点和出生点入口。 | O1/O5 |
| M10 | 群系颜色 | 使用算法返回的群系 ID；有中文名称、图例和高亮筛选。 | O1/O2 |
| M11 | 悬停采样 | 读实际光标位置的群系与坐标，低倍缩放也能取得精确单点。 | O3 |
| M12 | 区块网格 | 16 格边界在负数、跨原点及缩放后仍对齐。 | O1/工程推导 |
| M13 | 结构图层 | 分类型启停、全选清空；只列当前版本和维度支持的类型。 | O1/O2/O5 |
| M14 | 结构详情 | 点击位置显示类型、XZ 和距离；无真实 Y 数据时不编造高度。 | O1/O5 |
| M15 | 可行性 | 结构候选经过可用的群系/地形检查；近似结果有简短状态。 | O2/O3/O5 |
| M16 | 出生点与要塞 | 使用专门算法，不作为一般随机结构散点；可导航定位。 | O2/O5 |
| M17 | 史莱姆区块 | 使用 Java 判定，区块坐标与地图叠层一致；不是保证随时刷怪。 | O1/O5 |
| M18 | 寻找结构 | 从指定坐标与半径查找当前种子的位置，可取消；结果按距离排序。 | O2 |
| M19 | 寻找群系 | 显式查询范围/采样精度，找到后允许跳转；未找到不等于世界不存在。 | O2/工程推导 |
| M20 | 标记 | 添加、命名、备注、颜色、跳转和删除，关联种子/维度。 | O1/工程推导 |
| M21 | 距离与方向 | 所选位置相对中心的距离可用于旅行；计算使用世界坐标。 | 工程推导 |
| M22 | 下界换算 | 主世界/下界坐标换算，负坐标取整规则明确；不宣称自动匹配传送门。 | 工程推导 |
| M23 | 地图工程 | 收藏种子及视图、图层、标记；版本化数据，坏文件不清空已有作品。 | 工程推导 |
| M24 | 导入导出 | 工程/标记 JSON 往返，严格验证大小、版本及坐标；文件权限在主进程。 | KJMCL 架构 |
| M25 | 地图图片 | 导出当前真实可见地图与标记；未完成区域不能被伪装为已生成。 | O1/工程推导 |
| M26 | 全屏 | 有明确开关和 Esc 退出；还原窗口和地图尺寸，布局不溢出。 | 用户要求/O1 |
| M27 | 键盘 | 方向键平移、加减缩放；输入框内不抢按键。 | O1 |
| M28 | 异步安全 | 切换种子、版本、维度后，迟到瓦片和定位结果不能覆盖新地图。 | KJMCL 架构 |
| M29 | 有界性能 | 瓦片缓存、并发数和结果数有上限，取消能停止原生工作。 | O3/工程推导 |
| M30 | 本机计算 | 不需把种子发给第三方；原生程序架构和摘要校验后才执行，保持 shell-free。 | KJMCL 架构 |
| M31 | 可重复验证 | 同输入重复结果一致，有上游已知结果、负坐标与大种子回归；不是只测“有颜色”。 | O3/工程推导 |
| M32 | 真实桌面检查 | 工具箱来回、全屏/Esc、平移、导入恢复、结构定位和 PNG 文件回读。 | KJMCL AGENTS |

## 准确性与界面取舍

种子地图显示生成预测，不会读取玩家已建设的房屋或被修改的方块。混合版本世界需要按区块生成时的版本查看；改变世界生成的数据包或模组也可能不匹配。群系边界不等同于海岸和实际地表高度，不能用群系色块冒称精确地形图。[Chunkbase 帮助](https://www.chunkbase.com/apps/seed-map)

Cubiomes Viewer 列出的已知限制包括部分 1.18+ 结构受地形影响，以及旧版本出生点所依赖的草方块检查。模型结果应保留这种准确性边界。生产页面可只用「预测位置」或详情中的短提示，不需要常驻长段解释。[Viewer README](https://github.com/Cubitect/cubiomes-viewer)

跨种子自动筛选器、脚本条件语言、完整三维方块/洞穴重建、矿脉与战利品模拟、Bedrock 算法属于进一步扩展；本轮不得用空图层、随机散点或错误 Java 别名代替它们。固定种子的定位查询可先形成完整工作流。[Cubiomes Viewer](https://github.com/Cubitect/cubiomes-viewer)

## KJMCL 现有存档接入

- `shared/types.ts` 的 `SaveMetadata` 已包含 `seed?: string`、`version`、`dataVersion`、`spawn`、世界名称与目录名。
- `api.saveWorlds(instanceId)` 通过 `electron/core/save-manager.ts` 调用 Rust `list`，可直接读取上述属性；仅为取种子无需先扫描全部区块。
- `electron/native/save-manager/src/world.rs` 读取 `WorldGenSettings.seed`，兼容 `RandomSeed`，以字符串返回 i64；现有测试覆盖 `9007199254740993`。
- `src/pages/Saves.tsx` 世界摘要已有这些数据，可加「种子地图」动作，传递种子/版本/出生点到工具箱。文件与 NBT 访问仍留在主进程和 Rust。
- `scan.metadata.version` 是存档最后版本线索，不能证明每个区块的生成版本。对未支持版本保留原信息并让玩家选择，不静默折算。

本地 `SJMCL/` 未参与调研或实现；未复制其代码。算法库依赖应固定来源提交、保留原许可和摘要；使用 Rust 管理原生协议与任务并不意味着重新独立实现全部 Minecraft 生成算法。

## 本轮已运行的独立检查

- `tests/fixtures/SeedJavaReference.java` 由本机 JDK 21 直接执行，以 `Long.parseLong`、`String.hashCode`、`java.util.Random` 产生参考数据。包括 64 位极值、超界数字的文本回退、中文、代理对、孤立代理项和 Java 整数溢出。
- 12 个种子解析/哈希参考值及 72 组史莱姆区块参考与 TypeScript 实现匹配；同一批 72 组坐标又分别调用新构建的 `dist-native/seed-map/kjmcl-seed-map.exe` 的 `biome` 命令，结果全部匹配。这些检查没有启动 Minecraft。
- `tests/seed-map.test.ts`、`tests/seed-map-storage.test.ts`、`tests/seed-map-storage-queue.test.ts`、`tests/seed-map-view.test.ts` 共 33 项通过；覆盖取消时序、受限并发、缓存、真实临时文件、合并待写快照、备份恢复、导入校验、PNG 往返和视图坐标。服务队列单测使用注入边界 runner，不能称为原生生成验收。
- `scripts/seed-map-desktop-smoke.mjs` 在 Windows x64 的真实 Electron/preload/main/Rust 核心上通过：26.3 固定群系参考、26.2/26.3 末地环带差异、边缘史莱姆参考、地图渲染与键盘操作、负坐标标记、附近村庄定位、PNG/工程/标记文件往返、五轮连续全屏/Esc、工具箱两工具状态保留、真实 `level.dat` 的 64 位种子导入、960 像素窗口和关闭重启恢复。只将原生文件选择器指向隔离测试目录，未启动 Minecraft、使用真实账户、打包或发布。
- 本次桌面记录位于 `C:\Users\KILINC~1\AppData\Local\Temp\kjmcl-seed-map-desktop-vaweUE\result.json`，同目录 `screenshots/` 包含宽窗、960 窗口和全屏截图，已逐张检查。整套脚本约 13.1 秒；两个 128×128 末地粗采样瓦片的核心计时分别约 39.1/40.5 毫秒。记录同时包含浏览器、渲染器和 GPU 进程的瞬时内存值，仅用于本机观察，不是跨机器性能基准。
