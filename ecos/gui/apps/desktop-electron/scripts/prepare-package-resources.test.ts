import { chmod, copyFile, mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)
const tempDirs: string[] = []

async function createWorkspace() {
  const rootDir = await mkdtemp(join(tmpdir(), 'ecos-prepare-resources-'))
  tempDirs.push(rootDir)

  const appDir = join(rootDir, 'apps', 'desktop-electron')
  const scriptsDir = join(appDir, 'scripts')
  await mkdir(scriptsDir, { recursive: true })

  const sourceScript = '/home/ekko/Desktop/ECOS/ecos-studio/ecos/gui/apps/desktop-electron/scripts/prepare-package-resources.sh'
  const scriptPath = join(scriptsDir, 'prepare-package-resources.sh')
  await copyFile(sourceScript, scriptPath)
  await chmod(scriptPath, 0o755)

  const apiServerPath = join(rootDir, 'api-server-x86_64-unknown-linux-gnu')
  await copyFile('/bin/true', apiServerPath)
  await chmod(apiServerPath, 0o755)

  return {
    apiServerPath,
    appDir,
    resourcesDir: join(appDir, 'resources'),
    rootDir,
    scriptPath,
  }
}

async function createFakeOssCadSuite(rootDir: string) {
  const suiteDir = join(rootDir, 'fake-oss-cad-suite')
  const binDir = join(suiteDir, 'bin')
  await mkdir(binDir, { recursive: true })

  const yosysPath = join(binDir, 'yosys')
  await writeFile(yosysPath, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *"-m slang"* ]]; then
  exit 0
fi
echo "expected slang check" >&2
exit 1
`)
  await chmod(yosysPath, 0o755)

  return {
    suiteDir,
    yosysPath,
  }
}

async function createFakeApiServerBundle(rootDir: string) {
  const bundleRoot = join(rootDir, 'fake-api-server-bundle')
  const executablePath = join(bundleRoot, 'ecos-server')
  const tarPath = join(rootDir, 'ecos-server-bundle.tar')

  await mkdir(bundleRoot, { recursive: true })
  await writeFile(executablePath, '#!/usr/bin/env bash\nexit 0\n')
  await chmod(executablePath, 0o755)
  await writeFile(join(bundleRoot, 'libdummy.so'), 'placeholder')

  await execFile('tar', ['-cf', tarPath, '-C', bundleRoot, '.'])

  return {
    bundleRoot,
    executablePath,
    tarPath,
  }
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })))
  tempDirs.length = 0
})

describe('prepare-package-resources.sh', () => {
  it('fails instead of silently packaging a placeholder OSS CAD suite by default', async () => {
    const workspace = await createWorkspace()

    await expect(execFile(workspace.scriptPath, {
      cwd: dirname(workspace.scriptPath),
      env: {
        ...process.env,
        ECOS_API_SERVER_BIN: workspace.apiServerPath,
      },
    })).rejects.toMatchObject({
      stderr: expect.stringContaining('OSS CAD'),
    })
  })

  it('copies a provided OSS CAD suite when a yosys binary with slang support is configured', async () => {
    const workspace = await createWorkspace()
    const ossCadSuite = await createFakeOssCadSuite(workspace.rootDir)

    await execFile(workspace.scriptPath, {
      cwd: dirname(workspace.scriptPath),
      env: {
        ...process.env,
        CHIPCOMPILER_OSS_CAD_DIR: ossCadSuite.suiteDir,
        ECOS_API_SERVER_BIN: workspace.apiServerPath,
      },
    })

    const copiedYosysPath = join(workspace.resourcesDir, 'oss-cad-suite', 'bin', 'yosys')
    await expect(stat(copiedYosysPath)).resolves.toBeTruthy()
    await expect(stat(join(workspace.resourcesDir, 'oss-cad-suite', 'placeholder.txt'))).rejects.toBeTruthy()
  })

  it('extracts an onedir API server bundle tar into the packaged binaries directory', async () => {
    const workspace = await createWorkspace()
    const ossCadSuite = await createFakeOssCadSuite(workspace.rootDir)
    const apiBundle = await createFakeApiServerBundle(workspace.rootDir)

    await execFile(workspace.scriptPath, {
      cwd: dirname(workspace.scriptPath),
      env: {
        ...process.env,
        CHIPCOMPILER_OSS_CAD_DIR: ossCadSuite.suiteDir,
        ECOS_API_SERVER_BIN: apiBundle.tarPath,
      },
    })

    const extractedExecutablePath = join(
      workspace.resourcesDir,
      'binaries',
      'api-server-x86_64-unknown-linux-gnu',
      'ecos-server',
    )
    await expect(stat(extractedExecutablePath)).resolves.toBeTruthy()
  })
})
