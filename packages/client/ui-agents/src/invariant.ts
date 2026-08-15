/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-agents`.
 * @module @deepseek-ai/dsh-client-ui-agents/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-agents'

/** Cordis companion plugin name. */
export const name = 'client-ui-agents-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the panel is a read-only slot rendering of the host
 * roster route; registration and teardown are slot effects exercised by the
 * client plugin lifecycle, and the roster's truth lives on the hub.
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
