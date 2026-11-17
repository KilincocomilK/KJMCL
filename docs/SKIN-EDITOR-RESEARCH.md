# Minecraft 皮肤编辑器调研与迭代验收表

调研日期：2026-11-17。目标保持为完整、可持续创作的现代皮肤编辑器，不能把上传窗口加一个画布当作完成。

此次检索覆盖 Skindex、PMCSkin3D、Nova Skin、Blockbench、MinecraftSkinEditor、NeedCoolerShoes，以及其他仍在维护的编辑器和玩家讨论。下列“官方”指相应产品的维护方文档，并不意味着 Mojang 官方产品。未读取、复制任何编辑器实现代码，未改动 `SJMCL/`。

## 开始时的 KJMCL 基线

`electron/core/skins.ts` 提供账户皮肤读取、PNG 尺寸检查、上传和重置；`src/dialogs/AdvancedDialogs.tsx` 的 `SkinModel` 仅用 2D canvas 拼接正面预览，`SkinDialog` 提供模型选择、刷新和上传。没有绘画引擎、UV 交互、真实 3D 编辑、编辑图层、选区、项目持久化或历史记录。已有认证、主进程网络与安全凭据链路应复用。

## 产品资料

| 编号 | 来源 | 核实的能力 / 设计依据 |
| --- | --- | --- |
| O1 | [Skindex 编辑器](https://www.minecraftskins.com/skin-editor/) | 直接编辑皮肤、身体与外层切换、模型选择、导入 / 下载。搜索索引能读取入口；无 www 地址直接打开失败，因此不据此断言未暴露的高级功能。 |
| O2 | [PMCSkin3D 编辑器与官方帮助](https://www.planetminecraft.com/skin-editor/) | 2D / 3D、参考图、姿势、HD、网格、镜像、自定义刷与调色板、快捷键配置、截图和视频入口。 |
| O3 | [PMCSkin3D 帮助与功能概览](https://www.planetminecraft.com/forums/help/site/pmcskin3d-help-feature-overview-659910/) | 不同刷形、透明度、噪点、HSL、克隆、魔棒容差及部位可见性。此为站内转述帮助帖，细节以 O2 当前页面为主。 |
| O4 | [Nova Skin 产品介绍](https://minecraft.novaskin.me/about) | 3D 直接画、2D 编辑、内外层、镜像、颜色滤镜、PNG 与 GIF 导出。 |
| O5 | [Blockbench 官方总览](https://blockbench.net/wiki/guides/blockbench-overview-tips/) | 视口与 UV 绘画、填充范围、形状、渐变、复制粘贴、alpha 锁、临时吸色、颜色历史、快捷键和自动备份。 |
| O6 | [Blockbench 官方纹理制作指南](https://blockbench.net/wiki/guides/bedrock-modeling/) | 隐藏遮挡部位、变大笔刷、Shift 直线和外部纹理实时预览。该指南涵盖通用模型，不把建模功能全部当成皮肤 PNG 的能力。 |
| O7 | [Blockbench Texture API](https://web.blockbench.net/docs/classes/custom_misc.Internal_Types.Texture.html) | 纹理具有独立图层与选区；可在编辑期间更新预览、编辑结束再保存。仅参考公开 API 行为。 |
| O8 | [MinecraftSkinEditor 使用文档](https://minecraftskineditor.net/documentation/) | 可编辑项目、选区与几何工具、图层栈、模型适配、颜色工作台、姿势、项目导出；3D 配件只用于预览 / 模型，不会进入普通皮肤 PNG。 |
| O9 | [MCProfiles 皮肤编辑器](https://mcprofiles.me/tools/skin-editor) | 真正编辑图层、混合模式、历史跳转、身体部位混搭、游戏底层透明预览、经典 / 纤细像素布局转换。 |
| O10 | [MC-ENGINE 皮肤编辑器](https://mc-engine.app/editor) | 2D / 3D 绘画、更多画笔、HD 和额外图层。 |
| O11 | [MC-ENGINE 工具与快捷键](https://mc-engine.app/docs/editor-tools) | 渐变色阶与抖色、按选区 / 面应用、填充容差、保留空像素、纹理笔刷与快捷键。 |
| O12 | [MC-ENGINE 工具检索](https://mc-engine.app/docs/find-a-button) | 工具可搜索定位，避免高级功能只存在于难找的多级菜单。KJMCL 应以短标签和工具提示优先。 |
| O13 | [NeedCoolerShoes 官方介绍](https://needcoolershoes.com/) | 图层优先设计、经典 / 纤细、参考图吸色、混色调色板。 |
| O14 | [NeedCoolerShoes 雕刻工具](https://wiki.needcoolershoes.com/skin_editor/tools/sculpt/) | 将身体像素复制到对应外层，或擦掉外层，形成视觉深度；不是改变玩家几何体。 |
| O15 | [NeedCoolerShoes 填充工具](https://wiki.needcoolershoes.com/skin_editor/tools/paint_bucket/) | 按模型表面跨边连通填充，与全局同色替换区分；支持噪点 / 指定调色板混色。 |
| O16 | [NeedCoolerShoes 明暗工具](https://wiki.needcoolershoes.com/skin_editor/tools/shade/) | 可调强度的提亮 / 压暗工具。 |
| O17 | [MinecraftSkin.app 编辑器](https://minecraftskin.app/editor/) | 按面限制填充、UV 部位名、内外层和经典 / 纤细 3D 预览。 |
| O18 | [SkinEditor.org 编辑器说明](https://skineditor.org/minecraft-skin-editor) | 精确 RGBA、面聚焦、像素网格、命名项目、版本存档和本地草稿恢复。 |
| O19 | [Minecraft 官方皮肤说明](https://www.minecraft.net/en-us/article/what-is-minecraft-skin) | Java 导入展开 PNG，经典 / 纤细选择需与绘制布局一致；Bedrock 角色创作与普通经典皮肤是不同路径。 |
| O20 | [Microsoft Learn 皮肤包格式](https://learn.microsoft.com/en-us/minecraft/creator/documents/packagingaskinpack?view=minecraft-bedrock-stable) | Bedrock 皮肤包元数据、经典 / 纤细 geometry 标识与 PNG 关系；不是 Java 上传接口。 |
| O21 | [J-Kit 皮肤编辑器](https://jkit.tools/en/tools/minecraft-skin-editor) | 身体语义镜像、旧版 64×32 转现代布局、按面填充；明确将 PNG 导出与游戏实际应用分开。 |

## 玩家讨论及对应质量要求

社区帖用于了解创作需求；其中对其他产品的评价或缺陷不视为当前版本的独立技术结论。

| 编号 | 讨论 | 提取的需求 |
| --- | --- | --- |
| C1 | [Nova Skin：2026 编辑器更新反馈](https://forum.novaskin.me/t/issues-with-new-features-in-skin-editor-update/36560) | HEX 输入 / 复制不能消失；本地保存草稿不能自动发布；保留 HD Alex 创作流程。维护者在回复中区分了已修的保存问题和仍需补的 HD 功能。 |
| C2 | [Nova Skin：吸管入口反馈](https://forum.novaskin.me/t/request-for-getting-the-eye-dropper-back/36620) | 高频吸色应可直接使用；浏览器原生全屏吸色不可用时仍有皮肤内吸色；橡皮强度与透明颜色应明确。 |
| C3 | [NeedCoolerShoes 发布及玩家反馈](https://www.reddit.com/r/minecraftskins/comments/1ktvh7t/after_more_than_a_year_of_development_we_finished/) | 玩家看重脸部镜像、图层、纤细模型、雕刻和 2D / 3D 同时编辑；作者介绍跨模型边缘连通填充、指定色板混色。 |
| C4 | [多图层编辑器与参考图需求](https://www.reddit.com/r/minecraftskins/comments/1vick4b/ive_released_a_new_free_skin_editor/) | 多张参考图与从参考图吸色，不只是放一张不能操作的装饰图。 |
| C5 | [玩家讨论笔划撤销粒度](https://www.reddit.com/r/Minecraft/comments/1u23v5r/minecraft_skins/) | 一次按下到松开应是一条历史；颜色滑块和 HEX 并存；透明色可吸取。 |
| C6 | [Blockbench #592：镜像偏一像素](https://github.com/JannisX11/blockbench/issues/592) | 偶数笔刷镜像也要像素对齐，不能只有 1px 笔刷正确。 |
| C7 | [Blockbench #158：外层预览](https://github.com/JannisX11/blockbench/issues/158) | 外层和纤细模型需真正渲染；历史问题及后续评论不作为当前版本复现。 |
| C8 | [3D 姿势编辑器反馈](https://www.reddit.com/r/Minecraft/comments/1sjmqsp/i_made_a_site_where_you_can_pose_minecraft_skins/) | 头底面朝向、肢体调整范围、撤销及空白处取消选择都影响可用性。 |
| C9 | [创作者的皮肤编辑器建议](https://www.reddit.com/r/Minecraft/comments/1jgwkeo) | 用户不会因为有离线画笔就换工具；真正图层和成熟的编辑工作流才构成价值。 |
| C10 | [Blockforge：部位混搭与参考图](https://www.reddit.com/r/minecraftskins/comments/1x8rafh/saturnitystools_blockforge_skin_editor/) | 从另一个皮肤选取头 / 身体 / 肢体、内外层，保留供体预览。 |
| C11 | [编辑图层与衣柜工作流](https://www.reddit.com/r/minecraftskins/comments/1w112rw/i_created_a_advanced_layer_extraction_tool_edit/) | 衣服部件应能即时预览、独立启停，并避免重复导入 / 导出。 |
| C12 | [Skindex 进度丢失讨论](https://www.planetminecraft.com/forums/communities/skinning/skindex-not-working-630069/) | 编辑进度要能恢复，新建 / 打开 / 页面切换不得无声丢弃。 |
| C13 | [项目分享是否保留图层元数据](https://www.reddit.com/r/SideProject/comments/1xtoh1p/i_built_a_free_inbrowser_minecraft_skin_editor/) | 可编辑项目需保留层名、顺序、可见性等，PNG 不能替代项目文件。 |
| C14 | [Skindex 创作入门建议](https://www.minecraftskins.com/skin/23505526/10-tips-for-beginning-skinners/) | 自动噪点不是自动变好看；应同时提供受控明暗、颜色与手工像素工具。 |
| C15 | [PMC 创作者工具导航](https://www.planetminecraft.com/blog/gru-s-guide-to-pmcskin3d/) | 基础工具应好找，高级工具可分组；透明度与前景 / 背景色交换利于创作。 |

## 可逐项验证的实现矩阵

以下是结合多来源形成的 KJMCL 工程要求，不是对单个产品的完整复制。`P0/P1/P2` 只决定实现先后，**不是降低目标或自动把后续项排除**。所有项目在写下运行或测试证据以前均为“待验收”，不可仅因有按钮或类型定义就勾选完成。

| ID | 迭代 | 功能 | 可证明完成的行为 | 依据 |
| --- | --- | --- | --- | --- |
| F01 | P0 | 独立编辑页面 | 无账户也能新建 / 编辑；入口不局限于小上传弹窗。 | O1/O8 |
| F02 | P0 | 64×64 RGBA | PNG 导入到导出像素与 alpha 正确，透明像素不被当作黑色。 | O17/O18/C3 |
| F03 | P0 | 旧版 64×32 | 左右肢体按游戏语义补齐，顶部 / 底部方向测试。 | O21/O9 |
| F04 | P0 | 经典与纤细 | 两种 UV 与胳膊几何正确；模型变更可撤销。 | O19/O9/C7 |
| F05 | P1 | 模型布局转换 | 显式区分“按此模型解释”和“转换像素”；转换后不串面。 | O9/O8 |
| F06 | P0 | 双视图同步 | 2D 画一像素在对应 3D 面更新；3D 画回 2D 同一坐标。 | O2/O5/C3 |
| F07 | P0 | 相机导航 | 旋转、缩放、平移、复位及六向视图，不意外画笔落点。 | O5/O8 |
| F08 | P0 | 像素定位 | UV 网格、部位 / 面标签、鼠标坐标、笔刷轮廓和缩放。 | O17/O18/C6 |
| F09 | P0 | 部位可见性 | 六部位与身体 / 外层分别开关；可选聚焦、显示全部。 | O2/O17/C7 |
| F10 | P0 | 铅笔与橡皮 | 快速拖动连续不漏点，按笔划提交历史，透明度可预测。 | O1/C2/C5 |
| F11 | P0 | 吸管 | 点击 / 临时快捷键采样原始像素，不采到灯光阴影色。 | O5/C2 |
| F12 | P0 | 连通填充 | 容差可调，默认单面限制；alpha 参与匹配。 | O17/O3/C3 |
| F13 | P1 | 模型表面填充 | 可跨同部位相接面连通，不能沿平面 UV 淹到另一部位。 | O15/C3 |
| F14 | P1 | 同色替换 | 明确与连通桶区分；遵守选区与编辑范围。 | O15/O11 |
| F15 | P0 | 画笔参数 | 大小、方 / 圆形、透明度；半透明笔划不因事件频率变深。 | O3/O5 |
| F16 | P0 | 人体镜像 | 左右肢体和头 / 身体表面正确映射，偶数刷宽不偏移。 | O5/C3/C6 |
| F17 | P1 | 面内镜像 | 当前面 X / Y 可分别启用，不与人体左右对称混淆。 | O2 |
| F18 | P1 | 线与形状 | 线段、空心 / 实心矩形与椭圆；拖动有预览、一次撤销。 | O5/O8 |
| F19 | P1 | 渐变 | 前景 / 背景色，线性 / 分段 / 抖色，保留 alpha 或填透明可选。 | O11/O9 |
| F20 | P1 | 提亮与压暗 | 有强度、单笔划不重复累积，保留目标 alpha。 | O16/O11 |
| F21 | P1 | 噪点与纹理 | 可控色差 / 种子；可选限制在色板而非只随机 RGB。 | O3/O15/C14 |
| F22 | P1 | 克隆印章 | 设源、偏移复制，源快照不被本次绘制污染。 | O3/O8 |
| F23 | P1 | 雕刻 | 对应底层像素复制至外层，支持擦除外层且可撤销。 | O14 |
| F24 | P1 | 矩形 / 自由选区 | 绘画与滤镜只影响选区；全选、反选、取消选择。 | O8/O9 |
| F25 | P1 | 魔棒 | 相似色容差、连通选择，alpha 与隐藏层处理一致。 | O3/O8 |
| F26 | P1 | 选区变换 | 复制 / 剪切 / 粘贴、移动、翻转、旋转；不自动拉伸模糊像素。 | O5/O8 |
| F27 | P0 | 撤销 / 重做 | 画笔、图层、模型、滤镜都能回退；新编辑正确截断 redo 分支。 | O5/O9/C5 |
| F28 | P1 | 可见历史 | 操作名称和历史定位；一次拖动不是几百条记录。 | O9/C5 |
| F29 | P0 | 编辑图层 | 新增 / 复制 / 删除 / 命名 / 排序，不同于 MC 内外层选择。 | O7/O8/O13/C9 |
| F30 | P0 | 图层状态 | 可见、锁定、透明度、alpha 锁对所有工具生效。 | O5/O8 |
| F31 | P1 | 图层混合 | 至少 Normal/Multiply/Screen/Overlay/Add；结果可数值测试。 | O8/O9 |
| F32 | P1 | 图层整理 | 合并向下、合并可见、组或等效批量组织；锁定层保护。 | O8/C4 |
| F33 | P0 | 色彩工作台 | HEX/RGB/HSL、alpha、两色交换、最近颜色；键盘输入不触发工具。 | O5/O8/C1 |
| F34 | P1 | 调色板 | 多个命名色板、增删色、导入导出、从皮肤 / 图片提取。 | O2/O5/O11 |
| F35 | P1 | 颜色调整 | 色相 / 饱和度 / 明亮度 / 对比度、灰度、反相、色阶、描边；预览/取消。 | O4/O8/O9 |
| F36 | P1 | 参考图 | 可移动缩放、多图或切换；参考图吸色；不混入导出。 | O2/O13/C4 |
| F37 | P1 | 自定义印章 | 图片或选区作为笔刷，旋转 / 翻转 / 保存；有透明边缘。 | O2 |
| F38 | P1 | 部位混搭 | 从本地供体皮肤选头/躯干/肢体与内外层，合入新编辑层。 | O9/C10/C11 |
| F39 | P0 | 可编辑项目 | 导入/导出版本化工程；层名、像素、顺序、模型等往返一致。 | O8/O18/C13 |
| F40 | P0 | 草稿与恢复 | 自动保存、失败可见、重启恢复；不覆盖旧工程或默默清空。 | O5/O18/C12 |
| F41 | P1 | 多项目管理 | 名称、缩略图、复制、最近项目、另存副本和版本恢复。 | O18/O8/C1 |
| F42 | P0 | 导出与应用 | PNG、工程、账户应用独立；保存不触发网络上传。 | O19/C1 |
| F43 | P1 | 账户皮肤编辑 | 当前账户皮肤作为新项目导入；应用显式选账户和模型。 | KJMCL已有链路/O19 |
| F44 | P1 | 姿势 | 肢体角度、姿势预设、复位；像素不因姿势修改。 | O2/O8/C8 |
| F45 | P1 | 动态与展示 | 自动转台、走路预览、灯光开关与背景、透明 PNG 截图。 | O2/O4/O8 |
| F46 | P2 | 动画展示导出 | GIF 或视频输出，有分辨率/帧数/时长与取消；不冒称游戏皮肤动画。 | O4/O2 |
| F47 | P1 | 快捷键 | 工具、撤销、保存、选区、笔刷尺寸；输入框和弹窗内不抢键。 | O5/O8 |
| F48 | P2 | 自定义快捷键 | 重绑、冲突提示、恢复默认，快捷帮助可搜索。 | O2/O12/C3 |
| F49 | P2 | HD 工程 | 128/256 等与模型 UV 按比例工作；Java 账户应用限制与编辑尺寸分开。 | O10/C1 |
| F50 | P2 | 分辨率转换 | 最近邻升/降分辨率，结果可预览、可撤销、尺寸不只改标签。 | O2 |
| F51 | P1 | 游戏效果检查 | 内外层 alpha、空洞、未用 UV 区域与模型对应关系可检查修正。 | O9/O21 |
| F52 | P1 | 前后对比 | 原图或保存版本与当前图切换，不破坏历史。 | O10/O18 |
| F53 | P1 | 稳定输入 | Pointer capture、离开画布、取消事件、窗口失焦不会留下未结束笔划。 | C5与工程推导 |
| F54 | P1 | 轻量交互 | 窄窗口与面板折叠、按需渲染、长历史有上限但不丢当前作品。 | KJMCL界面约束/C9 |
| F55 | P1 | 精确与错误恢复 | 渲染与 PNG 像素比对、保存失败不假成功、坏工程不覆盖好草稿。 | O18/C12/C13 |

## 扩展能力与真实边界

“现代编辑器所有功能”没有固定且不变的行业全集。本表是从实际产品和创作流程提炼的可审计基线；发现新缺口需继续加表并实现，不以本表已列条目掩盖缺失。

以下能力也已发现，应在完成审查中明确处理，不能默默当作不存在：

- **披风、实体 / Mob UV、Bedrock `.mcpack`、GLB/OBJ/Blockbench 输出**：这些是邻接创作领域。普通 Java 皮肤 PNG 不能存储任意几何体、衣物模型或动画。若做扩展，需有独立格式和入口，不能把只在预览显示的配件称为已装进 Minecraft。
- **云同步、公开图库、在线分享、网页发布**：需真实服务与用户账户语义；本地项目和 PNG 已能构成独立工作流。此轮不得凭空生成上传成功，也不得未经适用授权注册/发布外部服务。
- **第三方默认纹理、服装素材包**：不把网络获取的角色图当作原创内置资源。可用程序生成的原创起始模板与本地导入，并保留作者/来源信息。
- **AI 生图 / 图片变皮肤**：不是所有主流编辑器的共同核心。若实现，输出仍需逐像素可编辑、正确 UV 与模型，不能用普通角色图替代展开皮肤。

这些边界只用于避免错误兼容性承诺，不自动满足用户的“最完善”要求。完成状态必须同时说明实际做了哪些、哪些仍是缺口，以及哪些功能已确认属于另一个独立产品而非皮肤编辑器本身。

## 迭代审查问题

每轮先回答并记录证据，再决定下一轮：

1. 能否从空白 / 老皮肤 / 当前账户皮肤，完成一张细节皮肤且保留工程？
2. 能否不重画地换衣服、配色、模型、镜像或复用一只袖子的图案？
3. 能否在所有部位、所有面、两种模型的内外层上正确点到一个指定像素？
4. 隐藏、锁定、选区、alpha 锁是否对每个工具一致生效？
5. 修改是否都能撤销，重启能恢复，保存和上传是否互不混淆？
6. 与本表的高级工具相比，还缺少什么会迫使玩家转去另一个编辑器？
7. 是否只有代码/单元测试证据，缺少实际界面与导出回读证据？若是则仍为待验收。

## 检索记录

执行超过 25 个定向查询，并打开官方工具页面、Wiki、社区长帖。代表性查询如下（无效或重复结果没有算成独立功能证据）：

1. `site:planetminecraft.com PMCSkin3D advanced editor features layers tools`
2. `site:minecraftskins.com skin editor tools noise mirror`
3. `site:novaskin.me skin editor layers tools`
4. `site:minecraftskins.com editor Minecraft skin pencil eraser auto tone brush mirror`
5. `site:blockbench.net wiki paint mode skin layers tools symmetry`
6. `site:blockbench.net Minecraft Skin mode export skin painting`
7. `MinecraftSkinEditor official features editor undo redo layers`
8. `site:blockbench.net/wiki skin painting tools layer mirror paint`
9. `site:blockbench.net/wiki paint mode texture layers gradient`
10. `site:minecraftskins.com/skin-editor/`
11. `site:novaskin.me skin editor filters layers copy paste`
12. `site:forum.novaskin.me skin editor undo layers lost work transparent`
13. `site:planetminecraft.com/tickets skin editor mirror layer palette reference`
14. `site:reddit.com/r/minecraftskins skin editor wish layers undo reference`
15. `site:github.com/JannisX11/blockbench/issues skin mirror slim layer`
16. `site:minecraft.net custom skins 64 64 128 skin slim classic transparency`
17. `site:learn.microsoft.com minecraft creator skin packs 64x64 128x128`
18. `site:needcoolershoes.com editor features layers sculpt`
19. `site:mineskin.pro features skin editor layer`
20. `site:minecraftskineditor.net documentation selection layers project HD 3D brush`
21. `site:mc-engine.app skin editor guide mirror selection gradient save`
22. `site:planetminecraft.com forums skin editor missing undo lost work`
23. `site:forum.novaskin.me skin editor layers mirror alex`
24. `site:learn.microsoft.com/en-us/minecraft/creator/documents/packagingaskinpack skins slim classic 64`
25. `site:minecraft.net/en-us/article/ custom skin transparent skin Java Edition`
26. `site:needcoolershoes.com features sculpt tool layers`
27. `site:forum.novaskin.me/t/issues-with-new-features-in-skin-editor-update/36560`

本调研文件本身不代表上述功能已实现。调研对应的源码审核阶段按用户要求未编译、打包；后续 0.7.3 已获准进行 Windows 本地构建、验证和打包，不发布上传。实际实现与验证状态由开发及发行记录补充。
