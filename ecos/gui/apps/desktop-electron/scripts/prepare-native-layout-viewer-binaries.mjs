import { spawn } from 'node:child_process'
import { chmod, copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const NATIVE_LAYOUT_VIEWER_BINARIES = [
  'ecos-layout-packer',
  'layout-viewer-native',
]

function defaultExecFile(file, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options?.cwd,
      env: options?.env,
      stdio: options?.stdio ?? 'inherit',
    })

    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(
        signal
          ? `${file} was terminated by signal ${signal}`
          : `${file} exited with code ${code}`,
      ))
    })
  })
}

function executableName(name, platform) {
  return platform === 'win32' ? `${name}.exe` : name
}

async function assertFileExists(path, label) {
  try {
    await stat(path)
  } catch {
    throw new Error(`${label} was not found: ${path}`)
  }
}

async function cleanStagingDirectory(path) {
  await mkdir(path, { recursive: true })
  const entries = await readdir(path, { withFileTypes: true })

  await Promise.all(entries.map((entry) => {
    if (entry.name === '.gitkeep') {
      return undefined
    }
    return rm(join(path, entry.name), { force: true, recursive: true })
  }))
}

export async function prepareNativeLayoutViewerBinaries(options = {}) {
  const packageRoot = options.packageRoot
    ?? dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
  const repoRoot = options.repoRoot
    ?? join(packageRoot, '../../../..')
  const platform = options.platform ?? process.platform
  const execFile = options.execFile ?? defaultExecFile
  const layoutViewerRoot = join(repoRoot, 'ecos/layout-viewer')
  const resourcesBin = join(packageRoot, 'resources/binaries')

  await execFile('cargo', [
    'build',
    '--release',
    '-p',
    'layout-viewer-native',
    '-p',
    'ecos-layout-packer',
  ], {
    cwd: layoutViewerRoot,
    stdio: 'inherit',
  })

  await cleanStagingDirectory(resourcesBin)

  for (const binary of NATIVE_LAYOUT_VIEWER_BINARIES) {
    const filename = executableName(binary, platform)
    const source = join(layoutViewerRoot, 'target/release', filename)
    const target = join(resourcesBin, filename)

    await assertFileExists(source, `Native layout viewer binary ${filename}`)
    await copyFile(source, target)
    if (platform !== 'win32') {
      await chmod(target, 0o755)
    }
  }

  return {
    binaries: NATIVE_LAYOUT_VIEWER_BINARIES.map((binary) => executableName(binary, platform)),
    resourcesBin,
  }
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url)

if (isCli) {
  prepareNativeLayoutViewerBinaries().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
