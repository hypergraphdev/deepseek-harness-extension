// Clicking the toolbar icon opens the side panel; no other background work.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
  console.error('dsh extension: side panel behavior rejected', error)
})

// Stream sniffers, registered from the user's own site adapters.
//
// A chart that streams its series over the page's WebSocket can only be read
// by wrapping that constructor before the page runs, which a click-time
// injection is far too late for. Adapters that declare `sniff` therefore get
// a MAIN-world content script at document_start — registered here, for their
// hosts only, so a browser with no such adapter runs no page scripts at all.

/** Registration id, so a reload replaces rather than duplicates. */
const SNIFFER_ID = 'dsh-stream-sniffer'

/** Hostname regexes are the adapter's matcher; content scripts need URL globs. */
function hostGlobs(adapter) {
  const patterns = Array.isArray(adapter.sniffMatches) ? adapter.sniffMatches : []
  return patterns.filter(pattern => typeof pattern === 'string' && pattern.length > 0)
}

async function registerSniffers() {
  let adapters = []
  try {
    const response = await fetch(chrome.runtime.getURL('site-adapters.json'))
    if (response.ok) {
      const parsed = await response.json()
      if (Array.isArray(parsed)) adapters = parsed
    }
  } catch { /* no adapter file: nothing to register */ }

  const matches = adapters.filter(adapter => adapter.sniff === true).flatMap(hostGlobs)
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [SNIFFER_ID] })
  } catch { /* nothing registered yet */ }
  if (matches.length === 0) return
  try {
    await chrome.scripting.registerContentScripts([{
      id: SNIFFER_ID,
      matches,
      js: ['stream-sniffer.js'],
      runAt: 'document_start',
      world: 'MAIN',
      persistAcrossSessions: true,
    }])
  } catch (error) {
    console.error('dsh extension: sniffer registration rejected', error)
  }
}

chrome.runtime.onInstalled.addListener(() => { void registerSniffers() })
chrome.runtime.onStartup.addListener(() => { void registerSniffers() })
