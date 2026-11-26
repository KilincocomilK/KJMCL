# 待确认事项与后续开发

2026-11-12 用户已明确指定：作者为 KilincocomilK，采用 MIT 许可证，上传到本人 GitHub 并先保持私有。仓库为 [KilincocomilK/KJMCL](https://github.com/KilincocomilK/KJMCL)。其余需要外部身份或发行配置的事项继续保留。

1. **Microsoft 应用身份**：KJMCL 的 Client ID、应用所有者和 Minecraft 服务准入。可在「账户管理 → Microsoft 账户」填写客户端 ID。
2. **许可证与仓库**：已按用户授权采用 MIT 并署名 KilincocomilK，GitHub 仓库保持私有；以后何时公开尚未指定。npm 包保留 `private: true` 防止误发布。SJMCL 参考目录、构建产物和玩家数据不上传。
3. **正式发布**：版本渠道、Windows 证书、macOS 签名 / 公证、自动更新服务、下载域名尚未配置。
4. **新增集成凭据**：CurseForge API Key 和 Modrinth 发布令牌由用户在设置配置，系统加密保存；不预置第三方项目凭据。以上原待确认问题继续保留，本轮没有再次请求回答。
5. **KJMC 联动**：是否预置服务器、服务器整合包和皮肤站；当前仅提供官网入口，不推定服务端地址或账户规则。

## 初版默认选择

- 启动器中文界面；桌面 960×650 起，自定义直角窗口、黑橙、磨砂表面。
- Minecraft Java Edition；Windows x64、macOS x64/arm64、Linux x64 构建目标。架构扩展应先加入原生库和 Java 测试矩阵。
- 原版 / Fabric / Quilt / Forge / NeoForge 独立实例；允许自定义 Minecraft 目录，已有目录通过复制导入。目录迁移保留原位置，不覆盖旧游戏或系统 Java。
- 全局默认内存 4096 MiB；Java 自动匹配主版本；代理默认关闭，可填写 7890。
- 下载源未在线验收。任何联网失败都作为失败显示，不伪造已安装状态。

## 0.2 开发范围

当时已实现用户指定的加载器、第三方账户、CurseForge、皮肤、整合包发布入口、备份、克隆和目录导入。需要外部凭据和真实账户的联调仍保留；该阶段没有执行远程项目创建、启动器正式发布、签名及许可决定。其后用户已授权本项目的私有 GitHub 仓库和 MIT 许可证，见上文。

## 资料来源

- [KJMC 官网](https://kjmc.top)：仅参考公开视觉特征。
- [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)：进程隔离、导航与 IPC 边界。
- [Microsoft 设备码流程](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code)：设备码轮询、过期与 slow_down。
- [Modrinth API](https://docs.modrinth.com/api/)：搜索、版本和依赖。
- [Fabric Meta](https://github.com/FabricMC/fabric-meta)、[Quilt Meta](https://github.com/QuiltMC/quilt-meta)：加载器元数据。
- [Forge 官方 Installer](https://github.com/MinecraftForge/Installer)、[NeoForge LegacyInstaller](https://github.com/neoforged/LegacyInstaller)：官方安装器 CLI 和生成版本配置。
- [CurseForge REST API](https://docs.curseforge.com/rest-api/)：项目 / 文件 / 依赖与 API Key。
- [authlib-injector 启动器规范](https://yushijinhun.github.io/authlib-injector/en/launcher-technical-specification.html)、[认证服务器规范](https://yushijinhun.github.io/authlib-injector/en/yggdrasil-server-technical-specification.html)：Yggdrasil 与皮肤扩展。
- [Modrinth Create Version](https://docs.modrinth.com/api/operations/createversion/)：标准整合包发布版本接口。
- [Adoptium API](https://api.adoptium.net/q/swagger-ui/)：Java 运行时元数据。

品牌图形和几何风景由本项目绘制，不捆绑 Minecraft 游戏素材、字体或其他启动器界面资产。
