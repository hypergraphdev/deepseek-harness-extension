import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { contentHasImage, createUserMessage, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, ImageBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import VisionBridge, { transcriptionText } from '@deepseek-ai/dsh-vision-bridge'
import type { Config } from '@deepseek-ai/dsh-vision-bridge/src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/**
 * Behavior suite for the vision bridge, driven through a real agent loop
 * against scripted mock adapters (no network): the repair-and-retry flow on
 * `UNSUPPORTED_CONTENT`, dormant and failure postures, the `analyze_image`
 * tool over the loop, route-gated tool registration, HMR disposal, and the
 * fail-loud pair rule.
 */

/** A deterministic durable image reference; no byte store is mounted because mock adapters never resolve bytes. */
function imageRef(name?: string): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
    mediaType: 'image/png',
    bytes: 128,
    width: 2,
    height: 2,
    ...name === undefined ? {} : { name },
  }
}

/** The image block every scenario's user message carries. */
function imageBlock(): ImageBlock {
  return { type: 'image', attachment: imageRef('chart.png') }
}

/** A chat-adapter script entry that refuses image content exactly like the DeepSeek serializer. */
function refuseImages(entry: (options: GenerateOptions) => ReturnType<typeof textResponse>) {
  return (options: GenerateOptions): ReturnType<typeof textResponse> => {
    if (options.messages.some(message => contentHasImage(message.content))) {
      throw new LlmError('the mock chat adapter does not support image content', 'UNSUPPORTED_CONTENT')
    }
    return entry(options)
  }
}

/** Boot the core spine plus the bridge; the caller registers adapters. */
async function harness(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(VisionBridge, config)
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
}

/** Run one image-bearing user turn against the given chat script. */
async function runImageTurn(ctx: Context, chatScript: ConstructorParameters<typeof MockAdapter>[0]): Promise<Agent> {
  const chat = new MockAdapter(chatScript)
  ctx.llm.registerAdapter(['chat'], chat)
  const agent = ctx.agentLoop.create(SessionId('s1'), { provider: 'chat', model: 'text-only' })
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'what is this chart?' }, imageBlock()],
    source: { kind: 'user' },
  }))
  await waitForIdle(ctx, agent)
  return agent
}

