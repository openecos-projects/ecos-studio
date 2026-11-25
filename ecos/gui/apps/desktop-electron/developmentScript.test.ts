import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('desktop development script', () => {
  it('clears inherited Electron and ECC overrides before launching development', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    )

    expect(packageJson.scripts.dev).toBe(
      'ELECTRON_RUN_AS_NODE= ECOS_ECC_BIN_DIR= electron-vite dev',
    )
  })
})
