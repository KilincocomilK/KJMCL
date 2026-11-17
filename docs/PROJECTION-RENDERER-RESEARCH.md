# 投影工坊方块渲染选型

调查日期：2026-11-17。此文记录上游能力与接入依据，不代表 KJMCL 已通过相应验收。

选择 **deepslate 0.27.3** 负责 Minecraft 方块模型、方块状态和特殊方块网格，转换为项目现有 Three 0.187 `BufferGeometry`。保留 KJMCL 的相机、选择、分层、编辑与全屏界面，不另造方块形状引擎。

## 方案比较

| 方案                                                                                | 已核查的能力                                                                                           | 接入成本与决定                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [deepslate](https://github.com/misode/deepslate) 0.27.3                             | MIT；浏览器 ESM；原生资源包模型；公开 CPU 网格 API；水、熔岩、含水方块和多种特殊方块                   | 无 Three 依赖，运行时依赖为 gl-matrix、md5、pako。适合接入现有 Three 场景，采用。依据：[package.json](https://github.com/misode/deepslate/blob/ee4a40f06bdaece8657cf8b77fe9a99362da6ac9/package.json)、[许可证](https://github.com/misode/deepslate/blob/ee4a40f06bdaece8657cf8b77fe9a99362da6ac9/LICENSE)。                                                                                                                                                    |
| [Prismarine Viewer](https://github.com/PrismarineJS/prismarine-viewer) 1.33.0       | MIT；区块 worker；Minecraft 资源生成流程；水体相邻角点高度、群系染色、动画贴图；浏览器和 Electron 示例 | 锁定 Three 0.128.0，并带 world/chunk/block、Socket.IO、Express 等生态依赖。偏向实时世界浏览；现有沙箱、Three 版本与投影编辑需要较大适配。本次不采用。依据：[依赖](https://github.com/PrismarineJS/prismarine-viewer/blob/master/package.json)、[流体及染色](https://github.com/PrismarineJS/prismarine-viewer/blob/master/viewer/lib/models.js)、[worker/动画材质](https://github.com/PrismarineJS/prismarine-viewer/blob/master/viewer/lib/worldrenderer.js)。 |
| [Schem-at/schematic-renderer](https://github.com/Schem-at/schematic-renderer) 1.6.1 | README 提供 Rust/WASM、Web Worker、资源包、切片、第一人称和交互 API；可由调用方提供资源包 Blob         | AGPL-3.0-only；Three ^0.184.0 不涵盖项目的 0.187；还引入 Nucleation、后处理和整套交互设施。更适合整体引入其查看器，本次不引入第二套工坊。以上功能仅据官方文档，未逐项运行验证。依据：[依赖及许可证声明](https://github.com/Schem-at/schematic-renderer/blob/master/package.json)、[接口说明](https://github.com/Schem-at/schematic-renderer/blob/master/README.md)。                                                                                            |
| [Lodestone](https://github.com/mattzh72/lodestone) 0.6.0                            | MIT；基于 deepslate 的 Three 渲染器，README 提供透明排序、区块剔除、资源包接口                         | peerDependency Three ^0.164.1 不涵盖 0.187，替换场景的收益小于直接使用 deepslate 网格。未逐项验证其新增渲染能力。依据：[依赖](https://github.com/mattzh72/lodestone/blob/main/package.json)、[上游说明](https://github.com/mattzh72/lodestone/blob/main/README.md)。                                                                                                                                                                                            |

## deepslate 实际能力与边界

已阅读源码快照 `ee4a40f06bdaece8657cf8b77fe9a99362da6ac9`，并对照安装的 npm 0.27.3 中 `BlockDefinition.js`、`SpecialRenderer.js`。以下判断来自实现，非仅来自宣传。

| 项目                       | 核查结果                                                                                                                   | 源码                                                                                                                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 楼梯、台阶、门等形状       | 从资源包模型元素生成几何，支持模型 parent、纹理引用、面 UV、元素旋转、方块状态旋转；不必写一套按方块名猜形状的代码         | [BlockModel](https://github.com/misode/deepslate/blob/ee4a40f06bdaece8657cf8b77fe9a99362da6ac9/src/render/BlockModel.ts)                                                                                                                                     |
| 栅栏、玻璃板等组合模型     | variants 与 multipart；条件包括 OR、AND、属性值 `                                                                          | `                                                                                                                                                                                                                                                            | [BlockDefinition](https://github.com/misode/deepslate/blob/ee4a40f06bdaece8657cf8b77fe9a99362da6ac9/src/render/BlockDefinition.ts) |
| 透明贴图                   | 上游保留贴图 alpha 并启用混合；区块中实体网格先于半透明网格提交。转换到 Three 时应保留 alpha，并区分 cutout 与 translucent | [Renderer](https://github.com/misode/deepslate/blob/ee4a40f06bdaece8657cf8b77fe9a99362da6ac9/src/render/Renderer.ts)、[ChunkBuilder](https://github.com/misode/deepslate/blob/ee4a40f06bdaece8657cf8b77fe9a99362da6ac9/src/render/ChunkBuilder.ts)           |
| 水、熔岩、含水方块         | `SpecialRenderers.getBlockMesh` 使用 still/flow 原版纹理；读取 level 0–15；含水状态附加水网格                              | [SpecialRenderer](https://github.com/misode/deepslate/blob/ee4a40f06bdaece8657cf8b77fe9a99362da6ac9/src/render/SpecialRenderer.ts)                                                                                                                           |
| 箱子、床、告示牌、潜影盒等 | 特殊渲染入口有对应网格和朝向处理；需要额外的 entity 纹理。不能只提取 `textures/block/`                                     | [SpecialRenderer](https://github.com/misode/deepslate/blob/ee4a40f06bdaece8657cf8b77fe9a99362da6ac9/src/render/SpecialRenderer.ts)                                                                                                                           |
| 草、树叶、水、红石染色     | 草叶水采用默认颜色，红石读取 power；这不是逐群系复现                                                                       | [BlockColors](https://github.com/misode/deepslate/blob/ee4a40f06bdaece8657cf8b77fe9a99362da6ac9/src/render/BlockColors.ts)                                                                                                                                   |
| 加权随机模型               | 0.27.3 从数组取第一个模型，不按 weight 随机选取                                                                            | [BlockDefinition](https://github.com/misode/deepslate/blob/ee4a40f06bdaece8657cf8b77fe9a99362da6ac9/src/render/BlockDefinition.ts)                                                                                                                           |
| UV lock                    | 类型有 uvlock 字段，但当前网格实现未使用；面自身 UV 旋转有实现                                                             | [BlockDefinition](https://github.com/misode/deepslate/blob/ee4a40f06bdaece8657cf8b77fe9a99362da6ac9/src/render/BlockDefinition.ts)、[BlockModel](https://github.com/misode/deepslate/blob/ee4a40f06bdaece8657cf8b77fe9a99362da6ac9/src/render/BlockModel.ts) |
| 流水斜面                   | level 对应平面高度；源为 14.2/16，上方被剔除时为 16/16。没有按相邻流体计算四角斜面                                         | [SpecialRenderer](https://github.com/misode/deepslate/blob/ee4a40f06bdaece8657cf8b77fe9a99362da6ac9/src/render/SpecialRenderer.ts)                                                                                                                           |
| 内置图集便利函数           | `TextureAtlas.fromBlobs` 固定截取图片左上 16×16，不能直接承担完整 entity 贴图、高分辨率资源包和动画帧                      | [TextureAtlas](https://github.com/misode/deepslate/blob/ee4a40f06bdaece8657cf8b77fe9a99362da6ac9/src/render/TextureAtlas.ts)                                                                                                                                 |

未据此宣称所有 Minecraft 版本、模组方块、实体或游戏光照完全一致。普通方块由实际加载的 blockstates/models 决定；特殊方块覆盖范围由依赖版本决定。

## KJMCL 接入要点

1. 主进程读取已安装的原版客户端 JAR；按需沿用启动器的官方来源、哈希校验与缓存。提取 `assets/minecraft/blockstates/`、`models/`、`textures/`，不要只下载 PNG。渲染进程只接收经过校验的数据，经具名 preload 接口访问。
2. 由 deepslate `BlockModel.fromJson` / `flatten`、`BlockDefinition.fromJson` / `getMesh`、`SpecialRenderers.getBlockMesh` 生成网格。将 `Mesh.quads` 的位置、UV、颜色、法线写入 Three geometry；不另写 Minecraft 模型解析器。公开网格结构见 [Mesh](https://github.com/misode/deepslate/blob/ee4a40f06bdaece8657cf8b77fe9a99362da6ac9/src/render/Mesh.ts)、[Vertex](https://github.com/misode/deepslate/blob/ee4a40f06bdaece8657cf8b77fe9a99362da6ac9/src/render/Vertex.ts)。
3. 图集保留贴图分辨率与 alpha，使用像素过滤。动画帧由图集适配层处理；不能把水的整张纵向帧条压成一格。水网格单独使用透明材质，含水楼梯的固体部分继续正常写入深度。
4. 按调色板状态缓存模型，按可见区块合并网格；分层、隐藏和层间距变化后更新相邻面的剔除。拾取保留原始方块索引，避免把模型的多个面误当成多个方块。
5. 原版素材不作为启动器源代码资产提交或随包复制；开源渲染库的 MIT 许可不等于 Mojang 纹理许可。Minecraft 对自有游戏内容保留权利，下载应走官方授权来源。依据：[Minecraft EULA](https://www.minecraft.net/en-us/eula)。deepslate 的版权及 MIT 许可应加入第三方声明。

## 建议验收场景

- 原版石头六面 UV、草方块顶面染色、树叶裁切透明、染色玻璃与冰的半透明遮挡。
- 楼梯所有朝向与上下半、内外角；台阶上下半与双层；栅栏和玻璃板的 multipart 连接。
- 水源、不同 level 流水、落水、熔岩、含水楼梯；从水体两侧观察，确认固体未被一起透明化。
- 床、箱子、潜影盒、告示牌的 entity 贴图无裁切或倒置；缺失资源有准确状态而非静默替代为普通色块。
- 切层、层间距、框选、替换、撤销和全屏后，贴图与拾取仍对应原始坐标；重复进入退出释放材质、纹理和 geometry。
- 使用真实原版客户端素材进行视觉验收；合成 JSON 或色块纹理单元测试仅验证几何和资源链路。

## 本轮实际验证

`node scripts/projection-render-desktop-smoke.mjs` 在 Windows Electron 中通过。使用独立写入的 420 方块结构 NBT、临时数据目录和官方 Minecraft 26.3 客户端素材，经真实 preload 和原生导入后得到 1,157 个四边形、221 张贴图。原版水贴图为 16×512，箱子为 64×64，均解析了真实 PNG 并记录 SHA-256。

桌面检查确认：射线穿过楼梯空角、命中楼梯底半；染色玻璃后的红块在实际帧缓冲中可见；熔岩动画改变实际像素；测量、框选、隐藏、替换、撤销重做、旋转、镜像、分层、层间距、全屏与返回工具箱均正常。截图已人工查看，未出现渲染异常或控制台错误。测试仅替代文件选择器返回路径，未替代资源服务、IPC、原生编解码或 WebGL。

含水台阶另作实际像素回归：干木侧面 RGB 为 `[155,128,77]`，含水木侧面为 `[158,129,79]`，各通道差不超过 3；经过多个水动画帧后，木面颜色完全不变，露出部分仍显示蓝色水体。源水与上方含水台阶接缝处 RGB 为 `[64,86,117]`，确认水体达到共享面，没有空气条带。

本地记录：`.local/projection-render-desktop/run-yjP9bc/result.json`；画面：同目录的 `01-gallery.png`、`03-transparency.png`、`04-animated-fluid.png`、`05-exploded.png`。此结果是 Windows 原版素材渲染验收，不是进入 Minecraft 游戏、多平台或全版本验收。
