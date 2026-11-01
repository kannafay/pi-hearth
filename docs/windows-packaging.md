# Windows 安装包

支持 Windows x64（`x86_64-pc-windows-msvc`）。安装包随附 Node.js 24.21.0、Pi 1.3.0、Pi 的生产依赖和上游许可证。用户无需安装 Node.js、pnpm、Rust、MSVC、全局 Pi 或 CC Switch；模型和凭证仍需配置，Git、Python 等任务工具按项目需要安装。

## 构建

在已具备 Rust、MSVC 和 Windows SDK 的开发机执行：

```powershell
pnpm install --frozen-lockfile
pnpm desktop:build
```

Tauri 的 Windows 构建钩子自动运行 `pnpm runtime:prepare` 和前端构建，产物位于 `src-tauri/target/release/bundle/nsis/`。首次构建需要联网下载官方 Node.js 和 Tauri 安装工具；Node.js 缓存在 `work/downloads/`，按版本文件中的 SHA-256 校验。校验失败时停止构建。

Node.js 版本与校验值位于 `runtime/windows-runtime.json`。Pi 版本同时锁定在根项目和 `runtime/package.json`，构建时检查一致性。通过 pnpm 的锁文件部署生产依赖，使用真实目录布局，检查并拒绝链接回开发环境的符号链接或目录联接。现有依赖安全覆盖和补丁继续生效。

运行时先在临时目录完成检查，再发布到 `src-tauri/bundle-runtime/`。该目录为生成资源，不提交二进制依赖；`.gitkeep` 仅使新检出的开发构建具有有效资源目录。

## 安装与启动

NSIS 安装包默认按当前用户安装，提供简体中文与英文界面。随包嵌入 WebView2 Bootstrapper：系统已有 WebView2 时复用，缺少时由安装流程下载并安装，因此首次安装 WebView2 需要联网。安装包未做代码签名，签名发行与自动更新后续接入。

```text
Pi Hearth.exe
runtime/
  manifest.json
  THIRD_PARTY_NOTICES.md
  licenses/              # Pi 上游许可证
  node/                  # Node.js、npm/npx、Node.js 许可证
  pi/                    # Pi、生产依赖、适配器及依赖许可证
```

运行时位置由应用可执行文件确定，不依赖工作目录。启动前检查资源和版本；异常时提示重新安装，不搜索系统 Node.js 或开发机的 `node_modules`。对话进程、历史会话、资源与模型查询、网络诊断、目录迁移统一使用随附 Node.js，并只在子进程中优先添加其目录到 PATH，不修改系统环境变量。隔离外部 `NODE_OPTIONS` 与 `NODE_PATH`。

应用数据和用户配置的既有目录保持不变。便携使用时必须保留完整的应用目录，不能只复制 EXE。`pnpm desktop:standalone` 用于生成包含本地前端的调试构建，同样需要配套运行时目录。

## 安装验证

先运行 `pnpm check`、`pnpm check:rust`、`pnpm test:rust`、`pnpm format:rust`，再实际构建安装包。在测试目录完成安装后运行：

```powershell
pnpm runtime:verify "D:\安装验证 空格\Pi Hearth" "D:\检查报告.json"
```

验证脚本从无开发工具 PATH 的独立临时目录启动安装后的 EXE，并注入不可用的外部 Node 配置，确认应用会忽略它。由应用自身解析并启动随附运行时，检查会话读取、资源与模型读取、本地 HTTP 网络测试、Pi RPC，以及审批和消息操作扩展的加载。测试只使用临时配置与本地 HTTP 服务，不调用付费模型或读取用户凭证。报告包含实际 Node.js 与 Pi 路径，必须都位于安装目录内。

这可验证脱离开发目录和系统 Node.js 后的运行链路；不同 Windows 系统版本与缺少 WebView2 的全新系统仍需单独验证。
