# doge

<p align="center">
  <img src="./public/app-icon.png" width="128" height="128" alt="doge AI 小柴犬助手应用图标" />
</p>

> 把复杂的事，叼回来做好。

doge 是一只住在电脑里的拟人化 AI 小柴犬。它不是高高在上的万能 AI，也不是只会等待命令的工具；它会记得你的习惯，把散落在文件、终端、任务和灵感里的事情一件件叼回来。

工作时，doge 陪你拆解目标、编写代码、查找资料、推进任务；生活里，它将逐步学会整理计划、保存想法、照看琐事。首个版本先专注开发者工作流，不会宣称尚未实现的生活服务。

当前版本：`0.1.0`

## 现在能做什么

- 在一个桌面界面中使用 Claude Code、Codex CLI、Gemini CLI、OpenCode、Kimi、Grok 等本地 AI runtime。
- 管理多个项目、工作区和 Git worktree，并在会话间快速切换。
- 实时查看推理、工具调用、文件修改、终端输出和任务状态。
- 浏览与编辑文件、查看 Git diff、提交变更、管理分支和历史。
- 使用项目地图、上下文账本、记忆、任务板和多智能体协作能力处理复杂工作。
- 数据默认保存在本机；doge 不依赖自建云服务才能运行。

## 下载与更新

公开安装包将发布到 [doge Releases](https://github.com/jasonmao-msj/doge/releases)。

doge 的自动更新只会信任 doge 自己的 GitHub Releases 签名。独立签名密钥和首个正式 Release 完成前，客户端更新器保持关闭，不会连接或信任其他更新源。

初期不需要云厂商服务器：应用本地运行，安装包与静态更新清单由 GitHub Releases 托管。只有未来出现账号同步、远程任务或更复杂的分发需求时，才需要评估后端服务。

## 本地开发

### 环境要求

- Node.js 20+
- npm 10+
- Rust stable、Cargo、rustfmt
- CMake
- macOS 构建建议安装 Homebrew OpenSSL 3

### 启动

```bash
git clone https://github.com/jasonmao-msj/doge.git
cd doge
npm install
npm run tauri:dev:hot
```

仅启动 Web 前端：

```bash
npm run dev
```

### 常用检查

日常开发优先运行与改动相关的测试：

```bash
npm run typecheck
npm exec vitest run -- path/to/changed.test.ts
cargo test --manifest-path src-tauri/Cargo.toml module_name --lib
```

合并或发布前再运行完整门禁：

```bash
npm run check:runtime-contracts
npm run check:branding
npm run lint
npm run typecheck
npm run test
cargo test --manifest-path src-tauri/Cargo.toml
```

macOS Apple Silicon 构建：

```bash
npm run build:mac-arm64
```

## 本地数据与迁移

- doge 当前数据目录：`~/.doge`
- 新安装只写入 doge 命名空间。
- 从历史版本升级时，doge 会复制旧数据到新目录；新目录已有数据时不会覆盖。
- 旧目录不会被移动或删除，便于回滚。
- 迁移日志只记录来源类型、版本与时间，不记录密钥、Token、完整用户路径或文件内容。

## 品牌

官方名称始终使用小写 `doge`。视觉方向是一只琥珀色、温暖、可靠的拟人化小柴犬，避免硬币、行情、火箭等加密货币元素。

品牌故事：

> doge 的故事，从一只总爱坐在你桌边的小柴犬开始。它会把散落在文件、终端、任务和灵感里的事情一件件叼回来。工作时，它陪你拆解目标、编写代码、查找资料、推进任务；生活里，它将逐步学会整理计划、保存想法、照看琐事。doge 是一只住在电脑里的拟人化 AI 小柴犬，也是你可以信任的生活与工作搭档。

## 开源许可

本项目依据 [MIT License](./LICENSE) 发布。Git 历史与 LICENSE 中保留了继承代码所需的版权和许可信息。

## 参与贡献

- 问题与建议：[GitHub Issues](https://github.com/jasonmao-msj/doge/issues)
- 代码仓库：[jasonmao-msj/doge](https://github.com/jasonmao-msj/doge)

提交前请确保品牌门禁、类型检查和相关测试通过。`main` 是 doge 的发布事实来源。
