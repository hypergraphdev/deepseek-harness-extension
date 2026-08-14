# Agent Note: Vision bridge for text-only models

Status: implemented

English | [中文](2026-08-14-vision-bridge-for-text-only-models.zh.md)

## Problem

Text-only routes (the DeepSeek adapter declares `inputModalities: ['text']`) refuse image conversations twice: the API host rejects image uploads at admission, and the adapter throws `UNSUPPORTED_CONTENT` if an image ever reaches serialization. Deployments that also run a local multimodal model (e.g. Ollama-served Qwen) had no way to let the text model use it, even though the harness already routes auxiliary model calls for compaction and session titles.

## Decision

**A reactive repair on `agent/request-error`, not a request-time rewrite.** `@deepseek-ai/dsh-vision-bridge` mounts a `visionBridge` service (dormant until a `vision-bridge:` settings section or composition entry names a provider/model pair). Images enter the session log unchanged. When a step fails with `UNSUPPORTED_CONTENT` and a route is configured, the bridge transcribes each image in every image-bearing `user/message` surface node through the vision route (`purpose: 'vision-bridge'`), appends one `vision-bridge/caption` event per image, shadows each node with a text-only replacement via `surfaceOp: {op: replace}` — the compaction mechanism — and returns `{kind: 'retry'}`. The agent-loop invariant (request messages must equal the dispatch-time durable derivation) holds by construction because the replacement is durable before the retry derives.

**The human transcript keeps its images.** Replacement nodes are model-only by the surface contract; append-origin events remain the transcript source, so the UI still shows the original image and the attachment stays log-referenced for authorized reads.

**Follow-up questions go through a route-gated tool.** `analyze_image(attachment_id, question)` registers only while a route resolves (settings changes toggle it live) and answers by sending the durable image reference plus the question to the vision route. The replacement text quotes the attachment id and names the tool, so the text model can recover detail the transcription dropped.

**Admission relaxes only when the bridge can serve.** The API host's two image gates (prompt admission, model switching) now also pass when `ctx.get('visionBridge')?.route()` resolves, via a type-only import — a composition without the bridge keeps exactly the old refusals.

## Consequences

- One refused request precedes each repair (the DeepSeek adapter refuses at serialization, before any provider round-trip), and the repair rewrites a derived-history prefix, so the retried request re-reads the full context once.
- Transcription is lossy and permanent for the model surface: a session switched back to a vision-capable model keeps the transcription, with `analyze_image` as the recovery path for lost detail.
- Images nested in `tool-result` content are not bridged; those sessions still refuse on text-only routes.
- `GenerateOptions.purpose` gains `'vision-bridge'`, and the base bundle mounts the package dormant, so unconfigured deployments keep exactly the prior behavior.

## Alternatives considered

**Transcribe at `agent/pre-step` by rewriting the entering messages.** Rejected: the swapped message becomes the durable `user/message`, erasing the image from the human transcript and from attachment authorization; the reactive path preserves both and needs no route detection at claim time (pre-step route guesses go stale across model switches in both directions).

**Rewrite messages in the `llm/stream` waterfall.** Rejected: the loop's request-reconstruction invariant compares dispatched messages against the durable derivation, and the architecture reserves message mutation for logged channels.

**A subagent delegation (`tool-subagent` instance pinned to the vision model).** Rejected as the primary path: it hands the whole turn to the vision model instead of letting the selected text model answer, and it cannot repair histories that already contain images. The config machinery for it already exists if a deployment wants it.

**Eager transcription at upload admission.** Deferred: it saves one locally-refused request per image turn but spends a vision call even when the session's model can see images natively (per-session selections change), and it moves the bridge into the host's admission path. Reconsider if the refused-request cost shows up in practice.
