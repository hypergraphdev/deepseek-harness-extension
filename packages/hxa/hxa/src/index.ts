/**
 * HXA Connect capability (`ctx.hxa`): one org-scoped bot connection to a
 * self-hosted HXA Connect hub over its REST surface — peers, direct
 * messages, and offline catchup. The service is dormant until both the hub
 * URL (config) and the bot token (environment) resolve; every operation on a
 * dormant service fails with `HXA_NOT_CONFIGURED`, and every wire response
 * is validated before it enters typed code. Consumers (the `hxa_*` tools,
 * a future Agents rail) inject this service and never speak HTTP themselves.
 * @module @deepseek-ai/dsh-hxa
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { HxaError } from './types.ts'
import type {
  HxaBot, HxaCatchupCount, HxaCatchupEvent, HxaCatchupPage, HxaMessage, HxaSendReceipt,
} from './types.ts'

export { HxaError } from './types.ts'
export type {
  HxaBot, HxaCatchupCount, HxaCatchupEvent, HxaCatchupPage, HxaMessage, HxaSendReceipt,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    hxa: HxaRuntime
  }
}

/** Hub endpoint and bot credential resolution. */
export interface Config {
  /** HXA Connect base URL (for example `https://hxa.example.com/connect`). Omitted = dormant. */
  url?: string
  /** Environment variable holding the bot token. The variable being unset keeps the service dormant. */
  tokenEnv?: string
  /** Per-request timeout in milliseconds. */
  requestTimeoutMs?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  url: z.string(),
  tokenEnv: z.string().default('HXA_BOT_TOKEN'),
  requestTimeoutMs: z.number().default(15_000),
})

/** A resolved live connection target. */
export interface HxaEndpoint {
  /** Hub base URL without a trailing slash. */
  url: string
  /** The bot bearer token. */
  token: string
}

/** Read one string field, tolerating absence when `optional`. */
function str(record: Record<string, unknown>, key: string, optional?: 'optional'): string {
  const value = record[key]
  if (typeof value === 'string') return value
  if (optional === 'optional' && (value === undefined || value === null)) return ''
  throw new HxaError('HXA_MALFORMED', `hub response field "${key}" is not a string`)
}

/** Read one finite-number field. */
function num(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new HxaError('HXA_MALFORMED', `hub response field "${key}" is not a number`)
}

/** Assert one JSON object. */
function obj(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HxaError('HXA_MALFORMED', `hub response ${what} is not an object`)
  }
  return value as Record<string, unknown>
}

/** Assert one JSON array. */
function arr(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new HxaError('HXA_MALFORMED', `hub response ${what} is not an array`)
  return value
}

/** Project one wire message record. */
function readMessage(value: unknown): HxaMessage {
  const record = obj(value, 'message')
  return {
    id: String(record['id'] ?? ''),
    senderName: str(record, 'sender_name', 'optional'),
    content: str(record, 'content', 'optional'),
    createdAt: typeof record['created_at'] === 'number' ? record['created_at'] : 0,
  }
}

/**
 * The HXA Connect connection service. One instance serves one bot identity
 * on one hub; agents and UI reach the org through its methods only.
 */
export class HxaRuntime extends Service {
  constructor(ctx: Context, private config: Config) {
    super(ctx, 'hxa')
  }

  /**
   * Resolve the live endpoint, or undefined while dormant.
   * @returns the hub URL and token, or undefined when either is missing.
   */
  endpoint(): HxaEndpoint | undefined {
    const url = this.config.url?.replace(/\/+$/, '')
    if (url === undefined || url.length === 0) return undefined
    const token = process.env[this.config.tokenEnv ?? 'HXA_BOT_TOKEN']
    if (token === undefined || token.length === 0) return undefined
    return { url, token }
  }

