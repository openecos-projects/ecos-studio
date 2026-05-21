import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('desktop main runtime wiring', () => {
  it('uses the ECC CLI adapter and does not start the FastAPI server in the normal path', () => {
    const sourcePath = fileURLToPath(new URL('./index.ts', import.meta.url))
    const source = readFileSync(sourcePath, 'utf8')

    expect(source).toContain("import { EccCliAdapter } from '../services/eccCliAdapter'")
    expect(source).toContain("import { createEccCliRuntimeEnv } from '../services/eccCliRuntime'")
    expect(source).not.toContain('new ApiServerService')
    expect(source).not.toContain('new ApiCliAdapter')
    expect(source).not.toContain('.apiServerService.start(')
    expect(source).not.toContain('.apiServerService.stop(')
  })
})
