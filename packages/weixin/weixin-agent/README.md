# @deepseek-ai/dsh-weixin-agent

Consumer of `ctx.weixin` and `ctx.agents`: WeChat as a conversation with the harness agent. An inbound message wakes a dedicated agent, and the assistant text that closes that turn is sent straight back to whoever wrote in.

The reply travels through this bridge rather than a tool, because the conversation has exactly one destination — the sender. The model therefore needs no WeChat vocabulary. Dormant while no account is linked, and the agent handle's failure never costs the WeChat connection.

## Configuration

| Field | Meaning |
|---|---|
| `sessionId` | Stable id for the WeChat agent (default `weixin-main`); reused across restarts. |
| `provider` / `model` | Agent route; omitted uses the deployment default. |
| `replyMaxChars` | Cap on one outbound reply (default 2000); longer text is truncated. |

## Model Experience

The agent carries a scoped `weixin:persona` prompt section (order 0) telling the model it is answering in a chat app: write plain text, no Markdown, because WeChat renders none of it and headings, bullets, and fences arrive as literal characters. Each inbound message enters the agent's session as a plugin-sourced `notice` user message, so it is durable and model-visible, satisfying the model-visible ⟺ logged rule. The assistant text closing each turn is the reply the bridge sends back to the sender; the model issues no send call of its own.

## Known Limitations and Deferred Work

- The reply is the turn's final assistant text, so a turn that produces only tool output sends nothing back.
- One shared agent serves every WeChat sender, so separate people share one conversation and its history.
- A reply longer than `replyMaxChars` is truncated rather than split across messages.
