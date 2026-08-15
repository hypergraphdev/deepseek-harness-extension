// Side panel bootstrap: dial the native-messaging host, ask it to ensure a
// dsh web server, then hand the whole panel to the served app in an iframe.
// The iframe stays same-origin with the server, so the app's own RPC and
// WebSocket connections pass the server's browser trust fence untouched.

const NATIVE_HOST_NAME = 'ai.deepseek.dsh'

const statusPane = document.getElementById('status')
const appFrame = document.getElementById('app')

function showStatus(html) {
  statusPane.innerHTML = html
  statusPane.classList.remove('hidden')
  appFrame.style.display = 'none'
}

function showApp(url) {
  appFrame.src = url
  appFrame.style.display = 'block'
  statusPane.classList.add('hidden')
}

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
