# Extension Edition Changes

English | [中文](EXTENSION-CHANGES.zh.md)

This repository is an independent edition of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) carrying the full upstream history plus the changes below. The companion fork that tracks upstream lives at [hypergraphdev/deepseek-harness](https://github.com/hypergraphdev/deepseek-harness).

## Changes over upstream

### 1. Browser side-panel extension (Chrome Side Panel)

- Adds `apps/extension/`: a Manifest V3 extension that opens the dsh Web GUI in the browser side panel from the toolbar icon;
- Starts the local `dsh web` server on demand through a native-messaging host (`dsh install-browser-host --extension <id>` registers it once; both source and built launches are supported);
- The embedded app's iframe explicitly delegates `microphone` and `clipboard-write`. A cross-origin iframe is granted neither by default, and without the latter a message's copy button fails silently;
- Commits: `051b610f`, `894bbee2`, `90ce867b`, `c6e053d3`.

### 2. Page context and article capture

- **Context**: asking from the side panel tells the agent which tab is active, local `file://` documents (such as PDFs) included. Closing the page emits an explicit "no active page" correction so stale context cannot linger. The context rides the durable `user/message` source metadata into the session log, satisfying upstream's model-visible ⟺ logged invariant; a repeated page is deduplicated, so a snapshot is injected only on change;
- **Read this page**: the "📄 Read page" control turns the active tab into **structured Markdown** carried by your next message. Candidate containers are scored by text volume against link density to pick the article root (the reading-mode approach), then heading levels, tables, fenced code with its language, lists, quotes, links, and images are preserved. Logged-in pages and JS-rendered readers work, which is exactly what `web_fetch` cannot reach. Any selected text comes along. The capture is one-shot and cleared once sent;
- **Images in the article** become absolute-URL Markdown image links — the model receives the address and alt text, not pixels. Combined with the vision bridge below, it can then call `read_image` on the one that matters;
- **Site adapters**: pages whose numbers never touch the DOM (quotes, candlesticks) go through configured adapters — `match` on hostname, `capture` parameters from the URL or DOM, `request` a public endpoint, `extract` the fields worth sending, delivered alongside the article as `<site_data>`. **The engine ships no site knowledge**; adapters live in your own `apps/extension/site-adapters.json` (gitignored — the repository carries only `site-adapters.example.json`);
- **In-page stream sniffing**: for hosts that declare `sniff` in an adapter, and only those, a `window.WebSocket` wrapper is registered into the MAIN world at `document_start`. It decodes the site's own frames, merges the series by bar time, and publishes them for extraction — **read-only**: it sends no frames and changes no application behavior. This is the only way to read charts like TradingView, where the data exists solely on the socket;
- Commits: `4e1e15a3`, `d4899824`, `848d2993`, `275c692a`, `76c4c068`.

### 3. vision-bridge image reading (with pipeline fixes)

- `vision-bridge` lets a text-only model (such as DeepSeek-V4-Flash) read images through a local multimodal model (such as ollama's gemma4): a request refused for carrying images is transcribed into text and retried, and an `analyze_image` tool answers follow-up questions about a specific image;
- This edition closes two gaps in that pipeline: the `read_image` tool's route gate now accepts an armed bridge, and images embedded in tool results are transcribed as well, with the substitution keeping call/result pairing intact;
- Commits: `4683f0e5`, `cfafe74d`, `a3f3f786`.

### 4. Voice input

- A microphone button in the composer toolbar dictates through the Web Speech API; the transcript is appended through the draft state machine, so undo, command tokens, and submit behave exactly as if typed;
- Inside the side panel, recognition runs on the extension's own top-level page and bridges its results back to the app (Chrome refuses the Web Speech API to a cross-origin iframe), with a one-time extension page for granting the microphone;
- Commits: `0b81b3cf`, `44f340a5`, `90ce867b`.

### 5. AI team: local experts and remote teammates

This turns the workstation from "one agent" into "your standing seat plus a team you can call on", along two complementary paths.

**Local experts (in-process, no server at all)** — the main agent starts a local CLI on a sentence and brings the answer back:

- Adds the `codex` and `claude_code` delegation tools (`dsh-base` composes upstream's own `subagent-codex` / `subagent-claude-code` providers), which run the official CLI in the session workspace and return the final answer of a one-shot task;
- "Have codex look at this code" is enough — no hub, no daemon in the path.

**HXA team (across machines, persistently online)** — adds the `packages/hxa/` capability family over a self-hosted [HXA Connect](https://github.com/hypergraphdev/hxa-connect) hub:

- `dsh-hxa` (`ctx.hxa`): the org-level bot connection (contacts, DMs, offline catch-up, WebSocket tickets), with responses validated at the wire and structured error codes. **Fully dormant when unconfigured** — no tools registered, not one token spent;
- `dsh-tool-hxa`: the model tools `hxa_contacts` (roster with presence), `hxa_send` (hand work to a teammate), and `hxa_inbox` (incremental receive with a watermark);
- `dsh-hxa-inbound`: the **inbound bridge** — one WebSocket keeps the local bot online (presence and the coordinator are independent, so neither failure costs the other), and each teammate message wakes a coordinator agent carrying the `hxa:coordinator` persona, which answers through its own `hxa_send`. Messages land via `followup` as a durable `user/message`, satisfying model-visible ⟺ logged;
- Bridge-created agents take the deployment's default model explicitly: the persona's `{{model}}` variable resolves from the agent's own options, so leaving it unset fails prompt assembly before the model is ever called. Their fixed session ids are resume-or-create — persistence refuses to create over an existing log, so a create-only bridge collides on its own id on every run after the first;
- `scripts/connect-teammate.sh <teammate>`: one command hangs a local CLI into the org as an online teammate (reading `HXA_HUB_URL` / `HXA_<NAME>_TOKEN` from the environment or `.env`, with no hardcoded paths; `SLOCK_DAEMON_PACKAGE` can point the daemon at a local checkout);
- Commits: `930b5bc6`, `ae1ee795`, `b9ad8615`, `cb959a02`, `95fe159f`, `c6e053d3`, `d987d77d`.

### 6. Agents sidebar panel

- Adds the `sidebar.agents` slot and the `dsh-client-ui-agents` plugin: a read-only team roster, one row per teammate (presence dot plus role), refreshed on a 20-second poll;
- Data comes from `ctx.hxa` through the host's new same-origin `GET /api/hxa/contacts` route (exact-match routing, cross-site requests refused). While HXA is dormant the route returns 404 and the panel does not render at all, so an unconfigured deployment spends no pixels;
- Commit: `668eb169`.

### 7. WeChat entry point (scan once)

WeChat becomes an entry point to the main agent: you write in WeChat, the local agent answers, and the reply goes straight back to the chat.

- Adds `packages/weixin/`: `dsh-weixin` (`ctx.weixin`) manages one QR-linked WeChat account over the iLink bot protocol. The scan yields a durable credential stored 0600 under the harness home, so **linking happens once** and a restart resumes on its own. The service owns the login state machine, the long-poll receive loop with a persisted cursor, and text send; when the server declares the session expired it unlinks rather than spinning;
- `dsh-weixin-agent` turns that account into a conversation: an inbound message wakes a dedicated agent (with the `weixin:persona` persona — chat register, plain text, since WeChat renders no Markdown), and the assistant text closing that turn is sent back to the sender. The model needs no notion of "WeChat" at all;
- While the turn runs, the chat shows a typing indicator so waiting has feedback. Every indicator failure is swallowed — a missing dot is not worth costing a reply;
- The settings page gains a WeChat section: a QR code while unlinked, and only the account plus an unlink button once linked. **The QR is encoded locally in the panel** — handing the payload to a third-party image service would be handing over the login credential;
- Dormant by default: with no stored credential the service opens no connection and the section shows as unlinked;
- Commits: `c6ef2c8c`, `c6e053d3`, `d987d77d`.

### 8. Interface polish

- The settings page's left navigation gains text labels, with icons distinguished per section (messaging sections use a conversation icon, leaving room for platforms beyond WeChat);
- A message's copy button works again inside the side panel (see the iframe permission delegation in section 1);
- Commit: `c6e053d3`.

## Quick start

1. Build and register the native host (macOS):

```sh
pnpm install && pnpm run build
pnpm dsh install-browser-host --extension <your-extension-id>
```

2. In `chrome://extensions`, enable Developer mode, choose "Load unpacked" and select `apps/extension/`, then re-run the command above with the extension id you get;
3. Click the toolbar icon to open the side panel.

### Enable vision-bridge (optional, needed for image reading)

vision-bridge needs a **local multimodal model** as its transcription engine. Install [ollama](https://ollama.com) and pull one:

```sh
brew install ollama          # or download the installer from ollama.com
ollama pull gemma4:12b       # a small multimodal model, ~7.6 GB; any image-capable model works
ollama serve                 # the desktop build runs this for you
```

Then configure **both** halves in `~/.dsh/settings.yaml` — register ollama as a provider first, then point vision-bridge at it (configuring only the second half leaves the bridge dormant, because the provider does not exist):

```yaml
llm-pi-ai:
  providers:
    ollama:
      displayName: ollama
      apiKeyEnv: OLLAMA_API_KEY
      api: openai-completions
      baseURL: http://127.0.0.1:11434/v1
      defaultInput: [ text, image ]
      models:
        - id: gemma4:12b
vision-bridge:
  provider: ollama
  model: gemma4:12b
```

Settings hot-reload; no restart needed. Once active, images uploaded in a text-model session and local images read through `read_image` are transcribed by gemma4, and the model can ask follow-up questions with `analyze_image`. Keys are case-sensitive — `Model:` instead of `model:` is dropped, leaving the bridge half-configured and dormant.

### Configure site adapters (optional, needed for structured site data)

Copy the example and keep the sites you care about (the file is gitignored and never enters version control):

```sh
cp apps/extension/site-adapters.example.json apps/extension/site-adapters.json
```

Each adapter's fields: `match` selects hostname and path, `capture` reads parameters out of the URL or DOM (a trading pair, a ticker), `request` builds a public endpoint call from them, and `extract` picks the fields worth sending to the model; `sniff` instead reads the page's own WebSocket stream. Reload the extension in `chrome://extensions` to apply changes. The sites in the example file are examples only — delete them all and the extension still works, since article capture does not depend on adapters.

### Call local Codex / Claude (works out of the box)

No configuration. With the official CLIs on `PATH` (`codex`, `claude`), tell the main agent "have codex refactor this function" or "have claude review this code" — it starts the CLI in the current workspace and brings back the final answer. A missing CLI fails that tool call and nothing else.

### Enable the HXA team (optional, needed for cross-machine collaboration)

Requires a self-hosted [HXA Connect](https://github.com/hypergraphdev/hxa-connect) hub (single process plus SQLite; `docker compose up` is enough).

1. **Create the bots on the hub**: one main bot for the workstation (`dsh-main` below) and one per teammate (`codex`, `hermes`, …). Set each bot's runtime afterwards, or the hub falls back to `claude` for all of them:

```sh
curl -X PATCH https://<your-hub>/api/me/profile \
  -H "authorization: Bearer <that bot's token>" \
  -H 'content-type: application/json' \
  -d '{"runtime":"codex"}'   # claude / codex / gemini / cursor / copilot / kimi
```

2. **Configure dsh**: the hub URL goes into `~/.dsh/cordis.patch.yml`, and the main bot's token travels through the environment (the repository-root `.env` will do):

```yaml
- id: hxa
  config:
    url: https://<your-hub>
```

```sh
# .env
HXA_HUB_URL=https://<your-hub>
HXA_BOT_TOKEN=<the main bot's token>
HXA_CODEX_TOKEN=<the codex teammate's token>
```

After a restart the main bot is online, the Agents panel appears in the sidebar, and the main agent has the `hxa_*` tools.

3. **Put a local CLI online as a teammate** (optional):

```sh
scripts/connect-teammate.sh codex
```

While the daemon runs, that bot shows online in the roster and the main agent can hand it work and collect results. Remote teammates (a Hermes deployed on a server, say) join through their own framework's HXA plugin and do not need this script.

### Link WeChat (optional)

No configuration: open the Web GUI's settings page → WeChat → generate the QR → scan it in WeChat and confirm on your phone. The credential is then stored at `~/.dsh/weixin/link.json` (0600), restores itself across restarts, and the QR does not come back. Messages sent to that account are answered by the local agent and the reply goes straight back to the chat; the settings page can unlink at any time.

## Syncing upstream

```sh
git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git
git fetch upstream && git merge upstream/master
```
