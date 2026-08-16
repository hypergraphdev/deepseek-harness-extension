/**
 * WeChat as a conversation with the harness agent: an inbound message wakes
 * a dedicated agent, and that agent's answer is sent back to the sender.
 *
 * The agent replies through this bridge rather than a tool, because the
 * conversation has exactly one destination — whoever wrote in. The bridge
 * therefore watches the woken session for the assistant text that closes the
 * turn and sends it, so the model needs no WeChat vocabulary at all.
 * @module @deepseek-ai/dsh-weixin-agent
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { boundContextSummary } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-weixin'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent-default-model'
// Type-only: resolves `ctx.get('sessionPersistence')` for the resume-or-create probe.
import type {} from '@deepseek-ai/dsh-session-persistence'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'weixin-agent'

/** Required services: the WeChat connection, the agent registry, and the loop. */
export const inject = ['weixin', 'agents', 'agentLoop']

/** Conversation identity and reply bounds. Invalid values fail plugin load. */
export interface Config {
  /** Stable session id for the agent that answers WeChat. */
  sessionId?: string
  /** Provider for that agent; omitted uses the deployment default. */
  provider?: string
  /** Model for that agent; omitted uses the deployment default. */
  model?: string
  /** Cap on one outbound reply; WeChat rejects very long messages. */
  replyMaxChars?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  sessionId: z.string().default('weixin-main'),
  provider: z.string(),
  model: z.string(),
  replyMaxChars: z.number().default(2_000),
})

/** The persona framing this agent as the user's WeChat presence. */
const WEIXIN_PERSONA = `You are answering in the user's WeChat. Every message you receive was sent by a person in a chat app, and your reply is delivered straight back to that chat.
Write like a chat message: short, plain, no Markdown — WeChat renders none of it, so headings, bullets, and code fences arrive as literal characters.
You have this workstation's tools. Use them when the request needs real work, then report the outcome in a sentence or two rather than pasting raw output.
You speak in the user's name; route irreversible or outward-facing decisions back to them instead of acting alone.`

/**
 * Bridge WeChat to one agent for the lifetime of `ctx`.
 * @param ctx - plugin context carrying `weixin`, `agents`, and `agentLoop`.
 * @param config - conversation identity and reply bounds.
 */
export function apply(ctx: Context, config: Config): void {
  let agent: Agent | undefined
  let session: Session | undefined
  /** The sender the current turn is answering, and their conversation token. */
  let awaiting: { userId: string; contextToken?: string } | undefined
  /** Assistant events already sent, so one turn's reply goes out once. */
  let deliveredSeq = -1

  ctx.inject(['agents', 'agentLoop'], (agentCtx) => {
    let cancelled = false
    let dispose: (() => Promise<void>) | undefined
    void (async () => {
      try {
        // The prompt's {{model}}/{{provider}} variables read the agent's own
        // options, so an agent created without them fails prompt assembly;
        // fall back to the deployment default rather than leaving them unset.
        const fallback = agentCtx.get('agentDefaultModel')?.currentSelection()
        const options = {
          provider: config.provider ?? fallback?.provider,
          model: config.model ?? fallback?.model,
        }
        // A fixed session id outlives the process, and the persistence layer
        // refuses to create over an existing log — so resume when one is
        // already on disk and create only the first time.
        const sessionId = SessionId(config.sessionId ?? 'weixin-main')
        const persisted = await agentCtx.get('sessionPersistence')?.inspect(sessionId).catch(() => undefined)
        const shared = {
          ...(options.provider === undefined || options.model === undefined
            ? {}
            : { agentOptions: { provider: options.provider, model: options.model } }),
          setup: (world: Context) => {
            if (world.get('systemPrompt') === undefined) return
            world.systemPrompt.section({ name: 'weixin:persona', order: 0, text: WEIXIN_PERSONA })
          },
        }
        const handle = persisted === undefined
          ? await agentCtx.agents.create({ sessionId, meta: { cwd: process.cwd() }, ...shared })
          : await agentCtx.agents.resume({ resumeSessionId: sessionId, ...shared })
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- disposal can land while the agent is created
        if (cancelled) { await handle.dispose(); return }
        agent = handle.agent
        session = handle.agent.session
        dispose = () => handle.dispose()
      } catch (error: unknown) {
        ctx.logger.warn(`weixin-agent: agent unavailable: ${String(error)}`)
      }
    })()
    agentCtx.effect(() => async () => {
      cancelled = true
      agent = undefined
      session = undefined
      if (dispose !== undefined) await dispose()
    }, 'weixin-agent.agent')
  })

  // Inbound: one message becomes one turn for the agent.
  ctx.on('weixin/message', (message) => {
    if (agent === undefined) return
    awaiting = {
      userId: message.fromUserId,
      ...(message.contextToken === undefined ? {} : { contextToken: message.contextToken }),
    }
    // The user is waiting on a model turn; show the chat's typing dots
    // until the reply lands.
    void ctx.weixin.setTyping(message.fromUserId, true)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: message.text }],
      source: {
        kind: 'plugin',
        plugin: name,
        form: 'notice',
        summary: boundContextSummary(`WeChat message from ${message.fromUserId}`),
      },
    }))
  })

  // Outbound: the text that closes a turn is the reply.
  ctx.on('session/event', (subject, event) => {
    if (session === undefined || subject !== session) return
    if (event.type !== 'assistant/message' || event.seq <= deliveredSeq) return
    const target = awaiting
    if (target === undefined) return
    const text = event.data.message.content
      .flatMap(block => block.type === 'text' ? [block.text] : [])
      .join('\n')
      .trim()
    if (text.length === 0) return
    deliveredSeq = event.seq
    const bounded = text.length > (config.replyMaxChars ?? 2_000)
      ? `${text.slice(0, config.replyMaxChars ?? 2_000)}…`
      : text
    void ctx.weixin.send(target.userId, bounded, target.contextToken)
      .catch((error: unknown) => { ctx.logger.warn(`weixin-agent: reply failed: ${String(error)}`) })
      .finally(() => { void ctx.weixin.setTyping(target.userId, false) })
  })
}
