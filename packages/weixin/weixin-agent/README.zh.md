# @deepseek-ai/dsh-weixin-agent

[English](README.md) | 中文

`ctx.weixin` 与 `ctx.agents` 的 Consumer：把微信变成与 harness agent 的对话。入站消息唤醒专属 agent，该回合收尾的 assistant 文本径直回送给来信的人。

回复经由这座桥而不是工具，因为对话有且只有一个目的地——发信人。模型因此不需要任何微信词汇。未绑定账号时保持休眠：agent 由第一条入站消息创建，因此从未绑定过账号的部署不会为微信留下任何会话。agent 句柄的失败也绝不连累微信连接。

## 配置

| 字段 | 含义 |
|---|---|
| `sessionId` | 微信 agent 的稳定 id（默认 `weixin-main`）；跨重启复用。 |
| `provider` / `model` | agent 路由；缺省用部署默认值。 |
| `replyMaxChars` | 单条出站回复的上限（默认 2000）；更长的文本被截断。 |

## Model Experience

### 聊天人格

#### What the model sees

微信 agent 携带作用域限定的 `weixin:persona` 段（order 0）：

##### Section text

```markdown
You are answering in the user's WeChat. Every message you receive was sent by a person in a chat app, and your reply is delivered straight back to that chat.
Write like a chat message: short, plain, no Markdown — WeChat renders none of it, so headings, bullets, and code fences arrive as literal characters.
You have this workstation's tools. Use them when the request needs real work, then report the outcome in a sentence or two rather than pasting raw output.
You speak in the user's name; route irreversible or outward-facing decisions back to them instead of acting alone.
```

#### Token effect

微信 agent 的每个请求承担固定的段落成本；其他 agent 不受影响。

#### KV Cache effect

插件保持挂载期间，微信会话前缀稳定。

### 入站 notice 与回复路径

#### What the model sees

每条入站微信消息以一条插件来源的 `notice` 用户消息进入会话，持久化于日志（模型可见 ⟺ 已记录）。回合收尾的 assistant 文本就是桥回送的回复；模型自身不发出任何发送调用。

#### Token effect

每条入站文本一条小消息，作为历史保留至压缩；回复除回合自身的 assistant 文本外不增加任何内容。

#### KV Cache effect

仅追加；新增可见内容跟在可复用请求前缀之后，不使既有 KV-cache 条目失效。

## Known Limitations and Deferred Work

- 回复取自回合最终的 assistant 文本，只产生工具输出的回合不会回送任何内容。
- 一个共享 agent 服务所有微信发信人，不同的人共用一段对话及其历史。
- 超过 `replyMaxChars` 的回复被截断，而不是拆成多条消息。
