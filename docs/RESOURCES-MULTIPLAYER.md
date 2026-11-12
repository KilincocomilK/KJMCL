# 0.4.0 资源与陶瓦联机

2026-11-12，Windows x64 本机开发验收。现有 state.json 仍为 schemaVersion=3，未改变账户、实例或设置结构，不重置用户数据。

## 使用

- 将 JAR、ZIP、MCPR、LITEMATIC、SCHEMATIC、SCHEM、NBT 文件拖入任意页面。读取内部元数据后弹出确认窗口，精确游戏版本与加载器能唯一匹配时推荐实例；版本范围、未知 ZIP 与有多个候选的文件由玩家选择。推荐不等于完整依赖检查。
- 每次最多 100 个文件、每个不超过 2 GiB。目录与符号链接不作为文件导入；原文件保留。同名默认跳过，也可生成副本，不提供覆盖操作。整合包使用“游戏实例 → 导入整合包”。
- 资源管理按实例列出 mods、shaderpacks、resourcepacks、replay_recordings、schematics。后两种支持子目录。资源包与光影当前列出 ZIP 文件，未展开目录形式的包。修改资源前需停止对应游戏和安装任务。
- Replay 显示录像缩略图、版本、时长、日期和服务器信息，实际播放在游戏内 Replay Viewer 完成。光影可显示包内封面，实际渲染效果在游戏中查看。
- 原理图支持 Litematica、Sponge v2/v3、传统 Schematic 与 Java 结构 NBT。逐区域显示尺寸与方块俯视图，颜色区分方块类型，并非 Minecraft 材质渲染。最多预览 16 个区域、200 万体素，单层最多 65,536 格；大文件保留管理功能，预览会说明限制。负尺寸区域按其本地区域坐标显示，多个区域不会合并成世界坐标模型。
- 陶瓦页首次点击“安装陶瓦组件”，完成后“启动 / 连接”。房主进入世界并对局域网开放后创建房间；好友填写邀请码加入。房间码、直连地址、成员和错误均来自本机官方组件。
- 自动安装固定为上游 v0.4.2，支持 Windows / Linux x64、ARM64。macOS 请先安装并运行官方陶瓦应用再连接。仅 Windows x64 在本机实测。默认遵循启动器代理设置；本机 GitHub 直连测试停滞，通过已有的 127.0.0.1:7890 代理成功下载，未修改真实用户配置。
- KJMCL 自己启动的陶瓦随启动器正常退出而关闭；连接到已运行的陶瓦时，关闭 KJMCL 不终止其他应用的陶瓦进程。改变房间状态会影响该共享陶瓦会话。运行期间的数据迁移要求重启后再操作。

## 实现与安全边界

新增接口同步覆盖 shared/types.ts、shared/schema.ts、具名 preload 和主进程处理器。渲染进程保持 sandbox/contextIsolation，不获得通用 IPC、文件系统、网络或进程执行接口。拖入路径通过 Electron webUtils 获取。

导入票据仅存在内存中，30 分钟过期；读取源文件后计算 SHA-256，提交时暂存并再次校验，防止预览后源文件变化。实例目录、子目录、目标文件检查链接与路径，写入使用不覆盖语义。ZIP/NBT 限制读取大小、条目数和结构复杂度。

陶瓦是未经修改的独立官方进程，通过回环 HTTP 通信。下载固定版本与官方 Release SHA-256，解包检查 TAR 路径、类型和校验头，再以 shell:false 启动。HTTP 仅访问 127.0.0.1，由主进程发现端口，禁止重定向并限制响应体。房间码与本地成员设备标识不写入 KJMCL 日志或用户状态。

组件位于 tools/terracotta/0.4.2，独立 manifest.json 使用 schemaVersion=1，包含组件文件哈希。tools 已纳入现有迁移、校验和受管数据清理范围。

官方依据：[HTTP API](https://burningtnt.github.io/Terracotta/http-api/)、[v0.4.2 源码和许可](https://github.com/burningtnt/Terracotta/tree/v0.4.2)、[Sponge Schematic v3](https://github.com/SpongePowered/Schematic-Specification/blob/master/versions/schematic-3.md)。界面显著标识陶瓦作者与许可，未复制其他启动器实现。

## 验证

- npm run typecheck、npm test、npm run test:desktop、npm run build。
- 新增资源单测：识别与精确匹配、实例隔离、重复文件处理、源文件变更、路径穿越与 junction 拒绝、重命名不覆盖、NBT 解析与预览。
- 新增陶瓦协议单测使用本地 HTTP 测试服务，验证路由、参数编码、房间状态、旧响应忽略、错误响应；不作为真实联机验收。
- resource-desktop-smoke.mjs 使用一次性目录，通过原生文件选择的 File 对象模拟拖放，覆盖首页、账户、联机、资源管理四页，验证沙箱桥接、推荐实例、实际导入、预览、重命名和实例切换。
- 真实陶瓦测试需显式设置 KJMCL_TEST_REAL_TERRACOTTA=1；可选 KJMCL_TEST_PROXY。通过官方包下载、SHA-256、实际进程握手、本机 HTTP 状态、扫描与重置；未加入外部房间，未完成双机 Minecraft 世界联机验收。测试 TEMP/TMP 和用户数据均隔离。
- 既有桌面测试使用 JDK 21 的 JVM fixture，不冒充真实 Minecraft 或多操作系统验收。没有真实账户登录、第三方发布或应用注册。
- Windows 构建未签名；macOS/Linux 未实机验证，未在 Windows 上生成对应系统发行包。
- 最终通过 90 项单测；Windows 打包后 win-unpacked/KJMCL.exe 再次通过新增桌面资源测试与真实陶瓦组件测试。安装版与便携版位于 release/0.4.0，附 SHA256SUMS.txt。未执行安装器安装或便携包装器生命周期测试。
