import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readdir, realpath, stat } = vi.hoisted(() => ({
  readdir: vi.fn(),
  realpath: vi.fn(),
  stat: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readdir,
  realpath,
  stat,
}))

import { ProjectScopeService } from './projectScopeService'

describe('ProjectScopeService fallback PDK naming', () => {
  beforeEach(() => {
    readdir.mockReset()
    realpath.mockReset()
    stat.mockReset()
  })

  it('derives fallback name and pdkId from only the leaf directory on Windows-style paths', async () => {
    realpath.mockResolvedValue('C:\\PDKs\\Open Cell Library')
    stat.mockResolvedValue({
      isDirectory: () => true,
    })
    readdir.mockResolvedValue([])

    const service = new ProjectScopeService()
    const scanned = await service.scanPdkDirectory('ignored-by-mock')

    expect(scanned).toMatchObject({
      canonicalPath: 'C:\\PDKs\\Open Cell Library',
      name: 'Open Cell Library',
      pdkId: 'open_cell_library',
    })
  })

  it('recursively lists LEF and Liberty resources under the PDK root', async () => {
    realpath.mockResolvedValue('/pdks/ics55')
    stat.mockResolvedValue({
      isDirectory: () => true,
    })
    readdir.mockImplementation(async (path: string) => {
      const entries: Record<
        string,
        Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>
      > = {
        '/pdks/ics55': [
          { name: 'IP', isDirectory: () => true, isFile: () => false },
          { name: 'prtech', isDirectory: () => true, isFile: () => false },
          { name: 'README.md', isDirectory: () => false, isFile: () => true },
        ],
        '/pdks/ics55/IP': [
          { name: 'STD_cell', isDirectory: () => true, isFile: () => false },
        ],
        '/pdks/ics55/IP/STD_cell': [
          { name: 'liberty', isDirectory: () => true, isFile: () => false },
          { name: 'lef', isDirectory: () => true, isFile: () => false },
        ],
        '/pdks/ics55/IP/STD_cell/lef': [
          { name: 'std.lef', isDirectory: () => false, isFile: () => true },
        ],
        '/pdks/ics55/IP/STD_cell/liberty': [
          { name: 'std_typ.lib', isDirectory: () => false, isFile: () => true },
        ],
        '/pdks/ics55/prtech': [
          { name: 'techLEF', isDirectory: () => true, isFile: () => false },
        ],
        '/pdks/ics55/prtech/techLEF': [
          { name: 'tech.lef', isDirectory: () => false, isFile: () => true },
        ],
      }
      return entries[path] ?? []
    })

    const service = new ProjectScopeService()
    const scanned = await service.scanPdkDirectory('/pdks/ics55')

    expect(scanned.detectedFiles.files).toEqual([
      'IP/STD_cell/lef/std.lef',
      'IP/STD_cell/liberty/std_typ.lib',
      'prtech/techLEF/tech.lef',
    ])
    expect(scanned.detectedFiles.directories).toContain('IP/STD_cell/lef')
    expect(scanned.detectedFiles.directories).toContain('prtech/techLEF')
  })
})
