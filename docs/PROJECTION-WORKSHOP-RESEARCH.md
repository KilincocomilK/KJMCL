# 投影工坊功能与格式依据

核对日期：2026-11-17（Asia/Shanghai）。参考用户截图与美西螈公开功能，KJMCL 独立实现；不复制启动器代码，不修改 `SJMCL/`。本文区分设计目标与实际验收，最终范围以实现和验证记录为准。

## 产品依据

[Axolotl 官方 README](https://github.com/Axolotl-Launcher/Axolotl) 将投影工坊列为实验室工具。[官方 1.11.0 发布记录](https://github.com/Axolotl-Launcher/Axolotl/releases/tag/v1.11.0) 包含投影方块状态编辑、从实例文件进入工坊，以及导出元数据和旋转变换的修复。这提示工坊需要同时保证可查看、可编辑和可靠导出，不能只有三维外观。

用户截图直接呈现：打开 Litematic、尺寸与方块数、撤销重做、3D 漫游、Y 层、层间距、单选/框选/测量、同材料/同层/连通选择、隐藏所选/仅显示所选/全部显示、替换/删除、顺逆时针旋转、X/Z 镜像、材料面板和导出。以下为本项目按这些交互整理的验收目标：

| 工作流 | 验收目标                                                             |
| ------ | -------------------------------------------------------------------- |
| 入口   | 工具箱第三个工具；切换到皮肤/种子地图后不丢工作区                    |
| 读取   | 从本地文件或实例投影目录读取，显示实际格式、尺寸、非空气计数         |
| 预览   | 真实方块数据生成三维视图，缩放、旋转、复位、顶视和全屏               |
| 分层   | Y 截面与范围、层间距分解；不修改文件中的真实方块坐标                 |
| 选择   | 单选、框选、同材料、同层、连通方块；统计选择数量                     |
| 测量   | 两点坐标差与距离；坐标按模型网格，不按屏幕像素计算                   |
| 可见性 | 隐藏、只看所选、全部显示，避免将隐藏误当删除                         |
| 编辑   | 替换方块及属性、删除、全局旋转/镜像、撤销重做                        |
| 材料   | 真实方块统计、搜索和导出；不将方块数冒称准确背包物品需求             |
| 导出   | 格式可重新读取，方向和尺寸一致，原文件不覆盖，复杂附加数据不静默丢弃 |
| 保存   | 自动保存、最近工程、重启恢复、修订冲突保护与损坏原件保留             |
| 大文件 | 主进程/Rust 解析，压缩和体积上限，受限并发，UI 不伪造进度            |

本轮不把在线资源站、账号授权或社区上传加入本地编辑工作流。渲染使用的简化外观与实际游戏材质应明确区分，不能生成假纹理并称其为原版资源。

## 格式核对

Sponge 的 [v3 官方规范](https://github.com/SpongePowered/Schematic-Specification/blob/master/versions/schematic-3.md) 规定 GZip NBT，根内有 `Schematic`；方块容器是 `Blocks`，包含 `Palette`、VarInt `Data`、可选 `BlockEntities`。尺寸以 unsigned short 存储，数组索引为 `x + z*Width + y*Width*Length`。实体、方块实体、三维生物群系均是独立数据，不能只写 Palette/Data 而默认其余不存在。

[v2 官方规范](https://github.com/SpongePowered/Schematic-Specification/blob/master/versions/schematic-2.md) 的 `Palette`、`BlockData` 在根层，实体和方块实体的附加字段与 v3 的 `Data` 包装不同。扩展名不能作为格式判断的唯一依据；读取器应检查版本和实际标签。

Litematica 的活跃维护分支 [LitematicaSchematic.java](https://github.com/sakura-ryoko/litematica/blob/1.21.5/src/main/java/fi/dy/masa/litematica/schematic/LitematicaSchematic.java) 当前写出版本 7，同时保留 v6 写法。区域包含带符号 Position/Size、方块 palette、long[]、方块实体、实体与计划刻。负 Size 的体积取绝对值，最低角是 `Position + min(Size+1,0)`，不是把数组倒序。方块实体和计划刻坐标相对最低角；实体 Pos 相对区域 Position，负尺寸下两者不同。未知附加标签应保留；缺乏完整变换支持时明确拒绝对应编辑/转换。

位存储依据维护者的 [LitematicaBitArray](https://github.com/sakura-ryoko/litematica/blob/1.21.5/src/main/java/fi/dy/masa/litematica/schematic/container/LitematicaBitArray.java) 与 [BlockStateContainer](https://github.com/sakura-ryoko/litematica/blob/1.21.5/src/main/java/fi/dy/masa/litematica/schematic/container/LitematicaBlockStateContainer.java)：每项至少两位，位数由 palette 容量决定；条目可能跨越 long 边界，不能套用新版区块文件的 long 内补齐布局。

旧 MCEdit `.schematic` 与现代 `.schem` 不同。[WorldEdit 的旧格式读取器](https://github.com/EngineHub/WorldEdit/blob/master/worldedit-core/src/main/java/com/sk89q/worldedit/extent/clipboard/io/MCEditSchematicReader.java) 读取 `Materials=Alpha`、`Blocks`、`Data`、可选 `AddBlocks`。方块是旧数字 ID 与 metadata，需要完整的旧版映射和 DataFixer 才能可靠变为现代状态；本轮若不实现该映射，应明确报不支持，不能以错误现代 ID 代替。

## 本项目的变换规则

以下为 KJMCL 自行推导的几何约定，须由独立夹具检查：绕 Y 顺时针为 `(x,z) → (L-1-z,x)`，输出尺寸交换 W/L；X 镜像为 `x → W-1-x`，Z 同理。方向属性、水平 axis、连接方向键、旋转值和铁轨形状须同步变化。镜像可能改变门铰链、楼梯左右形状和双箱左右状态；只转坐标会使红石与建筑含义发生变化。模组私有属性没有通用规则，不应承诺完整语义变换。

容器清单、实体位置/朝向、挂画支撑点、计划刻与群系数据都需保持对应位置。使用原源文件不变的导出路径应逐字节验证；编辑后的导出另用独立 NBT 解码器读取，不只用同一 Rust 编码器回读来证明正确。

## 独立验证设计

`tests/fixtures/projection-nbt.mjs` 只使用 Node 标准库，自行编码/解码测试 NBT，不引用生产 Rust 编解码。夹具包含 8×5×7、101 个非空气方块，以及带 facing/axis 属性的楼梯/原木；输出 Litematic v7、负尺寸 v6、Sponge v2/v3 与原版结构 NBT。它们是合成测试资料，不代表真实玩家工程或游戏内 Litematica 验收。

桌面检查应走真实 Electron/preload/原生核心；文件对话框可以由测试给出临时路径。检查原文件摘要、三维非空像素、选择和编辑、撤销重做、三种格式独立回读、材料导出、实例安装、重启持久化与全屏 Esc。无需登录、上传或运行真实 Minecraft。

2026-11-17 已执行：投影服务 13 项测试通过，包含损坏目录恢复、失效备份保持原件、修订冲突、并发串行、历史上限、清理失败时保留新修订与原生结果校验。`scripts/projection-desktop-smoke.mjs` 通过真实 Electron 验证以上五种格式、三维点击编辑、五次全屏/Esc、PNG、临时实例安装和重启恢复。`scripts/test-projection-native.mjs` 用独立 NBT 读回确认负尺寸箱子与计划刻旋转坐标、箱子物品与自定义 long 保留、替换后不恢复旧箱子物品，以及拒绝不支持转换时不写残文件。最终提交前仍应以最新构建重新执行项目检查。
