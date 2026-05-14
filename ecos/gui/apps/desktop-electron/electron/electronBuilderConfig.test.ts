import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('desktop electron builder config', () => {
  it('runs the Linux sandbox wrapper hook after packing', () => {
    const configPath = fileURLToPath(new URL('../electron-builder.yml', import.meta.url))
    const configText = readFileSync(configPath, 'utf8')

    expect(configText).toContain('afterPack: ./scripts/after-pack-linux-sandbox.mjs')
  })
})
