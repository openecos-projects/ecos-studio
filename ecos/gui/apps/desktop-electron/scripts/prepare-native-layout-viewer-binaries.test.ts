import { access, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareNativeLayoutViewerBinaries } from './prepare-native-layout-viewer-binaries.mjs'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map(async (dir) => {
    await import('node:fs/promises').then(({ rm }) => rm(dir, { force: true, recursive: true }))
  }))
  tempDirs.length = 0
})

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'ecos-native-layout-bins-'))
  tempDirs.push(root)
  const targetRelease = join(root, 'ecos/layout-viewer/target/release')
  await import('node:fs/promises').then(({ mkdir }) => mkdir(targetRelease, { recursive: true }))
  await writeFile(join(targetRelease, 'ecos-layout-packer'), 'packer-binary')
  await writeFile(join(targetRelease, 'layout-viewer-native'), 'viewer-binary')

  return {
    resourcesBin: join(root, 'ecos/gui/apps/desktop-electron/resources/binaries'),
    root,
    targetRelease,
  }
}

describe('prepareNativeLayoutViewerBinaries', () => {
  it('builds release binaries and stages them for electron-builder extraResources', async () => {
    const fixture = await createFixture()
    const execFile = vi.fn(async () => {})

    await prepareNativeLayoutViewerBinaries({
      execFile,
      packageRoot: join(fixture.root, 'ecos/gui/apps/desktop-electron'),
      platform: 'linux',
      repoRoot: fixture.root,
    })

    expect(execFile).toHaveBeenCalledWith('cargo', [
      'build',
      '--release',
      '-p',
      'layout-viewer-native',
      '-p',
      'ecos-layout-packer',
    ], {
      cwd: join(fixture.root, 'ecos/layout-viewer'),
      stdio: 'inherit',
    })
    await expect(readFile(join(fixture.resourcesBin, 'ecos-layout-packer'), 'utf8'))
      .resolves.toBe('packer-binary')
    await expect(readFile(join(fixture.resourcesBin, 'layout-viewer-native'), 'utf8'))
      .resolves.toBe('viewer-binary')
    expect((await stat(join(fixture.resourcesBin, 'ecos-layout-packer'))).mode & 0o111).not.toBe(0)
    expect((await stat(join(fixture.resourcesBin, 'layout-viewer-native'))).mode & 0o111).not.toBe(0)
  })

  it('cleans stale staged binaries before copying the current native viewer binaries', async () => {
    const fixture = await createFixture()
    await import('node:fs/promises').then(({ mkdir }) => mkdir(fixture.resourcesBin, { recursive: true }))
    await writeFile(join(fixture.resourcesBin, '.gitkeep'), '\n')
    await writeFile(join(fixture.resourcesBin, 'stale-viewer'), 'old-binary')

    await prepareNativeLayoutViewerBinaries({
      execFile: vi.fn(async () => {}),
      packageRoot: join(fixture.root, 'ecos/gui/apps/desktop-electron'),
      platform: 'linux',
      repoRoot: fixture.root,
    })

    await expect(access(join(fixture.resourcesBin, 'stale-viewer'))).rejects.toThrow()
    await expect(readFile(join(fixture.resourcesBin, '.gitkeep'), 'utf8'))
      .resolves.toBe('\n')
    await expect(readFile(join(fixture.resourcesBin, 'ecos-layout-packer'), 'utf8'))
      .resolves.toBe('packer-binary')
    await expect(readFile(join(fixture.resourcesBin, 'layout-viewer-native'), 'utf8'))
      .resolves.toBe('viewer-binary')
  })
})
