import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contentHasImage } from '@deepseek-ai/dsh-llm'
import { type SessionEvent } from '@deepseek-ai/dsh-session'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

// Keep the Loader config under examples so both modes exercise the same deployable
// topology: local fixture source plus bare plugins owned by the examples workspace.
const driver = fileURLToPath(new URL(
  '../../../../examples/headless-agent/tests/fixtures/vision-bridge-driver.ts',
  import.meta.url,
))
const configPath = fileURLToPath(new URL(
  '../../../../examples/headless-agent/tests/fixtures/vision-bridge.cordis.yml',
  import.meta.url,
))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

async function jsonlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return jsonlFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return paths.flat()
}

describe('vision-bridge through a real headless cordis.yml', () => {
  it('repairs a text-only route around an image turn and persists the transcription', async () => {
    let events: SessionEvent[] = []
    const { stderr } = await runLoaderSmoke({
      label: 'vision-bridge headless smoke',
      tempDirPrefix: 'vision-bridge-e2e-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        const logs = await jsonlFiles(join(cwd, '.sessions'))
        expect(logs).toHaveLength(1)
        const lines = (await readFile(logs[0] as string, 'utf8')).trimEnd().split('\n')
        events = lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
      },
    })
    expect(stderr).not.toContain('UNHANDLED')

    // The transcription is durable provenance beside the replacement node.
    const captions = events.filter(
      (event): event is SessionEvent<'vision-bridge/caption'> => event.type === 'vision-bridge/caption')
    expect(captions).toHaveLength(1)
    expect(captions[0]!.data.text).toBe('a red daily candlestick chart')
    expect(captions[0]!.data).toMatchObject({ provider: 'vb-vision', model: 'vision-mock' })

    // The original image message survives append-origin; the replacement
    // shadows it with the transcription for the model surface.
    const userMessages = events.filter(
      (event): event is SessionEvent<'user/message'> => event.type === 'user/message')
    expect(userMessages.some(event => event.surfaceOp === 'append' && contentHasImage(event.data.content))).toBe(true)
    const replacement = userMessages.find(event => typeof event.surfaceOp === 'object')
    expect(replacement).toBeDefined()
    expect(contentHasImage(replacement!.data.content)).toBe(false)

    // The text-only model answered from the transcription after the retry.
    const answers = events.filter(
      (event): event is SessionEvent<'assistant/message'> => event.type === 'assistant/message')
    const finalText = answers.at(-1)!.data.message.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('')
    expect(finalText).toBe('answer built from transcription')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
