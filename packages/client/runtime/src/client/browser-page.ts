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

/** Wire shape of one extension page-capture report. */
const CAPTURE_TYPE = 'dsh:page-capture'

/** Cap on one capture's body, matching the panel's own extraction cap. */
const CAPTURE_MAX_CHARS = 20_000

/** Cap on one site adapter's serialized payload. */
const SITE_DATA_MAX_CHARS = 20_000

/** One captured page body, staged for the next prompt. */
let pendingCapture: string | undefined

/**
 * The newest accepted page state for one outbound prompt.
 * @returns the sample, `null` for an explicit "no active page", or undefined outside the extension panel.
 */
export function currentBrowserPage(): BrowserPageSample | null | undefined {
  return current
}

/**
 * Take the staged page capture, if the user requested one since the last
 * prompt. Captures are one-shot: reading clears the stage, so a body rides
 * exactly the prompt the user sent it with.
 * @returns the captured text block, or undefined when nothing is staged.
 */
export function takePageCapture(): string | undefined {
  const capture = pendingCapture
  pendingCapture = undefined
  return capture
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
  const report = data as {
    type?: unknown
    url?: unknown
    title?: unknown
    text?: unknown
    selection?: unknown
    site?: unknown
  }
  if (report.type === CAPTURE_TYPE) {
    if (typeof report.url !== 'string' || typeof report.text !== 'string') return
    const selection = typeof report.selection === 'string' ? report.selection.trim() : ''
    const title = typeof report.title === 'string' ? report.title : ''
    const body = report.text.slice(0, CAPTURE_MAX_CHARS)
    // A configured site adapter's payload rides beside the article: numbers
    // a chart never puts in the DOM stay machine-readable as JSON.
    let siteBlock = ''
    if (typeof report.site === 'object' && report.site !== null) {
      const json = JSON.stringify(report.site).slice(0, SITE_DATA_MAX_CHARS)
      siteBlock = `<site_data>\n${json}\n</site_data>\n`
    }
    // Named parts, so the model can tell the page apart from the user's own
    // words and knows which fragment the user had highlighted.
    pendingCapture = `<browser_page url="${report.url}" title="${title}">\n`
      + (selection.length === 0 ? '' : `<selection>\n${selection}\n</selection>\n`)
      + siteBlock
      + `<content>\n${body}\n</content>\n</browser_page>`
    return
  }
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
