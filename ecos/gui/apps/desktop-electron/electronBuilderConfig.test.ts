import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('electron-builder config', () => {
  it('builds Linux AppImage and Debian artifacts for release packaging', () => {
    const config = readFileSync(
      resolve(process.cwd(), 'electron-builder.yml'),
      'utf8',
    )

    expect(config).toMatch(/target:\n\s+- AppImage/)
    expect(config).toMatch(/\n\s+- deb\b/)
  })
})
