/**
 * The model-facing `analyze_image` tool: answers a question about an image
 * already logged in the calling session by routing it through the vision
 * bridge. Registered only while a bridge route is configured, so a dormant
 * bridge never advertises an unusable tool.
 * @module @deepseek-ai/dsh-vision-bridge/src/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import { deriveEventMessage } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type VisionBridge from './index.ts'

/**
 * Collect every image attachment reference nested in typed model content,
 * walking tool-result nesting with the same depth rule as `contentHasImage`.
 * @param content - typed model content blocks.
 * @param into - accumulator receiving each reference in document order.
 */
function collectImageRefs(content: readonly ContentBlock[], into: ImageAttachmentRef[]): void {
  for (const block of content) {
    if (block.type === 'image') into.push(block.attachment)
    else if (block.type === 'tool-result') collectImageRefs(block.content, into)
  }
}

/**
 * Resolve an attachment id against the images the session log references.
 * Original events are scanned (not the live surface) so an image shadowed by
 * a bridge replacement stays addressable, and `vision-bridge/caption` events
 * keep their transcribed attachment reachable by construction.
 * @param session - the calling agent's session.
 * @param attachmentId - the model-supplied attachment id.
 * @returns the durable reference, or undefined when the log never referenced it.
 */
export function referencedImageRef(session: Session, attachmentId: string): ImageAttachmentRef | undefined {
  const refs: ImageAttachmentRef[] = []
  for (const event of session.events) {
    if (event.type === 'vision-bridge/caption') {
      refs.push(event.data.attachment)
      continue
    }
    const message: Message | null = deriveEventMessage(event)
    if (message !== null) collectImageRefs(message.content, refs)
  }
  return refs.find(ref => ref.attachmentId === attachmentId)
}

/**
 * Register the `analyze_image` tool. The bridge owns registration timing:
 * the tool exists only while {@link VisionBridge.route} resolves, and the
 * returned disposer retracts it when the route is cleared.
 * @param ctx - the registration scope carrying the `tools` service.
 * @param bridge - the owning bridge serving each transcription request.
 * @returns the registration's disposer.
 */
export function registerAnalyzeImageTool(ctx: Context, bridge: VisionBridge): () => void {
  return ctx.tools.register(defineTool({
    name: 'analyze_image',
    description: 'Answer a question about an image from this conversation by consulting a vision model. '
      + 'Use the attachment id quoted in the image transcription (e.g. from "[Image … (attachment sha256:…)]").',
    parameters: {
      attachment_id: { type: 'string', required: true, description: 'Attachment id of the image, as quoted in its transcription.' },
      question: { type: 'string', required: true, description: 'The specific question to answer about the image.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          answer: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.answer }],
    },
    // Read-only over durable attachments; concurrent questions cannot conflict.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.attachment_id.trim().length === 0) throw new Error('attachment_id must be a non-empty string')
      if (args.question.trim().length === 0) throw new Error('question must be a non-empty string')
      if (!exec.agent) throw new Error('analyze_image requires an owning agent session')
      const ref = referencedImageRef(exec.agent.session, args.attachment_id)
      if (ref === undefined) {
        throw new Error(`no image with attachment id "${args.attachment_id}" is referenced by this conversation`)
      }
      const answer = await bridge.describe(
        { type: 'image', attachment: ref },
        args.question,
        { sessionId: exec.agent.session.id, signal: exec.signal },
      )
      return { answer }
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: 'Analyze image',
        kind: 'read',
        rawInput: args,
      }
    },
  }))
}
