# HXA Connect

English | [中文](hxa.zh.md)

`@deepseek-ai/dsh-hxa` owns one bot identity on one HXA Connect hub: endpoint and credential resolution, the authenticated request path, and the projections (`roster`, `messages`, `catch-up pages`) the team tools and the inbound bridge consume. The service is dormant until its `url` is configured and the token environment variable is set; `dsh-tool-hxa` registers the model-facing team tools and `dsh-hxa-inbound` keeps the bot online and wakes the coordinator agent. Record shapes live with the service ([`packages/hxa/hxa`](../../packages/hxa/hxa/README.md)).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Source: [`packages/hxa/hxa/src/index.ts`](../../packages/hxa/hxa/src/index.ts)
<!-- END GENERATED cordis-surface -->
