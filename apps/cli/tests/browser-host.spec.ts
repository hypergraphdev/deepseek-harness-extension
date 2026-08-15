import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'
import {
  encodeNativeMessage,
  ensureWebServer,
  MAX_NATIVE_MESSAGE_BYTES,
  NATIVE_HOST_NAME,
  NativeMessageReader,
  probeDshServer,
} from '../src/browser-host.ts'
import { browserHostManifest, manifestPathFor, shimScript } from '../src/install-browser-host.ts'
import { parseDshArgs } from '../src/args.ts'

/**
 * Native-messaging host behavior: the stdio frame codec, the port probe's
 * dsh-signature classification, ensure's reuse/launch/refuse outcomes, the
 * installer's shim and manifest artifacts, and the launcher's new arg modes.
 */

const parse = (argv: string[]) => parseDshArgs(argv, '1.2.3')

let servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))))
  servers = []
})

/** One loopback HTTP server answering every request with a fixed status. */
async function listen(status: number): Promise<number> {
  const server = createServer((_request, response) => {
    response.statusCode = status
    response.end()
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return (server.address() as AddressInfo).port
}

describe('native message framing', () => {
  it('round-trips messages across arbitrary chunk boundaries', () => {
    const received: unknown[] = []
    const reader = new NativeMessageReader(message => received.push(message))
    const wire = Buffer.concat([
      encodeNativeMessage({ type: 'ensure' }),
      encodeNativeMessage({ type: 'ready', url: 'http://127.0.0.1:3080' }),
    ])
    // One byte at a time: framing must never depend on chunk alignment.
    for (const byte of wire) reader.push(Buffer.from([byte]))
    expect(received).toEqual([
      { type: 'ensure' },
      { type: 'ready', url: 'http://127.0.0.1:3080' },
    ])
  })

  it('delivers multiple frames arriving in one chunk', () => {
    const received: unknown[] = []
    const reader = new NativeMessageReader(message => received.push(message))
    reader.push(Buffer.concat([encodeNativeMessage(1), encodeNativeMessage(2), encodeNativeMessage(3)]))
    expect(received).toEqual([1, 2, 3])
  })

  it('refuses a frame beyond the message cap instead of buffering it', () => {
    const reader = new NativeMessageReader(() => {})
    const oversized = Buffer.alloc(4)
    oversized.writeUInt32LE(MAX_NATIVE_MESSAGE_BYTES + 1, 0)
    expect(() => { reader.push(oversized) }).toThrow(/exceeds the/)
  })
})

describe('probeDshServer', () => {
  it('classifies the dsh 426 signature, a foreign service, and an empty port', async () => {
    const dshLike = await listen(426)
    const foreign = await listen(200)
    const empty = await listen(200)
    await new Promise(resolve => servers.pop()!.close(resolve))
    await expect(probeDshServer(dshLike)).resolves.toBe('dsh')
    await expect(probeDshServer(foreign)).resolves.toBe('other')
    await expect(probeDshServer(empty)).resolves.toBe('absent')
  })
})

describe('ensureWebServer', () => {
  it('reuses a listening dsh server without launching anything', async () => {
    const port = await listen(426)
    // A command that cannot spawn proves the reuse path never launches.
    await expect(ensureWebServer(port, { command: ['/nonexistent-dsh-binary'] }))
      .resolves.toBe(`http://127.0.0.1:${port}`)
  })

  it('refuses a port serving something that is not dsh', async () => {
    const port = await listen(200)
    await expect(ensureWebServer(port, { command: ['/nonexistent-dsh-binary'] }))
      .rejects.toThrow(/not dsh web/)
  })

  it('launches the command and resolves the readiness line URL', async () => {
    const port = await listen(200)
    await new Promise(resolve => servers.pop()!.close(resolve))
    const script = 'setTimeout(() => { console.log("dsh web: http://127.0.0.1:4321") }, 20)'
    await expect(ensureWebServer(port, { command: [process.execPath, '-e', script] }))
      .resolves.toBe('http://127.0.0.1:4321')
  })

  it('fails when the launch exits before reporting readiness', async () => {
    const port = await listen(200)
    await new Promise(resolve => servers.pop()!.close(resolve))
    await expect(ensureWebServer(port, { command: [process.execPath, '-e', 'process.exit(3)'] }))
      .rejects.toThrow(/exited with code 3/)
  })

  it('fails after the readiness timeout', async () => {
    const port = await listen(200)
    await new Promise(resolve => servers.pop()!.close(resolve))
    const script = 'setInterval(() => {}, 1000)'
    await expect(ensureWebServer(port, { command: [process.execPath, '-e', script], timeoutMs: 200 }))
      .rejects.toThrow(/did not report readiness within 200ms/)
  })
})

describe('installer artifacts', () => {
  it('pins node, runtime flags, and the entry path into the shim', () => {
    const shim = shimScript('/usr/local/bin/node', [], '/opt/dsh/lib/bin.js', 3080)
    expect(shim.startsWith('#!/bin/sh\n')).toBe(true)
    expect(shim).not.toContain('cd ')
    expect(shim).toContain('"/usr/local/bin/node" "/opt/dsh/lib/bin.js" browser-host --port 3080 "$@"')
  })

  it('enters the repository root before a source entry, where cwd-resolved tsx flags and tsconfig paths hold', () => {
    const shim = shimScript('/usr/local/bin/node', ['--import', 'tsx/esm'], '/repo/apps/cli/src/bin.ts', 3080)
    expect(shim).toContain('cd "/repo" || exit 1\n')
    expect(shim).toContain('"/usr/local/bin/node" "--import" "tsx/esm" "/repo/apps/cli/src/bin.ts" browser-host --port 3080 "$@"')
  })

  it('authorizes exactly the given extension in the manifest', () => {
    expect(browserHostManifest('/home/u/.dsh/browser-host/dsh-browser-host', 'a'.repeat(32))).toEqual({
      name: NATIVE_HOST_NAME,
      description: expect.stringContaining('dsh web server') as unknown,
      path: '/home/u/.dsh/browser-host/dsh-browser-host',
      type: 'stdio',
      allowed_origins: [`chrome-extension://${'a'.repeat(32)}/`],
    })
  })

  it('maps supported browsers on macOS and refuses the rest', () => {
    expect(manifestPathFor('chrome', 'darwin', '/Users/u'))
      .toBe(`/Users/u/Library/Application Support/Google/Chrome/NativeMessagingHosts/${NATIVE_HOST_NAME}.json`)
    expect(manifestPathFor('edge', 'darwin', '/Users/u'))
      .toBe(`/Users/u/Library/Application Support/Microsoft Edge/NativeMessagingHosts/${NATIVE_HOST_NAME}.json`)
    expect(manifestPathFor('firefox', 'darwin', '/Users/u')).toBeUndefined()
    expect(manifestPathFor('chrome', 'linux', '/home/u')).toBeUndefined()
  })
})

describe('launcher arg modes', () => {
  it('routes browser-host, ignoring the browser-supplied arguments', () => {
    expect(parse(['browser-host'])).toEqual({ mode: 'browser-host', port: 3080 })
    expect(parse(['browser-host', '--port', '4000'])).toEqual({ mode: 'browser-host', port: 4000 })
    expect(parse(['browser-host', 'chrome-extension://abc/', '--parent-window=7']))
      .toEqual({ mode: 'browser-host', port: 3080 })
  })

  it('routes install-browser-host with browser collection and defaults', () => {
    expect(parse(['install-browser-host', '--extension', 'a'.repeat(32)]))
      .toEqual({ mode: 'install-browser-host', extension: 'a'.repeat(32), browsers: ['chrome'], port: 3080 })
    expect(parse(['install-browser-host', '--extension', 'b'.repeat(32), '--browser', 'chrome', '--browser', 'edge', '--port', '3090']))
      .toEqual({ mode: 'install-browser-host', extension: 'b'.repeat(32), browsers: ['chrome', 'edge'], port: 3090 })
  })
})

describe.runIf(process.platform === 'darwin')('install-browser-host through the real entry', () => {
  it('writes the executable shim and per-browser manifests under an overridden home', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-browser-host-'))
    try {
      const bin = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
      const extension = 'c'.repeat(32)
      const result = await execa(
        process.execPath,
        ['--import', 'tsx/esm', bin, 'install-browser-host', '--extension', extension, '--browser', 'chrome', '--browser', 'edge'],
        { env: { ...process.env, HOME: home, DSH_HOME: join(home, '.dsh') }, reject: false },
      )
      expect(result.stderr).toContain('installed the chrome native-messaging host')
      expect(result.exitCode).toBe(0)

      const shimPath = join(home, '.dsh', 'browser-host', 'dsh-browser-host')
      expect(statSync(shimPath).mode & 0o111).not.toBe(0)
      expect(readFileSync(shimPath, 'utf8')).toContain('browser-host --port 3080')

      for (const dir of ['Google/Chrome', 'Microsoft Edge']) {
        const manifest = JSON.parse(readFileSync(
          join(home, 'Library', 'Application Support', dir, 'NativeMessagingHosts', `${NATIVE_HOST_NAME}.json`),
          'utf8',
        )) as { path: string; allowed_origins: string[] }
        expect(manifest.path).toBe(shimPath)
        expect(manifest.allowed_origins).toEqual([`chrome-extension://${extension}/`])
      }
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, 30_000)
})

describe('browser-host through the real entry', () => {
  it('answers a framed ensure with the reused server URL over stdio', async () => {
    const port = await listen(426)
    const bin = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
    const child = execa(
      process.execPath,
      ['--import', 'tsx/esm', bin, 'browser-host', '--port', String(port), 'chrome-extension://test/'],
      { input: encodeNativeMessage({ type: 'ensure' }), encoding: 'buffer' },
    )
    const result = await child
    const received: unknown[] = []
    new NativeMessageReader(message => received.push(message)).push(Buffer.from(result.stdout))
    expect(received).toEqual([{ type: 'ready', url: `http://127.0.0.1:${port}` }])
  }, 60_000)
})
