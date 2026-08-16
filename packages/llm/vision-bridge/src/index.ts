/**
 * Vision bridge service: lets a text-only chat model converse over images by
 * transcribing them through a configured multimodal model.
 *
 * The bridge is reactive: images enter the session log unchanged, and when a
 * model request fails with `UNSUPPORTED_CONTENT`, the bridge transcribes every
 * image-bearing `user/message` surface node through the configured vision
 * route, shadows each node with a text-only replacement (`surfaceOp: replace`,
 * the compaction mechanism), and retries the step. The original events stay in
 * the log, so the human transcript keeps its images while the model surface
 * carries the transcription. The `analyze_image` tool lets the text model ask
 * follow-up questions about any logged image.
 * @module @deepseek-ai/dsh-vision-bridge
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { BlockAssembler, contentHasImage, createUserMessage, finishReasonError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, ImageBlock } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-agent'
import { registerAnalyzeImageTool } from './tool.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Vision bridge for text-only model routes; dormant until a route is configured. */
    visionBridge: VisionBridge
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One image transcription produced by the vision bridge while repairing a
     * text-only model request: the transcribed attachment, the vision route
     * that produced the text, and the transcription itself. Log-only
     * provenance beside the replacement `user/message` node that carries the
     * same text into the model surface.
     */
    'vision-bridge/caption': VisionBridgeCaption
  }
}

/** Payload of one `vision-bridge/caption` session event. */
export interface VisionBridgeCaption {
  /** The transcribed image's durable attachment reference. */
  attachment: ImageAttachmentRef
  /** Provider route that served the transcription. */
  provider: string
  /** Vision model that produced the transcription. */
  model: string
  /** The transcription text substituted for the image. */
  text: string
}

/** Settings namespace carrying the bridge route (`vision-bridge:` in `settings.yaml`). */
export const VISION_BRIDGE_SETTINGS_NAMESPACE = settingsNamespace('vision-bridge')

/**
 * Bridge configuration: the vision route plus the transcription request
 * envelope. `provider` and `model` must be set together; with neither set the
 * bridge stays dormant and every image-capability refusal keeps its current
 * behavior.
 */
export interface Config {
  /** Registered provider route serving the vision model. */
  provider?: string
  /** Provider-owned vision model id. */
  model?: string
  /**
   * Transcription instruction sent beside each image (default asks for a
   * detailed description with exact text transcription).
   */
  prompt?: string
  /** Output cap for one transcription request (default 1024). */
  maxTokens?: number
}

/** Default transcription instruction: detail-first so chart data and text survive the modality drop. */
const DEFAULT_PROMPT
  = 'Describe this image in comprehensive detail for a text-only assistant that cannot see it. '
  + 'Transcribe any visible text exactly. For charts and diagrams, name the axes, series, values, '
  + 'and trends. Include layout, colors, and any detail a reader would need to answer questions '
  + 'about the image.'

/** A resolved bridge route: both halves present and non-empty. */
export interface VisionBridgeRoute {
  /** Registered provider route serving the vision model. */
  provider: string
  /** Provider-owned vision model id. */
  model: string
}

/**
 * Reject a half-configured route: `provider` and `model` are only meaningful
 * as a pair, and a silent half-route would surface later as a confusing
 * `UNKNOWN_MODEL` at transcription time.
 * @param value - the candidate configuration.
 */
function validatePair(value: Config): void {
  const provider = value.provider ?? ''
  const model = value.model ?? ''
  if ((provider.length > 0) !== (model.length > 0)) {
    throw new Error('vision-bridge: `provider` and `model` must be configured together')
  }
}

/**
 * The model-facing text substituted for one transcribed image. Names the
 * attachment id so the model can hand it to `analyze_image` for follow-up
 * questions about the original.
 * @param attachment - the transcribed image's attachment reference.
 * @param model - the vision model that produced the transcription.
 * @param text - the transcription.
 * @returns the substitution text carried by the replacement message.
 */
