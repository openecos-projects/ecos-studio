import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SettingsStore } from './settingsStore'

const tempDirectories: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  tempDirectories.push(directory)
  return directory
}

describe('SettingsStore', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
    )
  })

  it('persists values and removes deleted keys', async () => {
    const directory = await createTempDir('ecos-settings-')
    const store = new SettingsStore({
      filePath: join(directory, 'settings.json'),
    })

    await store.set('recent_projects', [{ id: 'demo', path: '/tmp/demo' }])

    await expect(store.get('recent_projects')).resolves.toEqual([
      { id: 'demo', path: '/tmp/demo' },
    ])

    await store.delete('recent_projects')

    await expect(store.get('recent_projects')).resolves.toBeNull()
  })

  it('preserves concurrent updates to different keys', async () => {
    const directory = await createTempDir('ecos-settings-')
    const store = new SettingsStore({
      filePath: join(directory, 'settings.json'),
    })

    await Promise.all([
      store.set('recent_projects', [{ id: 'demo', path: '/tmp/demo' }]),
      store.set('current_project_path', '/tmp/demo'),
    ])

    await expect(store.get('recent_projects')).resolves.toEqual([
      { id: 'demo', path: '/tmp/demo' },
    ])
    await expect(store.get('current_project_path')).resolves.toBe('/tmp/demo')
  })
})
