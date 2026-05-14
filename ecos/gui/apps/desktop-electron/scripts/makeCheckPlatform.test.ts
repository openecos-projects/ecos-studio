import { execFile as execFileCallback } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)
const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))

describe('make check-platform', () => {
  it('accepts the current Linux x86_64 host when glibc is newer than 2.34', async () => {
    await expect(execFile('make', ['check-platform'], {
      cwd: repoRoot,
    })).resolves.toMatchObject({
      stderr: '',
    })
  })
})
