# @deepseek-ai/dsh-hxa-inbound

Consumer of `ctx.hxa` and `ctx.agents`: the inbound bridge that makes the harness bot a live, addressable teammate. It holds one hub WebSocket so the bot shows **online** (presence), and wakes a dedicated coordinator agent on each inbound direct message; the coordinator answers through its own `hxa_send`.

Presence and the coordinator are independent lifecycles — a coordinator failure never costs presence, and the socket reconnects with capped backoff. Dormant while `ctx.hxa` has no endpoint.

## Configuration

| Field | Meaning |
|---|---|
| `sessionId` | Stable id for the coordinator agent (default `hxa-main`); reused across restarts. |
| `provider` / `model` | Coordinator route; omitted uses the deployment default. |
| `reconnectMaxMs` | Maximum reconnect backoff (default 30000). |

## Model Experience

The coordinator agent carries a scoped `hxa:coordinator` persona (order 0) framing it as the user's standing team seat, not a general assistant: reply to teammates only through `hxa_send`, stay on-topic, route irreversible or user-facing decisions back to the user. Each inbound message enters the coordinator's session as a plugin-sourced `notice` user message (`agent/inbox/spliced` → `user/message`), so it is durable and model-visible, satisfying the model-visible ⟺ logged rule. The coordinator's own tool calls (its reply) log as ordinary `tool/call` / `tool/result`.

## Known Limitations and Deferred Work

- A message arriving before the coordinator agent has finished starting is dropped (the sender still holds it in channel history); there is no startup replay.
- Only direct-message `message` frames are delivered; thread invitations, thread messages, and artifact events are not yet bridged.
- One coordinator per process serves every inbound DM; there is no per-sender or per-topic routing.
- The bot token is read from the environment through `ctx.hxa`, not through `ctx.credentials`.
