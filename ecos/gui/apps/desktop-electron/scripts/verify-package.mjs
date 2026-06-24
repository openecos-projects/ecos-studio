import { access, readdir, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIRED_NATIVE_BINARIES = [
  'ecos-layout-packer',
  'layout-viewer-native',
]

async function assertExists(path, label) {
  try {
    await access(path)
  } catch {
    throw new Error(`${label} is missing: ${path}`)
  }
}

async function assertExecutable(path, label, platform) {
  await assertExists(path, label)
  if (platform === 'win32') {
    return
  }

  try {
    await access(path, constants.X_OK)
  } catch {
    const mode = (await stat(path)).mode.toString(8)
    throw new Error(`${label} is not executable: ${path} (${mode})`)
  }
}

export async function verifyPackageArtifacts(options = {}) {
  const packageRoot = options.packageRoot
    ?? dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
  const platform = options.platform ?? process.platform
  const releaseDir = join(packageRoot, 'release')
  const entries = await readdir(releaseDir)
  const appImages = entries.filter((entry) => entry.endsWith('.AppImage')).sort()
  const debs = entries.filter((entry) => entry.endsWith('.deb')).sort()

  if (appImages.length === 0) {
    throw new Error(`No AppImage artifacts found in ${releaseDir}`)
  }
  if (appImages.length > 1) {
    throw new Error(`Expected one AppImage artifact, found ${appImages.length}: ${appImages.join(', ')}`)
  }
  if (debs.length === 0) {
    throw new Error(`No Debian package artifacts found in ${releaseDir}`)
  }
  if (debs.length > 1) {
    throw new Error(`Expected one Debian package artifact, found ${debs.length}: ${debs.join(', ')}`)
  }

  const binariesDir = join(releaseDir, 'linux-unpacked/resources/binaries')
  for (const binary of REQUIRED_NATIVE_BINARIES) {
    await assertExecutable(join(binariesDir, binary), `Packaged native binary ${binary}`, platform)
  }

  return {
    appImages,
    debs,
    nativeBinaries: [...REQUIRED_NATIVE_BINARIES],
  }
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url)

if (isCli) {
  verifyPackageArtifacts()
    .then(({ appImages, debs, nativeBinaries }) => {
      console.log(`Verified AppImage artifact: ${appImages[0]}`)
      console.log(`Verified Debian package artifact: ${debs[0]}`)
      console.log(`Verified native binaries: ${nativeBinaries.join(', ')}`)
    })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}
