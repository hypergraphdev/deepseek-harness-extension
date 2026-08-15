import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import HxaRuntime, { HxaError } from '@deepseek-ai/dsh-hxa'

/**
 * Wire behavior of the HXA connection service against a scripted local hub:
 * dormancy, auth headers, response projection, unknown-event tolerance, and
 * the structured failure taxonomy.
 */

const TOKEN_ENV = 'HXA_SPEC_TOKEN'

let servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))))
  servers = []
  delete process.env.HXA_SPEC_TOKEN
})

/** One scripted hub: the handler sees every request; returns its port. */
async function hub(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void): Promise<number> {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    req.on('end', () => { handler(req, res, body) })
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  return (server.address() as AddressInfo).port
}

async function mount(url: string | undefined): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(HxaRuntime, { ...(url === undefined ? {} : { url }), tokenEnv: TOKEN_ENV })
  return ctx
}

const json = (res: ServerResponse, status: number, value: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}

describe('dormancy', () => {
  it('resolves no endpoint without a url or without the token variable', async () => {
    process.env[TOKEN_ENV] = 'tok'
    const noUrl = await mount(undefined)
    expect(noUrl.hxa.endpoint()).toBeUndefined()
    delete process.env.HXA_SPEC_TOKEN
    const noToken = await mount('http://127.0.0.1:1')
    expect(noToken.hxa.endpoint()).toBeUndefined()
    await expect(noToken.hxa.listBots()).rejects.toMatchObject({ code: 'HXA_NOT_CONFIGURED' })
  })
})

describe('wire round trips', () => {
  it('lists bots with the bearer token and projects optional fields', async () => {
    process.env[TOKEN_ENV] = 'tok'
    let auth = ''
    const port = await hub((req, res) => {
      auth = req.headers.authorization ?? ''
      json(res, 200, [
        { name: 'codex', online: true, role: 'coder', bio: 'refactors', status_text: null },
        { name: 'hermes', online: false },
      ])
    })
    const ctx = await mount(`http://127.0.0.1:${port}/`)
    const bots = await ctx.hxa.listBots()
    expect(auth).toBe('Bearer tok')
    expect(bots).toEqual([
      { name: 'codex', online: true, role: 'coder', bio: 'refactors' },
      { name: 'hermes', online: false },
    ])
  })

  it('sends a DM and returns the channel receipt', async () => {
    process.env[TOKEN_ENV] = 'tok'
    let posted = ''
    const port = await hub((_req, res, body) => {
      posted = body
      json(res, 200, { channel_id: 'ch-1', message: { id: 'm-1', sender_name: 'me', content: 'hi', created_at: 42 } })
    })
    const ctx = await mount(`http://127.0.0.1:${port}`)
    const receipt = await ctx.hxa.send('codex', 'hi')
    expect(JSON.parse(posted)).toEqual({ to: 'codex', content: 'hi' })
    expect(receipt).toEqual({ channelId: 'ch-1', message: { id: 'm-1', senderName: 'me', content: 'hi', createdAt: 42 } })
  })

  it('projects catchup counts, drops unknown event kinds, and follows pagination fields', async () => {
    process.env[TOKEN_ENV] = 'tok'
    const port = await hub((req, res) => {
      if (req.url?.includes('/catchup/count')) {
        json(res, 200, { thread_invites: 1, thread_status_changes: 0, thread_activities: 2, channel_messages: 3, total: 6 })
        return
      }
      json(res, 200, {
        events: [
          { event_id: 'e1', occurred_at: 1, type: 'channel_message_summary', channel_id: 'ch-1', channel_name: 'dm', count: 3, last_at: 9 },
          { event_id: 'e2', occurred_at: 2, type: 'thread_artifact_added', thread_id: 't', artifact_key: 'k', version: 1 },
          { event_id: 'e3', occurred_at: 3, type: 'thread_invited', thread_id: 't-1', topic: 'plan', inviter: 'hermes' },
        ],
        has_more: false,
      })
    })
    const ctx = await mount(`http://127.0.0.1:${port}`)
    const count = await ctx.hxa.catchupCount(0)
    expect(count.total).toBe(6)
    const page = await ctx.hxa.catchup(0)
    expect(page.hasMore).toBe(false)
    expect(page.events).toEqual([
      { type: 'channel_message_summary', channelId: 'ch-1', channelName: 'dm', count: 3, lastAt: 9 },
      { type: 'thread_invited', threadId: 't-1', topic: 'plan', inviter: 'hermes' },
    ])
  })
})

describe('failure taxonomy', () => {
  it('maps an HTTP rejection to HXA_HTTP with the hub detail', async () => {
    process.env[TOKEN_ENV] = 'tok'
    const port = await hub((_req, res) => { json(res, 403, { error: 'scope denied' }) })
    const ctx = await mount(`http://127.0.0.1:${port}`)
    const failure = await ctx.hxa.send('codex', 'hi').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(HxaError)
    expect((failure as HxaError).code).toBe('HXA_HTTP')
    expect((failure as HxaError).message).toContain('scope denied')
  })

  it('maps a non-JSON body to HXA_MALFORMED', async () => {
    process.env[TOKEN_ENV] = 'tok'
    const port = await hub((_req, res) => { res.writeHead(200); res.end('<html>') })
    const ctx = await mount(`http://127.0.0.1:${port}`)
    await expect(ctx.hxa.listBots()).rejects.toMatchObject({ code: 'HXA_MALFORMED' })
  })
})
