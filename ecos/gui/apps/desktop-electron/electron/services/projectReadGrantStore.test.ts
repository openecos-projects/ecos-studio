import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectReadGrantStore } from './projectReadGrantStore'

const tempDirectories: string[] = []

async function createStore(): Promise<{
  directory: string
  filePath: string
  store: ProjectReadGrantStore
}> {
  const directory = await mkdtemp(join(tmpdir(), 'ecos-project-read-grants-'))
  tempDirectories.push(directory)
  const filePath = join(directory, 'project-read-grants.json')
  return {
    directory,
    filePath,
    store: new ProjectReadGrantStore({ filePath }),
  }
}

describe('ProjectReadGrantStore', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true })),
    )
  })

  it('persists grants independently for each project', async () => {
    const { filePath, store } = await createStore()
    await store.set('/work/project-a', ['/work/rtl-a', '/work/rtl-a'])
    await store.set('/work/project-b', ['/work/rtl-b'])

    const reloaded = new ProjectReadGrantStore({ filePath })
    await expect(reloaded.get('/work/project-a')).resolves.toEqual(['/work/rtl-a'])
    await expect(reloaded.get('/work/project-b')).resolves.toEqual(['/work/rtl-b'])
  })

  it('treats malformed state as empty instead of granting access', async () => {
    const { filePath, store } = await createStore()
    await writeFile(filePath, '{not-json', 'utf8')

    await expect(store.get('/work/project')).resolves.toEqual([])
    expect(await readFile(filePath, 'utf8')).toBe('{not-json')
  })
})