  /**
   * Perform one authenticated JSON request against the hub.
   * @param method - HTTP method.
   * @param path - path beginning with `/api/`.
   * @param body - JSON body for mutating requests.
   * @param signal - caller cancellation.
   * @returns the parsed JSON response.
   * @throws HxaError when dormant, on transport/HTTP failure, or on a non-JSON body.
   */
  private async request(method: string, path: string, body: unknown, signal: AbortSignal | undefined): Promise<unknown> {
    const endpoint = this.endpoint()
    if (endpoint === undefined) {
      throw new HxaError('HXA_NOT_CONFIGURED', 'HXA is not configured: set the hub url and the bot token environment variable')
    }
    const timeout = AbortSignal.timeout(this.config.requestTimeoutMs ?? 15_000)
    const merged = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    let response: Response
    try {
      response = await fetch(`${endpoint.url}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${endpoint.token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: merged,
        redirect: 'error',
      })
    } catch (error: unknown) {
      throw new HxaError('HXA_HTTP', `hub request ${method} ${path} failed: ${String(error)}`, { cause: error })
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch (error: unknown) {
      throw new HxaError('HXA_MALFORMED', `hub response for ${method} ${path} is not JSON (status ${String(response.status)})`, { cause: error })
    }
    if (!response.ok) {
      const detail = str(obj(payload, 'error body'), 'error', 'optional')
      throw new HxaError('HXA_HTTP', `hub rejected ${method} ${path} (status ${String(response.status)})${detail === '' ? '' : `: ${detail}`}`)
    }
    return payload
  }

  /**
   * List org peers.
   * @param query - optional fuzzy filter over bio/role/function.
   * @param signal - caller cancellation.
   * @returns the org's bots.
   */
  async listBots(query?: string, signal?: AbortSignal): Promise<HxaBot[]> {
    const suffix = query === undefined || query.length === 0 ? '' : `?q=${encodeURIComponent(query)}`
    const payload = await this.request('GET', `/api/bots${suffix}`, undefined, signal)
    const rows = Array.isArray(payload) ? payload : arr(obj(payload, 'bots')['bots'], 'bots')
    return rows.map((row) => {
      const record = obj(row, 'bot')
      const bio = str(record, 'bio', 'optional')
      const role = str(record, 'role', 'optional')
      const statusText = str(record, 'status_text', 'optional')
      return {
        name: str(record, 'name'),
        online: record['online'] === true,
        ...(bio === '' ? {} : { bio }),
        ...(role === '' ? {} : { role }),
        ...(statusText === '' ? {} : { statusText }),
      }
    })
  }

  /**
   * Send one direct message; the hub creates or reuses the DM channel.
   * @param to - target bot name or id.
   * @param content - message body.
   * @param signal - caller cancellation.
   * @returns the channel and committed message.
   */
  async send(to: string, content: string, signal?: AbortSignal): Promise<HxaSendReceipt> {
    const payload = obj(await this.request('POST', '/api/send', { to, content }, signal), 'send receipt')
    return { channelId: str(payload, 'channel_id'), message: readMessage(payload['message']) }
  }

  /**
   * Count events missed since a timestamp.
   * @param since - epoch milliseconds.
   * @param signal - caller cancellation.
   * @returns per-kind unread counts.
   */
  async catchupCount(since: number, signal?: AbortSignal): Promise<HxaCatchupCount> {
    const payload = obj(await this.request('GET', `/api/me/catchup/count?since=${String(since)}`, undefined, signal), 'catchup count')
    return {
      threadInvites: num(payload, 'thread_invites'),
      threadStatusChanges: num(payload, 'thread_status_changes'),
      threadActivities: num(payload, 'thread_activities'),
      channelMessages: num(payload, 'channel_messages'),
      total: num(payload, 'total'),
    }
  }

  /**
   * Fetch one page of missed-event summaries.
   * @param since - epoch milliseconds.
   * @param cursor - pagination cursor from the previous page.
   * @param signal - caller cancellation.
   * @returns the page; unknown event kinds are dropped.
   */
  async catchup(since: number, cursor?: string, signal?: AbortSignal): Promise<HxaCatchupPage> {
    const suffix = cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`
    const payload = obj(await this.request('GET', `/api/me/catchup?since=${String(since)}${suffix}`, undefined, signal), 'catchup page')
    const events: HxaCatchupEvent[] = []
    for (const row of arr(payload['events'], 'catchup events')) {
      const record = obj(row, 'catchup event')
      switch (record['type']) {
        case 'channel_message_summary': {
          const channelName = str(record, 'channel_name', 'optional')
          events.push({
            type: 'channel_message_summary',
            channelId: str(record, 'channel_id'),
            count: num(record, 'count'),
            lastAt: num(record, 'last_at'),
            ...(channelName === '' ? {} : { channelName }),
          })
          break
        }
        case 'thread_invited':
          events.push({
            type: 'thread_invited',
            threadId: str(record, 'thread_id'),
            topic: str(record, 'topic', 'optional'),
            inviter: str(record, 'inviter', 'optional'),
          })
          break
        case 'thread_status_changed':
          events.push({
            type: 'thread_status_changed',
            threadId: str(record, 'thread_id'),
            topic: str(record, 'topic', 'optional'),
            from: str(record, 'from', 'optional'),
            to: str(record, 'to', 'optional'),
            by: str(record, 'by', 'optional'),
          })
          break
        default:
          // Merge-extensible wire vocabulary: kinds this seam does not
          // consume yet (thread activity, artifacts) fall through.
          break
      }
    }
    return {
      events,
      hasMore: payload['has_more'] === true,
      ...(typeof payload['cursor'] === 'string' ? { cursor: payload['cursor'] } : {}),
    }
  }

  /**
   * Read recent messages of one channel, oldest first.
   * @param channelId - the channel to read.
   * @param limit - maximum messages to return.
   * @param signal - caller cancellation.
   * @returns the channel's most recent messages.
   */
  async channelMessages(channelId: string, limit: number, signal?: AbortSignal): Promise<HxaMessage[]> {
    const payload = await this.request('GET', `/api/channels/${encodeURIComponent(channelId)}/messages?limit=${String(limit)}`, undefined, signal)
    const rows = Array.isArray(payload) ? payload : arr(obj(payload, 'messages')['messages'], 'messages')
    return rows.map(readMessage)
  }

  /**
   * Exchange the bot token for a one-time WebSocket connection ticket. The
   * ticket is single-use and short-lived; fetch one immediately before each
   * connect.
   * @param signal - caller cancellation.
   * @returns the connection ticket.
   */
  async wsTicket(signal?: AbortSignal): Promise<string> {
    const payload = obj(await this.request('POST', '/api/ws-ticket', {}, signal), 'ws ticket')
    return str(payload, 'ticket')
  }

  /**
   * Build the WebSocket URL for a ticket, deriving the ws(s) scheme and `/ws`
   * path from the configured hub URL.
   * @param ticket - a ticket from {@link wsTicket}.
   * @returns the full `wss://…/ws?ticket=…` URL.
   * @throws HxaError when the service is dormant.
   */
  wsUrl(ticket: string): string {
    const endpoint = this.endpoint()
    if (endpoint === undefined) {
      throw new HxaError('HXA_NOT_CONFIGURED', 'HXA is not configured: cannot build a WebSocket URL')
    }
    return `${endpoint.url.replace(/^http/, 'ws')}/ws?ticket=${encodeURIComponent(ticket)}`
  }
}

export default HxaRuntime
