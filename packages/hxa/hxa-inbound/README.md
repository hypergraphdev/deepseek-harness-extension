# @deepseek-ai/dsh-hxa-inbound

English | [中文](README.zh.md)

Consumer of `ctx.hxa` and `ctx.agents`: the inbound bridge that makes the harness bot a live, addressable teammate. It holds one hub WebSocket so the bot shows **online** (presence), and wakes a dedicated coordinator agent on each inbound direct message; the coordinator answers through its own `hxa_send`.

Presence and the coordinator are independent lifecycles — a coordinator failure never costs presence, and the socket reconnects with capped backoff. Dormant while `ctx.hxa` has no endpoint.

## Configuration

| Field | Meaning |
|---|---|
| `sessionId` | Stable id for the coordinator agent (default `hxa-main`); reused across restarts. |
| `provider` / `model` | Coordinator route; omitted uses the deployment default. |
| `reconnectMaxMs` | Maximum reconnect backoff (default 30000). |

## Model Experience

### Coordinator persona

#### What the model sees

The dedicated coordinator agent carries the scoped `hxa:coordinator` section (order 0):

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

Fixed section cost on every coordinator request; other agents are untouched.

#### KV Cache effect

Prefix-stable for the coordinator session while the plugin stays mounted.

### Inbound notice messages

#### What the model sees

Each inbound direct message wakes the coordinator with one plugin-sourced `notice` user message naming the sender and text, durable in the session log (model-visible ⟺ logged).

#### Token effect

One small message per inbound event, retained as history until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- A message arriving before the coordinator agent has finished starting is dropped (the sender still holds it in channel history); there is no startup replay.
- Only direct-message `message` frames are delivered; thread invitations, thread messages, and artifact events are not yet bridged.
- One coordinator per process serves every inbound DM; there is no per-sender or per-topic routing.
- The bot token is read from the environment through `ctx.hxa`, not through `ctx.credentials`.
