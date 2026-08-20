import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProjectManifestDraft,
  registerWorkspaceInManifest,
} from '@ecos-studio/shared'
import {
  projectWorkspaceDataReaderFor,
  readProjectWorkspaceAnalysisInputs,
  readProjectWorkspaceFlowStates,
} from './projectWorkspaceData'
import { readProjectManagementWorkspaceData } from './projectWorkspaceAnalysisData'
import { readFrontendProjectWorkspaceFlowStates } from './frontendProjectWorkspaceData'

vi.mock('./projectWorkspaceAnalysisData', () => ({
  readProjectManagementWorkspaceData: vi.fn(async () => ({
    analysisInputs: { ws_backend: { flowText: '{}' } },
    flowStates: { ws_backend: { Synth: 'success' } },
  })),
}))

vi.mock('./frontendProjectWorkspaceData', () => ({
  readFrontendProjectWorkspaceFlowStates: vi.fn(async () => ({
    ws_frontend: { prepare: 'success' },
  })),
}))

const readBackendDataMock = vi.mocked(readProjectManagementWorkspaceData)
const readFrontendFlowMock = vi.mocked(readFrontendProjectWorkspaceFlowStates)

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
    readFrontendFlowMock.mockClear()
  })

  it('delegates backend workspace data to the physical-design reader', async () => {
    const backendManifest = manifest('backend')

    await expect(
      readProjectWorkspaceFlowStates('/projects/backend', backendManifest),
    ).resolves.toEqual({
      ws_backend: { Synth: 'success' },
    })
    await expect(
      readProjectWorkspaceAnalysisInputs('/projects/backend', backendManifest),
    ).resolves.toEqual({
      ws_backend: { flowText: '{}' },
    })
    expect(readBackendDataMock).toHaveBeenCalledWith('/projects/backend', backendManifest)
  })

  it('keeps frontend workspaces away from backend artifact paths', async () => {
    const frontendManifest = manifest('frontend')

    await expect(
      readProjectWorkspaceFlowStates('/projects/frontend', frontendManifest),
    ).resolves.toEqual({ ws_frontend: { prepare: 'success' } })
    await expect(
      readProjectWorkspaceAnalysisInputs('/projects/frontend', frontendManifest),
    ).resolves.toEqual({
      ws_0001: {},
    })
    expect(readBackendDataMock).not.toHaveBeenCalled()
    expect(readFrontendFlowMock).toHaveBeenCalledWith(
      '/projects/frontend',
      frontendManifest,
    )
    expect(projectWorkspaceDataReaderFor('frontend')).not.toBe(
      projectWorkspaceDataReaderFor('backend'),
    )
  })
})
