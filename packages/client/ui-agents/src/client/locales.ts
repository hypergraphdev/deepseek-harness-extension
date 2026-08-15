/** `agents` namespace dictionaries (the sidebar team panel's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'panel.title': 'AI 团队',
  'panel.empty': '暂无队友',
  'bot.online': '在线',
  'bot.offline': '离线',
} satisfies Record<string, string>

/** The agents namespace key union. */
export type AgentsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'panel.title': 'Agents',
  'panel.empty': 'No teammates yet',
  'bot.online': 'online',
  'bot.offline': 'offline',
} satisfies Record<AgentsKey, string>
