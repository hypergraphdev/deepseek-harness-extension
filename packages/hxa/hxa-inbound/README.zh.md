# @deepseek-ai/dsh-hxa-inbound

[English](README.md) | 中文

`ctx.hxa` 与 `ctx.agents` 的 Consumer：入站桥，让 harness bot 成为一名在线、可寻址的队友。它持有一条 hub WebSocket 使 bot 显示为**在线**（presence），并在每条入站私信上唤醒一个专属 coordinator agent；coordinator 经它自己的 `hxa_send` 作答。

在线状态与 coordinator 是相互独立的生命周期——coordinator 的失败绝不连累在线状态，socket 以带上限的退避重连。`ctx.hxa` 没有 endpoint 时保持休眠。

## 配置

| 字段 | 含义 |
|---|---|
| `sessionId` | coordinator agent 的稳定 id（默认 `hxa-main`）；跨重启复用。 |
| `provider` / `model` | coordinator 路由；缺省用部署默认值。 |
| `reconnectMaxMs` | 重连退避上限（默认 30000）。 |

## Model Experience

### 协调者人格

#### What the model sees

专属协调者 agent 携带作用域限定的 `hxa:coordinator` 段（order 0）：

##### Section text

```markdown
You are dsh-main, the user's standing seat on their HXA team. You are a coordinator, not a general assistant.
Teammate messages arrive as notices describing who sent what. For each one, decide whether it needs a reply to the teammate, an action, or the user's attention.
- To reply to a teammate, call hxa_send with their exact bot name. Keep replies brief and strictly on-topic: answer what was asked. Do NOT start unrelated conversations or ask the teammate your own questions unless the user's interest genuinely requires it.
- If a message needs the user rather than you, leave it for them instead of inventing a reply.
- If no response is warranted, do nothing.
You act in the user's name; route irreversible or outward-facing decisions back to the user.
```

#### Token effect

协调者的每个请求承担固定的段落成本；其他 agent 不受影响。

#### KV Cache effect

插件保持挂载期间，协调者会话前缀稳定。

### 入站 notice 消息

#### What the model sees

每条入站私信以一条插件来源的 `notice` 用户消息唤醒协调者，注明发信人与内容，并持久化于会话日志（模型可见 ⟺ 已记录）。

#### Token effect

每个入站事件一条小消息，作为历史保留至压缩。

#### KV Cache effect

仅追加；新增可见内容跟在可复用请求前缀之后，不使既有 KV-cache 条目失效。

## Known Limitations and Deferred Work

- coordinator agent 尚未完成启动时到达的消息会被丢弃（发送方仍在频道历史中持有它）；没有启动期重放。
- 只投递私信 `message` 帧；thread 邀请、thread 消息与 artifact 事件尚未接桥。
- 每个进程只有一个 coordinator 服务所有入站私信；没有按发送方或按主题的路由。
- bot token 经 `ctx.hxa` 从环境读取，而不是经由 `ctx.credentials`。
