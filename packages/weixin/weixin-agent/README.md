# @deepseek-ai/dsh-weixin-agent

English | [中文](README.zh.md)

Consumer of `ctx.weixin` and `ctx.agents`: WeChat as a conversation with the harness agent. An inbound message wakes a dedicated agent, and the assistant text that closes that turn is sent straight back to whoever wrote in.

The reply travels through this bridge rather than a tool, because the conversation has exactly one destination — the sender. The model therefore needs no WeChat vocabulary. Dormant while no account is linked: the agent is created by the first inbound message, so a deployment that never links an account persists no session for WeChat. The agent handle's failure never costs the WeChat connection.

## Configuration

| Field | Meaning |
|---|---|
| `sessionId` | Stable id for the WeChat agent (default `weixin-main`); reused across restarts. |
| `provider` / `model` | Agent route; omitted uses the deployment default. |
| `replyMaxChars` | Cap on one outbound reply (default 2000); longer text is truncated. |

## Model Experience

### Chat persona

#### What the model sees

The WeChat agent carries the scoped `weixin:persona` section (order 0):

##### Section text

```markdown
You are answering in the user's WeChat. Every message you receive was sent by a person in a chat app, and your reply is delivered straight back to that chat.
Write like a chat message: short, plain, no Markdown — WeChat renders none of it, so headings, bullets, and code fences arrive as literal characters.
You have this workstation's tools. Use them when the request needs real work, then report the outcome in a sentence or two rather than pasting raw output.
You speak in the user's name; route irreversible or outward-facing decisions back to them instead of acting alone.
```

#### Token effect

Fixed section cost on every request of the WeChat agent; other agents are untouched.

#### KV Cache effect

Prefix-stable for the WeChat session while the plugin stays mounted.

### Inbound notices and the reply path

#### What the model sees

Each inbound WeChat message enters the session as one plugin-sourced `notice` user message, durable in the log (model-visible ⟺ logged). The assistant text closing the turn is the reply the bridge sends back; the model issues no send call of its own.

#### Token effect

One small message per inbound text, retained as history until compaction; the reply adds nothing beyond the turn's own assistant text.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- The reply is the turn's final assistant text, so a turn that produces only tool output sends nothing back.
- One shared agent serves every WeChat sender, so separate people share one conversation and its history.
- A reply longer than `replyMaxChars` is truncated rather than split across messages.
