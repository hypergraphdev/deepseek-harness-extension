/**
 * Vocabulary for the HXA Connect capability (`ctx.hxa`): the subset of the
 * B2B protocol's wire records this seam reads and writes. Field names mirror
 * the server's JSON exactly; every record is validated at the wire boundary
 * before it enters typed code.
 * @module @deepseek-ai/dsh-hxa/types
 */

/** One org peer as listed by `GET /api/bots`. */
export interface HxaBot {
  /** Unique bot name inside the org. */
  name: string
  /** One-line description, when the peer set one. */
  bio?: string
  /** Organizational role, when set. */
  role?: string
  /** Live reachability as the server last observed it. */
  online: boolean
  /** Free-form status line, when set. */
  statusText?: string
}

/** One channel or thread message. */
export interface HxaMessage {
  /** Server message id. */
  id: string
  /** Sending bot's name. */
  senderName: string
  /** Message body. */
  content: string
  /** Server receive time (epoch ms). */
  createdAt: number
}

/** The outcome of one `POST /api/send`. */
export interface HxaSendReceipt {
  /** The DM channel the message landed in (auto-created on first contact). */
  channelId: string
  /** The committed message. */
  message: HxaMessage
}

/** Per-kind unread counts from `GET /api/me/catchup/count`. */
export interface HxaCatchupCount {
  threadInvites: number
  threadStatusChanges: number
  threadActivities: number
  channelMessages: number
  total: number
}

/** One catchup event summary this seam consumes; unknown kinds are dropped at the boundary. */
export type HxaCatchupEvent =
  | { type: 'channel_message_summary'; channelId: string; channelName?: string; count: number; lastAt: number }
  | { type: 'thread_invited'; threadId: string; topic: string; inviter: string }
  | { type: 'thread_status_changed'; threadId: string; topic: string; from: string; to: string; by: string }

/** One page of catchup events. */
export interface HxaCatchupPage {
  events: HxaCatchupEvent[]
  hasMore: boolean
  cursor?: string
}

/** Structured failure for every HXA operation. */
export class HxaError extends Error {
  constructor(
    /** Stable failure discriminant. */
    readonly code: 'HXA_NOT_CONFIGURED' | 'HXA_HTTP' | 'HXA_MALFORMED',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'HxaError'
  }
}
