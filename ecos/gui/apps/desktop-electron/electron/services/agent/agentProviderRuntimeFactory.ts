import path from 'node:path'
import { AgentProviderProcessRuntime } from './agentProviderProcessRuntime'
import { discoverAgentProviderManifests } from './agentProviderPlugin'
import { AgentRuntimeManager } from './agentRuntimeManager'

export async function createAgentRuntimeFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentRuntimeManager | null> {
  const roots = configuredProviderRoots(env.ECOS_AGENT_PROVIDER_ROOTS)
  if (roots.length === 0) return null

  const manifests = await discoverAgentProviderManifests(roots)
  if (manifests.length === 0) return null

  return new AgentRuntimeManager({
    defaultProviderId: env.ECOS_AGENT_DEFAULT_PROVIDER,
    providers: manifests.map((manifest) => ({
      providerId: manifest.providerId,
      runtime: new AgentProviderProcessRuntime({ env, manifest }),
    })),
  })
}

function configuredProviderRoots(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(path.delimiter)
    .map((root) => root.trim())
    .filter(Boolean)
}
