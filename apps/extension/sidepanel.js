// Side panel bootstrap: dial the native-messaging host, ask it to ensure a
// dsh web server, then hand the whole panel to the served app in an iframe.
// The iframe stays same-origin with the server, so the app's own RPC and
// WebSocket connections pass the server's browser trust fence untouched.

const NATIVE_HOST_NAME = 'ai.deepseek.dsh'

const statusPane = document.getElementById('status')
const appFrame = document.getElementById('app')
const captureButton = document.getElementById('capture')

function showStatus(html) {
  statusPane.innerHTML = html
  statusPane.classList.remove('hidden')
  appFrame.style.display = 'none'
  captureButton.style.display = 'none'
}

// Origin the app was handed to; page reports target exactly this origin.
let appOrigin

function showApp(url) {
  appOrigin = new URL(url).origin
  appFrame.src = url
  appFrame.style.display = 'block'
  captureButton.style.display = 'block'
  statusPane.classList.add('hidden')
}

// Report the active tab of the panel's window into the embedded app, which
// attaches the newest report to the next prompt. Every change reports: the
// app classifies web and file pages as pages and anything else (chrome://,
// about:) as "no active page", so a closed page never lingers as stale
// context.
async function reportActivePage() {
  if (appOrigin === undefined || appFrame.contentWindow === null) return
  let tab
  try {
    // The panel's own window, not lastFocusedWindow: focus may sit on a
    // DevTools or unrelated window whose "window" has no tabs at all.
    const panelWindow = await chrome.windows.getCurrent()
    ;[tab] = await chrome.tabs.query({ active: true, windowId: panelWindow.id })
  } catch {
    return
  }
  if (tab === undefined || typeof tab.url !== 'string') return
  appFrame.contentWindow.postMessage(
    { type: 'dsh:browser-page', url: tab.url, title: typeof tab.title === 'string' ? tab.title : '' },
    appOrigin,
  )
}

chrome.tabs.onActivated.addListener(() => { reportActivePage() })
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url !== undefined || changeInfo.title !== undefined || changeInfo.status === 'complete')) {
    reportActivePage()
  }
})
// Post one message into the embedded app at its exact origin.
function postToApp(message) {
  if (appOrigin === undefined || appFrame.contentWindow === null) return
  appFrame.contentWindow.postMessage(message, appOrigin)
}

// ---- Page capture ----
// Runs INSIDE the inspected tab (serialized by chrome.scripting), so it may
// only use what that page provides. Prefers the reader-style main region and
// falls back to the body, mirroring what a reading-mode extractor keeps.
function extractPageText() {
  const pick = () => {
    for (const selector of ['article', 'main', '[role="main"]', '#content', '.article', '.markdown-body']) {
      const node = document.querySelector(selector)
      // A wrapper that holds almost nothing is worse than the body.
      if (node !== null && node.innerText.trim().length > 200) return node
    }
    return document.body
  }
  const selection = String(window.getSelection() ?? '').trim()
  const root = pick()
  const text = (root === null ? '' : root.innerText).replace(/\n{3,}/g, '\n\n').trim()
  return { title: document.title, url: location.href, selection, text }
}

/** Cap on the extracted body: a whole prompt turn, not a whole book. */
const CAPTURE_MAX_CHARS = 20000

async function capturePage() {
  captureButton.disabled = true
  const restore = (label) => {
    captureButton.textContent = label
    setTimeout(() => { captureButton.textContent = '📄 读取本页'; captureButton.disabled = false }, 2200)
  }
  let tab
  try {
    const panelWindow = await chrome.windows.getCurrent()
    ;[tab] = await chrome.tabs.query({ active: true, windowId: panelWindow.id })
  } catch {
    restore('读取失败')
    return
  }
  if (tab === undefined || typeof tab.url !== 'string' || !/^https?:\/\//.test(tab.url)) {
    restore('此页不支持')
    return
  }
  let results
  try {
    results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPageText })
  } catch {
    // Chrome refuses injection on its own pages, the store, and PDF viewers.
    restore('此页不可读')
    return
  }
  const page = results?.[0]?.result
  if (page === undefined || (page.text.length === 0 && page.selection.length === 0)) {
    restore('无正文')
    return
  }
  const body = page.text.length > CAPTURE_MAX_CHARS
    ? `${page.text.slice(0, CAPTURE_MAX_CHARS)}\n\n[内容过长，已截断]`
    : page.text
  postToApp({
    type: 'dsh:page-capture',
    url: page.url,
    title: page.title,
    selection: page.selection,
    text: body,
  })
  restore('✓ 已发送')
}

