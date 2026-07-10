import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DesignToolRuntimeAdapter } from './designToolRuntimeAdapter'
import { EccCliAdapter, type EccCliAdapterOptions } from './eccCliAdapter'
import { FrontendCliAdapter, type FrontendCliAdapterOptions } from './frontendCliAdapter'

export interface FrontendAwareRuntimeAdapterOptions {
  backend?: EccCliAdapterOptions
  frontend?: FrontendCliAdapterOptions
}

export function explicitFrontendDevelopmentRoot(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const root = env.ECOS_FE_DEV_ROOT?.trim()
  return root && existsSync(join(root, 'fecompiler')) ? root : undefined
}

export function createFrontendAwareRuntimeAdapter(
  options: FrontendAwareRuntimeAdapterOptions = {},
): DesignToolRuntimeAdapter {
  return new DesignToolRuntimeAdapter({
    backend: new EccCliAdapter(options.backend ?? {}),
    frontend: new FrontendCliAdapter({
      ...(options.frontend ?? {}),
      frontendRoot: options.frontend?.frontendRoot ?? explicitFrontendDevelopmentRoot(),
    }),
  })
}
