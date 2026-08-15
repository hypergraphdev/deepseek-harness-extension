/**
 * WeChat settings plugin, browser half: occupies a `settings.section` seat
 * with the account-linking panel. The section renders nothing while the host
 * has no WeChat capability, so an unconfigured deployment shows no entry.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-settings SlotMap merge (the settings.section seat).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { WeixinSection } from './WeixinSection.tsx'
import { en, zh, type WeixinKey } from './locales.ts'

export type { WeixinKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The WeChat settings section's copy. */
    weixin: WeixinKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'weixin'

/** Required services: the settings seat's slot registry and the locale registry. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the WeChat section into the settings page.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-weixin: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'messaging',
    order: 40,
    locale: NS,
    label: () => t('nav'),
  }, WeixinSection))
}
