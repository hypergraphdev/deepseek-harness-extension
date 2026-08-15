# DeepSeek Harness browser extension

English | [中文](README.zh.md)

A static MV3 side-panel shell for the local dsh web app. The panel dials the `ai.deepseek.dsh` native-messaging host (`dsh browser-host`), which reuses or launches a detached `dsh web` server on port 3080 and reports its URL; the panel then hands itself to that URL in an iframe. The embedded app is same-origin with the server, so its RPC and WebSocket connections pass the server's browser trust fence exactly as a normal tab would — the extension holds no capability of its own beyond `sidePanel` and `nativeMessaging`.

## Install

1. Load this directory unpacked: `chrome://extensions` → Developer mode → *Load unpacked* → `apps/extension`. Note the generated extension id.
2. Register the native host once: `dsh install-browser-host --extension <id>` (add `--browser edge` for Edge; macOS only for now).
3. Click the toolbar icon. The panel starts the server when none is running and embeds it when ready; without a registered host it shows these instructions instead.

This directory deliberately has no `package.json`: it is not a workspace member, not published, and needs no build — the browser loads the files as-is.

## Known Limitations and Deferred Work

- **macOS Chrome/Edge only.** Linux/Windows manifest paths and a `.bat` shim are deferred until someone needs them; Firefox uses a different manifest key (`allowed_extensions`) and is out of scope.
- **Fixed default port.** The shim records `--port` at install time; the panel has no per-session port picker.
- **No automated extension tests.** The native-host protocol, probe, launch, and installer artifacts are covered by `apps/cli/tests/browser-host.spec.ts`; the panel script itself is exercised manually, as the repository has no MV3 harness.
- **No store packaging.** Icons, versioning, and web-store publication are deferred; the extension is loaded unpacked from the repository.

## Page capture

The panel's capture pill extracts the active tab as Markdown — headings, tables, code blocks, lists, links, and image addresses survive as structure — plus whatever the user had highlighted. It rides the next prompt as one text part and is cleared after sending.

### Site adapters

Pages whose numbers live in a chart's own stream rather than the DOM need a site adapter. Adapters are **yours, not shipped**: copy `site-adapters.example.json` to `site-adapters.json` beside it and edit. Each entry matches a hostname, captures values out of the URL or DOM, optionally fetches a public endpoint, and hands the parsed payload to the agent beside the article.

```jsonc
{
  "name": "my-quotes",
  "match": "(^|\\.)example\\.com$",
  "capture": { "code": { "from": "url", "pattern": "/quote/(\\w+)", "group": 1 } },
  "request": "https://api.example.com/candles?symbol={code}",
  "extract": "\\((.*)\\)\\s*;?\\s*$"   // optional: unwrap a JSONP callback
}
```

#### Streamed data (`sniff`)

A chart that pushes its series over the page's own WebSocket puts nothing in the DOM, so no request can fetch it. Such an adapter sets `"sniff": true` and lists the hosts to observe:

```jsonc
{
  "name": "my-chart",
  "match": "(^|\\.)example\\.com$",
  "sniff": true,
  "sniffMatches": ["https://*.example.com/*"]
}
```

The background worker then registers `stream-sniffer.js` as a MAIN-world content script at `document_start` for those hosts only — early enough to wrap `window.WebSocket` before the page opens one. It reads frames as they pass and never modifies, blocks, or sends any; the decoded series waits on `window.__dshStream` until a capture reads it. Reload the extension after editing the file so the registration follows, and open the chart before capturing: the sniffer only sees frames that arrive while it is installed. The frame format it decodes is TradingView's; another stream shape needs its own sniffer.

`site-adapters.json` is git-ignored. The engine itself knows no sites; without the file, capture stays reading-mode only and no page script is ever registered.
