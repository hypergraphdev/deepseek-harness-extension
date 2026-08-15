/**
 * Browser-owned active-page sampling for prompt RPC provenance. The dsh
 * browser extension's side panel posts the user's active tab into the
 * embedded app frame on every change; the newest accepted sample rides the
 * next prompt like the browser time zone does. Web and file tabs sample as
 * pages; any other scheme samples as `null` ("no active page"), so a closed
 * page never lingers as stale context. Outside the extension no message
 * ever arrives and every prompt omits the field.
 */

// Value import from the inline-safe wire layer (not the connection plugin):
// plugin-to-plugin value imports are a bundle purity error.
import { BROWSER_PAGE_TITLE_MAX_CHARS, BROWSER_PAGE_URL_MAX_CHARS } from '@deepseek-ai/dsh-host-apiproxy/api'

/** Wire shape of one extension panel report. */
const MESSAGE_TYPE = 'dsh:browser-page'

/** The user's active browser tab as last reported by the extension panel. */
export interface BrowserPageSample {
  /** The tab's http(s) or file URL. */
  url: string
  /** The tab's title, possibly empty. */
  title: string
}

let current: BrowserPageSample | null | undefined

/**
 * The newest accepted page state for one outbound prompt.
 * @returns the sample, `null` for an explicit "no active page", or undefined outside the extension panel.
 */
export function currentBrowserPage(): BrowserPageSample | null | undefined {
  return current
}

/**
 * Accept one candidate report from a `message` event.
 * @param event - the window message event to screen.
 */
function acceptReport(event: MessageEvent): void {
  // Only the embedding extension panel: a top-level app has no parent, and
  // any non-parent or non-extension sender is untrusted page traffic.
  if (window.parent === window || event.source !== window.parent) return
  if (!event.origin.startsWith('chrome-extension://')) return
  const data: unknown = event.data
  if (typeof data !== 'object' || data === null) return
  const report = data as { type?: unknown; url?: unknown; title?: unknown }
  if (report.type !== MESSAGE_TYPE) return
  if (typeof report.url !== 'string' || typeof report.title !== 'string') return
  if (!/^(?:https?|file):\/\//.test(report.url) || report.url.length > BROWSER_PAGE_URL_MAX_CHARS) {
    current = null
    return
  }
  current = { url: report.url, title: report.title.slice(0, BROWSER_PAGE_TITLE_MAX_CHARS) }
}

/**
 * Listen for extension page reports for the caller's lifetime. Outside a
 * browser window (Node-hosted runtime tests) no report can ever arrive, so
 * the listener installs nothing.
 * @returns the disposer removing the listener and clearing the sample.
 */
export function installBrowserPageListener(): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('message', acceptReport)
  if (window.parent !== window) {
    // The panel's load-time report can precede this listener; the handshake
    // asks the embedder to re-report. Carries nothing, so the unknowable
    // extension origin is safely wildcarded.
    window.parent.postMessage({ type: 'dsh:browser-page-ready' }, '*')
  }
  return () => {
    window.removeEventListener('message', acceptReport)
    current = undefined
  }
}
