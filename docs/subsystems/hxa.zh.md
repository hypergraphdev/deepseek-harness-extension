# HXA Connect

[English](hxa.md) | 中文

`@deepseek-ai/dsh-hxa` 持有一个 HXA Connect hub 上的一个 bot 身份：端点与凭据解析、带鉴权的请求通路，以及团队工具与入站桥消费的投影（`roster`、`messages`、`catch-up pages`）。服务在配置 `url` 且设置 token 环境变量之前保持休眠；`dsh-tool-hxa` 注册面向模型的团队工具，`dsh-hxa-inbound` 维持 bot 在线并唤醒协调者 agent。记录形态随服务本体维护（[`packages/hxa/hxa`](../../packages/hxa/hxa/README.md)）。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxhxa--hxaruntime"></a>

### `ctx.hxa` — `HxaRuntime`

The HXA Connect connection service. One instance serves one bot identity on one hub; agents and UI reach the org through its methods only.

```ts cordis-catalog
/**
 * Resolve the live endpoint, or undefined while dormant.
 * @returns the hub URL and token, or undefined when either is missing.
 */
endpoint(): HxaEndpoint | undefined

/**
 * List org peers.
 * @param query - optional fuzzy filter over bio/role/function.
 * @param signal - caller cancellation.
 * @returns the org's bots.
 */
async listBots(query?: string, signal?: AbortSignal): Promise<HxaBot[]>

/**
 * Send one direct message; the hub creates or reuses the DM channel.
 * @param to - target bot name or id.
 * @param content - message body.
 * @param signal - caller cancellation.
 * @returns the channel and committed message.
 */
async send(to: string, content: string, signal?: AbortSignal): Promise<HxaSendReceipt>

/**
 * Count events missed since a timestamp.
 * @param since - epoch milliseconds.
 * @param signal - caller cancellation.
 * @returns per-kind unread counts.
 */
async catchupCount(since: number, signal?: AbortSignal): Promise<HxaCatchupCount>

/**
 * Fetch one page of missed-event summaries.
 * @param since - epoch milliseconds.
 * @param cursor - pagination cursor from the previous page.
 * @param signal - caller cancellation.
 * @returns the page; unknown event kinds are dropped.
 */
async catchup(since: number, cursor?: string, signal?: AbortSignal): Promise<HxaCatchupPage>

/**
 * Read recent messages of one channel, oldest first.
 * @param channelId - the channel to read.
 * @param limit - maximum messages to return.
 * @param signal - caller cancellation.
 * @returns the channel's most recent messages.
 */
async channelMessages(channelId: string, limit: number, signal?: AbortSignal): Promise<HxaMessage[]>

/**
 * Exchange the bot token for a one-time WebSocket connection ticket. The
 * ticket is single-use and short-lived; fetch one immediately before each
 * connect.
 * @param signal - caller cancellation.
 * @returns the connection ticket.
 */
async wsTicket(signal?: AbortSignal): Promise<string>

/**
 * Build the WebSocket URL for a ticket, deriving the ws(s) scheme and `/ws`
 * path from the configured hub URL.
 * @param ticket - a ticket from {@link wsTicket}.
 * @returns the full `wss://…/ws?ticket=…` URL.
 * @throws HxaError when the service is dormant.
 */
wsUrl(ticket: string): string
```

Source: [`packages/hxa/hxa/src/index.ts:93`](../../packages/hxa/hxa/src/index.ts)
<!-- END GENERATED cordis-surface -->
