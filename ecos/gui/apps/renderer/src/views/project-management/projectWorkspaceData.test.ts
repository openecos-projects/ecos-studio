import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProjectManifestDraft,
  registerWorkspaceInManifest,
} from '@ecos-studio/shared'
import {
  projectWorkspaceDataReaderFor,
  readProjectWorkspaceData,
} from './projectWorkspaceData'
import { readProjectManagementWorkspaceData } from './projectWorkspaceAnalysisData'
import { readFrontendProjectWorkspaceData } from './frontendProjectWorkspaceData'

vi.mock('./projectWorkspaceAnalysisData', () => ({
  readProjectManagementWorkspaceData: vi.fn(async () => ({
    analysisInputs: { ws_backend: { flowText: '{}' } },
    flowStates: { ws_backend: { Synth: 'success' } },
  })),
}))

vi.mock('./frontendProjectWorkspaceData', () => ({
  readFrontendProjectWorkspaceData: vi.fn(async () => ({
    analysisInputs: { ws_frontend: { frontendDetailTexts: { prepare: '{}' } } },
    flowStates: { ws_frontend: { prepare: 'success' } },
  })),
}))

const readBackendDataMock = vi.mocked(readProjectManagementWorkspaceData)
const readFrontendDataMock = vi.mocked(readFrontendProjectWorkspaceData)

function manifest(projectType: 'backend' | 'frontend') {
  return registerWorkspaceInManifest(
    createProjectManifestDraft({
      rootPath: `/projects/${projectType}`,
      name: projectType,
      designName: projectType,
      projectType,
    }),
    {
      projectRoot: `/projects/${projectType}`,
      workspacePath: `/projects/${projectType}/ws_0001`,
    },
  )
}

describe('project workspace data readers', () => {
  beforeEach(() => {
    readBackendDataMock.mockClear()
    readFrontendDataMock.mockClear()
  })

  it('delegates backend workspace data to the physical-design reader', async () => {
    const backendManifest = manifest('backend')

    await expect(
      readProjectWorkspaceData('/projects/backend', backendManifest),
    ).resolves.toEqual({
      analysisInputs: { ws_backend: { flowText: '{}' } },
      flowStates: { ws_backend: { Synth: 'success' } },
    })
    expect(readBackendDataMock).toHaveBeenCalledWith('/projects/backend', backendManifest)
  })

  it('keeps frontend workspaces away from backend artifact paths', async () => {
    const frontendManifest = manifest('frontend')

    await expect(
      readProjectWorkspaceData('/projects/frontend', frontendManifest),
    ).resolves.toEqual({
      analysisInputs: {
        ws_frontend: { frontendDetailTexts: { prepare: '{}' } },
      },
      flowStates: { ws_frontend: { prepare: 'success' } },
    })
    expect(readBackendDataMock).not.toHaveBeenCalled()
    expect(readFrontendDataMock).toHaveBeenCalledWith(
      '/projects/frontend',
      frontendManifest,
    )
    expect(projectWorkspaceDataReaderFor('frontend')).not.toBe(
      projectWorkspaceDataReaderFor('backend'),
    )
  })
})
