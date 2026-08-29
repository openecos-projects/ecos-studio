import { statSync, type Stats } from 'node:fs'
import { join, resolve } from 'node:path'
import type {
  QuickStartBuiltinResource,
  QuickStartBuiltinResources,
} from '@ecos-studio/shared'

export type { QuickStartBuiltinResource, QuickStartBuiltinResources }

export interface QuickStartResourceResolverOptions {
  appPath: string
  isPackaged: boolean
  resourcesPath: string
  stat?: (path: string) => Stats
}

const GCD_RESOURCE = {
  id: 'local:gcd',
  version: 'local',
} as const

const PDK_RESOURCE = {
  id: 'pdk:ics55',
  version: 'local',
} as const

function isRegularFile(path: string, stat: (path: string) => Stats): boolean {
  try {
    return stat(path).isFile()
  } catch {
    return false
  }
}

function isDirectory(path: string, stat: (path: string) => Stats): boolean {
  try {
    return stat(path).isDirectory()
  } catch {
    return false
  }
}

/** Resolve only the checked-in Quick Start layout or its packaged extraResource. */
export function resolveQuickStartResources(
  options: QuickStartResourceResolverOptions,
): QuickStartBuiltinResources {
  const stat = options.stat ?? statSync
  const devRoot = resolve(options.appPath, '..', '..', '..', '..')
  const packagedRoot = join(resolve(options.resourcesPath), 'agent', 'quick-start')
  const root = options.isPackaged ? packagedRoot : devRoot
  const designPath = options.isPackaged
    ? join(root, 'gcd.v')
    : join(root, 'ecc', 'docs', 'examples', 'gcd', 'gcd.v')
  const pdkPath = join(root, 'pdk', 'icsprout55-pdk')
  const designReady = isRegularFile(designPath, stat)
  const pdkReady = isDirectory(pdkPath, stat)

  return {
    design: designReady ? { ...GCD_RESOURCE, path: designPath } : null,
    pdk: pdkReady ? { ...PDK_RESOURCE, path: pdkPath } : null,
    diagnostics: [
      ...(!designReady ? [`Built-in GCD example is unavailable at ${designPath}.`] : []),
      ...(!pdkReady ? [`Built-in ICS55 PDK is unavailable at ${pdkPath}.`] : []),
    ],
  }
}

export class QuickStartResourceService {
  private readonly options: QuickStartResourceResolverOptions

  constructor(options: QuickStartResourceResolverOptions) {
    this.options = options
  }

  getResources(): QuickStartBuiltinResources {
    return resolveQuickStartResources(this.options)
  }
}
