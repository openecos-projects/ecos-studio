import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import type {
  DesktopApi,
  WorkspaceCreationModel,
  WorkspaceCreationModelRequest,
} from '@ecos-studio/shared'

const discoveredModel: WorkspaceCreationModel = {
  controls: {
    flowBoundaries: true,
    manualPdkFiles: true,
    mpc: true,
    pdkVersion: true,
  },
  discovery: {},
  context: {},
  parameters: [
    {
      definition: { id: 'track_density' },
      state: 'defaulted',
      value: 0.5,
    },
  ],
  pdkInstallations: [],
}

const getWorkspaceCreationModel = vi.fn(
  async (request?: WorkspaceCreationModelRequest) => {
    // The real preload bridge rejects payloads that structured clone cannot
    // serialize (for example Vue reactive proxies).
    structuredClone(request)
    return discoveredModel
  },
)

const desktopBridge = {
  workspaceCreationModel: { get: getWorkspaceCreationModel },
} as unknown as DesktopApi

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => desktopBridge,
}))

import { useWorkspaceCreationModel } from './useWorkspaceCreationModel'

describe('useWorkspaceCreationModel', () => {
  it('loads the model when the request options hold reactive project state', async () => {
    const mpc = reactive({ clock: { port: 'CK' } })
    const projectPresetParameters = reactive({ max_fanout: 16 })
    const creationModel = useWorkspaceCreationModel({
      designTool: () => 'backend',
      flowId: () => 'rtl2gds',
      inputMode: () => 'rtl',
      mpc: () => mpc,
      pdk: () => null,
      projectPresetParameters: () => projectPresetParameters,
    })

    await creationModel.refresh()

    expect(getWorkspaceCreationModel).toHaveBeenCalledTimes(1)
    const request = getWorkspaceCreationModel.mock.calls[0]?.[0]
    expect(request?.mpc).toEqual({ clock: { port: 'CK' } })
    expect(request?.projectPresetParameters).toEqual({ max_fanout: 16 })
    expect(creationModel.model.value?.parameters[0]?.definition.id).toBe('track_density')
  })
})
