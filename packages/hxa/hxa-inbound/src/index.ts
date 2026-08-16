/**
 * HXA inbound bridge: maintains one WebSocket to the hub so the harness bot
 * shows online, and wakes a dedicated coordinator agent on each inbound
 * direct message. The woken agent has the org's `hxa_*` tools in scope, so it
 * replies through its own `hxa_send` — this plugin only delivers, it does not
 * answer. The bridge is inert while `ctx.hxa` is dormant; a dropped socket
 * reconnects with capped backoff. Reading and injecting through `followup`
 * logs `agent/inbox/spliced` then a model-visible `user/message`, satisfying
 * the model-visible ⟺ logged rule.
 * @module @deepseek-ai/dsh-hxa-inbound
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { boundContextSummary } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-hxa'
import type {} from '@deepseek-ai/dsh-agent'
// Type-only: resolves `ctx.get('sessionPersistence')` for the resume-or-create probe.
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent-default-model'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'hxa-inbound'

/** Required services: the HXA connection and the agent registry. */
export const inject = ['hxa', 'agents']

/** Coordinator session identity and reconnection bounds. Invalid values fail plugin load. */
export interface Config {
  /** Stable session id for the coordinator agent that answers inbound messages. */
  sessionId?: string
  /** Provider for the coordinator agent; omitted uses the deployment default. */
  provider?: string
  /** Model for the coordinator agent; omitted uses the deployment default. */
  model?: string
  /** Maximum reconnect backoff in milliseconds. */
  reconnectMaxMs?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  sessionId: z.string().default('hxa-main'),
  provider: z.string(),
  model: z.string(),
  reconnectMaxMs: z.number().default(30_000),
})

/** One inbound direct message extracted from a hub WebSocket frame. */
export interface InboundMessage {
  /** The DM channel the message arrived on. */
  channelId: string
  /** The sending teammate's bot name. */
  senderName: string
  /** The message body. */
  content: string
}

/**
 * Parse one hub WebSocket text frame into a deliverable direct message.
 * Non-`message` events, self-authored echoes the hub already filters, and
 * malformed frames yield null.
 * @param raw - the frame payload (text).
 * @returns the inbound message, or null when the frame is not a deliverable DM.
 */
export function parseInboundFrame(raw: string): InboundMessage | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const frame = value as { type?: unknown; channel_id?: unknown; sender_name?: unknown; message?: unknown }
  if (frame.type !== 'message') return null
  if (typeof frame.channel_id !== 'string' || typeof frame.sender_name !== 'string') return null
  const message = frame.message
  if (typeof message !== 'object' || message === null) return null
  const content = (message as { content?: unknown }).content
  if (typeof content !== 'string' || content.length === 0) return null
  return { channelId: frame.channel_id, senderName: frame.sender_name, content }
}

/**
 * Render one inbound message as the coordinator's model-facing wake message.
 * @param inbound - the parsed inbound direct message.
 * @returns a plugin-sourced user message that names the sender and the reply path.
 */
export function inboundToUserMessage(inbound: InboundMessage): UserMessage {
  const text = 'A teammate on your HXA team sent you a direct message.\n'
    + `From: ${inbound.senderName}\n`
    + `Message: ${inbound.content}\n\n`
    + 'You are the user\'s coordinator. Decide whether this needs a reply, an action, or the user\'s attention. '
    + `To answer the teammate, use hxa_send to "${inbound.senderName}".`
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: {
      kind: 'plugin',
      plugin: name,
      form: 'notice',
      summary: boundContextSummary(`HXA message from ${inbound.senderName}`),
    },
  })
}

/** The coordinator agent's persona: a passive team seat, not a free assistant. */
const COORDINATOR_PERSONA = `You are dsh-main, the user's standing seat on their HXA team. You are a coordinator, not a general assistant.
Teammate messages arrive as notices describing who sent what. For each one, decide whether it needs a reply to the teammate, an action, or the user's attention.
- To reply to a teammate, call hxa_send with their exact bot name. Keep replies brief and strictly on-topic: answer what was asked. Do NOT start unrelated conversations or ask the teammate your own questions unless the user's interest genuinely requires it.
- If a message needs the user rather than you, leave it for them instead of inventing a reply.
- If no response is warranted, do nothing.
You act in the user's name; route irreversible or outward-facing decisions back to the user.`

/** The minimal WebSocket client surface this plugin drives (native global, not in lib types here). */
interface HubSocket {
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void
  close(): void
}

/** The native WebSocket constructor, present on Node's engine range. */
function socketConstructor(): (new (url: string) => HubSocket) | undefined {
  const global = globalThis as { WebSocket?: new (url: string) => HubSocket }
  return global.WebSocket
}

