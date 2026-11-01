# Windows 安装包

支持 Windows x64（`x86_64-pc-windows-msvc`）。安装包随附 Node.js 24.21.0、Pi 1.3.0、Pi 的生产依赖和上游许可证。用户无需安装 Node.js、pnpm、Rust、MSVC、全局 Pi 或 CC Switch；模型和凭证仍需配置，Git、Python 等任务工具按项目需要安装。

## 构建

在已具备 Rust、MSVC 和 Windows SDK 的开发机执行：

```powershell
pnpm install --frozen-lockfile
pnpm desktop:build
```

Tauri 的 Windows 构建钩子自动运行 `pnpm runtime:prepare` 和前端构建。`pnpm desktop:build` 成功后会把当前版本的 Windows x64 安装包复制到项目根目录的 `release/`，例如 `release/Pi Hearth_0.1.0_x64-setup.exe`；同版本再次构建会覆盖该文件，其他版本不自动删除。该目录已加入 Git 忽略规则。编译缓存与 Tauri 原始产物仍位于 `src-tauri/target/`；单独执行 `pnpm tauri build` 或 `pnpm tauri bundle` 时，安装包仍输出到 `src-tauri/target/release/bundle/nsis/`。

首次构建需要联网下载官方 Node.js 和 Tauri 安装工具；Node.js 缓存在 `work/downloads/`，按版本文件中的 SHA-256 校验。校验失败时停止构建。

Node.js 版本与校验值位于 `runtime/windows-runtime.json`。Pi 版本同时锁定在根项目和 `runtime/package.json`，构建时检查一致性。通过 pnpm 的锁文件部署生产依赖，使用真实目录布局，检查并拒绝链接回开发环境的符号链接或目录联接。现有依赖安全覆盖和补丁继续生效。

运行时先在临时目录完成检查，再发布到 `src-tauri/bundle-runtime/`。该目录为生成资源，不提交二进制依赖；`.gitkeep` 仅使新检出的开发构建具有有效资源目录。

## 安装与启动

NSIS 安装包按当前用户安装，使用 Pi Hearth 图标与品牌图片，直接进入简体中文欢迎页，无语言选择弹窗。首次安装为“欢迎 → 选择位置 → 安装 → 完成”四步：欢迎页点击“下一步”，选择位置后点击“安装”；选择位置时可用“上一步”返回欢迎页。已有安装时保留维护与覆盖安装选择。安装成功后自动显示完成页，可选择启动应用与创建桌面快捷方式。静默与被动安装跳过欢迎页。

默认安装位置为 `%LOCALAPPDATA%\Programs\Pi Hearth`，可通过输入框或“浏览”修改。程序文件与既有应用数据目录分开；重新安装沿用之前的安装位置。卸载默认保留会话与配置，可选清理安装位置记录与旧版应用标识对应的数据。

随包嵌入 WebView2 Bootstrapper：系统已有 WebView2 时复用，缺少时由安装流程下载并安装，因此首次安装 WebView2 需要联网。安装包未做代码签名。

## 安装界面维护

界面配置位于 `src-tauri/tauri.windows.conf.json`，中文提示与安装模板位于 `src-tauri/installer/`。模板基于 [Tauri CLI 2.12.4 的官方模板](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.4/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi)（Git blob `75efe3da953fb6914a08359705d94d9ee8732542`），沿用其安装、更新、WebView2、快捷方式与卸载流程；MIT 许可随源码保留。自定义部分为品牌、中文欢迎与完成页、成功后直接显示完成页、默认程序目录，以及发布者名称变更后从卸载记录恢复旧安装路径。升级 CLI 时需对照上游模板合并修复，再验证安装与卸载。

安装窗口使用 `compact-ui.rc` 定义的紧凑布局，窗口高度从 222 缩至 198 个对话框单位，按 Windows 字体和 DPI 自动缩放；目录输入、进度、欢迎页与完成页一并适配。`appearance.nsh` 为欢迎页和完成页提供一致的小标志、原生品牌文字与侧栏布局，离开欢迎页时恢复普通页顶栏；两个完成选项按原生复选框高度紧凑排列。

品牌标志直接从 `public/pi.svg` 绘制为高分辨率位图，标题图片为 192 × 192，侧图为 492 × 846；“Pi Hearth”等品牌文字由 Windows 原生控件绘制，避免整张低分辨率图片被放大。BMP 和仅含窗口资源的 `compact-ui.dll` 提交到仓库，正常打包无需重新生成。

修改图标或窗口布局后，在已有 MSVC 与 Windows SDK 的 Windows 开发机执行：

```powershell
./scripts/generate-installer-assets.ps1
```

生成脚本会调用 SDK 的 `rc.exe` 和 MSVC 的 `link.exe`。资源 DLL 没有入口点或可执行代码，NSIS 仅提取其中的对话框。NSIS Modern UI 资源的上游版本标识保留在源码注释中，许可位于 `LICENSE.nsis.txt`；升级 NSIS 时需检查窗口资源兼容性。

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

同时检查真实安装窗口的中文排版、安装位置输入与浏览、完成页，以及带中文和空格的自定义目录安装、重装后的路径恢复、快捷方式和默认保留数据的卸载行为。

这可验证脱离开发目录和系统 Node.js 后的运行链路；不同 Windows 系统版本与缺少 WebView2 的全新系统仍需单独验证。
