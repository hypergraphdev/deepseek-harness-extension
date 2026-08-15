import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { IncomingMessage, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import HxaRuntime from '@deepseek-ai/dsh-hxa'
import * as ToolHxa from '@deepseek-ai/dsh-tool-hxa'

/**
 * The HXA tools over the real registry, prompt assembly, and connection
 * service against a scripted local hub: endpoint-gated registration, the
 * three tool behaviors, the inbox watermark, and HMR disposal.
 */

const TOKEN_ENV = 'HXA_TOOL_SPEC_TOKEN'
const signal = new AbortController().signal

let servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))))
  servers = []
  delete process.env.HXA_TOOL_SPEC_TOKEN
})

/** One scripted hub returning canned JSON per path prefix. */
async function hub(routes: Record<string, (req: IncomingMessage, body: string) => [number, unknown]>): Promise<number> {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    req.on('end', () => {
      const route = Object.entries(routes).find(([prefix]) => req.url?.startsWith(prefix))
      const [status, value] = route === undefined ? [500, { error: `unrouted ${req.url ?? ''}` }] : route[1](req, body)
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(value))
    })
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  return (server.address() as AddressInfo).port
}

async function mountAll(port: number | undefined, config: ToolHxa.Config = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(HxaRuntime, { ...(port === undefined ? {} : { url: `http://127.0.0.1:${port}` }), tokenEnv: TOKEN_ENV })
  const fiber = await ctx.plugin(ToolHxa, config)
  let counter = 0
  const call = (name: string, args: unknown) => ctx.tools.execute({ signal, callId: CallId(`call-${++counter}`), name, arguments: args })
  return { ctx, fiber, call }
}

describe('endpoint-gated registration', () => {
  it('registers nothing while the connection is dormant', async () => {
    const { ctx } = await mountAll(undefined)
    expect(ctx.tools.get('hxa_send')).toBeUndefined()
    expect(ctx.tools.get('hxa_contacts')).toBeUndefined()
    expect(ctx.tools.get('hxa_inbox')).toBeUndefined()
  })

  it('registers the three tools and disposes them with the fiber', async () => {
    process.env[TOKEN_ENV] = 'tok'
    const port = await hub({})
    const { ctx, fiber } = await mountAll(port)
    expect(ctx.tools.get('hxa_send')).toBeDefined()
    expect(ctx.tools.get('hxa_contacts')).toBeDefined()
    expect(ctx.tools.get('hxa_inbox')).toBeDefined()
    await fiber.dispose()
    expect(ctx.tools.get('hxa_send')).toBeUndefined()
    expect(ctx.tools.get('hxa_contacts')).toBeUndefined()
    expect(ctx.tools.get('hxa_inbox')).toBeUndefined()
  })
})

describe('hxa_contacts', () => {
  it('renders the roster with presence markers', async () => {
    process.env[TOKEN_ENV] = 'tok'
    const port = await hub({
      '/api/bots': () => [200, [
        { name: 'codex', online: true, role: 'coder', bio: 'refactors' },
        { name: 'hermes', online: false },
      ]],
    })
    const { call } = await mountAll(port)
    const result = await call('hxa_contacts', {})
    expect(result.isError).toBeFalsy()
    const text = result.content.map(block => block.type === 'text' ? block.text : '').join('')
    expect(text).toContain('● codex (coder) — refactors')
    expect(text).toContain('○ hermes')
  })
})

describe('hxa_send', () => {
  it('rejects blank arguments and delivers non-blank ones', async () => {
    process.env[TOKEN_ENV] = 'tok'
    const port = await hub({
      '/api/send': (_req, body) => [200, {
        channel_id: 'ch-9',
        message: { id: 'm', sender_name: 'me', content: (JSON.parse(body) as { content: string }).content, created_at: 7 },
      }],
    })
    const { call } = await mountAll(port)
    const blank = await call('hxa_send', { to: ' ', content: 'x' })
    expect(blank.isError).toBe(true)
    const sent = await call('hxa_send', { to: 'codex', content: 'please refactor' })
    expect(sent.isError).toBeFalsy()
    const text = sent.content.map(block => block.type === 'text' ? block.text : '').join('')
    expect(text).toContain('Delivered to codex (channel ch-9)')
  })
})

describe('hxa_inbox', () => {
  it('reports an empty inbox, expands unread channels, and advances the watermark', async () => {
    process.env[TOKEN_ENV] = 'tok'
    let countTotal = 0
    const port = await hub({
      '/api/me/catchup/count': () => [200, {
        thread_invites: countTotal > 0 ? 1 : 0, thread_status_changes: 0, thread_activities: 0,
        channel_messages: countTotal, total: countTotal > 0 ? countTotal + 1 : 0,
      }],
      '/api/me/catchup?': () => [200, {
        events: [
          { event_id: 'e1', occurred_at: 1, type: 'channel_message_summary', channel_id: 'ch-1', channel_name: 'codex', count: 2, last_at: Date.now() },
          { event_id: 'e2', occurred_at: 2, type: 'thread_invited', thread_id: 't-1', topic: 'ship it', inviter: 'hermes' },
        ],
        has_more: false,
      }],
      '/api/channels/ch-1/messages': () => [200, [
        { id: 'm1', sender_name: 'codex', content: 'done, see the diff', created_at: Date.now() },
        { id: 'm0', sender_name: 'codex', content: 'ancient history', created_at: 1 },
      ]],
    })
    const { call } = await mountAll(port)

    const empty = await call('hxa_inbox', {})
    const emptyText = empty.content.map(block => block.type === 'text' ? block.text : '').join('')
    expect(emptyText).toContain('Inbox empty')

    countTotal = 2
    const drained = await call('hxa_inbox', { since_hours: 24 })
    expect(drained.isError).toBeFalsy()
    const text = drained.content.map(block => block.type === 'text' ? block.text : '').join('')
    expect(text).toContain('Thread invitation from hermes: "ship it"')
    expect(text).toContain('codex: done, see the diff')
    expect(text).not.toContain('ancient history')
  })
})
