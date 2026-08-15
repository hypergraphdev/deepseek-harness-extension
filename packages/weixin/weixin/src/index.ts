/**
 * WeChat capability (`ctx.weixin`): one QR-linked WeChat account whose
 * messages reach the harness agent and whose replies go back out.
 *
 * Linking is a one-time act — the scan yields a durable bot token stored
 * under the harness home, so a restart resumes without another QR. The
 * service owns that credential, the login state machine, and the receive
 * loop; consumers (the settings page's QR panel, the inbound bridge)
 * subscribe rather than poll the wire themselves.
 * @module @deepseek-ai/dsh-weixin
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import {
  getUpdates, ILINK_BASE_URL, pollQr, requestQr, SESSION_EXPIRED_CODE, sendText, sendTyping,
} from './protocol.ts'
import type { InboundText, QrChallenge } from './protocol.ts'

export type { InboundText, QrChallenge, QrStatus } from './protocol.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    weixin: WeixinRuntime
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One inbound WeChat message, after the receive loop accepted it.
     * @mode emit
     * @param message - the sender, text, and conversation token.
     */
    'weixin/message'(message: InboundText): void
    /**
     * The link state changed: a scan completed, or the credential was
     * dropped or rejected.
     * @mode emit
     * @param linked - whether an account is now linked.
     */
    'weixin/link'(linked: boolean): void
  }
}

/** Receive-loop tuning. Invalid values fail plugin load. */
export interface Config {
  /** Delay before retrying after a failed poll. */
  retryDelayMs?: number
  /** Delay after repeated failures. */
  backoffDelayMs?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  retryDelayMs: z.number().default(2_000),
  backoffDelayMs: z.number().default(30_000),
})

/** The durable link: what a scan yields and a restart reuses. */
interface StoredLink {
  botToken: string
  accountId: string
  baseUrl: string
  userId?: string
  cursor?: string
}

/** What the settings panel renders. */
export interface WeixinStatus {
  /** Whether an account is linked; false means the panel should offer a QR. */
  linked: boolean
  /** The linked account id, once linked. */
  accountId?: string
  /** A pending challenge's payload to render, while linking. */
  qrcodeUrl?: string
  /** Whether the pending challenge has been scanned but not confirmed. */
  scanned?: boolean
}

/** Failures a consumer can act on. */
export class WeixinError extends Error {
  constructor(readonly code: 'WEIXIN_NOT_LINKED' | 'WEIXIN_API', message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WeixinError'
  }
}

/**
 * The WeChat connection. One linked account per harness home; linking,
 * receiving, and sending all run through this service.
 */
export class WeixinRuntime extends Service {
  /** Credential file, 0600 under the harness home. */
  private readonly linkPath = dshHomePath('weixin', 'link.json')
  private link: StoredLink | undefined
  /** The challenge being polled, while a link is in progress. */
  private pending: { challenge: QrChallenge; scanned: boolean; abort: AbortController } | undefined
  /** Live receive loop, disposed with the plugin. */
  private receiving: AbortController | undefined

  constructor(ctx: Context, private config: Config) {
    super(ctx, 'weixin')
    this.link = this.loadLink()
    ctx.effect(() => {
      if (this.link !== undefined) this.startReceiving()
      return () => {
        this.pending?.abort.abort()
        this.receiving?.abort()
      }
    }, 'weixin.connection')
  }

