/**
 * The iLink Bot wire protocol: QR login, long-poll receive, and text send.
 * Pure request/response helpers over `fetch` — no state, no lifecycle, so
 * the service above owns retry, persistence, and delivery.
 *
 * Bot identity travels entirely in headers (`Authorization` plus the app
 * pair); request bodies never name the bot, which is why `from_user_id` is
 * always empty on outbound messages.
 * @module @deepseek-ai/dsh-weixin/protocol
 */

/** The iLink endpoint every deployment talks to. */
export const ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com'

/** Bot class provisioned by the login QR; an opaque server-side constant. */
export const ILINK_BOT_TYPE = '3'

/** Client identification sent on every request. */
const APP_ID = 'bot'

/** Packed client version (`major<<16 | minor<<8 | patch`) for 1.0.0. */
const APP_CLIENT_VERSION = '65536'

/** Version stamp every POST body carries. */
const BASE_INFO = { channel_version: '1.0.0' } as const

/** Login-status values the QR poller can observe. */
export type QrStatus = 'wait' | 'scaned' | 'confirmed' | 'expired' | 'scaned_but_redirect'

/** One pending login: the poll key plus the payload to render as a QR image. */
export interface QrChallenge {
  /** Opaque login-session key, the only value the status poll takes. */
  qrcode: string
  /** The string to encode into a QR image (also openable in a browser). */
  qrcodeUrl: string
}

/** One status observation, carrying credentials once confirmed. */
export interface QrStatusReport {
  status: QrStatus
  /** Bearer token for every later call; present on `confirmed`. */
  botToken?: string
  /** The bot's account identity; present on `confirmed`. */
  accountId?: string
  /** Per-account API base for later calls; absent means keep the default. */
  baseUrl?: string
  /** The human user's iLink id. */
  userId?: string
  /** New poll host for `scaned_but_redirect`. */
  redirectHost?: string
}

/** One inbound message, reduced to what a text bridge needs. */
export interface InboundText {
  /** Sender's iLink user id; also the reply address. */
  fromUserId: string
  /** Plain text (a voice note's transcript counts). */
  text: string
  /** Server receive time in epoch milliseconds. */
  createdAt: number
  /** Per-conversation token to echo on the reply. */
  contextToken?: string
}

/** One long-poll result. */
export interface UpdateBatch {
  messages: InboundText[]
  /** Opaque cursor to persist and echo on the next poll. */
  cursor?: string
  /** Server-directed timeout for the next poll. */
  nextTimeoutMs?: number
  /** Body-level failure code; `-14` means the session expired. */
  errorCode?: number
  errorMessage?: string
}

/** Session-expiry code the poll loop treats as terminal for the credential. */
export const SESSION_EXPIRED_CODE = -14

/** Random per-request UIN header value the API expects. */
function randomUin(): string {
  const value = Math.floor(Math.random() * 0x1_0000_0000)
  return Buffer.from(String(value), 'utf8').toString('base64')
}

/** Headers common to every request. */
function commonHeaders(): Record<string, string> {
  return { 'iLink-App-Id': APP_ID, 'iLink-App-ClientVersion': APP_CLIENT_VERSION }
}

/** One GET against the iLink API. */
async function getJson(baseUrl: string, path: string, query: Record<string, string>, timeoutMs: number): Promise<unknown> {
  const url = new URL(path, `${baseUrl.replace(/\/+$/, '')}/`)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  const response = await fetch(url, { headers: commonHeaders(), signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`iLink GET ${path} failed with ${String(response.status)}`)
  return response.json()
}

/** One authenticated POST against the iLink API. */
async function postJson(baseUrl: string, path: string, token: string, body: object, timeoutMs: number): Promise<unknown> {
  const url = new URL(path, `${baseUrl.replace(/\/+$/, '')}/`)
  const payload = JSON.stringify({ ...body, base_info: BASE_INFO })
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...commonHeaders(),
      'content-type': 'application/json',
      'AuthorizationType': 'ilink_bot_token',
      'X-WECHAT-UIN': randomUin(),
      ...(token.length === 0 ? {} : { authorization: `Bearer ${token}` }),
    },
    body: payload,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`iLink POST ${path} failed with ${String(response.status)}`)
  return response.json()
}

/** Read one string field from an unknown record. */
function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Request a fresh login QR.
 * @param signal - caller cancellation.
 * @returns the challenge to display and poll.
 */
export async function requestQr(signal?: AbortSignal): Promise<QrChallenge> {
  void signal
  const payload = await getJson(ILINK_BASE_URL, 'ilink/bot/get_bot_qrcode', { bot_type: ILINK_BOT_TYPE }, 5_000)
  const record = payload as Record<string, unknown>
  const qrcode = readString(record, 'qrcode')
  const qrcodeUrl = readString(record, 'qrcode_img_content')
  if (qrcode === undefined || qrcodeUrl === undefined) throw new Error('iLink returned no QR challenge')
  return { qrcode, qrcodeUrl }
}

/**
 * Observe one login status. The call long-polls, and every transport
 * failure reports `wait` so a poll loop never dies on a transient error.
 * @param challenge - the pending challenge's poll key.
 * @param baseUrl - poll host, which a redirect may move.
 * @returns the observed status, with credentials once confirmed.
 */
