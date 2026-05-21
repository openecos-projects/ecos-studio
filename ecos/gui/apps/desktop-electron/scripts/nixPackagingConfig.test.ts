import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('Nix GUI packaging config', () => {
  it('launches Electron with the ECC CLI available on PATH', () => {
    const configPath = fileURLToPath(new URL('../../../default.nix', import.meta.url))
    const configText = readFileSync(configPath, 'utf8')

    expect(configText).toContain('ecos-server,')
    expect(configText).toContain('ln -s ${ecos-server}/bin/ecos-ecc-cli apps/desktop-electron/resources/binaries/ecc')
    expect(configText).not.toContain('pyinstaller ${../server/ecos.spec}')
    expect(configText).not.toContain('api-server-')
    expect(configText).not.toContain('ECOS_SERVER_DIRECTORY')
  })
})
