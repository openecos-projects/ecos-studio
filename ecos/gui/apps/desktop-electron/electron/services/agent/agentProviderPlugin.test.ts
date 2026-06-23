import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  discoverAgentProviderManifests,
  supportedAgentProviderProtocolVersion,
} from './agentProviderPlugin'

describe('agent provider plugin manifests', () => {
  it('discovers provider manifests from plugin roots and resolves command cwd', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ecos-agent-provider-'))
    try {
      const pluginRoot = path.join(root, 'codex')
      await mkdir(pluginRoot)
      await writeFile(path.join(pluginRoot, 'agent-provider.json'), JSON.stringify({
        args: ['--stdio'],
        command: './bin/codex-provider',
        displayName: 'Codex',
        providerId: 'codex',
        protocolVersion: supportedAgentProviderProtocolVersion,
      }))

      await expect(discoverAgentProviderManifests([root])).resolves.toEqual([
        {
          args: ['--stdio'],
          command: './bin/codex-provider',
          displayName: 'Codex',
          manifestPath: path.join(pluginRoot, 'agent-provider.json'),
          pluginRoot,
          providerId: 'codex',
          protocolVersion: supportedAgentProviderProtocolVersion,
        },
      ])
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('rejects provider manifests with unsupported protocol versions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ecos-agent-provider-'))
    try {
      await writeFile(path.join(root, 'agent-provider.json'), JSON.stringify({
        command: 'codex-provider',
        providerId: 'codex',
        protocolVersion: supportedAgentProviderProtocolVersion + 1,
      }))

      await expect(discoverAgentProviderManifests([root])).rejects.toThrow(
        'Unsupported agent provider protocol version',
      )
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
