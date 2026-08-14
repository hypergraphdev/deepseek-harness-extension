import type { Context } from '@deepseek-ai/cordis'
import { contentHasImage, LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

/** One deterministic text response as a chunk stream. */
function* textChunks(text: string): Iterable<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** Text-only chat adapter: refuses image content exactly like the DeepSeek serializer. */
class VbChatAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.messages.some(message => contentHasImage(message.content))) {
      throw new LlmError('the vb-chat fixture adapter does not support image content', 'UNSUPPORTED_CONTENT')
    }
    const sawTranscription = options.messages
      .flatMap(message => message.content)
      .some(block => block.type === 'text' && block.text.includes('transcribed by'))
    yield* textChunks(sawTranscription ? 'answer built from transcription' : 'no transcription present')
  }
}

/** Vision adapter: transcribes any request into one fixed caption. */
class VbVisionAdapter extends LlmAdapter {
  async * stream(): AsyncIterable<StreamChunk> {
    yield* textChunks('a red daily candlestick chart')
  }
}

export const name = 'vision-bridge-mock-llm'
export const inject = ['llm']

/** Register the test-only `vb-chat` and `vb-vision` adapters. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['vb-chat'], new VbChatAdapter())
  ctx.llm.registerAdapter(['vb-vision'], new VbVisionAdapter())
}
