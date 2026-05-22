import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('Nix GUI packaging config', () => {
  it('packages the real ECC CLI instead of the ecos-server shim', () => {
    const configPath = fileURLToPath(new URL('../../../default.nix', import.meta.url))
    const configText = readFileSync(configPath, 'utf8')
    const removedServerShimProgram = ['ecos', 'ecc', 'cli'].join('-')

    expect(configText).toContain('chipcompiler-cli,')
    expect(configText).toContain('ln -s ${chipcompiler-cli}/bin/ecc apps/desktop-electron/resources/binaries/ecc')
    expect(configText).not.toContain(removedServerShimProgram)
    expect(configText).not.toContain('pyinstaller ${../server/ecos.spec}')
    expect(configText).not.toContain('api-server-')
    expect(configText).not.toContain('ECOS_SERVER_DIRECTORY')
  })
})
