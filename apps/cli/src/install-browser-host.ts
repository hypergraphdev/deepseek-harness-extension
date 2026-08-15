/**
 * `dsh install-browser-host`: register the native-messaging host so a browser
 * can launch dsh for the extension. Writes one dsh-managed shim under
 * `$DSH_HOME/browser-host/` and one manifest per target browser in that
 * browser's NativeMessagingHosts directory; both are overwritten on every run
 * so a moved installation heals by re-running the command.
 * @module @deepseek-ai/dsh/install-browser-host
 */

import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { NATIVE_HOST_NAME } from './browser-host.ts'

/** CLI name prefixing every diagnostic this command prints. */
const NAME = 'dsh'

/**
 * Chromium-family extension ids: 32 characters of the `a`-`p` alphabet
 * (Chrome's base16 over `a`-`p`, shared by Edge).
 */
const EXTENSION_ID = /^[a-p]{32}$/

/** The browsers this installer can register, mapped to their macOS manifest directories. */
const DARWIN_MANIFEST_DIRS: Readonly<Record<string, readonly string[]>> = {
  chrome: ['Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'],
  edge: ['Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts'],
}

/**
 * The POSIX launcher shim the browser manifests point at. Browsers require an
 * executable path; npm's extensionless `.bin` shims are not reliably
 * spawnable, so the shim pins the current Node binary, this entry's runtime
 * flags (the tsx hook for source launches), and this entry's absolute path.
 * @param execPath - absolute Node binary path.
 * @param execArgv - runtime flags the entry was launched with.
 * @param binPath - absolute path of the dsh entry script.
 * @param port - port handed to `dsh browser-host`.
 * @returns the shim script content.
 */
export function shimScript(execPath: string, execArgv: readonly string[], binPath: string, port: number): string {
  const flags = execArgv.map(flag => ` ${JSON.stringify(flag)}`).join('')
  return `#!/bin/sh\nexec ${JSON.stringify(execPath)}${flags} ${JSON.stringify(binPath)} browser-host --port ${String(port)} "$@"\n`
}

/**
 * The native-messaging host manifest a browser reads to authorize and launch
 * the shim.
 * @param shimPath - absolute path of the installed launcher shim.
 * @param extension - the extension id allowed to connect.
 * @returns the manifest object serialized into the browser's directory.
 */
export function browserHostManifest(shimPath: string, extension: string): object {
  return {
    name: NATIVE_HOST_NAME,
    description: 'DeepSeek Harness browser bridge: launches and reports the local dsh web server.',
    path: shimPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extension}/`],
  }
}

/**
 * The manifest file path for one browser, or undefined for an unknown browser
 * name.
 * @param browser - target browser name (`chrome` | `edge`).
 * @param platform - the current `process.platform`.
 * @param home - the user's home directory.
 * @returns the absolute manifest path, or undefined when the browser is not supported.
 */
export function manifestPathFor(browser: string, platform: string, home: string): string | undefined {
  if (platform !== 'darwin') return undefined
  const segments = DARWIN_MANIFEST_DIRS[browser]
  if (segments === undefined) return undefined
  return join(home, ...segments, `${NATIVE_HOST_NAME}.json`)
}

/** Everything {@link runInstallBrowserHost} resolved from the invocation. */
export interface InstallBrowserHostOptions {
  /** The extension id allowed to connect. */
  extension: string
  /** Target browsers receiving a manifest. */
  browsers: readonly string[]
  /** Port recorded in the shim. */
  port: number
}

/**
 * Write the shim and every requested browser manifest.
 * @param options - validated invocation values.
 * @returns the process exit code: `0` after every write landed, `1` for a refused input or platform.
 */
export function runInstallBrowserHost(options: InstallBrowserHostOptions): number {
  if (process.platform !== 'darwin') {
    process.stderr.write(`${NAME}: install-browser-host supports macOS only for now (got ${process.platform})\n`)
    return 1
  }
  if (!EXTENSION_ID.test(options.extension)) {
    process.stderr.write(`${NAME}: ${JSON.stringify(options.extension)} is not an extension id (32 characters a-p, shown on the browser's extensions page)\n`)
    return 1
  }
  const manifests: [browser: string, path: string][] = []
  for (const browser of options.browsers) {
    const path = manifestPathFor(browser, process.platform, homedir())
    if (path === undefined) {
      process.stderr.write(`${NAME}: unsupported --browser ${JSON.stringify(browser)}; supported: ${Object.keys(DARWIN_MANIFEST_DIRS).join(', ')}\n`)
      return 1
    }
    manifests.push([browser, path])
  }

  const shimPath = dshHomePath('browser-host', 'dsh-browser-host')
  mkdirSync(dirname(shimPath), { recursive: true })
  writeFileSync(shimPath, shimScript(process.execPath, process.execArgv, process.argv[1] as string, options.port))
  chmodSync(shimPath, 0o755)

  const manifest = `${JSON.stringify(browserHostManifest(shimPath, options.extension), undefined, 2)}\n`
  for (const [browser, path] of manifests) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, manifest)
    process.stderr.write(`${NAME}: installed the ${browser} native-messaging host at ${path}\n`)
  }
  process.stderr.write(`${NAME}: the extension can now launch dsh web on port ${String(options.port)}; reload it in the browser to connect\n`)
  return 0
}
