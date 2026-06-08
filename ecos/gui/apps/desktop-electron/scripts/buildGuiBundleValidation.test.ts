import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFile as execFileCallback } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)
const tempDirs: string[] = []
const scriptPath = fileURLToPath(new URL('../../../../scripts/build-gui.sh', import.meta.url))

async function makeFakeRelease() {
  const rootDir = await mkdtemp(join(tmpdir(), 'ecos-build-gui-'))
  tempDirs.push(rootDir)

  const releaseDir = join(rootDir, 'release')
  await mkdir(releaseDir, { recursive: true })

  return {
    releaseDir,
    rootDir,
  }
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })))
  tempDirs.length = 0
})

describe('build-gui bundle validation', () => {
  it('installs the ECC CLI wrapper from a bundled CLI artifact', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'ecos-build-gui-runtime-'))
    tempDirs.push(rootDir)
    const bundleDir = join(rootDir, 'ecc-cli-bundle')
    const artifactPath = join(rootDir, 'ecc.tar')
    const targetDir = join(rootDir, 'resources', 'binaries')
    await mkdir(join(bundleDir, '_internal'), { recursive: true })
    await writeFile(join(bundleDir, 'ecc'), '#!/usr/bin/env bash\n')
    await writeFile(join(bundleDir, '_internal', 'runtime-marker'), 'fake-runtime\n')
    await chmod(join(bundleDir, 'ecc'), 0o755)
    await execFile('tar', ['-cf', artifactPath, '-C', bundleDir, '.'])

    await expect(execFile('bash', [
      '-lc',
      `source "${scriptPath}"; install_ecc_cli_artifact "${artifactPath}" "${targetDir}"`,
    ])).resolves.toMatchObject({
      stderr: '',
    })

    const wrapper = await readFile(join(targetDir, 'ecc'), 'utf8')
    expect(wrapper).toContain('exec "$SCRIPT_DIR/ecc-runtime/ecc" "$@"')
    await expect(readFile(join(targetDir, 'ecc-runtime', '_internal', 'runtime-marker'), 'utf8')).resolves.toBe(
      'fake-runtime\n',
    )
  })

  it('runs pnpm from PATH with the repository Node version', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'ecos-build-gui-pnpm-'))
    tempDirs.push(rootDir)

    const guiDir = join(rootDir, 'gui')
    const fakeBinDir = join(rootDir, 'bin')
    await mkdir(guiDir, { recursive: true })
    await mkdir(fakeBinDir, { recursive: true })
    await writeFile(join(guiDir, '.nvmrc'), '23.11.0\n')

    await writeFile(join(fakeBinDir, 'npx'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" > "$LOG_DIR/npx-args"
while [[ $# -gt 0 && "$1" != "--" ]]; do
  shift
done
shift
exec "$@"
`)
    await chmod(join(fakeBinDir, 'npx'), 0o755)

    await writeFile(join(fakeBinDir, 'pnpm'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" > "$LOG_DIR/pnpm-args"
`)
    await chmod(join(fakeBinDir, 'pnpm'), 0o755)

    await expect(execFile('bash', [
      '-lc',
      `source "${scriptPath}"; pnpm_with_repo_node "${guiDir}" install --frozen-lockfile`,
    ], {
      env: {
        ...process.env,
        LOG_DIR: rootDir,
        PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
      },
    })).resolves.toMatchObject({
      stderr: '',
    })

    const npxArgs = await readFile(join(rootDir, 'npx-args'), 'utf8')
    const pnpmArgs = await readFile(join(rootDir, 'pnpm-args'), 'utf8')

    expect(npxArgs).toContain('node@23.11.0')
    expect(npxArgs).not.toContain('/usr/local/bin/pnpm')
    expect(pnpmArgs).toBe(`--dir
${guiDir}
install
--frozen-lockfile
`)
  })

  it('accepts a release without packaged OSS CAD suite', async () => {
    const { releaseDir } = await makeFakeRelease()

    await expect(execFile('bash', [
      '-lc',
      `source "${scriptPath}"; validate_no_packaged_oss_cad_suite "${releaseDir}"`,
    ])).resolves.toMatchObject({
      stderr: '',
      stdout: '',
    })
  })

  it('fails when a release still contains packaged OSS CAD suite', async () => {
    const { releaseDir } = await makeFakeRelease()
    await mkdir(join(releaseDir, 'linux-unpacked', 'resources', 'resources', 'oss-cad-suite'), {
      recursive: true,
    })

    await expect(execFile('bash', [
      '-lc',
      `source "${scriptPath}"; validate_no_packaged_oss_cad_suite "${releaseDir}"`,
    ])).rejects.toMatchObject({
      stderr: expect.stringContaining('packaged OSS CAD suite must not be present'),
    })
  })

  it('fails when any release entry contains packaged OSS CAD suite', async () => {
    const { releaseDir } = await makeFakeRelease()
    await mkdir(join(releaseDir, 'custom-layout', 'resources', 'oss-cad-suite'), {
      recursive: true,
    })

    await expect(execFile('bash', [
      '-lc',
      `source "${scriptPath}"; validate_no_packaged_oss_cad_suite "${releaseDir}"`,
    ])).rejects.toMatchObject({
      stderr: expect.stringContaining('packaged OSS CAD suite must not be present'),
    })
  })

  it('fails when a requested rpm artifact is missing', async () => {
    const { releaseDir } = await makeFakeRelease()

    await expect(execFile('bash', [
      '-lc',
      `source "${scriptPath}"; validate_requested_linux_artifacts "${releaseDir}" rpm`,
    ])).rejects.toMatchObject({
      stderr: expect.stringContaining('rpm artifact not found'),
    })
  })

  it('accepts all requested Linux artifacts when they exist', async () => {
    const { releaseDir } = await makeFakeRelease()
    await writeFile(join(releaseDir, 'ECOS-Studio.AppImage'), '')
    await writeFile(join(releaseDir, 'ecos-studio.deb'), '')
    await writeFile(join(releaseDir, 'ecos-studio.rpm'), '')
    await mkdir(join(releaseDir, 'linux-unpacked'), { recursive: true })

    await expect(execFile('bash', [
      '-lc',
      `source "${scriptPath}"; validate_requested_linux_artifacts "${releaseDir}" appimage,deb,rpm,dir`,
    ])).resolves.toMatchObject({
      stderr: '',
      stdout: '',
    })
  })

})
