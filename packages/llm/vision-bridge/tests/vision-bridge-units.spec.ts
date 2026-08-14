import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { CallId, contentHasImage, createUserMessage, LlmError } from '@deepseek-ai/dsh-llm'
import type { ImageBlock } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import VisionBridge, { transcriptionText, VISION_BRIDGE_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-vision-bridge'
import * as VisionBridgeInvariant from '@deepseek-ai/dsh-vision-bridge/invariant'
import { MockAdapter, maxTokensResponse, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/**
 * Edge suite complementing the loop-driven scenarios: direct `describe()`
 * failure surfaces, the settings-driven route lifecycle, `analyze_image`
 * argument validation through the registry executor, non-image failure codes,
 * and the caption-event invariant.
 */

function imageRef(name?: string): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(`sha256:${'b'.repeat(64)}`),
    mediaType: 'image/jpeg',
    bytes: 64,
    width: 3,
    height: 1,
    ...name === undefined ? {} : { name },
  }
}

function imageBlock(): ImageBlock {
  return { type: 'image', attachment: imageRef() }
}

async function harness(config: object = {}): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(VisionBridge, config)
  return ctx
}

describe('describe() failure surfaces', () => {
  it('refuses on a dormant bridge', async () => {
    const ctx = await harness()
    await expect(ctx.visionBridge.describe(imageBlock(), undefined, {}))
      .rejects.toThrow(/no vision route is configured/)
  })

  it('refuses an empty transcription', async () => {
    const ctx = await harness({ provider: 'vision', model: 'v1' })
    ctx.llm.registerAdapter(['vision'], new MockAdapter([textResponse('   ')]))
    await expect(ctx.visionBridge.describe(imageBlock(), undefined, {}))
      .rejects.toThrow(/empty transcription/)
  })

  it('surfaces a token-cap truncation', async () => {
    const ctx = await harness({ provider: 'vision', model: 'v1' })
    ctx.llm.registerAdapter(['vision'], new MockAdapter([maxTokensResponse('partial')]))
    await expect(ctx.visionBridge.describe(imageBlock(), undefined, {}))
      .rejects.toThrow(/token cap/)
  })

  it('surfaces a stream failure with its code text', async () => {
    const ctx = await harness({ provider: 'vision', model: 'v1' })
    ctx.llm.registerAdapter(['vision'], new MockAdapter([() => {
      throw new LlmError('vision route down', 'PROVIDER_UNAVAILABLE')
    }]))
    await expect(ctx.visionBridge.describe(imageBlock(), undefined, {}))
      .rejects.toThrow(/vision route down/)
  })
})

describe('settings-driven route lifecycle', () => {
  /** The smallest real provider: one in-memory document, always writable. */
  class MemorySettings extends SettingsProvider {
    doc: Record<string, unknown> = {}

    get writable(): boolean {
      return true
    }

    protected load(): Promise<Record<string, unknown>> {
      return Promise.resolve(structuredClone(this.doc))
    }

    protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
      this.doc = { ...this.doc, [ns]: structuredClone(section) }
      return Promise.resolve()
    }
  }

  it('activates and retracts the route and tool with the settings section', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    const settingsFiber = ctx.plugin(MemorySettings)
    await settingsFiber.await()
    await ctx.plugin(VisionBridge, {})

    expect(ctx.visionBridge.route()).toBeUndefined()
    expect(ctx.tools.get('analyze_image')).toBeUndefined()

    await ctx.settings.replace(VISION_BRIDGE_SETTINGS_NAMESPACE, { provider: 'vision', model: 'v1' })
    expect(ctx.visionBridge.route()).toEqual({ provider: 'vision', model: 'v1' })
    expect(ctx.tools.get('analyze_image')).toBeDefined()

    await ctx.settings.replace(VISION_BRIDGE_SETTINGS_NAMESPACE, {})
    expect(ctx.visionBridge.route()).toBeUndefined()
    expect(ctx.tools.get('analyze_image')).toBeUndefined()
  })

  it('rejects a half-configured section at the write point', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    const settingsFiber = ctx.plugin(MemorySettings)
    await settingsFiber.await()
    await ctx.plugin(VisionBridge, {})

    await expect(ctx.settings.replace(VISION_BRIDGE_SETTINGS_NAMESPACE, { provider: 'vision' }))
      .rejects.toThrow(/must be configured together/)
    expect(ctx.visionBridge.route()).toBeUndefined()
  })
})

