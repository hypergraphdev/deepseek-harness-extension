# @deepseek-ai/dsh-tool-hxa

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

Registers the `tool:hxa` prompt section (order 150) teaching org membership, asynchronous replies, and the rule that irreversible or outward-facing decisions route back to the user. Three tool schemas enter the prompt. `hxa_inbox` results scale with unread volume up to the configured bounds; the section and schemas are stable text, so KV-cache prefixes survive across steps.

## Known Limitations and Deferred Work

- The inbox watermark is process-local: a restart re-reads the default window instead of resuming durably.
- Replies arrive only when the model checks `hxa_inbox`; push delivery into the agent inbox is the planned sibling Consumer.
- No thread participation tools yet (create/join/messages/artifacts).
