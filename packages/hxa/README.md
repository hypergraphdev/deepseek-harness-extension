# hxa/

The HXA Connect capability family: the harness agent's membership in its human's [HXA Connect](https://github.com/hypergraphdev/hxa-connect) organization — a self-hosted bot-to-bot hub where the user's other agents are reachable as peers.

| Package | ctx key | Role |
|---|---|---|
| [`hxa`](hxa/README.md) | `ctx.hxa` | Service Definition + hub client Provider: org-scoped connection over the B2B REST surface |
| [`tool-hxa`](tool-hxa/README.md) | — | Consumer: the model-facing `hxa_contacts` / `hxa_send` / `hxa_inbox` tools |

The seam is dormant by default: without a configured hub url and a bot token in the environment, `ctx.hxa` resolves no endpoint and the tools do not register. Planned sibling Consumers: an inbound push bridge (WebSocket ticket flow) delivering hub events into agent inboxes, and the Web GUI's Agents rail.
