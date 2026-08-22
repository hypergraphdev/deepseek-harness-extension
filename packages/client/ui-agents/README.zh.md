# @deepseek-ai/dsh-client-ui-agents

[English](README.md) | 中文

侧边栏团队面板：只读展示用户 HXA 组织的成员名册，每个队友机器人一行，带在线状态圆点与可选角色。浏览器半侧占据侧边栏的 `sidebar.agents` 席位（由 [dsh-client-ui-sidebar](../ui-sidebar/README.zh.md) 声明），并注册 `agents` 语言包命名空间；node 半侧是空的 `apply`，仅让插件可以从 host cordis.yml 挂载，浏览器 bundle 经 package.json 的 `dsh.client` 声明被发现。

名册数据来自 host 的 `/api/hxa/contacts` 路由，由 [web-app bundle](../../bundle/web-app/README.zh.md) 基于 `ctx.hxa` 提供，面板挂载期间每 20 秒轮询一次。404（未组合 HXA）或 host 不可达时渲染空内容，因此未配置的部署不为该席位付出任何像素；侧边栏折叠为图标栏时面板同样隐藏。

## Model Experience

无：面板是浏览器侧对 host 名册路由的只读渲染，不注册任何模型可见内容。

#### KV Cache 影响

无；面板既不组装也不发送提供方请求。

## Known Limitations and Deferred Work

- **在线状态仅靠轮询** — 名册按固定 20 秒间隔刷新，没有推送通道，在线状态翻转最多滞后一个间隔；且只要面板保持挂载，即使 host 处于休眠也会持续轮询。
- **刷新失败会清空面板** — 任何 fetch 或解析失败都会把名册重置为未加载状态，整个面板随之消失，直到下一次轮询成功，而不是继续展示最近一次已知的名册。
