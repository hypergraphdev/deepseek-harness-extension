# @deepseek-ai/dsh-tool-hxa

English | [中文](README.zh.md)

Consumer of `ctx.hxa`: the model-facing HXA tools. Registration is endpoint-gated — while the connection is dormant at plugin load, no tool and no prompt section exists, so an unconfigured deployment spends zero tokens on this package.

| Tool | Behavior |
|---|---|
| `hxa_contacts` | List org peers with role/bio and presence; optional fuzzy query. |
| `hxa_send` | Direct-message one peer by bot name; returns the channel receipt. |
| `hxa_inbox` | Drain events since the last check: thread invitations and status changes as lines, unread DM channels expanded into recent messages (bounded by `maxInboxChannels` × `maxChannelMessages`). |

## Configuration

| Field | Meaning |
|---|---|
| `maxInboxChannels` | Unread channels expanded per inbox check (default 5); overflow is named but not expanded. |
| `maxChannelMessages` | Messages fetched per expanded channel (default 20). |

## Model Experience

### Org prompt section

#### What the model sees

While a live endpoint exists, the `tool:hxa` section (order 150) teaches the agent its org membership:

##### Section text

```markdown
You are a member of your user's HXA Connect organization: a hub where the user's other agents (teammates) are reachable as bots.
Use hxa_contacts to see who exists and who is online, hxa_send to direct-message a teammate (delegate work, ask questions, follow up), and hxa_inbox to collect messages and events that arrived since you last checked.
Teammates reply asynchronously: after delegating, check hxa_inbox later in the conversation (or when the user asks for status) instead of blocking.
You speak in the user's name; route decisions that are irreversible or outward-facing back to the user before committing.
```

#### Token effect

Fixed section cost on every request while the bridge is live; a dormant hub adds nothing.

#### KV Cache effect

Prefix-stable while the endpoint stays configured; configuring or clearing the hub remounts the tools and invalidates the prefix.

### Tool schemas and results

#### What the model sees

The generated [`hxa_contacts`, `hxa_inbox`, and `hxa_send` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-hxa). Results render as text: the roster with online state, the inbox digest since the last check, and a send acknowledgement.

#### Token effect

Fixed schema cost per request while registered; result size scales with the roster and with how much arrived since the model last drained the inbox, bounded by the configured expansion caps.

#### KV Cache effect

Append-only; results follow the reusable request prefix and do not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- The inbox watermark is process-local: a restart re-reads the default window instead of resuming durably.
- Replies arrive only when the model checks `hxa_inbox`; push delivery into the agent inbox is the planned sibling Consumer.
- No thread participation tools yet (create/join/messages/artifacts).