/**
 * Maintain the inbound bridge for the lifetime of `ctx`. The hub socket and
 * the coordinator agent are independent: the socket connects immediately to
 * keep the bot online (presence), and the coordinator is created separately
 * so a coordinator failure never costs presence. Each inbound message wakes
 * the coordinator when it is ready.
 * @param ctx - plugin context carrying `hxa` and `agents`.
 * @param config - coordinator identity and reconnection bounds.
 */
export function apply(ctx: Context, config: Config): void {
  if (ctx.hxa.endpoint() === undefined) return
  const Socket = socketConstructor()
  if (Socket === undefined) {
    ctx.logger.warn('hxa-inbound: no WebSocket implementation; inbound bridge disabled')
    return
  }
  const reconnectMaxMs = config.reconnectMaxMs ?? 30_000

  let disposed = false
  let socket: HubSocket | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let attempt = 0
  // Set by the coordinator branch once its agent exists; a message arriving
  // before then is dropped (the sender still has it in the channel history).
  let agent: import('@deepseek-ai/dsh-agent').Agent | undefined

  const scheduleReconnect = (): void => {
    if (disposed || reconnectTimer !== undefined) return
    attempt += 1
    const delay = Math.min(reconnectMaxMs, 1000 * 2 ** Math.min(attempt, 6))
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      void connect()
    }, delay)
  }

  const connect = async (): Promise<void> => {
    if (disposed) return
    let ticket: string
    try {
      ticket = await ctx.hxa.wsTicket()
    } catch (error: unknown) {
      ctx.logger.warn(`hxa-inbound: ticket request failed: ${String(error)}`)
      scheduleReconnect()
      return
    }
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- disposal can land while the ticket is awaited
    if (disposed) return
    const ws = new Socket(ctx.hxa.wsUrl(ticket))
    socket = ws
    ws.addEventListener('open', () => { attempt = 0 })
    ws.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return
      const inbound = parseInboundFrame(event.data)
      // Deliver on the woken coordinator; its own hxa_send answers.
      if (inbound !== null) agent?.followup(inboundToUserMessage(inbound))
    })
    ws.addEventListener('close', () => {
      if (socket === ws) socket = undefined
      scheduleReconnect()
    })
    ws.addEventListener('error', () => { /* close follows; reconnect handled there */ })
  }

  // Presence: start the socket now, independent of the coordinator.
  void connect()
  ctx.effect(() => () => {
    disposed = true
    if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
    socket?.close()
  }, 'hxa-inbound.socket')

  // Coordinator: created once the agent-loop has registered itself as the
  // agent factory. Injecting on `agents` alone is too early — the service
  // exists before the loop calls setFactory — so depend on `agentLoop`.
  ctx.inject(['agents', 'agentLoop'], (agentCtx) => {
    let cancelled = false
    let handleDispose: (() => Promise<void>) | undefined
    void (async () => {
      try {
        // The prompt's {{model}}/{{provider}} variables read the agent's own
        // options, so an agent created without them fails prompt assembly;
        // fall back to the deployment default rather than leaving them unset.
        const fallback = agentCtx.get('agentDefaultModel')?.currentSelection()
        const agentOptions = {
          provider: config.provider ?? fallback?.provider,
          model: config.model ?? fallback?.model,
        }
        // A fixed session id outlives the process, and the persistence layer
        // refuses to create over an existing log — so resume when one is
        // already on disk and create only the first time.
        const sessionId = SessionId(config.sessionId ?? 'hxa-main')
        const persisted = await agentCtx.get('sessionPersistence')?.inspect(sessionId).catch(() => undefined)
        const shared = {
          ...(agentOptions.provider === undefined || agentOptions.model === undefined
            ? {}
            : { agentOptions: { provider: agentOptions.provider, model: agentOptions.model } }),
          setup: (world: Context) => {
            if (world.get('systemPrompt') === undefined) return
            world.systemPrompt.section({ name: 'hxa:coordinator', order: 0, text: COORDINATOR_PERSONA })
          },
        }
        const handle = persisted === undefined
          ? await agentCtx.agents.create({ sessionId, meta: { cwd: process.cwd() }, ...shared })
          : await agentCtx.agents.resume({ resumeSessionId: sessionId, ...shared })
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- disposal can land while the agent is created
        if (cancelled) { await handle.dispose(); return }
        agent = handle.agent
        handleDispose = () => handle.dispose()
      } catch (error: unknown) {
        ctx.logger.warn(`hxa-inbound: coordinator agent unavailable: ${String(error)}`)
      }
    })()
    agentCtx.effect(() => async () => {
      cancelled = true
      agent = undefined
      if (handleDispose !== undefined) await handleDispose()
    }, 'hxa-inbound.coordinator')
  })
}
