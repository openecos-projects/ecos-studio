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
  const descriptor = JSON.parse(await readFile(join(sourceRoot, 'ecc-pdk.json'), 'utf8'))
  const root = await mkdtemp(join(tmpdir(), 'ecos-e2e-pdk-'))
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
  if (!hasEm) {
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
