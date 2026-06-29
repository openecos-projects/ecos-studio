import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export const supportedAgentProviderProtocolVersion = 1
export const agentProviderManifestFileName = 'agent-provider.json'

export interface AgentProviderManifest {
  args?: string[]
  command: string
  displayName?: string
  providerId: string
  protocolVersion: number
}

export interface ResolvedAgentProviderManifest extends AgentProviderManifest {
  manifestPath: string
  pluginRoot: string
}

export async function discoverAgentProviderManifests(
  roots: string[],
): Promise<ResolvedAgentProviderManifest[]> {
  const manifests: ResolvedAgentProviderManifest[] = []
  const seenManifestPaths = new Set<string>()

  for (const root of roots) {
    for (const manifestPath of await manifestPathsForRoot(root)) {
      if (seenManifestPaths.has(manifestPath)) continue
      seenManifestPaths.add(manifestPath)
      const manifest = await readAgentProviderManifest(manifestPath)
      if (manifest) {
        manifests.push(manifest)
      }
    }
  }

  return manifests.sort((first, second) => first.providerId.localeCompare(second.providerId))
}

async function manifestPathsForRoot(root: string): Promise<string[]> {
  const paths = [path.join(root, agentProviderManifestFileName)]

  try {
    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        paths.push(path.join(root, entry.name, agentProviderManifestFileName))
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  return paths
}

async function readAgentProviderManifest(
  manifestPath: string,
): Promise<ResolvedAgentProviderManifest | null> {
  let raw: string
  try {
    raw = await readFile(manifestPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }

  const manifest = validateAgentProviderManifest(JSON.parse(raw), manifestPath)
  return {
    ...manifest,
    manifestPath,
    pluginRoot: path.dirname(manifestPath),
  }
}

function validateAgentProviderManifest(
  value: unknown,
  manifestPath: string,
): AgentProviderManifest {
  const record = readRecord(value)
  const providerId = readString(record.providerId)
  const command = readString(record.command)
  const displayName = readOptionalString(record.displayName)
  const protocolVersion = record.protocolVersion
  const args = readStringArray(record.args)

  if (!providerId) {
    throw new Error(`Agent provider manifest is missing providerId: ${manifestPath}`)
  }
  if (!command) {
    throw new Error(`Agent provider manifest is missing command: ${manifestPath}`)
  }
  if (protocolVersion !== supportedAgentProviderProtocolVersion) {
    throw new Error(
      `Unsupported agent provider protocol version in ${manifestPath}: ${String(protocolVersion)}`,
    )
  }

  return {
    ...(args ? { args } : {}),
    command,
    ...(displayName ? { displayName } : {}),
    providerId,
    protocolVersion,
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map((item) => String(item))
}
