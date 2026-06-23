import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteContentService } from './remoteContentService'
import type { RemoteContentSourceConfig } from './remoteContentSources'

const source: RemoteContentSourceConfig = {
  provider: 'github',
  owner: 'openecos-projects',
  repo: 'ecos-studio',
  ref: 'main',
  rootPath: 'ecos/gui/apps/renderer/public',
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

async function createTempDir(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix))
}

describe('RemoteContentService', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    vi.unstubAllEnvs()
    await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })))
    tempDirs.length = 0
  })

  it('lists files from a built-in GitHub source under its root path', async () => {
    const fetchImpl = vi.fn(async (...args: Parameters<typeof fetch>) => {
      expect(String(args[0])).toBe('https://api.github.com/repos/openecos-projects/ecos-studio/git/trees/main?recursive=1')
      return jsonResponse({
        truncated: false,
        tree: [
          { path: 'ecos/gui/apps/renderer/public/ysyxSoCASIC.json', type: 'blob', size: 123, sha: 'abc' },
          { path: 'README.md', type: 'blob', size: 10, sha: 'def' },
          { path: 'ecos/gui/apps/renderer/public/image.png', type: 'blob', size: 20, sha: 'ghi' },
          { path: 'ecos/gui/apps/renderer/public/subdir', type: 'tree', sha: 'tree' },
        ],
      })
    })

    const service = new RemoteContentService({
      fetchImpl,
      sources: { socTemplateCatalog: source },
    })

    await expect(service.listFiles({ source: 'socTemplateCatalog', pattern: '**/*.json' }))
      .resolves
      .toEqual([
        {
          source: 'socTemplateCatalog',
          path: 'ysyxSoCASIC.json',
          name: 'ysyxSoCASIC.json',
          size: 123,
          sha: 'abc',
        },
      ])
  })

  it('reads a text file through the GitHub contents raw media type', async () => {
    const fetchImpl = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const [url, init] = args
      expect(String(url)).toBe('https://api.github.com/repos/openecos-projects/ecos-studio/contents/ecos%2Fgui%2Fapps%2Frenderer%2Fpublic%2FysyxSoCASIC.json?ref=main')
      expect(init?.headers).toMatchObject({
        Accept: 'application/vnd.github.raw+json',
        'X-GitHub-Api-Version': '2022-11-28',
      })
      return new Response('{"design_name":"ysyxSoCASIC"}', { status: 200 })
    })

    const service = new RemoteContentService({
      fetchImpl,
      sources: { socTemplateCatalog: source },
    })

    await expect(service.readTextFile({ source: 'socTemplateCatalog', path: 'ysyxSoCASIC.json' }))
      .resolves
      .toBe('{"design_name":"ysyxSoCASIC"}')
  })

  it('reads files from repository root sources without prefixing an empty path segment', async () => {
    const fetchImpl = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const [url] = args
      expect(String(url)).toBe('https://api.github.com/repos/KoEkko/ecos-registry/contents/manifest.json?ref=main')
      return new Response('{"schema_version":1}', { status: 200 })
    })

    const service = new RemoteContentService({
      fetchImpl,
      sources: {
        socTemplateCatalog: {
          provider: 'github',
          owner: 'KoEkko',
          repo: 'ecos-registry',
          ref: 'main',
          rootPath: '',
        },
      },
    })

    await expect(service.readTextFile({ source: 'socTemplateCatalog', path: 'manifest.json' }))
      .resolves
      .toBe('{"schema_version":1}')
  })

  it('lists files from repository root sources', async () => {
    const fetchImpl = vi.fn(async (...args: Parameters<typeof fetch>) => {
      expect(String(args[0])).toBe('https://api.github.com/repos/KoEkko/ecos-registry/git/trees/main?recursive=1')
      return jsonResponse({
        truncated: false,
        tree: [
          { path: 'manifest.json', type: 'blob', size: 123, sha: 'manifest-sha' },
          { path: 'templates/ysyxSoC/metadata/ysyxSoCASIC.json', type: 'blob', size: 456, sha: 'template-sha' },
          { path: 'templates/ysyxSoC', type: 'tree', sha: 'tree-sha' },
        ],
      })
    })

    const service = new RemoteContentService({
      fetchImpl,
      sources: {
        socTemplateCatalog: {
          provider: 'github',
          owner: 'KoEkko',
          repo: 'ecos-registry',
          ref: 'main',
          rootPath: '',
        },
      },
    })

    await expect(service.listFiles({ source: 'socTemplateCatalog', pattern: '**/*.json' }))
      .resolves
      .toEqual([
        {
          source: 'socTemplateCatalog',
          path: 'manifest.json',
          name: 'manifest.json',
          size: 123,
          sha: 'manifest-sha',
        },
        {
          source: 'socTemplateCatalog',
          path: 'templates/ysyxSoC/metadata/ysyxSoCASIC.json',
          name: 'ysyxSoCASIC.json',
          size: 456,
          sha: 'template-sha',
        },
      ])
  })

  it('stores successful SoC catalog reads in the XDG cache directory', async () => {
    const xdgCacheHome = await createTempDir('ecos-xdg-cache-')
    tempDirs.push(xdgCacheHome)
    vi.stubEnv('XDG_CACHE_HOME', xdgCacheHome)
    vi.stubEnv('ECOS_STUDIO_SOC_TEMPLATE_CACHE_DIR', undefined)

    const service = new RemoteContentService({
      fetchImpl: vi.fn(async () => new Response('{"schema_version":1}', { status: 200 })),
      sources: {
        socTemplateCatalog: {
          provider: 'github',
          owner: 'KoEkko',
          repo: 'ecos-registry',
          ref: 'main',
          rootPath: '',
        },
      },
    })

    await expect(service.readTextFile({ source: 'socTemplateCatalog', path: 'manifest.json' }))
      .resolves
      .toBe('{"schema_version":1}')

    await expect(readFile(join(xdgCacheHome, 'ecos-studio', 'soc-templates', 'manifest.json'), 'utf8'))
      .resolves
      .toBe('{"schema_version":1}')
  })

  it('uses ECOS_STUDIO_SOC_TEMPLATE_CACHE_DIR before XDG_CACHE_HOME for SoC catalog cache files', async () => {
    const xdgCacheHome = await createTempDir('ecos-xdg-cache-')
    const overrideCacheDir = await createTempDir('ecos-soc-cache-')
    tempDirs.push(xdgCacheHome, overrideCacheDir)
    vi.stubEnv('XDG_CACHE_HOME', xdgCacheHome)
    vi.stubEnv('ECOS_STUDIO_SOC_TEMPLATE_CACHE_DIR', overrideCacheDir)

    const service = new RemoteContentService({
      fetchImpl: vi.fn(async () => new Response('{"schema_version":2}', { status: 200 })),
      sources: {
        socTemplateCatalog: {
          provider: 'github',
          owner: 'KoEkko',
          repo: 'ecos-registry',
          ref: 'main',
          rootPath: '',
        },
      },
    })

    await service.readTextFile({ source: 'socTemplateCatalog', path: 'manifest.json' })

    await expect(readFile(join(overrideCacheDir, 'manifest.json'), 'utf8'))
      .resolves
      .toBe('{"schema_version":2}')
    await expect(readFile(join(xdgCacheHome, 'ecos-studio', 'soc-templates', 'manifest.json'), 'utf8'))
      .rejects
      .toMatchObject({ code: 'ENOENT' })
  })

  it('falls back to a parseable SoC catalog cache file when the remote read fails', async () => {
    const cacheDir = await createTempDir('ecos-soc-cache-')
    tempDirs.push(cacheDir)
    vi.stubEnv('ECOS_STUDIO_SOC_TEMPLATE_CACHE_DIR', cacheDir)
    await writeFile(join(cacheDir, 'manifest.json'), '{"schema_version":3}', 'utf8')

    const service = new RemoteContentService({
      fetchImpl: vi.fn(async () => new Response('Not Found', { status: 404 })),
      sources: {
        socTemplateCatalog: {
          provider: 'github',
          owner: 'KoEkko',
          repo: 'ecos-registry',
          ref: 'main',
          rootPath: '',
        },
      },
    })

    await expect(service.readJsonFile({ source: 'socTemplateCatalog', path: 'manifest.json' }))
      .resolves
      .toEqual({ schema_version: 3 })
  })

  it('returns fresh SoC catalog content when only the cache write fails', async () => {
    const cacheDir = await createTempDir('ecos-soc-cache-')
    tempDirs.push(cacheDir)
    vi.stubEnv('ECOS_STUDIO_SOC_TEMPLATE_CACHE_DIR', cacheDir)
    await writeFile(join(cacheDir, 'manifest.json'), '{"schema_version":"stale"}', 'utf8')
    await mkdir(join(cacheDir, 'manifest.json.tmp'))

    const service = new RemoteContentService({
      fetchImpl: vi.fn(async () => new Response('{"schema_version":"fresh"}', { status: 200 })),
      sources: {
        socTemplateCatalog: {
          provider: 'github',
          owner: 'KoEkko',
          repo: 'ecos-registry',
          ref: 'main',
          rootPath: '',
        },
      },
    })

    await expect(service.readTextFile({ source: 'socTemplateCatalog', path: 'manifest.json' }))
      .resolves
      .toBe('{"schema_version":"fresh"}')
  })

  it('does not fall back to an unparseable SoC catalog cache file for JSON reads', async () => {
    const cacheDir = await createTempDir('ecos-soc-cache-')
    tempDirs.push(cacheDir)
    vi.stubEnv('ECOS_STUDIO_SOC_TEMPLATE_CACHE_DIR', cacheDir)
    await writeFile(join(cacheDir, 'manifest.json'), 'not-json', 'utf8')

    const service = new RemoteContentService({
      fetchImpl: vi.fn(async () => new Response('Not Found', { status: 404 })),
      sources: {
        socTemplateCatalog: {
          provider: 'github',
          owner: 'KoEkko',
          repo: 'ecos-registry',
          ref: 'main',
          rootPath: '',
        },
      },
    })

    await expect(service.readJsonFile({ source: 'socTemplateCatalog', path: 'manifest.json' }))
      .rejects
      .toThrow('Remote JSON is invalid: socTemplateCatalog/manifest.json')
  })

  it('parses JSON files and reports invalid JSON with the source path', async () => {
    const service = new RemoteContentService({
      fetchImpl: vi.fn(async () => new Response('not-json', { status: 200 })),
      sources: { socTemplateCatalog: source },
    })

    await expect(service.readJsonFile({ source: 'socTemplateCatalog', path: 'broken.json' }))
      .rejects
      .toThrow('Remote JSON is invalid: socTemplateCatalog/broken.json')
  })

  it('rejects path traversal outside the configured source root', async () => {
    const service = new RemoteContentService({
      fetchImpl: vi.fn(),
      sources: { socTemplateCatalog: source },
    })

    await expect(service.readTextFile({ source: 'socTemplateCatalog', path: '../secret.json' }))
      .rejects
      .toThrow('Remote content path must be relative to its source root.')
  })

  it('fails clearly when GitHub tree results are truncated', async () => {
    const service = new RemoteContentService({
      fetchImpl: vi.fn(async () => jsonResponse({ truncated: true, tree: [] })),
      sources: { socTemplateCatalog: source },
    })

    await expect(service.listFiles({ source: 'socTemplateCatalog' }))
      .rejects
      .toThrow('GitHub tree response for socTemplateCatalog is truncated.')
  })

  it('reports non-OK GitHub responses with status and request URL', async () => {
    const service = new RemoteContentService({
      fetchImpl: vi.fn(async () => new Response('Not Found', { status: 404 })),
      sources: { socTemplateCatalog: source },
    })

    await expect(service.readTextFile({ source: 'socTemplateCatalog', path: 'missing.json' }))
      .rejects
      .toThrow(
        'GitHub request failed with 404: https://api.github.com/repos/openecos-projects/ecos-studio/contents/ecos%2Fgui%2Fapps%2Frenderer%2Fpublic%2Fmissing.json?ref=main',
      )
  })
})
