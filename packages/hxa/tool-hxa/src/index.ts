/**
 * Model-facing HXA tools: the agent's membership in its human's HXA Connect
 * org. `hxa_contacts` lists reachable peers, `hxa_send` direct-messages one,
 * and `hxa_inbox` drains missed events since the last check (expanding
 * unread DM channels into their recent messages). Tools register only while
 * `ctx.hxa` resolves a live endpoint at load; a hub that later goes dormant
 * fails per-call instead.
 * @module @deepseek-ai/dsh-tool-hxa
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { HxaMessage } from '@deepseek-ai/dsh-hxa'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-hxa'

/** Required services: the HXA connection, the tool registry, and the prompt assembly. */
export const inject = ['hxa', 'tools', 'systemPrompt']

/** Inbox expansion bounds. Invalid values fail plugin load. */
export interface Config {
  /** Maximum unread channels expanded into messages per inbox check. */
  maxInboxChannels?: number
  /** Maximum messages fetched per expanded channel. */
  maxChannelMessages?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  maxInboxChannels: z.number().default(5),
  maxChannelMessages: z.number().default(20),
})

/** Render one message as a transcript line. */
function messageLine(message: HxaMessage): string {
  return `[${new Date(message.createdAt).toISOString()}] ${message.senderName}: ${message.content}`
}

/** The prompt section teaching the agent its org membership. */
const SECTION_TEXT = `You are a member of your user's HXA Connect organization: a hub where the user's other agents (teammates) are reachable as bots.
Use hxa_contacts to see who exists and who is online, hxa_send to direct-message a teammate (delegate work, ask questions, follow up), and hxa_inbox to collect messages and events that arrived since you last checked.
Teammates reply asynchronously: after delegating, check hxa_inbox later in the conversation (or when the user asks for status) instead of blocking.
You speak in the user's name; route decisions that are irreversible or outward-facing back to the user before committing.`

/**
 * Register the HXA tools and prompt section while a live endpoint exists.
 * @param ctx - plugin context carrying `hxa`, `tools`, and `systemPrompt`.
 * @param config - inbox expansion bounds.
 */
export function apply(ctx: Context, config: Config): void {
  if (ctx.hxa.endpoint() === undefined) return

  ctx.systemPrompt.section({ name: 'tool:hxa', order: 150, text: SECTION_TEXT })

  ctx.tools.register(defineTool({
    name: 'hxa_contacts',
    description: 'List the teammates (bots) in your HXA org: name, role, bio, and online state. Optional fuzzy query over role/bio.',
    parameters: {
      query: { type: 'string', description: 'Fuzzy filter over bio/role/function; omit to list everyone.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          bots: {
            type: 'array', required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                online: { type: 'boolean', required: true },
                role: { type: 'string' },
                bio: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.bots.length === 0
          ? 'No teammates registered in the org.'
          : value.bots.map(bot => `${bot.online ? '●' : '○'} ${bot.name}${bot.role === undefined ? '' : ` (${bot.role})`}${bot.bio === undefined ? '' : ` — ${bot.bio}`}`).join('\n'),
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const bots = await ctx.hxa.listBots(args.query, exec.signal)
      return {
        bots: bots.map(bot => ({
          name: bot.name,
          online: bot.online,
          ...(bot.role === undefined ? {} : { role: bot.role }),
          ...(bot.bio === undefined ? {} : { bio: bot.bio }),
        })),
      }
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: args.query === undefined ? 'List HXA teammates' : `Find HXA teammates: ${args.query}`, kind: 'read' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'hxa_send',
    description: 'Send a direct message to one HXA teammate by bot name. Replies arrive asynchronously; collect them later with hxa_inbox.',
    parameters: {
      to: { type: 'string', required: true, description: 'Target bot name (see hxa_contacts).' },
      content: { type: 'string', required: true, description: 'The message body.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          channelId: { type: 'string', required: true },
          deliveredAt: { type: 'integer', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Delivered to ${args.to} (channel ${value.channelId}).`,
      }],
    },
    // Distinct sends are independent hub writes; ordering between them is not load-bearing.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.to.trim().length === 0 || args.content.trim().length === 0) {
        throw new Error('hxa_send requires a non-empty "to" and "content"')
      }
      const receipt = await ctx.hxa.send(args.to, args.content, exec.signal)
      return { channelId: receipt.channelId, deliveredAt: receipt.message.createdAt }
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: `HXA message to ${args.to}`, kind: 'edit' }
    },
  }))

  // Last drained watermark, process-local: the next inbox check resumes
  // where the previous one left off instead of re-reading history.
  let lastCheckedAt = Date.now()

  ctx.tools.register(defineTool({
    name: 'hxa_inbox',
    description: 'Collect HXA events since the last check: unread DM messages (expanded per channel) and thread invitations/status changes.',
    parameters: {
      since_hours: { type: 'number', description: 'Look-back window in hours; omit to resume from the previous check.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          digest: { type: 'string', required: true },
          totalEvents: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.digest }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const since = args.since_hours === undefined
        ? lastCheckedAt
        : Date.now() - Math.max(0, args.since_hours) * 3_600_000
      const count = await ctx.hxa.catchupCount(since, exec.signal)
      const drainedAt = Date.now()
      if (count.total === 0) {
        lastCheckedAt = drainedAt
        return { digest: 'Inbox empty: no teammate activity since the last check.', totalEvents: 0 }
      }
      const lines: string[] = []
      let cursor: string | undefined
      const channels = new Map<string, string | undefined>()
      do {
        const page = await ctx.hxa.catchup(since, cursor, exec.signal)
        for (const event of page.events) {
          switch (event.type) {
            case 'channel_message_summary':
              if (channels.size < (config.maxInboxChannels ?? 5)) channels.set(event.channelId, event.channelName)
              else lines.push(`(channel ${event.channelName ?? event.channelId}: ${String(event.count)} unread messages not expanded)`)
              break
            case 'thread_invited':
              lines.push(`Thread invitation from ${event.inviter}: "${event.topic}" (thread ${event.threadId})`)
              break
            case 'thread_status_changed':
              lines.push(`Thread "${event.topic}" moved ${event.from} → ${event.to} by ${event.by}`)
              break
            default:
              break
          }
        }
        cursor = page.hasMore ? page.cursor : undefined
      } while (cursor !== undefined)
      for (const [channelId, channelName] of channels) {
        const messages = await ctx.hxa.channelMessages(channelId, config.maxChannelMessages ?? 20, exec.signal)
        const fresh = messages.filter(message => message.createdAt > since)
        if (fresh.length === 0) continue
        lines.push(`--- ${channelName ?? `channel ${channelId}`} ---`)
        for (const message of fresh) lines.push(messageLine(message))
      }
      lastCheckedAt = drainedAt
      return {
        digest: lines.length === 0 ? 'Only already-read activity was found.' : lines.join('\n'),
        totalEvents: count.total,
      }
    },
    presentCall(): GenericCallView {
      return { card: 'generic', title: 'Check HXA inbox', kind: 'read' }
    },
  }))
}
