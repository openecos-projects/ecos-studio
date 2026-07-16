import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
  await writeFile(
    join(root, 'index.html'),
    [
      '<!doctype html>',
      '<html><head>',
      '<script type="module">',
      'import init from "./surfer.js";',
      'init(`./surfer_bg.wasm`);',
      'import { inject_message as injectMessage } from "./surfer.js";',
      'window.inject_message = injectMessage;',
      '</script>',
      '</head><body>',
      '<script>navigator.serviceWorker.register(`sw.js`);</script>',
      '</body></html>',
    ].join('\n'),
  )
  await writeFile(
    join(root, 'integration.js'),
    [
      'function register_message_listener() {',
      '  window.__listener_registered = true;',
      '}',
    ].join('\n'),
  )
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
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
  vi.unstubAllGlobals()
})

describe('SurferProtocolService', () => {
  it('serves the Surfer viewer from local assets without runtime network fetch', async () => {
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
    expect(text).toContain('await init(`./surfer_bg.wasm`);')
    expect(text).toContain("case 'Ping':")
    expect(text).toContain("case 'LoadUrl':")
    expect(text).toContain('keep_unavailable: false')
    expect(text).toContain('keep_variables: false')
    expect(text).not.toContain("url,\n                'Clear'")
    expect(text).not.toContain("case 'LoadBlob':")
    expect(text).not.toContain('URL.createObjectURL')
    expect(text).toContain('surferModule.waves_loaded()')
    expect(text).toContain('JSON.stringify({ AddScope: scope })')
    expect(text).toContain("postHostMessage('SurferWaveformLoaded'")
    expect(text).toContain('injectWhenReady')
    expect(text).toContain('SurferReady')
    expect(text).toContain('Surfer service worker disabled inside ECOS Studio')
    expect(text).not.toContain('navigator.serviceWorker.register(`sw.js`)')
    expect(text).not.toContain('register_message_listener();')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('serves local Surfer static assets from the configured asset directory', async () => {
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

  it('prefers Resource Manager-installed Surfer assets when available', async () => {
    const fallbackAssetsPath = await createSurferAssets()
    const resourceAssetsPath = await createSurferAssets()
    await writeFile(
      join(resourceAssetsPath, 'surfer.js'),
      'export default async function resourceManagedInit() {}',
    )
    const harness = createProtocolHarness()
    const service = new SurferProtocolService({
      projectScopeProvider: {
        requestProjectPathAccess: async (path) => path,
      },
      surferAssetsPath: fallbackAssetsPath,
      surferAssetsPathProvider: async () => resourceAssetsPath,
    })

    service.register(harness.protocol)
    const response = await harness.request('ecos-surfer://viewer/surfer.js')

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toContain('resourceManagedInit')
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
    const response = await harness.request(surferWaveformUrl(waveform), {
      method: 'HEAD',
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Length')).toBe(
      String('$date today $end\n'.length),
    )
    expect(requestProjectPathAccess).toHaveBeenCalledWith(waveform)
  })

  it('resolves Resource Manager and development Surfer asset locations', () => {
    expect(
      resolveSurferAssetsPath({
        env: { ECOS_SURFER_ASSETS_PATH: '/data/ecos/tools/surfer/0.4.0' },
        isPackaged: true,
        resourcesPath: '/opt/ecos/resources',
      }),
    ).toBe('/data/ecos/tools/surfer/0.4.0')
    expect(
      resolveSurferAssetsPath({
        isPackaged: true,
        resourcesPath: '/opt/ecos/resources',
      }),
    ).not.toBe('/opt/ecos/resources/surfer')
    expect(
      resolveSurferAssetsPath({
        appPath: '/repo/ecos/gui/apps/desktop-electron',
        isPackaged: false,
      }),
    ).toBe('/repo/ecos/gui/apps/desktop-electron/resources/surfer')
  })
})
