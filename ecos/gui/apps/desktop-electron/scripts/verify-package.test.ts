import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyPackageArtifacts } from './verify-package.mjs'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map(async (dir) => {
    await import('node:fs/promises').then(({ rm }) => rm(dir, { force: true, recursive: true }))
  }))
  tempDirs.length = 0
})

async function createReleaseFixture() {
  const packageRoot = await mkdtemp(join(tmpdir(), 'ecos-package-verify-'))
  tempDirs.push(packageRoot)
  const releaseDir = join(packageRoot, 'release')
  const binariesDir = join(releaseDir, 'linux-unpacked/resources/binaries')
  await mkdir(binariesDir, { recursive: true })
  await writeFile(join(releaseDir, 'ECOS-Studio_0.1.0-alpha.5_x86_64.AppImage'), 'appimage')
  await writeFile(join(releaseDir, 'ECOS-Studio_0.1.0-alpha.5_amd64.deb'), 'deb')
  await writeFile(join(binariesDir, 'ecos-layout-packer'), 'packer')
  await writeFile(join(binariesDir, 'layout-viewer-native'), 'viewer')
  await chmod(join(binariesDir, 'ecos-layout-packer'), 0o755)
  await chmod(join(binariesDir, 'layout-viewer-native'), 0o755)

  return { binariesDir, packageRoot, releaseDir }
}

describe('verifyPackageArtifacts', () => {
  it('accepts a release with AppImage, Debian package, and executable native layout viewer binaries', async () => {
    const fixture = await createReleaseFixture()

    await expect(verifyPackageArtifacts({ packageRoot: fixture.packageRoot }))
      .resolves.toEqual({
        appImages: ['ECOS-Studio_0.1.0-alpha.5_x86_64.AppImage'],
        debs: ['ECOS-Studio_0.1.0-alpha.5_amd64.deb'],
        nativeBinaries: ['ecos-layout-packer', 'layout-viewer-native'],
      })
  })

  it('rejects release directories that are missing Debian artifacts', async () => {
    const fixture = await createReleaseFixture()
    await import('node:fs/promises').then(({ rm }) => rm(join(fixture.releaseDir, 'ECOS-Studio_0.1.0-alpha.5_amd64.deb')))

    await expect(verifyPackageArtifacts({ packageRoot: fixture.packageRoot }))
      .rejects.toThrow('No Debian package artifacts found')
  })
})
