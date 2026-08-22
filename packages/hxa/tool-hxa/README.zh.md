# @deepseek-ai/dsh-tool-hxa

[English](README.md) | 中文

`ctx.hxa` 的 Consumer：面向模型的 HXA 工具。注册以 endpoint 为门槛——插件加载时连接若处于休眠，就不存在任何工具与提示词段，未配置的部署因此在本包上花费零 token。

| 工具 | 行为 |
|---|---|
| `hxa_contacts` | 列出组织内对等方及其角色/简介与在线状态；支持可选的模糊查询。 |
| `hxa_send` | 按 bot 名字向一个对等方发私信；返回频道回执。 |
| `hxa_inbox` | 取空自上次检查以来的事件：thread 邀请与状态变化以行呈现，未读私信频道展开为最近消息（受 `maxInboxChannels` × `maxChannelMessages` 约束）。 |

## 配置

| 字段 | 含义 |
|---|---|
| `maxInboxChannels` | 每次检查收件箱时展开的未读频道数（默认 5）；超出的只报名字不展开。 |
| `maxChannelMessages` | 每个展开频道抓取的消息数（默认 20）。 |

## Model Experience

### 组织提示词段

#### What the model sees

存在活跃端点时，`tool:hxa` 段（order 150）向 agent 说明其组织成员身份：

##### Section text

```markdown
You are a member of your user's HXA Connect organization: a hub where the user's other agents (teammates) are reachable as bots.
Use hxa_contacts to see who exists and who is online, hxa_send to direct-message a teammate (delegate work, ask questions, follow up), and hxa_inbox to collect messages and events that arrived since you last checked.
Teammates reply asynchronously: after delegating, check hxa_inbox later in the conversation (or when the user asks for status) instead of blocking.
You speak in the user's name; route decisions that are irreversible or outward-facing back to the user before committing.
```

#### Token effect

桥接存活期间每个请求承担固定的段落成本；休眠的 hub 不增加任何内容。

#### KV Cache effect

端点保持配置期间前缀稳定；配置或清除 hub 会重挂工具并使前缀失效。

### 工具 schema 与结果

#### What the model sees

生成的 [`hxa_contacts`、`hxa_inbox` 与 `hxa_send` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-hxa)。结果以文本呈现：带在线状态的名册、自上次查看以来的收件摘要，以及发送确认。

#### Token effect

注册期间每个请求承担固定的 schema 成本；结果大小随名册规模及自上次清空收件箱以来的消息量增长，受配置的展开上限约束。

#### KV Cache effect

仅追加；结果跟在可复用请求前缀之后，不使既有 KV-cache 条目失效。

## Known Limitations and Deferred Work

- 收件箱水位是进程内的：重启后重新读取默认窗口，而不是持久续读。
- 回复只在模型检查 `hxa_inbox` 时到达；推送投递进 agent 收件箱是计划中的同族 Consumer。
- 尚无 thread 参与工具（创建/加入/消息/artifact）。
