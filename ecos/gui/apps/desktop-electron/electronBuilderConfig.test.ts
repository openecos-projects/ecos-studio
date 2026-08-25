import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('electron-builder config', () => {
  it('builds Linux AppImage and Debian artifacts for release packaging', () => {
    const config = readFileSync(resolve(process.cwd(), 'electron-builder.yml'), 'utf8')

    expect(config).toMatch(/target:\n\s+- AppImage/)
    expect(config).toMatch(/\n\s+- deb\b/)
  })

  it('stages the private HDL index tools in release resources', () => {
    const buildScript = readFileSync(
      resolve(process.cwd(), '../../../../.github/scripts/build-binaries.sh'),
      'utf8',
    )
    const smokeScript = readFileSync(
      resolve(process.cwd(), '../../../scripts/chip-viewer-appimage-smoke.sh'),
      'utf8',
    )

    expect(buildScript).toContain('command -v plocate')
    expect(buildScript).toContain('command -v updatedb')
    expect(smokeScript).toContain('resources/binaries/plocate')
    expect(smokeScript).toContain('resources/binaries/updatedb')
  })
})
