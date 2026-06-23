import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  resolveSurferAssetsPath,
  SurferProtocolService,
  surferViewerUrl,
  surferWaveformUrl,
} from './surferProtocolService'

const tempDirectories: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  tempDirectories.push(directory)
  return directory
}

async function createSurferAssets(): Promise<string> {
  const root = await createTempDir('ecos-surfer-assets-')
  await writeFile(join(root, 'index.html'), [
    '<!doctype html>',
    '<html><body>',
    '<script type="module">',
    '/*SURFER_SETUP_HOOKS*/',
    '</script>',
    '<script>navigator.serviceWorker.register(\'sw.js\');</script>',
    '</body></html>',
  ].join('\n'))
  await writeFile(join(root, 'integration.js'), [
    'function register_message_listener() {',
    '  window.__listener_registered = true;',
    '}',
  ].join('\n'))
  await writeFile(join(root, 'manifest.json'), '{"name":"Surfer"}')
  await writeFile(join(root, 'surfer.js'), 'export default async function init() {}')
  await writeFile(join(root, 'surfer_bg.wasm'), 'wasm')
  await writeFile(join(root, 'sw.js'), 'self.addEventListener("install", () => {})')
  return root
}

function createProtocolHarness() {
  let handler: ((request: Request) => Promise<Response>) | null = null
  const protocol = {
    handle: vi.fn((_scheme: string, next: (request: Request) => Promise<Response>) => {
      handler = next
    }),
  }
  return {
    protocol,
    request(url: string, init?: RequestInit) {
      if (!handler) throw new Error('protocol handler was not registered')
      return handler(new Request(url, init))
    },
  }
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) =>
    rm(directory, { force: true, recursive: true }),
  ))
  vi.unstubAllGlobals()
})

describe('SurferProtocolService', () => {
  it('serves the Surfer viewer from bundled assets without runtime network fetch', async () => {
    const surferAssetsPath = await createSurferAssets()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const harness = createProtocolHarness()
    const service = new SurferProtocolService({
      projectScopeProvider: {
        requestProjectPathAccess: async (path) => path,
      },
      surferAssetsPath,
    })

    service.register(harness.protocol)
    const response = await harness.request(surferViewerUrl())
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/html')
    expect(text).toContain('register_message_listener();')
    expect(text).toContain('SurferReady')
    expect(text).toContain('Surfer service worker disabled inside ECOS Studio')
    expect(text).not.toContain('<script src="integration.js"></script>')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('serves local Surfer static assets from the bundled asset directory', async () => {
    const surferAssetsPath = await createSurferAssets()
    const harness = createProtocolHarness()
    const service = new SurferProtocolService({
      projectScopeProvider: {
        requestProjectPathAccess: async (path) => path,
      },
      surferAssetsPath,
    })

    service.register(harness.protocol)
    const response = await harness.request('ecos-surfer://viewer/surfer.js')

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/javascript')
    await expect(response.text()).resolves.toContain('init')
  })

  it('keeps waveform files local and scoped through the project scope provider', async () => {
    const surferAssetsPath = await createSurferAssets()
    const projectRoot = await createTempDir('ecos-wave-project-')
    const waveform = join(projectRoot, 'trace.vcd')
    await writeFile(waveform, '$date today $end\n')
    const requestProjectPathAccess = vi.fn(async (path: string) => {
      if (path !== waveform) throw new Error('unexpected path')
      return path
    })
    const harness = createProtocolHarness()
    const service = new SurferProtocolService({
      projectScopeProvider: { requestProjectPathAccess },
      surferAssetsPath,
    })

    service.register(harness.protocol)
    const response = await harness.request(surferWaveformUrl(waveform), { method: 'HEAD' })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Length')).toBe(String('$date today $end\n'.length))
    expect(requestProjectPathAccess).toHaveBeenCalledWith(waveform)
  })

  it('resolves packaged and development Surfer asset locations', () => {
    expect(resolveSurferAssetsPath({
      isPackaged: true,
      resourcesPath: '/opt/ecos/resources',
    })).toBe('/opt/ecos/resources/surfer')
    expect(resolveSurferAssetsPath({
      appPath: '/repo/ecos/gui/apps/desktop-electron',
      isPackaged: false,
    })).toBe('/repo/ecos/gui/apps/desktop-electron/resources/surfer')
  })
})
