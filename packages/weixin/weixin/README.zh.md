# @deepseek-ai/dsh-weixin

[English](README.md) | 中文

微信能力（`ctx.weixin`）的 Service Definition 与 Provider：经 iLink Bot 线协议连接一个扫码绑定的微信账号——绑定（`startLink`、`status`、`unlink`）、入站投递（`weixin/message`）与出站文本（`send`）。

## 配置

| 字段 | 含义 |
|---|---|
| `retryDelayMs` | 单次轮询失败后的重试延迟（默认 2000）。 |
| `backoffDelayMs` | 连续三次失败后的退避延迟（默认 30000）。 |

绑定是一次性动作：扫码产出的 bot token 以 0600 权限存放在 harness home 下，重启后无需再次扫码即可继续接收。`status()` 报告已绑定的账号或待渲染的扫码挑战；未绑定时的任何发送都抛出携带 `WEIXIN_NOT_LINKED` 代码的 `WeixinError`，线协议侧的拒绝携带 `WEIXIN_API`。服务端会话过期会解绑账号并以 `false` 发出 `weixin/link`，人由此得知需要重新扫码。接收游标在投递前持久化，崩溃后是重投而不是跳过。

## Model Experience

None, as 该连接服务不注册任何提示词、schema 或结果文本；绑定账号后的模型可见对话由 `dsh-weixin-agent` 拥有。

#### KV Cache effect

无；该服务既不组装也不发送任何 provider 请求。

## Known Limitations and Deferred Work

- 仅支持文本消息：图片、语音与文件没有媒体管线，非文本入站内容在边界处丢弃。
- 每个 harness home 只能绑定一个账号；凭据文件只保存一条链接。
- 仅支持私聊：群聊既不接收也不可寻址。
- bot token 以 0600 普通文件存放在 harness home 下，而不是经由 `ctx.credentials`。
