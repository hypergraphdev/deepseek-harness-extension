/**
 * Agents panel plugin, browser half: occupies the sidebar's `sidebar.agents`
 * seat with the read-only HXA team roster. The panel polls the host's
 * `/api/hxa/contacts` route and renders nothing while HXA is dormant, so the
 * seat costs unconfigured deployments no pixels.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-sidebar seat's existence (SidebarRoot renders it).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { AgentsPanel } from './AgentsPanel.tsx'
import { en, zh, type AgentsKey } from './locales.ts'

export type { AgentsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The sidebar team panel's copy. */
    agents: AgentsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'agents'

/** Required services: the sidebar seat's slot registry and the locale registry. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the team roster panel into the sidebar seat.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-agents: dictionaries')

  ctx.slots.inject('sidebar.agents', () => ctx.slots.register({
    name: 'sidebar.agents',
    locale: NS,
  }, AgentsPanel))
}
