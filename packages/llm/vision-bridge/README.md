# @deepseek-ai/dsh-vision-bridge

English | [中文](README.zh.md)

Lets a text-only chat model converse over images by transcribing them through a configured multimodal model. The bridge is reactive: images enter the session log unchanged, and when a model request fails with `UNSUPPORTED_CONTENT`, the bridge transcribes every image-bearing `user/message` surface node through the vision route, appends one `vision-bridge/caption` event per image, shadows each node with a text-only replacement (`surfaceOp: replace`, the compaction mechanism), and retries the step. Original events stay append-origin, so the human transcript keeps its images while the model surface carries the transcription. While a route is configured, the `analyze_image` tool lets the text model ask follow-up questions about any logged image, and the API host admits image uploads and model switches that its modality check would otherwise refuse.

## Config

```yaml
- id: vision-bridge
  name: '@deepseek-ai/dsh-vision-bridge'
  config:
    provider: ollama          # provider route serving the vision model
    model: qwen3.6:latest     # provider-owned vision model id
    # prompt: <transcription instruction>   # default asks for a detailed description
    # maxTokens: 1024                       # default; output cap per transcription
```

`provider` and `model` must be set together; a half pair throws at plugin load and is refused at the settings write point. With neither set the bridge mounts dormant: no tool, no admission change, every image-capability refusal keeps its current behavior. The shipped base bundle mounts it dormant; a `vision-bridge:` section in `settings.yaml` (hot-reloaded) supplies or clears the route live, toggling `analyze_image` with it.

## Repair flow

1. A step fails with `UNSUPPORTED_CONTENT` (the text-only adapter refused image content).
2. Every image-bearing `user/message` surface node is transcribed: one bridge call per image (`purpose: 'vision-bridge'`), one durable `vision-bridge/caption` event per transcription.
3. A replacement `user/message` (original source, images swapped for transcription text) shadows the node via `surfaceOp: {op: replace}`; the step retries and derives the text-only history.

A failed transcription warns and delegates, leaving the original failure terminal. Images nested in `tool-result` content are left untouched — replacing a `tool/result` node would break its tool-call pairing — so such sessions still refuse on text-only routes.

## Model Experience

### Transcription replacement

#### What the model sees

After a repair, the derived history carries this text in place of each image (the image itself is gone from the model surface):

##### Replacement text

```markdown
[Image "<name>" (attachment <attachmentId>, <mediaType>, <width>x<height>) transcribed by <model>:]
<transcription>
[The original image is preserved. Call the analyze_image tool with this attachment id to ask specific questions about it.]
```

#### Token effect

Each image costs one auxiliary vision request (bounded by `maxTokens`) and its transcription text rides every later request for that session in place of the image bytes.

#### KV Cache effect

A repair rewrites an existing prefix of the derived history, so the retried request re-reads the full context once; later requests reuse the rewritten prefix append-only.

### `analyze_image` tool

#### What the model sees

While a route is configured, one extra tool schema: `analyze_image(attachment_id, question)` returning `{ answer }`. The transcription text names the attachment id it should pass.

#### Token effect

One tool schema in every request while configured; each call adds one auxiliary vision request plus the answer text as a durable tool result.

#### KV Cache effect

Append-only; tool results follow the reusable request prefix and do not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Transcription is lossy and permanent.** A replaced node never returns to image form: switching the session back to a vision-capable model keeps the transcription, not the image. `analyze_image` is the recovery path for lost detail.
- **`tool-result` images are not bridged** — sessions whose images arrived through tools (e.g. `read_image` on a vision route) still refuse on text-only routes.
- **One transcription per image occurrence.** The same attachment re-sent in a later message is transcribed again; caption events are provenance, not a cache.
- **Proactive bridging is deferred.** The repair costs one refused request per image turn (local serializer refusal, no provider round-trip on the DeepSeek adapter); transcribing at admission time instead is deferred until the reactive path shows real cost.
