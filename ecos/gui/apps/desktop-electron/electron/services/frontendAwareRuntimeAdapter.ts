import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DesignToolRuntimeAdapter } from './designToolRuntimeAdapter'
import { EccCliAdapter, type EccCliAdapterOptions } from './eccCliAdapter'
import { FrontendCliAdapter, type FrontendCliAdapterOptions } from './frontendCliAdapter'

export interface FrontendAwareRuntimeAdapterOptions {
  backend?: EccCliAdapterOptions
  frontend?: FrontendCliAdapterOptions
  frontendRootSearchRoots?: string[]
}

function isFrontendDevelopmentRoot(root: string): boolean {
  return existsSync(join(root, 'fecompiler'))
}

export function explicitFrontendDevelopmentRoot(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const root = env.ECOS_FE_DEV_ROOT?.trim()
  return root && isFrontendDevelopmentRoot(root) ? root : undefined
}

export function discoverFrontendDevelopmentRoot(startPath: string): string | undefined {
  let current = resolve(startPath)
  for (let depth = 0; depth < 10; depth += 1) {
    if (isFrontendDevelopmentRoot(current)) return current

    const nested = join(current, 'ecc-fe')
    if (isFrontendDevelopmentRoot(nested)) return nested

    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return undefined
}

export function resolveFrontendDevelopmentRoot(
  options: {
    env?: NodeJS.ProcessEnv
    searchRoots?: string[]
  } = {},
): string | undefined {
  const explicitRoot = explicitFrontendDevelopmentRoot(options.env)
  if (explicitRoot) return explicitRoot

  for (const root of options.searchRoots ?? []) {
    const discovered = discoverFrontendDevelopmentRoot(root)
    if (discovered) return discovered
  }
  return undefined
}

export function createFrontendAwareRuntimeAdapter(
  options: FrontendAwareRuntimeAdapterOptions = {},
): DesignToolRuntimeAdapter {
  const frontendRoot = options.frontend?.frontendRoot ?? resolveFrontendDevelopmentRoot({
    searchRoots: options.frontendRootSearchRoots,
  })
  return new DesignToolRuntimeAdapter({
    backend: new EccCliAdapter(options.backend ?? {}),
    frontend: new FrontendCliAdapter({
      ...(options.frontend ?? {}),
      frontendRoot,
    }),
  })
}