describe('analyze_image argument validation', () => {
  const testSignal = new AbortController().signal

  async function activeHarness(): Promise<Context> {
    const ctx = await harness({ provider: 'vision', model: 'v1' })
    ctx.llm.registerAdapter(['vision'], new MockAdapter([textResponse('an answer')]))
    return ctx
  }

  it('rejects blank arguments and a missing owning agent', async () => {
    const ctx = await activeHarness()
    const run = (args: object) => ctx.tools.execute({
      callId: CallId('c1'), name: 'analyze_image', arguments: args, signal: testSignal,
    })
    await expect(run({ attachment_id: '  ', question: 'q' }).then(result => JSON.stringify(result.content)))
      .resolves.toContain('attachment_id must be a non-empty string')
    await expect(run({ attachment_id: 'sha256:x', question: ' ' }).then(result => JSON.stringify(result.content)))
      .resolves.toContain('question must be a non-empty string')
    await expect(run({ attachment_id: 'sha256:x', question: 'q' }).then(result => JSON.stringify(result.content)))
      .resolves.toContain('requires an owning agent session')
  })

  it('rejects an attachment id the conversation never referenced', async () => {
    const ctx = await activeHarness()
    const agent = ctx.agentLoop.create(SessionId('u1'), { provider: 'vision', model: 'v1' })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'no image here' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const result = await ctx.tools.execute({
      callId: CallId('c2'), name: 'analyze_image', agent,
      arguments: { attachment_id: 'sha256:missing', question: 'q' }, signal: testSignal,
    })
    expect(JSON.stringify(result.content)).toContain('is referenced by this conversation')
  })

  it('resolves an image referenced only by a caption event', async () => {
    const ctx = await activeHarness()
    const agent = ctx.agentLoop.create(SessionId('u2'), { provider: 'vision', model: 'v1' })
    agent.session.append('vision-bridge/caption', {
      attachment: imageRef('chart.jpg'), provider: 'vision', model: 'v1', text: 'a chart',
    })
    const result = await ctx.tools.execute({
      callId: CallId('c3'), name: 'analyze_image', agent,
      arguments: { attachment_id: String(imageRef().attachmentId), question: 'what is it?' }, signal: testSignal,
    })
    expect(result.isError).not.toBe(true)
    expect(JSON.stringify(result.content)).toContain('an answer')
  })
})

describe('failure-code filter', () => {
  it('delegates a non-UNSUPPORTED_CONTENT failure untouched', async () => {
    const ctx = await harness({ provider: 'vision', model: 'v1' })
    ctx.llm.registerAdapter(['vision'], new MockAdapter([]))
    ctx.llm.registerAdapter(['chat'], new MockAdapter([() => {
      throw new LlmError('quota exhausted', 'RATE_LIMITED')
    }]))
    const errors: unknown[] = []
    ctx.on('agent/error', ({ error }) => { errors.push(error) })
    const agent = ctx.agentLoop.create(SessionId('f1'), { provider: 'chat', model: 'text-only' })
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'look' }, imageBlock()],
      source: { kind: 'user' },
    }))
    await new Promise<void>((resolve) => {
      const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') { dispose(); resolve() }
      })
    })
    expect(errors).not.toHaveLength(0)
    expect(agent.session.events.some(event => event.type === 'vision-bridge/caption')).toBe(false)
    expect(agent.session.deriveMessages().some(message => contentHasImage(message.content))).toBe(true)
  })
})

describe('transcription text without a name', () => {
  it('omits the name label when the attachment has none', () => {
    const text = transcriptionText(imageRef(), 'v1', 'a chart')
    expect(text).not.toContain('"')
    expect(text).toContain(`attachment ${imageRef().attachmentId}`)
  })
})

describe('caption-event invariant', () => {
  function captionEvent(data: object): SessionEvent {
    return { type: 'vision-bridge/caption', seq: 0, time: 0, data } as SessionEvent
  }

  async function invariantHarness(): Promise<Context> {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(VisionBridgeInvariant)
    return ctx
  }

  it('accepts a complete caption record and ignores other events', async () => {
    const ctx = await invariantHarness()
    expect(() => {
      ctx.emit('session/event', {} as Session, captionEvent({
        attachment: imageRef(), provider: 'vision', model: 'v1', text: 'a chart',
      }))
      ctx.emit('session/event', {} as Session, { type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } } as SessionEvent)
    }).not.toThrow()
  })

  it.each([
    [{ attachment: imageRef(), provider: 'vision', model: 'v1', text: '  ' }, /non-empty transcription/],
    [{ attachment: imageRef(), provider: '', model: 'v1', text: 'a chart' }, /name the vision route/],
    [{ attachment: imageRef(), provider: 'vision', model: '', text: 'a chart' }, /name the vision route/],
    [{ attachment: { ...imageRef(), attachmentId: '' }, provider: 'vision', model: 'v1', text: 'a chart' }, /reference the transcribed attachment/],
  ])('rejects an incoherent caption record', async (data, message) => {
    const ctx = await invariantHarness()
    expect(() => { ctx.emit('session/event', {} as Session, captionEvent(data)) }).toThrow(message)
  })
})

