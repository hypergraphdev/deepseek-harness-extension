#!/usr/bin/env node
/** Test driver that sends one image-bearing turn through a Headless Loader composition. */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('vision-bridge driver requires a config path')

const ctx = await boot('vision-bridge-e2e', resolveConfigPath(configPath, undefined))
try {
  const agents = ctx.get('agents')?.roots() ?? []
  const [agent] = agents
  if (agent === undefined || agents.length !== 1) {
    throw new Error(`vision-bridge driver requires exactly one top-level agent, found ${agents.length}`)
  }
  await agent.whenIdle()
  agent.followup(createUserMessage({
    content: [
      { type: 'text', text: 'what is this chart?' },
      {
        type: 'image',
        attachment: {
          attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
          mediaType: 'image/png',
          bytes: 128,
          width: 2,
          height: 2,
          name: 'chart.png',
        },
      },
    ],
    source: { kind: 'user' },
  }))
  await agent.whenIdle()
  await ctx.sessions.flush(agent.session)
} finally {
  await ctx.fiber.dispose()
}
