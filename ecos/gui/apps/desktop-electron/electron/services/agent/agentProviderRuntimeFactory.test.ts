import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AgentRuntimeManager } from './agentRuntimeManager'
import { createAgentRuntimeFromEnvironment } from './agentProviderRuntimeFactory'

describe('Flow Agent provider runtime factory', () => {
  it('stays disabled until an explicit provider root is configured', async () => {
    await expect(createAgentRuntimeFromEnvironment({})).resolves.toBeNull()
  })

  it('loads a provider manifest from the configured root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ecos-flow-agent-'))
    try {
      await writeFile(
        path.join(root, 'agent-provider.json'),
        JSON.stringify({
          command: 'uv',
          protocolVersion: 1,
          providerId: 'flow_agent',
        }),
      )

      const runtime = await createAgentRuntimeFromEnvironment({
        ECOS_AGENT_PROVIDER_ROOTS: root,
      })

      expect(runtime).toBeInstanceOf(AgentRuntimeManager)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
