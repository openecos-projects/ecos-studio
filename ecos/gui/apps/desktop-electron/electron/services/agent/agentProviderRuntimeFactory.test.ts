import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AgentRuntimeManager } from './agentRuntimeManager'
import { createAgentRuntimeFromEnvironment } from './agentProviderRuntimeFactory'

describe('ECOS Agent provider runtime factory', () => {
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
          providerId: 'ecos_agent',
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

  it('loads the in-tree provider when no extension root is configured', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ecos-agent-'))
    try {
      await writeFile(
        path.join(root, 'agent-provider.json'),
        JSON.stringify({
          command: 'uv',
          protocolVersion: 1,
          providerId: 'ecos_agent',
        }),
      )

      await expect(createAgentRuntimeFromEnvironment({}, root)).resolves.toBeInstanceOf(
        AgentRuntimeManager,
      )
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('keeps the in-tree manifest when an extension repeats its provider ID', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ecos-agent-'))
    const extension = await mkdtemp(path.join(tmpdir(), 'ecos-agent-extension-'))
    try {
      const manifest = JSON.stringify({
        command: 'uv',
        protocolVersion: 1,
        providerId: 'ecos_agent',
      })
      await writeFile(path.join(root, 'agent-provider.json'), manifest)
      await writeFile(path.join(extension, 'agent-provider.json'), manifest)

      await expect(
        createAgentRuntimeFromEnvironment({ ECOS_AGENT_PROVIDER_ROOTS: extension }, root),
      ).resolves.toBeInstanceOf(AgentRuntimeManager)
    } finally {
      await rm(root, { force: true, recursive: true })
      await rm(extension, { force: true, recursive: true })
    }
  })

  it('expands a home-relative configured provider root', async () => {
    const root = await mkdtemp(path.join(homedir(), 'ecos-agent-root-'))
    try {
      await writeFile(
        path.join(root, 'agent-provider.json'),
        JSON.stringify({
          command: 'ecos-agent',
          protocolVersion: 1,
          providerId: 'ecos_agent',
        }),
      )
      const relativeRoot = path.relative(homedir(), root)

      await expect(
        createAgentRuntimeFromEnvironment({
          ECOS_AGENT_PROVIDER_ROOTS: `~/${relativeRoot}`,
        }),
      ).resolves.toBeInstanceOf(AgentRuntimeManager)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
