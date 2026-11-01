# 第三方许可说明

Pi Hearth 自有代码采用根目录的 [MIT 许可证](LICENSE)。第三方代码、字体、工具和运行时继续适用各自的许可证；根许可证不替换这些组件的原有条款与版权声明。

## 仓库内保留的第三方源码

- `src-tauri/vendor/` 中的 GLib、GLib macros 和 GTK3 macros 保留各目录的 MIT 许可；单实例插件保留其 MIT / Apache-2.0 许可文件。修改记录见 [security-patches.json](src-tauri/vendor/security-patches.json)。
- Tauri 安装模板的上游许可见 [LICENSE.tauri.txt](src-tauri/installer/LICENSE.tauri.txt)。
- NSIS Modern UI 窗口资源的许可与来源见 [LICENSE.nsis.txt](src-tauri/installer/LICENSE.nsis.txt)。
- Pi 上游的 MIT 版权与许可声明见 [pi-MIT.txt](runtime/licenses/pi-MIT.txt)。

## 随 Windows 安装包分发的运行时

Node.js、Pi 及其生产依赖保留各自的许可声明。构建时会将这些声明随运行时一起打包，安装目录内的 `runtime/THIRD_PARTY_NOTICES.md`、`runtime/node/LICENSE`、`runtime/licenses/` 和各依赖的许可文件可供查阅。打包过程见 [Windows 打包文档](docs/windows-packaging.md)。

## 其他依赖

前端与 Rust 依赖的具体版本由 `pnpm-lock.yaml` 和 `src-tauri/Cargo.lock` 锁定，许可证以各组件随附的声明为准。例如，Geist 字体采用 SIL OFL-1.1，Lucide 图标采用 ISC，shadcn/ui 组件采用 MIT。这些依赖的许可不会因 Pi Hearth 开源而改变。
