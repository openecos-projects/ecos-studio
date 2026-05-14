import { describe, expect, it, vi } from 'vitest'
import {
  BundleFileNotFoundError,
  BundlePathOutsideRootError,
  createTileBundleReader,
  joinBundleLocalPath,
} from './bundleReader'

describe('joinBundleLocalPath', () => {
  it('joins bundle-root-relative paths without Tauri path helpers', () => {
    expect(
      joinBundleLocalPath(
        '/tmp/project/.ecos/tile-cache/layout/route',
        'tiles/vector/0/0/0.bin',
      ),
    ).toBe('/tmp/project/.ecos/tile-cache/layout/route/tiles/vector/0/0/0.bin')
  })
})

describe('createTileBundleReader', () => {
  it('reads text and binary files through the desktop bridge under a local bundle root', async () => {
    const readProjectTextFile = vi.fn().mockResolvedValue('{"version":1}')
    const readProjectBinaryFile = vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3, 4]))
    const reader = createTileBundleReader(
      {
        baseUrl: 'asset://unused',
        localRoot: '/tmp/project/.ecos/tile-cache/layout/route',
      },
      {
        readProjectTextFile,
        readProjectBinaryFile,
      },
    )

    await expect(reader.readText('manifest.json')).resolves.toBe('{"version":1}')
    const binary = await reader.readBinary('cells.bin')
    expect(Array.from(new Uint8Array(binary))).toEqual([1, 2, 3, 4])

    expect(readProjectTextFile).toHaveBeenCalledWith(
      '/tmp/project/.ecos/tile-cache/layout/route/manifest.json',
    )
    expect(readProjectBinaryFile).toHaveBeenCalledWith(
      '/tmp/project/.ecos/tile-cache/layout/route/cells.bin',
    )
  })

  it('maps bridge ENOENT failures to BundleFileNotFoundError for optional tile assets', async () => {
    const reader = createTileBundleReader(
      {
        baseUrl: 'asset://unused',
        localRoot: '/tmp/project/.ecos/tile-cache/layout/route',
      },
      {
        readProjectTextFile: vi.fn().mockRejectedValue(new Error('ENOENT: no such file')),
        readProjectBinaryFile: vi.fn().mockRejectedValue(new Error('ENOENT: no such file')),
      },
    )

    await expect(reader.readText('tiles/vector/0/0/0.bin')).rejects.toBeInstanceOf(
      BundleFileNotFoundError,
    )
    await expect(reader.readBinary('tiles/vector/0/0/0.bin')).rejects.toBeInstanceOf(
      BundleFileNotFoundError,
    )
  })

  it('rejects bundle-relative traversal that escapes the generated bundle root', async () => {
    const readProjectTextFile = vi.fn()
    const readProjectBinaryFile = vi.fn()
    const reader = createTileBundleReader(
      {
        baseUrl: 'asset://unused',
        localRoot: '/tmp/project/.ecos/tile-cache/layout/route',
      },
      {
        readProjectTextFile,
        readProjectBinaryFile,
      },
    )

    await expect(reader.readText('../../other/file')).rejects.toBeInstanceOf(
      BundlePathOutsideRootError,
    )
    await expect(reader.readBinary('../../other/file')).rejects.toBeInstanceOf(
      BundlePathOutsideRootError,
    )
    expect(readProjectTextFile).not.toHaveBeenCalled()
    expect(readProjectBinaryFile).not.toHaveBeenCalled()
  })
})
