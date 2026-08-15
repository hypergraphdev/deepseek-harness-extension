# DeepSeek Harness 浏览器扩展

[English](README.md) | 中文

本地 dsh web 应用的静态 MV3 侧边栏外壳。面板拨号 `ai.deepseek.dsh` native-messaging 宿主（`dsh browser-host`），后者复用或以分离方式启动 3080 端口上的 `dsh web` server 并报告其 URL；面板随后用 iframe 把自己交给该 URL。内嵌应用与 server 同源，其 RPC 与 WebSocket 连接与普通标签页一样通过 server 的浏览器信任栅栏——扩展自身除 `sidePanel` 与 `nativeMessaging` 外不持有任何能力。

## 安装

1. 以未打包方式加载本目录：`chrome://extensions` → 开发者模式 → *加载已解压的扩展程序* → `apps/extension`，记下生成的扩展 id。
2. 注册一次 native host：`dsh install-browser-host --extension <id>`（Edge 加 `--browser edge`；目前仅支持 macOS）。
3. 点击工具栏图标。server 未运行时面板会将其启动，就绪后嵌入；未注册宿主时面板会显示这份指引。

本目录刻意不放 `package.json`：它不是工作区成员、不发布、也无需构建——浏览器按原样加载这些文件。

## Known Limitations and Deferred Work

- **仅支持 macOS 的 Chrome/Edge。** Linux/Windows 的清单路径与 `.bat` shim 待有需要时再补；Firefox 使用不同的清单键（`allowed_extensions`），不在范围内。
- **固定默认端口。** shim 在安装时记录 `--port`；面板没有会话级端口选择。
- **没有自动化扩展测试。** native host 协议、探测、启动与安装产物由 `apps/cli/tests/browser-host.spec.ts` 覆盖；面板脚本本身靠手工验证，仓库尚无 MV3 测试基建。
- **未做商店打包。** 图标、版本管理与商店发布均延后；扩展从仓库以未打包方式加载。
