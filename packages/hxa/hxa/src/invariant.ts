/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-hxa`.
 * @module @deepseek-ai/dsh-hxa/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-hxa'

/** Cordis companion plugin name. */
export const name = 'hxa-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the service owns no registry and emits no events —
 * every operation is one validated HTTP round trip whose request/response
 * relation is enforced at the wire boundary and covered by package tests.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
