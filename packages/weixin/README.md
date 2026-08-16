# weixin/

English | [中文](README.zh.md)

The WeChat capability family: the harness agent reachable from its human's WeChat — a QR scan links one account, and messages to it become turns for an agent that answers in the chat.

| Package | ctx key | Role |
|---|---|---|
| [`weixin`](weixin/README.md) | `ctx.weixin` | Service Definition + iLink client Provider: QR login, the durable credential, the long-poll receive loop, and text send |
| [`weixin-agent`](weixin-agent/README.md) | — | Consumer: the conversation bridge — an inbound message wakes a dedicated agent, whose closing assistant text is sent back to the sender |

The seam is dormant until an account is linked: with no credential under the harness home, `ctx.weixin` receives nothing and no consumer activates. Linking happens once, through the settings page's QR panel; a restart resumes from the stored credential without another scan.
