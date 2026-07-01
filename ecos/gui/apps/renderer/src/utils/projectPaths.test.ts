import { describe, expect, it } from 'vitest'

import { convertRemoteToLocalPath } from './projectPaths'

describe('projectPaths', () => {
  it('converts an nfs path using the local project root', () => {
    expect(
      convertRemoteToLocalPath(
        '/nfs/share/home/user/benchmark/place_ecc/output/maps/density.png',
        '/Users/ekko/projects/place_ecc',
      ),
    ).toBe('/Users/ekko/projects/place_ecc/output/maps/density.png')
  })

  it('returns non-nfs paths as-is', () => {
    expect(
      convertRemoteToLocalPath(
        '/Users/ekko/projects/place_ecc/output/maps/density.png',
        '/Users/ekko/projects/place_ecc',
      ),
    ).toBe('/Users/ekko/projects/place_ecc/output/maps/density.png')
  })

  it('returns the remote path when projectPath is missing', () => {
    expect(
      convertRemoteToLocalPath(
        '/nfs/share/home/user/benchmark/place_ecc/output/maps/density.png',
        '',
      ),
    ).toBe('/nfs/share/home/user/benchmark/place_ecc/output/maps/density.png')
  })

  it('returns the remote path when the project name cannot be extracted', () => {
    expect(
      convertRemoteToLocalPath(
        '/nfs/share/home/user/benchmark/place_ecc/output/maps/density.png',
        '/',
      ),
    ).toBe('/nfs/share/home/user/benchmark/place_ecc/output/maps/density.png')
  })

  it('returns the remote path when the project segment is absent', () => {
    expect(
      convertRemoteToLocalPath(
        '/nfs/share/home/user/benchmark/other_project/output/maps/density.png',
        '/Users/ekko/projects/place_ecc',
      ),
    ).toBe('/nfs/share/home/user/benchmark/other_project/output/maps/density.png')
  })

  it('joins cleanly when the local project path has a trailing slash', () => {
    expect(
      convertRemoteToLocalPath(
        '/nfs/share/home/user/benchmark/place_ecc/output/maps/density.png',
        '/Users/ekko/projects/place_ecc/',
      ),
    ).toBe('/Users/ekko/projects/place_ecc/output/maps/density.png')
  })

  it('preserves Windows-style separators in the local project path', () => {
    expect(
      convertRemoteToLocalPath(
        '/nfs/share/home/user/benchmark/place_ecc/output/maps/density.png',
        'C:\\Users\\ekko\\projects\\place_ecc',
      ),
    ).toBe('C:\\Users\\ekko\\projects\\place_ecc\\output\\maps\\density.png')
  })
})
