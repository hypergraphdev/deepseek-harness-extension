# Agent Note: 经 native-messaging 启动器的浏览器扩展

Status: implemented

[English](2026-08-15-browser-extension-native-host.md) | 中文

## 问题

在浏览器里使用 dsh 需要手动在终端跑 `pnpm dsh web` 并盯住打印的 URL。浏览器扩展能让产品一键可达并在后续获得网页上下文，但扩展不能监听端口、不能创建进程、不能触碰文件系统——而这些正是 dsh 依赖的全部本地能力——纯扩展移植会掏空产品。

## 决策

**在现有 web 应用之上做薄侧边栏外壳，由 native-messaging 启动器供电。** 扩展（`apps/extension`，静态 MV3，无构建）拨号已注册的 `ai.deepseek.dsh` 宿主；`dsh browser-host` 收到 `{type:'ensure'}` 后复用或以分离方式启动 `dsh web` 并回复其 URL；面板用 iframe 嵌入该 URL。内嵌应用与 server 同源，现有浏览器信任栅栏（Host/Origin/Sec-Fetch-Site）原样通过，server 端零改动——server 不发送任何阻止嵌入的响应头，就绪契约就是监督进程已在消费的 `dsh web: http://…` stdout 行。

**复用检测靠协议签名而非端口假设。** 对 `/api/events.mux` 的普通 GET 只有 dsh server 会回 `426 Upgrade Required`；任何其他响应都以明确诊断拒绝，而不是把陌生服务嵌进面板。

**安装器写入的是重跑即自愈的 dsh 托管产物。** `dsh install-browser-host --extension <id>` 覆盖写 `$DSH_HOME/browser-host/` 下的 `#!/bin/sh` shim（钉住 `process.execPath`、`execArgv` 与入口绝对路径——按仓库的 Windows 可生成性规则，绝不指向 npm 的 `.bin` shim），并在 macOS 的 NativeMessagingHosts 目录为每个浏览器写一份清单，`allowed_origins` 锁定给定扩展 id。

## 后果

- 扩展只持有 `sidePanel` + `nativeMessaging`；所有 agent 能力仍在用户启动的本地进程中，`dsh web` 的安全姿态不变。
- 被启动的 server 是分离进程，寿命长于 native host；关闭面板不会停掉它。
- `apps/extension` 刻意不带 `package.json`：加了就会被 `check-workspace-constraints` 强制为公开发布的工作区成员，这个静态目录并不需要。
- CLI 按既有 commander/dispatch 模式新增两个模式（`browser-host`、`install-browser-host`）。

## 曾考虑的替代方案

**纯扩展内 agent 运行时。** 暂不采用：它放弃 shell、子进程、LSP 与原生沙箱，还需要尚不存在的浏览器侧 provider（IndexedDB 持久化、File System Access）；插件化架构把这条路留作日后的 browser profile。

**在 native-messaging stdio 上直接跑 RPC 协议。** 不采用：它在宿主到浏览器单条 1 MB 上限之下重复一套传输，而启动器模式原样复用现有 WebSocket 传输与 boot-manifest 注入。

**扩展页面直接 fetch server。** 不采用：信任栅栏按设计拒绝 `chrome-extension://` 来源，为此开白名单只会扩大 server 的跨源面，相比同源 iframe 没有任何收益。
