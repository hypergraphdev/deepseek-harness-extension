# WeChat

[English](weixin.md) | 中文

`@deepseek-ai/dsh-weixin` 经 iLink Bot 线协议持有一个扫码绑定的微信账号：绑定、持久凭据、派发 `weixin/message` 的接收循环与出站文本。服务在通过设置页扫码面板绑定账号之前保持休眠；`dsh-weixin-agent` 将入站消息桥接给专属 agent，其收尾文本即聊天回复。记录形态随服务本体维护（[`packages/weixin/weixin`](../../packages/weixin/weixin/README.md)）。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxweixin--weixinruntime"></a>

### `ctx.weixin` — `WeixinRuntime`

The WeChat connection. One linked account per harness home; linking, receiving, and sending all run through this service.

```ts cordis-catalog
/**
 * The panel's view of the connection.
 * @returns whether an account is linked, plus any pending challenge.
 */
status(): WeixinStatus

/**
 * Begin linking: fetch a QR and poll it until the user confirms in
 * WeChat. Calling it while a challenge is pending returns that one.
 * @returns the payload to render as a QR image.
 * @throws WeixinError when the API refuses a challenge.
 */
async startLink(): Promise<string>

/** Drop the stored credential and stop receiving. */
unlink(): void

/**
 * Send one text message to a WeChat user.
 * @param toUserId - the recipient, normally an inbound message's sender.
 * @param text - the reply body.
 * @param contextToken - the conversation token from that user's message.
 * @throws WeixinError when no account is linked.
 */
async send(toUserId: string, text: string, contextToken?: string): Promise<void>

/**
 * Show or clear the typing indicator in one chat. Failures are swallowed:
 * the indicator is a courtesy, and losing it must never cost the reply.
 * @param toUserId - the chat to indicate in.
 * @param typing - true while composing, false to clear.
 */
async setTyping(toUserId: string, typing: boolean): Promise<void>
```

Source: [`packages/weixin/weixin/src/index.ts:90`](../../packages/weixin/weixin/src/index.ts)

<a id="weixin-events"></a>

### `weixin/*` events

<a id="weixinlink--emit"></a>

#### `weixin/link` — emit

The link state changed: a scan completed, or the credential was dropped or rejected.

```ts cordis-catalog
/**
 * The link state changed: a scan completed, or the credential was
 * dropped or rejected.
 * @mode emit
 * @param linked - whether an account is now linked.
 */
'weixin/link'(linked: boolean): void
```

Source: [`packages/weixin/weixin/src/index.ts:45`](../../packages/weixin/weixin/src/index.ts)

<a id="weixinmessage--emit"></a>

#### `weixin/message` — emit

One inbound WeChat message, after the receive loop accepted it.

```ts cordis-catalog
/**
 * One inbound WeChat message, after the receive loop accepted it.
 * @mode emit
 * @param message - the sender, text, and conversation token.
 */
'weixin/message'(message: InboundText): void
```

Source: [`packages/weixin/weixin/src/index.ts:38`](../../packages/weixin/weixin/src/index.ts)
<!-- END GENERATED cordis-surface -->
