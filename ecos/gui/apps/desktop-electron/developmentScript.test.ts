import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('desktop development script', () => {
  it('does not launch Electron in Node compatibility mode', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    )

    expect(packageJson.scripts.dev).toBe('ELECTRON_RUN_AS_NODE= electron-vite dev')
  })
})