export async function pollQr(challenge: string, baseUrl: string = ILINK_BASE_URL): Promise<QrStatusReport> {
  let payload: unknown
  try {
    payload = await getJson(baseUrl, 'ilink/bot/get_qrcode_status', { qrcode: challenge }, 35_000)
  } catch {
    return { status: 'wait' }
  }
  const record = payload as Record<string, unknown>
  const status = readString(record, 'status')
  if (status === undefined) return { status: 'wait' }
  const botToken = readString(record, 'bot_token')
  const accountId = readString(record, 'ilink_bot_id')
  const baseUrlField = readString(record, 'baseurl')
  const userId = readString(record, 'ilink_user_id')
  const redirectHost = readString(record, 'redirect_host')
  return {
    status: status as QrStatus,
    ...(botToken === undefined ? {} : { botToken }),
    ...(accountId === undefined ? {} : { accountId }),
    ...(baseUrlField === undefined ? {} : { baseUrl: baseUrlField }),
    ...(userId === undefined ? {} : { userId }),
    ...(redirectHost === undefined ? {} : { redirectHost }),
  }
}

/**
 * Project one raw message record into the text a bridge delivers. A voice
 * note's transcript is text; anything without text yields undefined.
 * @param raw - one `msgs` entry.
 * @returns the reduced message, or undefined when it carries no text.
 */
export function readInboundText(raw: unknown): InboundText | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const fromUserId = readString(record, 'from_user_id')
  if (fromUserId === undefined) return undefined
  const items = record['item_list']
  if (!Array.isArray(items)) return undefined
  let text: string | undefined
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const entry = item as Record<string, unknown>
    const type = entry['type']
    const textItem = entry['text_item'] as Record<string, unknown> | undefined
    const voiceItem = entry['voice_item'] as Record<string, unknown> | undefined
    if (type === 1 && typeof textItem?.['text'] === 'string') { text = textItem['text']; break }
    if (type === 3 && typeof voiceItem?.['text'] === 'string') { text = voiceItem['text']; break }
  }
  if (text === undefined || text.length === 0) return undefined
  const createdAt = record['create_time_ms']
  const contextToken = readString(record, 'context_token')
  return {
    fromUserId,
    text,
    createdAt: typeof createdAt === 'number' ? createdAt : Date.now(),
    ...(contextToken === undefined ? {} : { contextToken }),
  }
}

/**
 * Long-poll for new messages. A client-side timeout is the steady state,
 * not a failure: it returns an empty batch carrying the cursor unchanged.
 * @param baseUrl - the account's API base.
 * @param token - the bot token.
 * @param cursor - the persisted cursor; empty on the first ever poll.
 * @param timeoutMs - client timeout for this poll.
 * @returns the batch, its new cursor, and any body-level failure.
 */
export async function getUpdates(baseUrl: string, token: string, cursor: string, timeoutMs = 35_000): Promise<UpdateBatch> {
  let payload: unknown
  try {
    payload = await postJson(baseUrl, 'ilink/bot/getupdates', token, { get_updates_buf: cursor }, timeoutMs)
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'TimeoutError') return { messages: [], cursor }
    throw error
  }
  const record = payload as Record<string, unknown>
  const ret = typeof record['ret'] === 'number' ? record['ret'] : 0
  const errcode = typeof record['errcode'] === 'number' ? record['errcode'] : 0
  const failure = ret !== 0 ? ret : errcode
  const rawMessages = Array.isArray(record['msgs']) ? record['msgs'] : []
  const messages = rawMessages.flatMap((raw) => {
    const message = readInboundText(raw)
    return message === undefined ? [] : [message]
  })
  const nextCursor = readString(record, 'get_updates_buf')
  const nextTimeout = record['longpolling_timeout_ms']
  return {
    messages,
    // Never clobber a good cursor with an empty one.
    cursor: nextCursor ?? cursor,
    ...(typeof nextTimeout === 'number' && nextTimeout > 0 ? { nextTimeoutMs: nextTimeout } : {}),
    ...(failure === 0 ? {} : { errorCode: failure, errorMessage: readString(record, 'errmsg') ?? 'iLink reported a failure' }),
  }
}

/** Build the one-off client id the API uses for idempotency. */
function clientId(): string {
  return `dsh-weixin:${String(Date.now())}-${Math.random().toString(16).slice(2, 10)}`
}

/**
 * Send one plain-text reply.
 * @param baseUrl - the account's API base.
 * @param token - the bot token.
 * @param toUserId - the recipient's iLink user id.
 * @param text - the message body.
 * @param contextToken - the conversation token last seen from that user.
 */
export async function sendText(
  baseUrl: string,
  token: string,
  toUserId: string,
  text: string,
  contextToken?: string,
): Promise<void> {
  await postJson(baseUrl, 'ilink/bot/sendmessage', token, {
    msg: {
      from_user_id: '',
      to_user_id: toUserId,
      client_id: clientId(),
      // BOT-authored, complete: the client renders it immediately.
      message_type: 2,
      message_state: 2,
      item_list: [{ type: 1, text_item: { text } }],
      ...(contextToken === undefined ? {} : { context_token: contextToken }),
    },
  }, 15_000)
}