describe('repair edge cases', () => {
  function waitIdle(ctx: Context, agent: ReturnType<Context['agentLoop']['create']>): Promise<void> {
    return new Promise((resolve) => {
      const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') { dispose(); resolve() }
      })
    })
  }

  it('reports a non-Error transcription failure and leaves the original failure terminal', async () => {
    const ctx = await harness({ provider: 'vision', model: 'v1' })
    ctx.llm.registerAdapter(['vision'], new MockAdapter([() => { throw 'vision exploded' }]))
    ctx.llm.registerAdapter(['chat'], new MockAdapter([() => {
      throw new LlmError('no images', 'UNSUPPORTED_CONTENT')
    }]))
    const errors: unknown[] = []
    ctx.on('agent/error', ({ error }) => { errors.push(error) })
    const agent = ctx.agentLoop.create(SessionId('e1'), { provider: 'chat', model: 'text-only' })
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'look' }, imageBlock()],
      source: { kind: 'user' },
    }))
    await waitIdle(ctx, agent)
    expect(errors).not.toHaveLength(0)
    expect(agent.session.events.some(event => event.type === 'vision-bridge/caption')).toBe(false)
  })

  it('skips a node whose image sits inside nested tool-result content', async () => {
    const ctx = await harness({ provider: 'vision', model: 'v1' })
    ctx.llm.registerAdapter(['vision'], new MockAdapter([]))
    ctx.llm.registerAdapter(['chat'], new MockAdapter([() => {
      throw new LlmError('no images', 'UNSUPPORTED_CONTENT')
    }]))
    const errors: unknown[] = []
    ctx.on('agent/error', ({ error }) => { errors.push(error) })
    const agent = ctx.agentLoop.create(SessionId('e2'), { provider: 'chat', model: 'text-only' })
    agent.followup(createUserMessage({
      content: [{ type: 'tool-result', toolCallId: CallId('c0'), content: [imageBlock()] }],
      source: { kind: 'user' },
    }))
    await waitIdle(ctx, agent)
    // The nested image is not a top-level block, so nothing is transcribed and
    // the node keeps deriving its image: no replacement, no retry.
    expect(errors).not.toHaveLength(0)
    expect(agent.session.events.some(event => event.type === 'vision-bridge/caption')).toBe(false)
    expect(agent.session.deriveMessages().some(message => contentHasImage(message.content))).toBe(true)
  })
})

describe('tool presentation and nested references', () => {
  it('renders a generic call card from pure arguments', async () => {
    const ctx = await harness({ provider: 'vision', model: 'v1' })
    const definition = ctx.tools.get('analyze_image')!
    const view = definition.presentCall?.({ attachment_id: 'sha256:x', question: 'color?' })
    expect(view).toMatchObject({ card: 'generic', title: 'Analyze image', kind: 'read' })
  })

  it('resolves an image nested in durable tool-result content', async () => {
    const ctx = await harness({ provider: 'vision', model: 'v1' })
    ctx.llm.registerAdapter(['vision'], new MockAdapter([textResponse('nested answer')]))
    const agent = ctx.agentLoop.create(SessionId('e3'), { provider: 'vision', model: 'v1' })
    agent.session.append('tool/result', {
      message: {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: CallId('c9'), content: [imageBlock()] }],
      },
    } as never, { surfaceOp: 'append' })
    const result = await ctx.tools.execute({
      callId: CallId('c4'), name: 'analyze_image', agent,
      arguments: { attachment_id: String(imageRef().attachmentId), question: 'q' },
      signal: new AbortController().signal,
    })
    expect(result.isError).not.toBe(true)
    expect(JSON.stringify(result.content)).toContain('nested answer')
  })
})

describe('multi-turn repair', () => {
  it('skips non-user surface nodes and repairs only the image message', async () => {
    const ctx = await harness({ provider: 'vision', model: 'v1' })
    ctx.llm.registerAdapter(['vision'], new MockAdapter([textResponse('a chart')]))
    ctx.llm.registerAdapter(['chat'], new MockAdapter([
      textResponse('hello'),
      () => { throw new LlmError('no images', 'UNSUPPORTED_CONTENT') },
      textResponse('after repair'),
    ]))
    const agent = ctx.agentLoop.create(SessionId('m1'), { provider: 'chat', model: 'text-only' })
    const idle = (): Promise<void> => new Promise((resolve) => {
      const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') { dispose(); resolve() }
      })
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }))
    await idle()
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'and this?' }, imageBlock()],
      source: { kind: 'user' },
    }))
    await idle()

    const captions = agent.session.events.filter(event => event.type === 'vision-bridge/caption')
    expect(captions).toHaveLength(1)
    const answers = agent.session.events
      .filter((event): event is SessionEvent<'assistant/message'> => event.type === 'assistant/message')
    expect(JSON.stringify(answers.at(-1)!.data.message.content)).toContain('after repair')
  })
})
