import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DesignToolRuntimeAdapter } from './designToolRuntimeAdapter'
import { EccCliAdapter, type EccCliAdapterOptions } from './eccCliAdapter'
import { FrontendCliAdapter, type FrontendCliAdapterOptions } from './frontendCliAdapter'

export interface FrontendAwareRuntimeAdapterOptions {
  backend?: EccCliAdapterOptions
  frontend?: FrontendCliAdapterOptions
}

function findFrontendRoot(startDirectory: string): string | null {
  let directory = startDirectory
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(directory, 'ecc-fe')
    if (existsSync(join(candidate, 'fecompiler'))) {
      return candidate
    }

    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return null
}

export function defaultFrontendRoot(): string {
  return process.env.ECOS_FE_COMPILER_ROOT
    ?? findFrontendRoot(process.cwd())
    ?? findFrontendRoot(dirname(fileURLToPath(import.meta.url)))
    ?? join(process.cwd(), 'ecc-fe')
}

export function createFrontendAwareRuntimeAdapter(
  options: FrontendAwareRuntimeAdapterOptions = {},
): DesignToolRuntimeAdapter {
  return new DesignToolRuntimeAdapter({
    backend: new EccCliAdapter(options.backend ?? {}),
    frontend: new FrontendCliAdapter({
      frontendRoot: defaultFrontendRoot(),
      ...(options.frontend ?? {}),
    }),
  })
}
