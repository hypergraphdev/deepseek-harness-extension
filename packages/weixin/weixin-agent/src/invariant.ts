/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-weixin-agent`.
 * @module @deepseek-ai/dsh-weixin-agent/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-weixin-agent'

/** Cordis companion plugin name. */
export const name = 'weixin-agent-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the bridge holds one agent handle whose lifecycle
 * and inbound-message projection are exercised by package tests; each
 * delivered message becomes a followup the agent loop already logs, and each
 * reply derives from a logged assistant event.
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