  /** Read the stored link, or undefined when this home has none. */
  private loadLink(): StoredLink | undefined {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.linkPath, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null) return undefined
      const record = parsed as Partial<StoredLink>
      if (typeof record.botToken !== 'string' || typeof record.accountId !== 'string') return undefined
      return {
        botToken: record.botToken,
        accountId: record.accountId,
        baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : ILINK_BASE_URL,
        ...(typeof record.userId === 'string' ? { userId: record.userId } : {}),
        ...(typeof record.cursor === 'string' ? { cursor: record.cursor } : {}),
      }
    } catch {
      // No link yet, or a file this build cannot read: both mean "unlinked".
      return undefined
    }
  }

  /** Persist the link, including the advancing receive cursor. */
  private saveLink(): void {
    if (this.link === undefined) return
    mkdirSync(dirname(this.linkPath), { recursive: true })
    writeFileSync(this.linkPath, JSON.stringify(this.link))
    chmodSync(this.linkPath, 0o600)
  }

  /**
   * The panel's view of the connection.
   * @returns whether an account is linked, plus any pending challenge.
   */
  status(): WeixinStatus {
    if (this.link !== undefined) return { linked: true, accountId: this.link.accountId }
    if (this.pending === undefined) return { linked: false }
    return { linked: false, qrcodeUrl: this.pending.challenge.qrcodeUrl, scanned: this.pending.scanned }
  }

  /**
   * Begin linking: fetch a QR and poll it until the user confirms in
   * WeChat. Calling it while a challenge is pending returns that one.
   * @returns the payload to render as a QR image.
   * @throws WeixinError when the API refuses a challenge.
   */
  async startLink(): Promise<string> {
    if (this.link !== undefined) throw new WeixinError('WEIXIN_API', 'an account is already linked; unlink first')
    if (this.pending !== undefined) return this.pending.challenge.qrcodeUrl
    let challenge: QrChallenge
    try {
      challenge = await requestQr()
    } catch (error: unknown) {
      throw new WeixinError('WEIXIN_API', `could not obtain a login QR: ${String(error)}`, { cause: error })
    }
    this.pending = { challenge, scanned: false, abort: new AbortController() }
    void this.awaitScan()
    return challenge.qrcodeUrl
  }

  /** Poll the pending challenge until it confirms, expires, or is dropped. */
  private async awaitScan(): Promise<void> {
    let host = ILINK_BASE_URL
    let refreshes = 0
    while (this.pending !== undefined && !this.pending.abort.signal.aborted) {
      const report = await pollQr(this.pending.challenge.qrcode, host)
      if (this.pending === undefined) return
      switch (report.status) {
        case 'scaned':
          this.pending.scanned = true
          break
        case 'scaned_but_redirect':
          if (report.redirectHost !== undefined) host = `https://${report.redirectHost}`
          break
        case 'expired': {
          if (++refreshes > 3) { this.pending = undefined; return }
          try {
            this.pending.challenge = await requestQr()
            this.pending.scanned = false
          } catch {
            this.pending = undefined
            return
          }
          break
        }
        case 'confirmed': {
          if (report.botToken === undefined || report.accountId === undefined) { this.pending = undefined; return }
          this.link = {
            botToken: report.botToken,
            accountId: report.accountId,
            baseUrl: report.baseUrl ?? ILINK_BASE_URL,
            ...(report.userId === undefined ? {} : { userId: report.userId }),
          }
          this.pending = undefined
          this.saveLink()
          this.ctx.emit('weixin/link', true)
          this.startReceiving()
          return
        }
        default:
          break
      }
      await new Promise(resolve => setTimeout(resolve, 1_000))
    }
  }

  /** Drop the stored credential and stop receiving. */
  unlink(): void {
    this.receiving?.abort()
    this.receiving = undefined
    this.link = undefined
    try {
      writeFileSync(this.linkPath, '{}')
      chmodSync(this.linkPath, 0o600)
    } catch { /* an unwritable home still unlinks this process */ }
    this.ctx.emit('weixin/link', false)
  }

  /**
   * Send one text message to a WeChat user.
   * @param toUserId - the recipient, normally an inbound message's sender.
   * @param text - the reply body.
   * @param contextToken - the conversation token from that user's message.
   * @throws WeixinError when no account is linked.
   */
  async send(toUserId: string, text: string, contextToken?: string): Promise<void> {
    if (this.link === undefined) throw new WeixinError('WEIXIN_NOT_LINKED', 'no WeChat account is linked')
    await sendText(this.link.baseUrl, this.link.botToken, toUserId, text, contextToken)
  }

  /**
   * Show or clear the typing indicator in one chat. Failures are swallowed:
   * the indicator is a courtesy, and losing it must never cost the reply.
   * @param toUserId - the chat to indicate in.
   * @param typing - true while composing, false to clear.
   */
  async setTyping(toUserId: string, typing: boolean): Promise<void> {
    if (this.link === undefined) return
    try {
      await sendTyping(this.link.baseUrl, this.link.botToken, toUserId, typing)
    } catch { /* an absent indicator is not worth surfacing */ }
  }

  /** Run the long-poll receive loop until the plugin or the link goes away. */
  private startReceiving(): void {
    this.receiving?.abort()
    const abort = new AbortController()
    this.receiving = abort
    void (async () => {
      let timeoutMs = 35_000
      let failures = 0
      while (!abort.signal.aborted && this.link !== undefined) {
        try {
          const batch = await getUpdates(this.link.baseUrl, this.link.botToken, this.link.cursor ?? '', timeoutMs)
          if (abort.signal.aborted || this.link === undefined) return
          if (batch.errorCode === SESSION_EXPIRED_CODE) {
            // The credential no longer works; a human must scan again.
            this.ctx.logger.warn('weixin: session expired, unlinking')
            this.unlink()
            return
          }
          if (batch.errorCode !== undefined) {
            failures += 1
            await this.pause(failures >= 3 ? this.config.backoffDelayMs ?? 30_000 : this.config.retryDelayMs ?? 2_000)
            if (failures >= 3) failures = 0
            continue
          }
          failures = 0
          if (batch.nextTimeoutMs !== undefined) timeoutMs = batch.nextTimeoutMs
          // Persist the cursor before delivering: a redelivered message is
          // recoverable, a skipped one is not.
          this.link = { ...this.link, ...(batch.cursor === undefined ? {} : { cursor: batch.cursor }) }
          this.saveLink()
          for (const message of batch.messages) this.ctx.emit('weixin/message', message)
        } catch (error: unknown) {
          if (abort.signal.aborted) return
          failures += 1
          this.ctx.logger.warn(`weixin: receive failed: ${String(error)}`)
          await this.pause(failures >= 3 ? this.config.backoffDelayMs ?? 30_000 : this.config.retryDelayMs ?? 2_000)
          if (failures >= 3) failures = 0
        }
      }
    })()
  }

  /** Sleep, unless the loop is already tearing down. */
  private pause(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export default WeixinRuntime
