import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import electronPath from 'electron'

const packageRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const mainEntry = join(packageRoot, 'dist/main/index.cjs')
const preloadEntry = join(packageRoot, 'dist/preload/index.cjs')
const SMOKE_TIMEOUT_MS = 30_000

async function assertBuiltArtifact(path, label) {
  try {
    await access(path)
  } catch {
    throw new Error(`${label} is missing: ${path}. Run pnpm desktop:build first.`)
  }
}

async function createSmokeRenderer() {
  const smokeDir = await mkdtemp(join(tmpdir(), 'ecos-electron-smoke-'))
  const indexPath = join(smokeDir, 'index.html')
  await mkdir(smokeDir, { recursive: true })
  await writeFile(
    indexPath,
    `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>ECOS Electron Smoke</title></head>
  <body>
    <script>
      ;(async () => {
        try {
          if (!window.ecosDesktop) {
            throw new Error('window.ecosDesktop is missing')
          }
          const versions = await window.ecosDesktop.app.getVersions()
          if (!versions || typeof versions.gui !== 'string') {
            throw new Error('app.getVersions() returned an invalid payload')
          }
          window.electronSmoke?.complete?.()
        } catch (error) {
          window.electronSmoke?.failed?.(error instanceof Error ? error.message : String(error))
        }
      })()
    </script>
  </body>
</html>`,
  )

  return {
    dispose: () => rm(smokeDir, { force: true, recursive: true }),
    url: pathToFileURL(indexPath).toString(),
  }
}

async function createSmokeApp() {
  const appDir = await mkdtemp(join(tmpdir(), 'ecos-electron-smoke-app-'))
  await writeFile(
    join(appDir, 'package.json'),
    JSON.stringify({
      main: mainEntry,
      name: 'ecos-electron-smoke',
      type: 'module',
    }),
  )

  return {
    dispose: () => rm(appDir, { force: true, recursive: true }),
    path: appDir,
  }
}

function runElectronSmoke(appPath, rendererUrl) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      ELECTRON_RENDERER_URL: rendererUrl,
      ECOS_ELECTRON_SMOKE: '1',
      ECOS_FORWARD_RENDERER_CONSOLE: '1',
    }
    delete env.ELECTRON_RUN_AS_NODE

    const child = spawn(electronPath, [appPath], {
      cwd: packageRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const output = []
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Electron smoke test timed out after ${SMOKE_TIMEOUT_MS}ms`))
    }, SMOKE_TIMEOUT_MS)

    child.stdout.on('data', (chunk) => {
      output.push(chunk.toString())
    })
    child.stderr.on('data', (chunk) => {
      output.push(chunk.toString())
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve(output.join(''))
        return
      }
      reject(
        new Error(
          `Electron smoke test failed with code ${code ?? 'null'} signal ${signal ?? 'null'}\n${output.join('')}`,
        ),
      )
    })
  })
}

export async function runSmokeTest() {
  await assertBuiltArtifact(mainEntry, 'Electron main bundle')
  await assertBuiltArtifact(preloadEntry, 'Electron preload bundle')

  const app = await createSmokeApp()
  const renderer = await createSmokeRenderer()
  try {
    return await runElectronSmoke(app.path, renderer.url)
  } finally {
    await renderer.dispose()
    await app.dispose()
  }
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url)

if (isCli) {
  runSmokeTest()
    .then(() => {
      console.log('Electron smoke test passed.')
    })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}