export function transcriptionText(attachment: ImageAttachmentRef, model: string, text: string): string {
  const label = attachment.name === undefined ? '' : ` "${attachment.name}"`
  return `[Image${label} (attachment ${attachment.attachmentId}, ${attachment.mediaType}, `
    + `${attachment.width}x${attachment.height}) transcribed by ${model}:]\n${text}\n`
    + '[The original image is preserved. Call the analyze_image tool with this attachment id '
    + 'to ask specific questions about it.]'
}

/**
 * Owns the bridge route and the transcription flow. The composition entry
 * remains usable without a settings provider; when one is mounted, the
 * `vision-bridge:` section is read live and toggles the `analyze_image` tool
 * with the route.
 */
export class VisionBridge extends Service {
  static Config: z<Config> = z.object({
    provider: z.string(),
    model: z.string(),
    prompt: z.string().default(DEFAULT_PROMPT),
    maxTokens: z.number().step(1).min(1).default(1024),
  })

  static inject = ['llm']

  private source: () => Config
  private syncToolRegistration: (() => void) | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'visionBridge')
    validatePair(config)
    this.source = () => config
    installSettingsSection(ctx, VISION_BRIDGE_SETTINGS_NAMESPACE, VisionBridge.Config, config, {
      setSource: (current) => { this.source = current },
      onChange: () => this.syncToolRegistration?.(),
      validate: validatePair,
    })

    ctx.on('agent/request-error', async ({ agent, failure, signal }, next) => {
      // Cancellation surfaces inside transcription via `signal.throwIfAborted()`.
      if (failure.code !== 'UNSUPPORTED_CONTENT') return next()
      const route = this.route()
      if (route === undefined) return next()
      let replaced: boolean
      try {
        replaced = await this.transcribeImageMessages(agent.session, route, signal)
      } catch (error: unknown) {
        ctx.logger.warn(`vision-bridge: transcription failed: ${String(error)}; leaving the original failure terminal`)
        return next()
      }
      if (!replaced) return next()
      return { kind: 'retry' }
    })

    ctx.inject(['tools'], (toolCtx) => {
      let dispose: (() => void) | undefined
      const sync = (): void => {
        const route = this.route()
        if (route !== undefined && dispose === undefined) {
          dispose = registerAnalyzeImageTool(toolCtx, this)
        } else if (route === undefined && dispose !== undefined) {
          const disposeTool = dispose
          dispose = undefined
          disposeTool()
        }
      }
      toolCtx.effect(() => {
        sync()
        this.syncToolRegistration = sync
        return () => {
          this.syncToolRegistration = undefined
          dispose?.()
          dispose = undefined
        }
      }, 'visionBridge.analyzeImageTool')
    })
  }

  /**
   * Read the currently configured bridge route.
   * @returns the provider/model pair, or undefined while the bridge is dormant.
   */
  route(): VisionBridgeRoute | undefined {
    const current = this.source()
    const provider = current.provider ?? ''
    const model = current.model ?? ''
    if (provider.length === 0 || model.length === 0) return undefined
    return { provider, model }
  }

  /**
   * Transcribe one image through the configured vision route.
   * @param image - the image block to describe; bytes resolve through the attachment service at the adapter.
   * @param instruction - the transcription instruction; the configured prompt when undefined.
   * @param context - the requesting session id and cancellation signal.
   * @returns the non-empty transcription text.
   */
  async describe(
    image: ImageBlock,
    instruction: string | undefined,
    context: { sessionId?: Session['id']; signal?: AbortSignal },
  ): Promise<string> {
    const route = this.route()
    if (route === undefined) {
      throw new Error('vision-bridge: no vision route is configured; set `provider` and `model` in the `vision-bridge` settings section')
    }
    const current = this.source()
    // schemastery's .default() guarantees both fields after validation; the assertions
    // narrow the user-writable optional Config type without a dead fallback branch.
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- tsc needs the narrowing inside the `??` chain
    const prompt = instruction ?? current.prompt as string
    const maxTokens = current.maxTokens as number
    const assembler = new BlockAssembler()
    const options: GenerateOptions = {
      provider: route.provider,
      model: route.model,
      messages: [createUserMessage({
        content: [image, { type: 'text', text: prompt }],
        source: { kind: 'plugin', plugin: 'vision-bridge' },
      })],
      maxTokens,
      purpose: 'vision-bridge',
      ...context.sessionId === undefined ? {} : { sessionId: context.sessionId },
      ...context.signal === undefined ? {} : { signal: context.signal },
    }
    for await (const chunk of this.ctx.llm.stream(options)) assembler.push(chunk)
    const error = finishReasonError(assembler.finish, 'vision-bridge: transcription truncated at the token cap; raise `maxTokens`')
    if (error !== undefined) throw error
    const text = assembler.blocks()
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim()
    if (text.length === 0) {
      throw new Error(`vision-bridge: model "${route.model}" returned an empty transcription`)
    }
    return text
  }

  /**
   * Shadow every image-bearing `user/message` and `tool/result` surface node
   * with a same-type text-only replacement built from per-image
   * transcriptions. A tool result is replaced by a tool result carrying the
   * same call identity, so tool-call pairing is preserved.
   * @param session - the session whose surface is repaired.
   * @param route - the resolved vision route serving the transcriptions.
   * @param signal - the turn abort signal.
   * @returns whether at least one node was replaced (the retry precondition).
   */
  private async transcribeImageMessages(
    session: Session,
    route: VisionBridgeRoute,
    signal: AbortSignal,
  ): Promise<boolean> {
    let replaced = false
    // Snapshot: each replacement rewrites the live surface while iterating.
    for (const seq of [...session.surface.nodes]) {
      signal.throwIfAborted()
      const event = session.events.find(candidate => candidate.seq === seq)
      if (event?.type === 'user/message') {
        const message = event.data
        if (!contentHasImage(message.content)) continue
        const { content, captionSeqs } = await this.transcribeBlockList(message.content, session, route, signal)
        if (contentHasImage(content)) continue
        session.append('user/message', { ...message, content }, {
          surfaceOp: { op: 'replace', start: seq, end: seq },
          sourceEventSeqs: [...captionSeqs, seq],
        })
        replaced = true
      } else if (event?.type === 'tool/result') {
        // The images sit inside the tool-result block, the only part a
        // tool/result replacement may change.
        const message = event.data.message
        // `ToolResultMessage.content` is the one-tuple `[ToolResultBlock]`.
        const [result] = message.content
        if (!contentHasImage(result.content)) continue
        const { content, captionSeqs } = await this.transcribeBlockList(result.content, session, route, signal)
        if (contentHasImage(content)) continue
        session.append('tool/result', {
          ...event.data,
          message: { ...message, content: [{ ...result, content }] },
        }, {
          surfaceOp: { op: 'replace', start: seq, end: seq },
          sourceEventSeqs: [...captionSeqs, seq],
        })
        replaced = true
      }
    }
    return replaced
  }

  /**
   * Transcribe every image block in one flat block list, appending a durable
   * caption event per image.
   * @param blocks - the block list to repair.
   * @param session - the session receiving caption events.
   * @param route - the resolved vision route serving the transcriptions.
   * @param signal - the turn abort signal.
   * @returns the repaired list plus the appended caption seqs.
   */
  private async transcribeBlockList(
    blocks: readonly ContentBlock[],
    session: Session,
    route: VisionBridgeRoute,
    signal: AbortSignal,
  ): Promise<{ content: ContentBlock[]; captionSeqs: number[] }> {
    const captionSeqs: number[] = []
    const content: ContentBlock[] = []
    for (const block of blocks) {
      if (block.type !== 'image') {
        content.push(block)
        continue
      }
      const text = await this.describe(block, undefined, { sessionId: session.id, signal })
      const caption = session.append('vision-bridge/caption', {
        attachment: block.attachment,
        provider: route.provider,
        model: route.model,
        text,
      })
      captionSeqs.push(caption.seq)
      content.push({ type: 'text', text: transcriptionText(block.attachment, route.model, text) })
    }
    return { content, captionSeqs }
  }
}

export default VisionBridge
