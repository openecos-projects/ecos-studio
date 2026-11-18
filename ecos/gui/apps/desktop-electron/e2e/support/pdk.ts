import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { repoRoot } from './launch'

const fixtures = new Map<string, Promise<string>>()

/** A separate package with explicitly synthetic EM data, never edit the supplied PDK. */
export function prepareTestPdk(source: string): Promise<string> {
  let fixture = fixtures.get(source)
  if (!fixture) {
    fixture = createFixture(source)
    fixtures.set(source, fixture)
  }
  return fixture
}

async function createFixture(source: string): Promise<string> {
  const sourceRoot = await realpath(source)
  let descriptor = JSON.parse(await readFile(join(sourceRoot, 'ecc-pdk.json'), 'utf8'))
  const root = await mkdtemp(join(tmpdir(), 'ecos-e2e-pdk-'))
  if (descriptor.schema_version === 2) {
    const binaryDirectory = process.env.ECOS_E2E_ECC_BIN_DIR
    if (!binaryDirectory)
      throw new Error('Schema 2 PDK fixtures require ECOS_E2E_ECC_BIN_DIR')
    const state = await mkdtemp(join(tmpdir(), 'ecos-e2e-pdk-state-'))
    const run = promisify(execFile)
    const env = { ...process.env, ECC_PDK_INVENTORY: join(state, 'inventory.json') }
    const binary = join(binaryDirectory, 'ecc')
    await run(binary, ['pdk', 'configure', 'adopt', '--root', sourceRoot], { env })
    const shown = await run(binary, ['pdk', 'configure', 'show', '--root', sourceRoot], {
      env,
      maxBuffer: 8 * 1024 * 1024,
    })
    // Copy the complete resolved resource set, including entries supplied by the
    // matching ECC profile. Never mutate the vendor description to add tool policy.
    descriptor = JSON.parse(shown.stdout).descriptor
  }
  for (const resource of Object.values(descriptor.resources) as Array<{ path: string }>) {
    const input = await realpath(resolve(sourceRoot, resource.path))
    const subpath = relative(sourceRoot, input)
    if (isAbsolute(resource.path) || subpath.startsWith('..') || isAbsolute(subpath)) {
      throw new Error(`PDK test resource escapes its source: ${resource.path}`)
    }
    const output = resolve(root, resource.path)
    if (relative(root, output).startsWith('..'))
      throw new Error('Invalid PDK test resource')
    await mkdir(dirname(output), { recursive: true })
    try {
      await link(input, output)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
        await copyFile(input, output)
    }
  }
  const hasEm = Object.values(descriptor.resources).some(
    (resource) => (resource as { role: string }).role === 'em',
  )
  if (!hasEm && !descriptor.tools?.configs?.emir?.synthetic_model) {
    await copyFile(
      join(repoRoot, 'ecc/test/fixtures/emir/ics55_synthetic.tech'),
      join(root, 'synthetic-test-em.tech'),
    )
    descriptor.resources['test-em'] = { path: 'synthetic-test-em.tech', role: 'em' }
    descriptor.profile_revision = `${descriptor.profile_revision}-synthetic-em-test-only`
    console.warn('E2E PDK uses synthetic EM data for flow testing, not signoff.')
  }
  await writeFile(join(root, 'ecc-pdk.json'), JSON.stringify(descriptor))
  return root
}
