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
})
