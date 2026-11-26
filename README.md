# KJMCL

KJMCL 是一款黑橙像素风的 Minecraft Java 版桌面启动器。你可以创建游戏实例，也可以直接使用已有的 `.minecraft` 文件夹。

## 下载与使用

Windows x64 提供安装版和便携版。首次使用时，新玩家可以跟随引导创建游戏文件夹、配置 Java 和添加账户，再选择版本安装游戏。已有游戏的玩家可以直接沿用原目录，也可以创建独立副本。以后仍可从「启动器设置 → 游戏目录与迁移」导入。[下载最新版](https://github.com/KilincocomilK/KJMCL/releases/latest)

## 功能

- 安装原版、Fabric、Quilt、Forge 和 NeoForge，分别管理各实例的 Java、模组和配置。
- 搜索和安装模组、资源包、光影与 RedenMC 投影，预览本地资源。
- 备份世界，在地图上编辑区块与游戏规则。工具箱还提供皮肤编辑器、种子地图和投影工坊。
- 通过陶瓦联机与朋友游玩，或使用内置 AI 助手诊断实例。[AI 助手指南](docs/AI-ASSISTANT.md)

## 本地开发

使用仓库指定的 Node.js 和 npm 版本，并安装 Rust。Windows x64 构建还需 MSVC、MSYS2 UCRT64 和 Rust 的 `x86_64-pc-windows-gnu` 目标。桌面测试需要 JDK 17 或更高版本。[构建说明](docs/SEED-MAP-IMPLEMENTATION.md)

```sh
npm ci
npm run dev
```

运行 `npm test` 执行单元测试，运行 `npm run dist` 构建当前平台的发行包。

项目采用 MIT 许可证。[许可证](LICENSE) · [第三方声明](THIRD_PARTY_NOTICES.txt)
