/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-vision-bridge`.
 * @module @deepseek-ai/dsh-vision-bridge/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from '@deepseek-ai/dsh-session'

const PACKAGE_NAME = '@deepseek-ai/dsh-vision-bridge'

/** Cordis companion plugin name. */
export const name = 'vision-bridge-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Every `vision-bridge/caption` event must carry a routable provenance: a
 * non-empty transcription, both route halves, and a complete attachment
 * reference. A violation means a replacement node was built from a caption
 * the log cannot explain.
 */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  ctx.on('session/event', (_session, event) => {
    if (event.type !== 'vision-bridge/caption') return
    const { attachment, provider, model, text } = event.data
    if (text.trim().length === 0) fail('a vision-bridge/caption event must carry a non-empty transcription')
    if (provider.length === 0 || model.length === 0) {
      fail('a vision-bridge/caption event must name the vision route that produced it')
    }
    if (attachment.attachmentId.length === 0) {
      fail('a vision-bridge/caption event must reference the transcribed attachment')
    }
  })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
