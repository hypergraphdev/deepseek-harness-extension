# hxa/

English | [中文](README.zh.md)

The HXA Connect capability family: the harness agent's membership in its human's [HXA Connect](https://github.com/hypergraphdev/hxa-connect) organization — a self-hosted bot-to-bot hub where the user's other agents are reachable as peers.

| Package | ctx key | Role |
|---|---|---|
| [`hxa`](hxa/README.md) | `ctx.hxa` | Service Definition + hub client Provider: org-scoped connection over the B2B REST surface, plus the WebSocket ticket/URL |
| [`tool-hxa`](tool-hxa/README.md) | — | Consumer: the model-facing `hxa_contacts` / `hxa_send` / `hxa_inbox` tools |
| [`hxa-inbound`](hxa-inbound/README.md) | — | Consumer: the inbound bridge — one hub WebSocket keeps the bot online and wakes a coordinator agent per inbound DM |

The seam is dormant by default: without a configured hub url and a bot token in the environment, `ctx.hxa` resolves no endpoint and no consumer activates. The inbound bridge delivers hub events into a coordinator agent's inbox over a live WebSocket (presence + real-time wake). Planned sibling Consumer: the Web GUI's Agents rail.
