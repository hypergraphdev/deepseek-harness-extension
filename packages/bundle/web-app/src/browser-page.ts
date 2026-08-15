/**
 * Browser-page request context for the Web surface. A prompt admitted with an
 * extension-reported active page carries it as durable `user/message` source
 * metadata; source metadata never reaches the model, so an eligible step
 * appends one plugin-sourced snapshot message rendering the newest page in
 * the entering batch. Consecutive snapshots deduplicate: an unchanged page
 * injects nothing.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { PromptBrowserPage } from '@deepseek-ai/dsh-host-apiproxy/api'
// Type-only: the 'user-rpc' MessageSourceMap merge carrying browserPage.
import type {} from '@deepseek-ai/dsh-host-apiproxy/api'

/** Durable `source.plugin` name attributing every snapshot this module appends. */
export const BROWSER_PAGE_CONTEXT_SOURCE = 'web-surface-browser-page'

/** The newest extension-reported page state among the step's entering messages; `null` is an explicit "no active page". */
function newestEnteringPage(messages: readonly UserMessage[]): PromptBrowserPage | null | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const source = messages[index]?.source
    if (source !== undefined && source.kind === 'user' && 'browserPage' in source
      && source.browserPage !== undefined) {
      return source.browserPage
    }
  }
  return undefined
}

/** The last snapshot text this module durably injected into the session. */
function latestSnapshotText(agent: Agent): string | undefined {
  for (const event of [...agent.session.events].reverse()) {
    if (event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === BROWSER_PAGE_CONTEXT_SOURCE
      && event.data.source.form === 'snapshot') {
      return event.data.source.sections[0]?.text
    }
  }
  return undefined
}

/** Render one page state as the model-facing snapshot line. */
function renderBrowserPage(page: PromptBrowserPage | null): string {
  if (page === null) {
    return 'The user\'s active browser tab is no longer a web or file page; earlier browser-page snapshots are stale.'
  }
  const title = page.title.length === 0 ? 'untitled page' : JSON.stringify(page.title)
  return `The user's active browser tab is ${title} at ${page.url}.`
}

/**
 * Register a prepended pre-step listener appending deduplicated browser-page
 * snapshots for the lifetime of `ctx`.
 * @param ctx - plugin context; the listener is disposed with it.
 */
export function installBrowserPageContext(ctx: Context): void {
  ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const page = newestEnteringPage(decision.messages)
    if (page === undefined) return decision
    const text = renderBrowserPage(page)
    const latest = latestSnapshotText(agent)
    if (latest === text) return decision
    // A "no active page" report corrects an earlier page snapshot; with no
    // earlier snapshot there is nothing to correct.
    if (page === null && latest === undefined) return decision
    return {
      kind: 'enter',
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text }],
          source: {
            kind: 'plugin',
            plugin: BROWSER_PAGE_CONTEXT_SOURCE,
            form: 'snapshot',
            sections: [{ name: BROWSER_PAGE_CONTEXT_SOURCE, text }],
          },
        }),
      ],
    }
  }, { prepend: true })
}
