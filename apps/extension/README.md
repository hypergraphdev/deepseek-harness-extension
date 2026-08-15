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
