/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-settings-weixin`.
 * @module @deepseek-ai/dsh-client-ui-settings-weixin/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-settings-weixin'

/** Cordis companion plugin name. */
export const name = 'client-ui-settings-weixin-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the section renders the host's link state and posts
 * two link mutations; the credential and its lifecycle live in dsh-weixin,
 * and this seat's registration and teardown are slot effects exercised by
 * the client plugin lifecycle.
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
