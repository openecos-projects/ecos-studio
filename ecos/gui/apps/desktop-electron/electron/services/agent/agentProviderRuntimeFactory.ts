import { homedir } from 'node:os'
import path from 'node:path'
import { AgentProviderProcessRuntime } from './agentProviderProcessRuntime'
import { discoverAgentProviderManifests } from './agentProviderPlugin'
import { AgentRuntimeManager } from './agentRuntimeManager'

export async function createAgentRuntimeFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  builtInProviderRoot?: string,
): Promise<AgentRuntimeManager | null> {
  const roots = configuredProviderRoots(
    env.ECOS_AGENT_PROVIDER_ROOTS,
    builtInProviderRoot,
  )
  if (roots.length === 0) return null

  const manifests = await discoverAgentProviderManifests(roots)
  if (manifests.length === 0) return null
  const providers = manifests.filter(
    (manifest, index) =>
      manifests.findIndex(({ providerId }) => providerId === manifest.providerId) ===
      index,
  )

  return new AgentRuntimeManager({
    defaultProviderId:
      env.ECOS_AGENT_DEFAULT_PROVIDER ??
      providers.find(({ providerId }) => providerId === 'ecos_agent')?.providerId,
    providers: providers.map((manifest) => ({
      providerId: manifest.providerId,
      runtime: new AgentProviderProcessRuntime({ env, manifest }),
    })),
  })
}

function configuredProviderRoots(
  value: string | undefined,
  builtInProviderRoot: string | undefined,
): string[] {
  const configured = value
    ? value
        .split(path.delimiter)
        .map((root) => root.trim())
        .filter(Boolean)
        .map(resolveProviderRoot)
    : []
  return builtInProviderRoot
    ? [resolveProviderRoot(builtInProviderRoot), ...configured]
    : configured
}

function resolveProviderRoot(root: string): string {
  const expanded = root === '~' ? homedir() : root.replace(/^~(?=[/\\])/, homedir())
  return path.resolve(expanded)
}
