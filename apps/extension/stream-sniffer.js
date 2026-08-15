/**
 * In-page stream sniffer, registered as a MAIN-world content script at
 * document_start for hosts whose adapter declares `sniff`.
 *
 * Some charts never put their series in the DOM: the numbers arrive over the
 * page's own WebSocket and live only in its canvas. Reading them requires
 * wrapping `window.WebSocket` before the page's own script constructs one,
 * which is why this file runs at document_start in the page world rather
 * than through the panel's on-click injection.
 *
 * It is strictly read-only: frames are parsed as they pass, never modified,
 * intercepted, or injected. The decoded series is published on
 * `window.__dshStream` for the panel's extractor to read on capture.
 *
 * The frame vocabulary is TradingView's (`~m~<len>~m~<json>` envelopes with
 * `timescale_update` / `du` payloads), which is the protocol this sniffer
 * supports; adapters for other stream formats need their own sniffer.
 */
(function installStreamSniffer() {
  if (window.__dshStreamInstalled) return
  window.__dshStreamInstalled = true

  /** Bars per series id, keyed by bar time so updates replace in place. */
  const stores = new Map()
  let symbol = ''
  let activeSeries = null

  /** Published snapshot the extractor reads at capture time. */
  window.__dshStream = { symbol: '', bars: [] }

  /** Split one socket payload into its `~m~<len>~m~<body>` frames. */
  function frames(raw) {
    const out = []
    const text = String(raw)
    const header = /~m~(\d+)~m~/g
    let match
    while ((match = header.exec(text)) !== null) {
      const start = header.lastIndex
      out.push(text.slice(start, start + Number(match[1])))
      header.lastIndex = start + Number(match[1])
    }
    return out
  }

  /** Merge one payload's price series (`sds_*`; study series `st*` are noise). */
  function takeBars(seriesId, payload) {
    for (const key of Object.keys(payload)) {
      if (!key.startsWith('sds_')) continue
      const rows = payload[key] && payload[key].s
      if (!Array.isArray(rows) || rows.length === 0) continue
      let store = stores.get(seriesId)
      if (store === undefined) stores.set(seriesId, (store = new Map()))
      for (const row of rows) {
        const v = row && row.v
        if (!Array.isArray(v) || v.length < 5) continue
        store.set(v[0], { time: v[0] * 1000, open: +v[1], high: +v[2], low: +v[3], close: +v[4], volume: +v[5] || 0 })
      }
      activeSeries = seriesId
      publish()
    }
  }

  /** Republish the newest window of the active series. */
  function publish() {
    const store = activeSeries === null ? undefined : stores.get(activeSeries)
    if (store === undefined) return
    window.__dshStream = {
      symbol,
      bars: [...store.values()].sort((a, b) => a.time - b.time).slice(-400),
    }
  }

  /** Read one frame; `fromClient` marks frames the page sent. */
  function onFrame(text, fromClient) {
    if (text.length === 0 || text[0] !== '{') return
    let message
    try {
      message = JSON.parse(text)
    } catch {
      return
    }
    const { m, p } = message
    if (typeof m !== 'string' || !Array.isArray(p)) return
    if (fromClient) {
      // Switching symbol rebuilds the series; drop the old bars so the two
      // never mix in one published window.
      if (m === 'create_series' || m === 'modify_series') {
        stores.delete(p[0])
        window.__dshStream = { symbol, bars: [] }
      }
      return
    }
    if (m === 'symbol_resolved' && p[2] !== null && typeof p[2] === 'object') {
      symbol = p[2].pro_name || p[2].name || symbol
      publish()
      return
    }
    if ((m === 'timescale_update' || m === 'du') && p[1] !== null && typeof p[1] === 'object') {
      takeBars(p[0], p[1])
    }
  }

  // Wrap the constructor while preserving `instanceof` and the static
  // constants the page relies on.
  const NativeWebSocket = window.WebSocket
  function ObservedWebSocket(url, protocols) {
    const socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols)
    try {
      socket.addEventListener('message', (event) => {
        if (typeof event.data === 'string') for (const frame of frames(event.data)) onFrame(frame, false)
      })
      const send = socket.send.bind(socket)
      socket.send = function observedSend(data) {
        try {
          if (typeof data === 'string') for (const frame of frames(data)) onFrame(frame, true)
        } catch { /* a malformed outbound frame is the page's business, not ours */ }
        return send(data)
      }
    } catch { /* a socket that refuses listeners still works for the page */ }
    return socket
  }
  ObservedWebSocket.prototype = NativeWebSocket.prototype
  Object.setPrototypeOf(ObservedWebSocket, NativeWebSocket)
  window.WebSocket = ObservedWebSocket
})()
