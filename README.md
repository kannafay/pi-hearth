# Pi Hearth

面向 Pi Coding Agent 的本地优先桌面工作台，提供项目管理、对话、工具执行展示和代码变更查看。

项目已接入 Pi RPC，支持读取本机 Pi 模型配置、普通对话、多项目会话、Pi 原生历史恢复、Markdown 流式回复、模型切换、文件读写和命令执行。对话中可展开工具记录，查看参数、实时输出与结果，并停止任务。Git 服务仍按文档规划接入。产品只面向电脑端，首轮开发与验证以 Windows 为主。

## 核心方案

**Tauri 2 + Rust + React / TypeScript + Pi RPC + SQLite**。

React 提供桌面界面，Rust 管理本地服务与 Pi 运行时子进程，Pi 负责模型调用和代理执行。当前开发阶段使用本机 Node.js 和项目依赖中的固定版本 Pi；随安装包分发 Node.js 与 Pi 运行时是发行目标，尚未接入。

## 输入框命令

在输入框开头输入 `/`，可搜索命令和当前会话已加载的技能。上下方向键选择，`Enter` 或 `Tab` 补全；补全后可以继续填写参数，再按 `Enter` 执行。`Esc` 关闭列表，`Shift+Enter` 换行。

| 命令                      | 用途                                                |
| ------------------------- | --------------------------------------------------- |
| `/new`                    | 在当前项目新建对话                                  |
| `/resume`                 | 搜索并切换已有会话                                  |
| `/name [标题]`            | 重命名当前会话，省略标题时打开编辑框                |
| `/model [provider/model]` | 切换模型，省略参数时打开模型列表                    |
| `/thinking [档位]`        | 调整当前模型支持的思考强度，包括 `default` 和 `off` |
| `/settings`               | 打开 Pi Hearth 设置                                 |
| `/compact [保留要求]`     | 压缩当前上下文，执行期间可以停止                    |
| `/skill:名称 [任务]`      | 调用已启用的技能                                    |

在消息中输入 `@` 可搜索当前项目文件，遵循项目忽略规则。选择后插入相对路径，带空格的路径自动加引号，文件由 Pi 按需读取。终端命令前缀 `!`、`!!` 尚未接入。

## 项目文档

| 文档                             | 内容                                                     |
| -------------------------------- | -------------------------------------------------------- |
| [技术栈](docs/tech-stack.md)     | 桌面框架、前端、运行时、存储、测试与发布选型             |
| [整体架构](docs/architecture.md) | 分层职责、通信、会话与进程、数据归属、首版范围和实施阶段 |
| [界面布局](docs/ui-layout.md)    | 主窗口线框、面板尺寸、对话交互、文件查看、设置和视觉规范 |

## 首版目标

- 打开本地项目，管理项目与历史会话。
- 配置模型与 API Key，发送消息并查看流式回复和工具执行过程。
- 停止任务，恢复历史会话，切换会话时保留后台任务。
- 查看文件和 Git 差异，排查启动与执行问题。
- 通过桌面安装包使用应用，并支持签名更新。

完整代码编辑、交互式终端、任务级回滚、Git worktree 管理、扩展管理界面和 OAuth 登录留待后续阶段。

## 本地开发