describe('request repair', () => {
  it('transcribes images through the bridge route, shadows the node, and retries the step', async () => {
    const ctx = await harness({ provider: 'vision', model: 'v1' })
    ctx.llm.registerAdapter(['vision'], new MockAdapter([textResponse('a red daily candlestick chart')]))
    const agent = await runImageTurn(ctx, [
      refuseImages(() => textResponse('unreachable')),
      textResponse('It shows a downtrend.'),
    ])

    const events = agent.session.events
    const caption = events.find((event): event is SessionEvent<'vision-bridge/caption'> => event.type === 'vision-bridge/caption')
    expect(caption?.data.text).toBe('a red daily candlestick chart')
    expect(caption?.data).toMatchObject({ provider: 'vision', model: 'v1' })

    // The original image message stays in the log (human transcript); the
    // replacement node carries the transcription into the model surface.
    const userMessages = events.filter((event): event is SessionEvent<'user/message'> => event.type === 'user/message')
    expect(userMessages.some(event => contentHasImage(event.data.content))).toBe(true)
    const replacement = userMessages.find(event => event.surfaceOp !== undefined && event.surfaceOp !== 'append')
    expect(replacement).toBeDefined()

    const derived = agent.session.deriveMessages()
    expect(derived.some(message => contentHasImage(message.content))).toBe(false)
    const transcribed = derived.flatMap(message => message.content)
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    expect(transcribed).toContain('a red daily candlestick chart')
    expect(transcribed).toContain(`attachment ${imageRef().attachmentId}`)

    const answer = events.find((event): event is SessionEvent<'assistant/message'> => event.type === 'assistant/message')
    expect(answer?.data.message.content).toEqual([{ type: 'text', text: 'It shows a downtrend.' }])
  })

  it('stays dormant without a configured route: the failure remains terminal', async () => {
    const ctx = await harness()
    const errors: unknown[] = []
    ctx.on('agent/error', ({ error }) => { errors.push(error) })
    const agent = await runImageTurn(ctx, [refuseImages(() => textResponse('unreachable'))])

    expect(errors).not.toHaveLength(0)
    expect(agent.session.events.some(event => event.type === 'vision-bridge/caption')).toBe(false)
    expect(agent.session.deriveMessages().some(message => contentHasImage(message.content))).toBe(true)
  })

  it('leaves the original failure terminal when the bridge route itself fails', async () => {
    const ctx = await harness({ provider: 'vision', model: 'v1' })
    ctx.llm.registerAdapter(['vision'], new MockAdapter([() => {
      throw new LlmError('vision route down', 'PROVIDER_UNAVAILABLE')
    }]))
    const errors: unknown[] = []
    ctx.on('agent/error', ({ error }) => { errors.push(error) })
    const agent = await runImageTurn(ctx, [refuseImages(() => textResponse('unreachable'))])

    expect(errors).not.toHaveLength(0)
    expect(agent.session.events.some(event => event.type === 'vision-bridge/caption')).toBe(false)
    // No replacement landed: the surface still derives the image message.
    expect(agent.session.deriveMessages().some(message => contentHasImage(message.content))).toBe(true)
  })

  it('ignores non-image UNSUPPORTED_CONTENT failures', async () => {
    const ctx = await harness({ provider: 'vision', model: 'v1' })
    ctx.llm.registerAdapter(['vision'], new MockAdapter([]))
    const errors: unknown[] = []
    ctx.on('agent/error', ({ error }) => { errors.push(error) })
    const chat = new MockAdapter([() => {
      throw new LlmError('some other unsupported construct', 'UNSUPPORTED_CONTENT')
    }])
    ctx.llm.registerAdapter(['chat'], chat)
    const agent = ctx.agentLoop.create(SessionId('s1'), { provider: 'chat', model: 'text-only' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'plain text' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    // No image anywhere: the bridge finds nothing to repair and delegates.
    expect(errors).not.toHaveLength(0)
    expect(agent.session.events.some(event => event.type === 'vision-bridge/caption')).toBe(false)
  })
})

describe('analyze_image tool', () => {
  it('answers follow-up questions about a logged image through the bridge route', async () => {
    const ctx = await harness({ provider: 'vision', model: 'v1' })
    ctx.llm.registerAdapter(['vision'], new MockAdapter([
      textResponse('a red daily candlestick chart'),
      textResponse('the third candle is green'),
    ]))
    const agent = await runImageTurn(ctx, [
      refuseImages(() => textResponse('unreachable')),
      toolCallResponse('c1', 'analyze_image', {
        attachment_id: String(imageRef().attachmentId),
        question: 'what color is the third candle?',
      }),
      textResponse('The third candle is green.'),
    ])

    const result = agent.session.events.find((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
    const resultText = JSON.stringify(result?.data.message.content)
    expect(resultText).toContain('the third candle is green')
  })

  it('is registered only while a route is configured', async () => {
    const dormant = await harness()
    expect(dormant.tools.get('analyze_image')).toBeUndefined()

    const active = await harness({ provider: 'vision', model: 'v1' })
    expect(active.tools.get('analyze_image')).toBeDefined()
  })
})

describe('lifecycle and configuration', () => {
  it('disposes its service, listener, and tool with the plugin fiber', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    const fork = await ctx.plugin(VisionBridge, { provider: 'vision', model: 'v1' })
    expect(ctx.get('visionBridge')).toBeDefined()
    expect(ctx.tools.get('analyze_image')).toBeDefined()
    await fork.dispose()
    expect(ctx.get('visionBridge')).toBeUndefined()
    expect(ctx.tools.get('analyze_image')).toBeUndefined()
  })

  it('rejects a half-configured route at load', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await expect(ctx.plugin(VisionBridge, { provider: 'vision' })).rejects.toThrow(
      /`provider` and `model` must be configured together/,
    )
  })
})

describe('transcription text', () => {
  it('names the attachment, dimensions, vision model, and the analyze_image follow-up path', () => {
    const text = transcriptionText(imageRef('chart.png'), 'v1', 'a chart')
    expect(text).toContain('"chart.png"')
    expect(text).toContain(`attachment ${imageRef().attachmentId}`)
    expect(text).toContain('image/png, 2x2')
    expect(text).toContain('transcribed by v1')
    expect(text).toContain('a chart')
    expect(text).toContain('analyze_image')
  })
})
