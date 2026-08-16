# @deepseek-ai/dsh-weixin

English | [中文](README.zh.md)

Service Definition and Provider for the WeChat capability (`ctx.weixin`): one QR-linked WeChat account over the iLink Bot wire protocol — linking (`startLink`, `status`, `unlink`), inbound delivery (`weixin/message`), and outbound text (`send`).

## Configuration

| Field | Meaning |
|---|---|
| `retryDelayMs` | Delay before retrying after a failed poll (default 2000). |
| `backoffDelayMs` | Delay after three consecutive failures (default 30000). |

Linking is a one-time act: the scan yields a bot token stored 0600 under the harness home, so a restart resumes receiving without another QR. `status()` reports the linked account or the pending challenge to render; every send on an unlinked service throws `WeixinError` with code `WEIXIN_NOT_LINKED`, and wire refusals carry `WEIXIN_API`. A server-side session expiry unlinks the account and emits `weixin/link` with `false`, so a human knows to scan again. The receive cursor is persisted before delivery, so a crash redelivers rather than skips.

## Model Experience

None, as the connection service registers no prompt, schema, or result text; `dsh-weixin-agent` owns the model-visible conversation a linked account enables.

#### KV Cache effect

None; the service neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- Text messages only: images, voice, and files have no media pipeline, so non-text inbound content is dropped at the boundary.
- One linked account per harness home; the credential file holds a single link.
- Direct messages only: group chats are not received or addressable.
- The bot token is stored as a plain 0600 file under the harness home rather than through `ctx.credentials`.
