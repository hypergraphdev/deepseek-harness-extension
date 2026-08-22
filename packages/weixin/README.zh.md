# weixin/

[English](README.md) | 中文

微信能力族：让 harness agent 能从其主人的微信触达——扫一次码绑定一个账号，发给它的消息成为 agent 的回合，agent 在聊天里作答。

| 包 | ctx 键 | 角色 |
|---|---|---|
| [`weixin`](weixin/README.zh.md) | `ctx.weixin` | Service Definition + iLink 客户端 Provider：扫码登录、持久凭据、长轮询接收循环与文本发送 |
| [`weixin-agent`](weixin-agent/README.zh.md) | — | Consumer：会话桥——入站消息唤醒专属 agent，其收尾的 assistant 文本回送给发信人 |

seam 在绑定账号前保持休眠：harness home 下没有凭据时，`ctx.weixin` 收不到任何东西，Consumer 也不会激活。绑定只做一次，通过设置页的扫码面板完成；重启后从存储的凭据恢复，无需再次扫码。
