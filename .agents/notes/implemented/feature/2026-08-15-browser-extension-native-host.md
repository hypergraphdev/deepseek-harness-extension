# Agent Note: Browser extension through a native-messaging launcher

Status: implemented

English | [中文](2026-08-15-browser-extension-native-host.zh.md)

## Problem

Using dsh from a browser meant manually running `pnpm dsh web` in a terminal and keeping a tab on the printed URL. A browser extension would make the product one click away and add page context later, but extensions cannot listen on ports, spawn processes, or touch the filesystem — every local capability dsh is built on — so a "pure extension" port would gut the product.

## Decision

**A thin side-panel shell over the existing web app, powered by a native-messaging launcher.** The extension (`apps/extension`, static MV3, no build) dials the registered `ai.deepseek.dsh` host; `dsh browser-host` answers `{type:'ensure'}` by reusing or launching a detached `dsh web` and replying with its URL; the panel embeds that URL in an iframe. The embedded app is same-origin with the server, so the existing browser trust fence (Host/Origin/Sec-Fetch-Site) passes untouched and no server change is needed — the server sends no frame-blocking headers, and the readiness contract is the documented `dsh web: http://…` stdout line supervisors already consume.

**Reuse detection is a protocol signature, not a port assumption.** A plain GET on `/api/events.mux` answers `426 Upgrade Required` only on a dsh server; any other response refuses with a clear diagnostic instead of embedding a foreign service.

**The installer writes dsh-managed artifacts that heal by re-running.** `dsh install-browser-host --extension <id>` overwrites a `#!/bin/sh` shim under `$DSH_HOME/browser-host/` (pinning `process.execPath`, `execArgv`, and the entry's absolute path — never npm's `.bin` shim, per the repository's Windows-spawnability rule) and one manifest per browser in the macOS NativeMessagingHosts directories, `allowed_origins` locked to the given extension id.

## Consequences

- The extension holds only `sidePanel` + `nativeMessaging`; every agent capability keeps living in the user-launched local process, so the security posture of `dsh web` is unchanged.
- The spawned server is detached and outlives the native host; closing the panel does not stop it.
- `apps/extension` carries no `package.json` by design: adding one would make it a published workspace member under `check-workspace-constraints`, which this static directory does not want.
- The CLI gains two modes (`browser-host`, `install-browser-host`) with the launcher's existing commander/dispatch pattern.

## Alternatives considered

**A pure in-extension agent runtime.** Rejected for now: it forfeits shell, subprocess, LSP, and native sandboxing, and requires browser-side providers (IndexedDB persistence, File System Access) that do not exist yet; the plugin architecture keeps this open as a later profile.

**Speaking the RPC protocol over native-messaging stdio.** Rejected: it duplicates the transport behind a 1 MB per-message host-to-browser cap, while the launcher pattern reuses the existing WebSocket transport and boot-manifest injection unchanged.

**Direct extension-page fetches to the server.** Rejected: the trust fence refuses `chrome-extension://` origins by design, and whitelisting them would widen the server's cross-origin surface for no gain over the same-origin iframe.
