import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  currentProject,
  fetchSharedHomeData,
  readProjectTextFile,
  writeProjectTextFile,
  resolveProjectPathAccess,
} = vi.hoisted(() => ({
  currentProject: {
    value: { path: '/workspace/demo' } as { path: string } | null,
  },
  fetchSharedHomeData: vi.fn(),
  readProjectTextFile: vi.fn(),
  writeProjectTextFile: vi.fn(),
  resolveProjectPathAccess: vi.fn(async (path: string) => path),
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject,
  }),
}))

vi.mock('./useTauri', () => ({
  useTauri: () => ({
    isInTauri: true,
  }),
}))

vi.mock('./useHomeData', () => ({
  fetchSharedHomeData,
  convertRemoteToLocalPath: (path: string) => path,
}))

vi.mock('@/utils/projectFiles', () => ({
  readProjectTextFile,
  writeProjectTextFile,
}))

vi.mock('@/utils/projectFs', () => ({
  resolveProjectPathAccess,
}))

import { useParameters } from './useParameters'

describe('useParameters desktop bridge integration', () => {
  beforeEach(() => {
    currentProject.value = { path: '/workspace/demo' }
    fetchSharedHomeData.mockReset()
    readProjectTextFile.mockReset()
    writeProjectTextFile.mockReset()
    resolveProjectPathAccess.mockClear()
  })

  it('loads and saves parameters through the bridge-backed file helpers', async () => {
    fetchSharedHomeData.mockResolvedValue({
      parameters: '/workspace/demo/home/parameters.json',
    })
    readProjectTextFile.mockResolvedValue(JSON.stringify({
      PDK: 'ics55',
      Design: 'demo',
      'Top module': 'chip_top',
      Die: { Size: [100, 100], Area: 10000 },
      Core: {
        Size: [80, 80],
        Area: 6400,
        'Bounding box': '(0,0) (80,80)',
        Utilitization: 0.5,
        Margin: [4, 4],
        'Aspect ratio': 1,
      },
      'Max fanout': 20,
      'Target density': 0.3,
      'Target overflow': 0.1,
      'Global right padding': 0,
      'Cell padding x': 600,
      'Routability opt flag': 1,
      Clock: 'clk',
      'Frequency max [MHz]': 100,
      'Bottom layer': 'MET2',
      'Top layer': 'MET5',
      'PDK Root': '/pdks/ics55',
    }))

    const parameters = useParameters()

    await vi.waitFor(() => {
      expect(readProjectTextFile).toHaveBeenCalledWith('/workspace/demo/home/parameters.json')
    })

    expect(parameters.config.design).toBe('demo')
    expect(parameters.config.topModule).toBe('chip_top')

    parameters.config.design = 'updated_demo'

    await expect(parameters.saveParameters()).resolves.toBe(true)

    expect(resolveProjectPathAccess).toHaveBeenCalledWith('/workspace/demo/home/parameters.json')
    expect(writeProjectTextFile).toHaveBeenCalledWith(
      '/workspace/demo/home/parameters.json',
      expect.stringContaining('"Design": "updated_demo"'),
    )
  })
})