需要 Node.js 22.19 及以上版本、pnpm 12.9.1 和 Rust stable。Windows 桌面构建还需要 MSVC C++ Build Tools、Windows SDK 与 WebView2，安装方式见 [Tauri 环境要求](https://v2.tauri.app/start/prerequisites/)。

```sh
pnpm install --frozen-lockfile
pnpm desktop
```

`pnpm desktop` 启动前会检查 `cargo` 和 `rustc` 是否可用。缺失或工具链异常时，会停止启动并显示中文安装命令、PATH 检查与终端重开指引；检查不会自动安装 Rust。Windows 可手动运行 `winget install --id Rustlang.Rustup --exact`，安装时选择 MSVC 工具链；若已安装 rustup 但缺少 stable，可运行 `rustup toolchain install stable`。安装完成后重新打开终端，再运行 `pnpm desktop`。

Windows 还会离线编译并链接一个无外部依赖的最小 Rust 程序，确认 MSVC 链接器和 Windows SDK 可用；临时文件会在检查后清理。检查失败时会显示中文安装或修复指引，不会自动安装系统组件。可在管理员终端手动执行下面的命令，安装 C++ 构建工作负载及推荐组件：

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --source winget --override "--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

只查看前端时运行 `pnpm dev`，访问 `http://127.0.0.1:1420`。浏览器预览可以调整主题和查看布局；本地项目与对话通过桌面端提供。

在 Pi 配置目录（默认 `~/.pi/agent`，可在“设置 → 关于”中查看）中配置模型提供商与 API Key，也可通过环境变量提供凭证。打开桌面端即可开始普通对话，无需先选择项目或手动连接。输入区可直接切换模型。Enter 发送，Shift+Enter 换行；生成时可停止。更新 Pi 配置后，新建对话会重新读取配置，设置中的刷新按钮可更新模型列表。

新对话优先使用应用中保存的默认模型；默认模型未设置或已不可用时，按 Pi 返回的顺序选择首个可用模型，不按配置来源或提供商 ID 前缀设置优先级。已有会话保留仍可用的模型。

左侧先列出项目，普通对话位于下方的“聊天”分组。支持添加已有项目、创建项目、按项目管理多个会话，以及搜索全部历史。项目菜单中的“项目指令”编辑项目的 `AGENTS.md`（兼容已有 `CLAUDE.md`），同项目会话和其他 Pi 客户端均可使用。界面使用 shadcn/ui Neutral 配色、常规字重与紧凑圆角。

消息输入、附件、模型选择与发送操作位于同一个输入区。支持选择、拖入和粘贴文件，以及粘贴图片；每条消息最多 10 个附件，单个附件最多 20 MiB。图片作为原生图片输入发送；128 KiB 以内的 UTF-8 文本附带正文，其他文件提供本地路径，由 Pi 按需使用工具读取。模型需支持图片输入才能理解图片。

工具支持读取、创建、覆盖和精确修改文件；Windows 命令使用 PowerShell，其他桌面平台使用 Bash。项目内现有文件读取直接执行；文件修改、命令执行和项目外读取需要在工具记录中选择“允许本次”或“拒绝”。确认 2 分钟后过期，停止任务会取消尚未处理的确认。路径检查会解析符号链接；工具仍以当前用户权限运行，并非操作系统沙箱。

工具参数与输出保存在应用数据目录的 `tool-output/` 中。界面保留有界预览，较长内容按需分页加载；Pi 自身截断前的命令输出仍由 Pi 管理。MCP 和技能默认沿用本机 Pi 配置，设置中的开关作为 Pi Hearth 独立覆盖，仅作用于本应用启动的 Pi 运行时，不修改原有 Pi 配置。项目扩展不自动加载；客户端审批模块随 Rust 核心内嵌，加载失败时拒绝连接。

开发阶段通过 `pnpm install` 安装固定的 `@earendil-works/pi-coding-agent` 1.3.0。Rust 通过本机 Node.js 以 RPC 模式启动该包的 `dist/bundle/cli.js`，不查找或启动全局 `pi` 命令。应用依赖 Pi 运行时，但无需全局安装 Pi。

Rust 读取 `PI_CODING_AGENT_DIR` 或默认的 `~/.pi/agent` 配置，将凭证转换为子进程环境变量；原配置保持不变，密钥不传到前端，也不写入客户端的模型文件。该配置目录用于 Pi 运行时，不代表本机安装了全局命令。当前支持 API Key 和环境变量凭证，OAuth 与凭证命令后续接入。

会话使用 Pi 原生 JSONL 文件，遵循 Pi 默认目录、环境变量与已知项目的 `sessionDir` 设置；早期桌面专属目录的会话也会出现在列表中。列表每 15 秒及窗口重新获得焦点时静默同步，不显示自动刷新动画；空闲的当前会话发生外部变化时重新加载。重启恢复上次项目和会话，不自动重跑中断工具。当前生成期间需结束或停止后再切换会话，同一会话暂不支持与其他 Pi 客户端同时生成。

| 命令                      | 用途                                                              |
| ------------------------- | ----------------------------------------------------------------- |
| `pnpm desktop`            | 启动 Tauri 桌面开发环境                                           |
| `pnpm dev`                | 启动浏览器前端预览                                                |
| `pnpm build`              | 类型检查并构建前端                                                |
| `pnpm desktop:build`      | 构建桌面应用与安装包                                              |
| `pnpm check`              | 类型、Lint、前端测试与格式检查                                    |
| `pnpm check:rust`         | 检查 Rust 桌面核心                                                |
| `pnpm test:rust`          | Rust 协议、凭证与状态测试                                         |
| `pnpm test:rpc:live`      | 使用本机模型验证多轮、流式和停止，会产生真实 API 请求             |
| `pnpm test:tools:live`    | 在隔离测试目录验证文件工具、命令、拒绝与停止，会产生真实 API 请求 |
| `pnpm test:sessions`      | 验证原生会话目录发现与历史解析                                    |
| `pnpm test:sessions:live` | 使用本机模型验证项目指令、会话隔离与历史续聊，会产生真实 API 请求 |
| `pnpm format:rust`        | 检查 Rust 格式                                                    |

前端代码位于 `src/`，桌面核心位于 `src-tauri/`。`src/components/ui/` 保存 shadcn/ui 官方 Base UI 版组件源码，`components.json` 使用 `base-nova`。组件源码在仓库内维护；添加组件时参照官方 Base UI 版本，并沿用现有样式。项目不安装 shadcn CLI，避免引入其尚无补丁的传递依赖。

Linux 的 GTK3 仍依赖 GLib 0.18。`src-tauri/vendor/security-patches.json` 记录官方安全补丁的回移、旧宏依赖的移除和单实例插件的 zbus 6 适配，以及原始包校验值。GLib 保留原版本号，按版本扫描的工具可能仍会告警；实际使用的是仓库内已修复的源码。上游提供兼容版本后应移除对应本地补丁。

Linux 回归入口为 `tests/linux-security/check.sh`。使用同目录的 Dockerfile 创建验证环境，将仓库只读挂载到 `/workspace`，再在容器中执行该脚本；覆盖应用编译、优化构建下的 GLib 字符串迭代、宏错误提示和真实 D-Bus 单实例转发。
