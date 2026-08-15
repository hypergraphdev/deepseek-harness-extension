/**
 * Native-messaging host for the dsh browser extension: speaks the browser's
 * length-prefixed stdio JSON protocol, ensures a dsh web server is running on
 * the requested port, and answers with its URL. The browser spawns this
 * process when the extension connects and closes its stdio to end it.
 * @module @deepseek-ai/dsh/browser-host
 */

import { spawn } from 'node:child_process'

/**
 * The native-messaging host name registered in every browser manifest and
 * dialed by the extension's `connectNative` call.
 */
export const NATIVE_HOST_NAME = 'ai.deepseek.dsh'

/**
 * Cap on one incoming native message. The extension only ever sends small
 * control messages; a longer length prefix means a broken or hostile peer,
 * and reading it would buffer unbounded stdin.
 */
export const MAX_NATIVE_MESSAGE_BYTES = 1024 * 1024

/** One control message between the extension and this host. */
interface NativeHostRequest {
  /** The only request: ensure a dsh web server is running and report its URL. */
  type: 'ensure'
}

/** The host's answer to one {@link NativeHostRequest}. */
type NativeHostResponse =
  | { type: 'ready'; url: string }
  | { type: 'error'; message: string }

/**
 * Frame one value as a native message: a 32-bit little-endian byte length
 * followed by UTF-8 JSON, the browser's stdio wire format.
 * @param value - JSON-serializable message body.
 * @returns the framed bytes to write to stdout.
 */
export function encodeNativeMessage(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  const frame = Buffer.allocUnsafe(4 + body.length)
  frame.writeUInt32LE(body.length, 0)
  body.copy(frame, 4)
  return frame
}

/**
 * Incremental decoder for the native-message stdio stream. Push chunks as
 * they arrive; each complete frame's parsed JSON is handed to the callback.
 */
export class NativeMessageReader {
  private buffered: Buffer = Buffer.alloc(0)

  constructor(private readonly onMessage: (message: unknown) => void) {}

  /**
   * Consume one stdin chunk, emitting every message it completes.
   * @param chunk - raw bytes from the stream, at any framing offset.
   */
  push(chunk: Buffer): void {
    this.buffered = this.buffered.length === 0 ? chunk : Buffer.concat([this.buffered, chunk])
    while (this.buffered.length >= 4) {
      const length = this.buffered.readUInt32LE(0)
      if (length > MAX_NATIVE_MESSAGE_BYTES) {
        throw new Error(`native message of ${String(length)} bytes exceeds the ${String(MAX_NATIVE_MESSAGE_BYTES)}-byte cap`)
      }
      if (this.buffered.length < 4 + length) return
      const body = this.buffered.subarray(4, 4 + length)
      this.buffered = this.buffered.subarray(4 + length)
      this.onMessage(JSON.parse(body.toString('utf8')))
    }
  }
}

/** What a port probe found listening. */
export type PortProbe = 'dsh' | 'other' | 'absent'

/**
 * Classify what serves a loopback port. A dsh web server answers a plain GET
 * on its WebSocket path with `426 Upgrade Required`, which no other local
 * service is expected to do.
 * @param port - loopback port to probe.
 * @returns `dsh` for that signature, `other` for any different response, `absent` when nothing accepts the connection.
 */
export async function probeDshServer(port: number): Promise<PortProbe> {
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/api/events.mux`, { redirect: 'manual' })
    return response.status === 426 ? 'dsh' : 'other'
  } catch {
    return 'absent'
  }
}

/** How {@link ensureWebServer} launches a detached `dsh web`; injectable for tests. */
export interface EnsureOptions {
  /** Command and arguments launching the server (default: this entry re-invoked with `web`). */
  command?: readonly string[]
  /** Milliseconds to wait for the server's readiness line (default 90000). */
  timeoutMs?: number
}

/** The readiness line `dsh web` prints once its Loader tree settled. */
const READY_LINE = /dsh web: (http:\/\/\S+)/

/** This entry re-invoked under the same runtime flags, so source and built launches both work. */
function selfWebCommand(port: number): readonly string[] {
  return [process.execPath, ...process.execArgv, process.argv[1] as string, 'web', '--port', String(port)]
}

/**
 * Ensure a dsh web server is running on the port and return its URL. An
 * already-listening dsh server is reused; an empty port gets a detached
 * `dsh web` whose readiness line supplies the URL; any other occupant is an
 * error rather than a guess.
 * @param port - loopback port the server serves on.
 * @param options - launch command and timeout overrides for tests.
 * @returns the served base URL.
 */
export async function ensureWebServer(port: number, options: EnsureOptions = {}): Promise<string> {
  const found = await probeDshServer(port)
  if (found === 'dsh') return `http://127.0.0.1:${String(port)}`
  if (found === 'other') {
    throw new Error(`port ${String(port)} is serving something that is not dsh web; stop it or install with a different --port`)
  }
  const [command, ...commandArgs] = options.command ?? selfWebCommand(port)
  const child = spawn(command as string, commandArgs, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const url = await new Promise<string>((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? 90_000
    let settled = false
    const settle = (outcome: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      outcome()
    }
    const timer = setTimeout(() => {
      settle(() => {
        child.kill('SIGTERM')
        reject(new Error(`dsh web did not report readiness within ${String(timeoutMs)}ms`))
      })
    }, timeoutMs)
    let seen = ''
    const scan = (chunk: Buffer): void => {
      seen += chunk.toString('utf8')
      const match = READY_LINE.exec(seen)
      if (match !== null) settle(() => { resolve(match[1] as string) })
    }
    child.stdout.on('data', scan)
    child.stderr.on('data', scan)
    child.on('error', (error) => { settle(() => { reject(error) }) })
    child.on('exit', (code) => {
      settle(() => { reject(new Error(`dsh web exited with code ${String(code)} before reporting readiness`)) })
    })
  })
  // The server outlives this host: the browser closes the host with the
  // extension, while the detached server keeps serving later connections.
  child.stdout.destroy()
  child.stderr.destroy()
  child.unref()
  return url
}

/**
 * Serve the native-messaging endpoint until the browser closes stdin. Every
 * `ensure` request is answered with `ready` and the server URL, or `error`
 * with the failure; a malformed frame ends the process with a diagnostic.
 * @param options - the port the web server is expected on.
 * @returns fulfillment when the browser closes the stdio channel.
 */
export async function runBrowserHost(options: { port: number }): Promise<void> {
  const respond = (message: NativeHostResponse): void => {
    process.stdout.write(encodeNativeMessage(message))
  }
  const reader = new NativeMessageReader((message) => {
    const request = message as Partial<NativeHostRequest> | null
    if (request === null || request.type !== 'ensure') {
      respond({ type: 'error', message: 'unknown request; this host only answers {"type":"ensure"}' })
      return
    }
    ensureWebServer(options.port).then(
      (url) => { respond({ type: 'ready', url }) },
      (error: unknown) => { respond({ type: 'error', message: error instanceof Error ? error.message : String(error) }) },
    )
  })
  await new Promise<void>((resolve, reject) => {
    process.stdin.on('data', (chunk: Buffer) => {
      try {
        reader.push(chunk)
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    process.stdin.on('end', () => { resolve() })
    process.stdin.on('error', (error) => { reject(error) })
  })
}