captureButton.addEventListener('click', () => { void capturePage() })

// ---- Dictation host ----
// Speech recognition runs HERE, in the panel's top-level extension page:
// Chrome refuses the Web Speech API inside the app's cross-origin iframe, so
// the app asks this page to listen and receives transcript segments back
// over the same validated channel the page reports use.
const Recognition = self.SpeechRecognition ?? self.webkitSpeechRecognition
let dictationSession = null
let grantTabOpened = false

// The side panel cannot show the microphone permission prompt; a top-level
// extension page can, and the grant covers the whole extension origin. Probe
// with getUserMedia first: granted permission releases the probe stream and
// proceeds, anything else opens the grant page once per panel lifetime.
async function ensureMicPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    for (const track of stream.getTracks()) track.stop()
    grantTabOpened = false
    return true
  } catch {
    if (!grantTabOpened) {
      grantTabOpened = true
      chrome.tabs.create({ url: chrome.runtime.getURL('mic-permission.html') })
    }
    postToApp({ type: 'dsh:dictation-failure', failure: 'denied' })
    postToApp({ type: 'dsh:dictation-state', listening: false })
    return false
  }
}

async function startDictation() {
  if (Recognition === undefined || dictationSession !== null) return
  if (!(await ensureMicPermission())) return
  if (dictationSession !== null) return
  const session = new Recognition()
  session.lang = navigator.language
  session.continuous = true
  session.interimResults = false
  session.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index]
      if (result === undefined || !result.isFinal) continue
      const text = result[0].transcript.trim()
      if (text.length > 0) postToApp({ type: 'dsh:dictation-text', text })
    }
  }
  session.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      postToApp({ type: 'dsh:dictation-failure', failure: 'denied' })
    } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
      postToApp({ type: 'dsh:dictation-failure', failure: 'error' })
    }
  }
  session.onend = () => {
    dictationSession = null
    postToApp({ type: 'dsh:dictation-state', listening: false })
  }
  dictationSession = session
  postToApp({ type: 'dsh:dictation-state', listening: true })
  session.start()
}

// The app announces its listener after boot; the load-time report below can
// fire before that listener exists, so the handshake re-reports. The same
// channel carries the app's dictation requests.
window.addEventListener('message', (event) => {
  if (event.source !== appFrame.contentWindow
    || event.data === null || typeof event.data !== 'object') return
  switch (event.data.type) {
    case 'dsh:browser-page-ready':
      reportActivePage()
      break
    case 'dsh:dictation-probe':
      postToApp({ type: 'dsh:dictation-capability', supported: Recognition !== undefined })
      break
    case 'dsh:dictation-start':
      startDictation()
      break
    case 'dsh:dictation-stop':
      dictationSession?.stop()
      break
  }
})
appFrame.addEventListener('load', () => { reportActivePage() })

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`)
}

function showOnboarding(detail) {
  showStatus(`
    <h1>Connect this panel to dsh</h1>
    <ol>
      <li>Install the CLI once: <code>npm i -g dsh</code></li>
      <li>Register this extension: <code>dsh install-browser-host --extension ${chrome.runtime.id}</code></li>
      <li>Reopen this panel.</li>
    </ol>
    <button id="retry">Retry</button>
    ${detail === undefined ? '' : `<div class="detail">${escapeHtml(detail)}</div>`}
  `)
  document.getElementById('retry').addEventListener('click', connect)
}

function connect() {
  showStatus('Connecting to dsh…')
  let port
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST_NAME)
  } catch (error) {
    showOnboarding(error instanceof Error ? error.message : String(error))
    return
  }
  let settled = false
  port.onMessage.addListener((message) => {
    if (settled || message === null || typeof message !== 'object') return
    if (message.type === 'ready' && typeof message.url === 'string') {
      settled = true
      showApp(message.url)
      port.disconnect()
    } else if (message.type === 'error') {
      settled = true
      showOnboarding(message.message)
      port.disconnect()
    }
  })
  port.onDisconnect.addListener(() => {
    if (settled) return
    settled = true
    showOnboarding(chrome.runtime.lastError === undefined ? undefined : chrome.runtime.lastError.message)
  })
  showStatus('Starting the dsh web server… (first start can take a minute)')
  port.postMessage({ type: 'ensure' })
}

connect()
