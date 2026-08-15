import { describe, expect, it } from 'vitest'
import { contentHasImage } from '@deepseek-ai/dsh-llm'
import { inboundToUserMessage, parseInboundFrame } from '@deepseek-ai/dsh-hxa-inbound'

/**
 * Pure inbound-frame handling: which hub frames become deliverable messages,
 * and how a delivered message projects into the coordinator's wake message.
 * The socket lifecycle and agent wiring are covered by the assembled runtime
 * test in wsUrl derivation and by real-hub verification.
 */

describe('parseInboundFrame', () => {
  it('accepts a direct-message frame', () => {
    const frame = JSON.stringify({
      type: 'message',
      channel_id: 'ch-1',
      sender_name: 'codex',
      message: { id: 'm-1', content: 'the refactor is ready', created_at: 1 },
    })
    expect(parseInboundFrame(frame)).toEqual({ channelId: 'ch-1', senderName: 'codex', content: 'the refactor is ready' })
  })

  it('rejects non-message events, malformed JSON, and empty content', () => {
    expect(parseInboundFrame(JSON.stringify({ type: 'presence', bot: 'codex' }))).toBeNull()
    expect(parseInboundFrame('not json')).toBeNull()
    expect(parseInboundFrame(JSON.stringify({ type: 'message', channel_id: 'c', sender_name: 's', message: { content: '' } }))).toBeNull()
    expect(parseInboundFrame(JSON.stringify({ type: 'message', channel_id: 'c', sender_name: 's' }))).toBeNull()
    expect(parseInboundFrame(JSON.stringify({ type: 'message', channel_id: 5, sender_name: 's', message: { content: 'x' } }))).toBeNull()
  })
})

describe('inboundToUserMessage', () => {
  it('names the sender, carries the body, and points at the reply tool', () => {
    const message = inboundToUserMessage({ channelId: 'ch-1', senderName: 'hermes', content: 'here is the analysis' })
    const text = message.content.filter((block): block is { type: 'text'; text: string } => block.type === 'text').map(block => block.text).join('')
    expect(text).toContain('From: hermes')
    expect(text).toContain('here is the analysis')
    expect(text).toContain('hxa_send to "hermes"')
    expect(contentHasImage(message.content)).toBe(false)
  })

  it('is plugin-sourced as a notice so it renders as collapsed context', () => {
    const message = inboundToUserMessage({ channelId: 'c', senderName: 'codex', content: 'done' })
    expect(message.source).toMatchObject({ kind: 'plugin', plugin: 'hxa-inbound', form: 'notice' })
    expect(message.source.kind === 'plugin' && message.source.form === 'notice' && message.source.summary).toContain('codex')
  })
})
