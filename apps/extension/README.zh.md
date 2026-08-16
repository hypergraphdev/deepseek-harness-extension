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

## 页面抓取

面板的抓取按钮把活动标签页提取为 Markdown——标题、表格、代码块、列表、链接与图片地址都以结构保留——外加用户当时高亮选中的内容。它作为一个文本部分随下一条提示发送，发送后即清空。

### 站点适配器

数字存在于图表自身数据流而非 DOM 中的页面需要站点适配器。适配器**属于你自己，不随仓库发布**：把旁边的 `site-adapters.example.json` 复制为 `site-adapters.json` 再编辑。每个条目匹配一个主机名，从 URL 或 DOM 中捕获值，可选地请求一个公开端点，并把解析后的载荷连同正文一起交给 agent。

```jsonc
{
  "name": "my-quotes",
  "match": "(^|\\.)example\\.com$",
  "capture": { "code": { "from": "url", "pattern": "/quote/(\\w+)", "group": 1 } },
  "request": "https://api.example.com/candles?symbol={code}",
  "extract": "\\((.*)\\)\\s*;?\\s*$"   // optional: unwrap a JSONP callback
}
```

#### 流式数据（`sniff`）

通过页面自身 WebSocket 推送序列的图表不会往 DOM 里放任何东西，因此没有请求可以取到它。这类适配器设置 `"sniff": true` 并列出要观察的主机：

```jsonc
{
  "name": "my-chart",
  "match": "(^|\\.)example\\.com$",
  "sniff": true,
  "sniffMatches": ["https://*.example.com/*"]
}
```

后台 worker 随后仅为这些主机把 `stream-sniffer.js` 注册为 `document_start` 时机的 MAIN-world 内容脚本——早到足以在页面建立连接前包裹 `window.WebSocket`。它只读取经过的帧，绝不修改、拦截或发送任何内容；解码出的序列存放在 `window.__dshStream` 上等待抓取读取。编辑该文件后需重新加载扩展让注册跟上，并在抓取前先打开图表：嗅探器只能看到它安装期间到达的帧。它解码的帧格式是 TradingView 的；其他流的形态需要各自的嗅探器。

`site-adapters.json` 已被 git 忽略。引擎本身不了解任何站点；没有该文件时，抓取只保留阅读模式，也永远不会注册任何页面脚本。
