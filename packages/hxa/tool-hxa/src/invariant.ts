/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-hxa`.
 * @module @deepseek-ai/dsh-tool-hxa/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-hxa'

/** Cordis companion plugin name. */
export const name = 'tool-hxa-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package contributes registry entries whose
 * registration and teardown are exercised by package tests, and every
 * durable effect of a call is the tool result the core pipeline already
 * logs and pairs.
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
