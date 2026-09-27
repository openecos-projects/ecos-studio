import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EccCliCommandError, EccCliProcess } from './cliProcess'

describe('EccCliProcess', () => {
  it('uses argv without a shell and captures bounded output', async () => {
    const cli = new EccCliProcess({
      resolveLaunch: () => ({
        command: process.execPath,
        args: ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))'],
      }),
    })
    const result = await cli.run(['value with spaces', '$(exit 91)'])
    expect(JSON.parse(result.stdout)).toEqual(['value with spaces', '$(exit 91)'])
  })

  it('reports the CLI exit code and stderr', async () => {
    const cli = new EccCliProcess({
      resolveLaunch: () => ({
        command: process.execPath,
        args: ['-e', 'process.stderr.write("busy"); process.exit(20)'],
      }),
    })
    await expect(cli.run([])).rejects.toMatchObject({
      exitCode: 20,
      stderr: 'busy',
    } satisfies Partial<EccCliCommandError>)
  })

  it('redirects detached bootstrap output to a persistent log', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ecc-cli-detached-'))
    const logFile = join(directory, 'home', 'run-logs', 'run.log')
    const cli = new EccCliProcess({
      resolveLaunch: () => ({
        command: process.execPath,
        args: [
          '-e',
          'process.stdout.write("bootstrap-out\\n"); process.stderr.write("bootstrap-error\\n")',
        ],
      }),
    })
    try {
      await cli.spawnDetached([], { logFile })
      const content = await waitForFile(logFile)
      expect(content).toContain('bootstrap-out')
      expect(content).toContain('bootstrap-error')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})

async function waitForFile(path: string): Promise<string> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const content = await readFile(path, 'utf8').catch(() => '')
    if (content.includes('bootstrap-out') && content.includes('bootstrap-error')) {
      return content
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Detached ECC bootstrap log was not written')
}
