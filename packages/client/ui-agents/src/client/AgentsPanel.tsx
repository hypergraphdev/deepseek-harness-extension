/**
 * The sidebar team panel: a read-only roster of the user's HXA org — one row
 * per teammate bot with a presence dot. Data comes from the host's
 * `/api/hxa/contacts` route, polled while mounted; a 404 (HXA dormant) or an
 * unreachable host renders nothing, so unconfigured deployments show no
 * panel at all. Hidden while the sidebar is collapsed to its icon rail.
 */

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-sidebar SlotMap merge (the sidebar.agents seat).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './AgentsPanel.module.css'

/** One roster row from the host route. */
interface RosterBot {
  name: string
  online: boolean
  role?: string
}

/** How often the roster refreshes while the panel is mounted. */
const POLL_MS = 20_000

/** Full seat props: runtime share (standard kit + wide owner prop) & the locale seat. */
export type AgentsPanelProps = PropsRuntime<'sidebar.agents'> & PropsLocale<'agents'>

export function AgentsPanel({ wide, t }: AgentsPanelProps) {
  // undefined = not loaded or dormant (render nothing); [] = loaded but empty.
  const [bots, setBots] = useState<RosterBot[] | undefined>(undefined)

  useEffect(() => {
    let live = true
    const load = async (): Promise<void> => {
      try {
        const response = await fetch('/api/hxa/contacts')
        if (!response.ok) { if (live) setBots(undefined); return }
        const payload: unknown = await response.json()
        const rows = (payload as { bots?: unknown }).bots
        if (!Array.isArray(rows)) { if (live) setBots(undefined); return }
        const parsed = rows.flatMap((row): RosterBot[] => {
          if (typeof row !== 'object' || row === null) return []
          const bot = row as { name?: unknown; online?: unknown; role?: unknown }
          if (typeof bot.name !== 'string') return []
          return [{
            name: bot.name,
            online: bot.online === true,
            ...(typeof bot.role === 'string' && bot.role.length > 0 ? { role: bot.role } : {}),
          }]
        })
        if (live) setBots(parsed)
      } catch {
        if (live) setBots(undefined)
      }
    }
    void load()
    const timer = setInterval(() => { void load() }, POLL_MS)
    return () => { live = false; clearInterval(timer) }
  }, [])

  if (!wide || bots === undefined) return null
  return (
    <div className={css.panel}>
      <h3 className={css.title}>{t('panel.title')}</h3>
      {bots.length === 0
        ? <div className={css.empty}>{t('panel.empty')}</div>
        : (
          <ul className={css.list}>
            {bots.map(bot => (
              <li key={bot.name} className={css.row}>
                <span
                  className={clsx(css.dot, bot.online && css.dotOnline)}
                  role="img"
                  aria-label={t(bot.online ? 'bot.online' : 'bot.offline')}
                />
                <span className={css.name}>{bot.name}</span>
                {bot.role !== undefined && <span className={css.role}>{bot.role}</span>}
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}
