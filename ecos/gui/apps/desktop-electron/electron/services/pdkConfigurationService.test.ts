import { afterEach, describe, expect, it } from 'vitest'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PdkConfigurationService } from './pdkConfigurationService'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})
async function fixture(
  body = 'console.log(JSON.stringify({args: process.argv.slice(2)}))',
) {
  const root = await mkdtemp(join(tmpdir(), 'pdk-cli-test-'))
  directories.push(root)
  const command = join(root, 'ecc')
  await writeFile(command, `#!${process.execPath}\n${body}\n`)
  await chmod(command, 0o755)
  const service = new PdkConfigurationService({
    resolveCommand: () => command,
    envProvider: () => process.env,
  })
  return { root, service }
}
describe('PdkConfigurationService', () => {
  it('passes paths and JSON as literal arguments without shell expansion', async () => {
    const { root, service } = await fixture()
    const value = { path: 'space $(touch forbidden); `echo bad`' }
    const result = await service.configure({
      action: 'set',
      root,
      field: 'resources',
      value,
      expectedRevision: 'a'.repeat(64),
    })
    expect(result.args).toEqual([
      'pdk',
      'configure',
      'set',
      '--root',
      root,
      '--field',
      'resources',
      '--value-json',
      JSON.stringify(value),
      '--expected-revision',
      'a'.repeat(64),
    ])
  })
  it('preserves structured validation errors from ECC', async () => {
    const { root, service } = await fixture(
      'console.log(JSON.stringify({error: {code: "revision_conflict"}})); process.exit(2)',
    )
    await expect(service.configure({ action: 'show', root })).resolves.toEqual({
      error: { code: 'revision_conflict' },
    })
  })
  it('does not accept an unsuccessful process as a successful response', async () => {
    const { root, service } = await fixture('console.log("{}"); process.exit(2)')
    await expect(service.configure({ action: 'show', root })).rejects.toThrow(
      'failed without a diagnostic',
    )
  })
  it('rejects relative resource roots before invoking ECC', async () => {
    const { service } = await fixture()
    await expect(service.configure({ action: 'show', root: '../pdk' })).rejects.toThrow(
      'absolute',
    )
  })
})
