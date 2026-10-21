# Pi Hearth 技术栈

采用 Tauri 2、Rust 和 React 构建桌面客户端，通过 Pi RPC 复用代理能力。本地保存项目、会话和设置；模型请求由 Pi 发送至用户配置的服务。

## 技术选型

| 层次 | 技术 | 用途 |
| --- | --- | --- |
| 桌面框架 | Tauri 2 | 窗口、系统集成、权限配置和安装打包 |
| 本地应用核心 | Rust + Tokio + Serde | 异步任务、子进程、RPC 解析和本地服务 |
| 前端 | React + TypeScript + Vite | 桌面单页应用与类型检查 |
| 组件与样式 | shadcn/ui（Base UI）+ Tailwind CSS | 布局、表单、菜单、弹窗和主题 |
| 界面状态 | Zustand | 当前项目、会话、面板状态和消息展示缓存 |
| 长列表 | TanStack Virtual | 长对话与工具记录的虚拟化展示 |
| Markdown | Streamdown + Shiki | 流式 Markdown 和代码高亮 |
| 文件与差异 | Monaco Editor | 按需加载的只读文件预览与差异查看 |
| 代理引擎 | Pi Coding Agent | 模型接入、上下文、工具循环和会话持久化 |
| Pi 运行时 | 随应用分发的 Node.js LTS | 启动固定版本 Pi，无需用户单独安装 Node.js |
| 前后端通信 | Tauri Commands + Channels | 控制请求与有序流式数据传输 |
| Pi 通信 | stdin / stdout JSONL RPC | 长驻子进程的命令、响应和事件 |
| 应用数据库 | SQLite + SQLx | 项目、会话索引、运行记录和普通设置 |
| 凭证存储 | 系统凭证库 + Rust keyring | API Key 的读取与保存 |
| 类型契约 | Rust DTO + ts-rs | 从 Rust 数据结构生成前端类型 |
| 日志 | tracing + 文件轮转 | 启动、协议、进程与执行问题诊断 |
| Rust 测试 | Cargo Test | RPC 适配、状态转换、进程与存储逻辑 |
| 前端测试 | Vitest + React Testing Library | 状态逻辑和关键组件交互 |
| 桌面端测试 | WebdriverIO + Tauri WebDriver 集成 | 真实桌面窗口中的关键流程 |
| 构建与发布 | Tauri Bundler + Updater + CI | 各平台安装包、更新产物和签名校验 |
| 包与依赖管理 | pnpm + Cargo | JavaScript 与 Rust 依赖管理及锁文件 |

## 选型边界

React 作为本地单页界面运行，前端通过 Tauri 调用 Rust。本地服务直接放在 Rust 核心中，首版无需额外部署 HTTP 后端。

Pi 通过语言无关的 RPC 协议接入。Rust 统一管理桌面能力、子进程和持久化，模型调用、上下文压缩与工具循环由 Pi 承担。

SQLite 只保存应用数据和索引，完整会话以 Pi 会话文件为准。Zustand 保存界面状态和可重建的展示数据，API Key 保存于系统凭证库。具体归属见[整体架构](architecture.md)。

Monaco 按需加载，首版用于只读预览与差异查看。桌面端自动化测试依赖只加入测试构建。

## 版本与运行时

- Tauri 使用 2.x；其余依赖在工程初始化时选择相互兼容的已发布版本，并提交锁文件。
- Node.js 选择满足所选 Pi 版本要求的 LTS 版本，Pi 使用固定发行版本。
- 应用、Node.js、Pi 与随附扩展作为同一套版本验证和发布，运行时升级随应用版本进行。
- Git、Shell 和具体项目所需开发工具使用本机环境，启动时检测路径、版本和缺失依赖。
- Windows、macOS 和 Linux 分别构建并验证对应产物，平台支持范围以实际发布结果为准。

## 官方资料

- [Tauri 前后端通信](https://v2.tauri.app/develop/calling-frontend/)与[外部程序打包](https://v2.tauri.app/develop/sidecar/)
- [Tauri 更新插件](https://v2.tauri.app/plugin/updater/)与[桌面端自动化测试](https://v2.tauri.app/develop/tests/webdriver/)
- [Pi 仓库](https://github.com/earendil-works/pi)与[RPC 接口](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)
- [React](https://react.dev/)、[shadcn/ui](https://ui.shadcn.com/docs)、[Streamdown](https://streamdown.ai/)和[TanStack Virtual](https://tanstack.com/virtual/latest/docs/introduction)
