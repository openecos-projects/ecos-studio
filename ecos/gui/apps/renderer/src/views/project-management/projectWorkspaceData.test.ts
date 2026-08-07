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
import {
  readBackendProjectWorkspaceAnalysisInputs,
  readBackendProjectWorkspaceFlowStates,
} from './projectWorkspaceAnalysisData'
import { readFrontendProjectWorkspaceFlowStates } from './frontendProjectWorkspaceData'

vi.mock('./projectWorkspaceAnalysisData', () => ({
  readBackendProjectWorkspaceAnalysisInputs: vi.fn(async () => ({
    ws_backend: { flowText: '{}' },
  })),
  readBackendProjectWorkspaceFlowStates: vi.fn(async () => ({
    ws_backend: { Synth: 'success' },
  })),
}))

vi.mock('./frontendProjectWorkspaceData', () => ({
  readFrontendProjectWorkspaceFlowStates: vi.fn(async () => ({
    ws_frontend: { prepare: 'success' },
  })),
}))

const readBackendAnalysisMock = vi.mocked(readBackendProjectWorkspaceAnalysisInputs)
const readBackendFlowMock = vi.mocked(readBackendProjectWorkspaceFlowStates)
const readFrontendFlowMock = vi.mocked(readFrontendProjectWorkspaceFlowStates)

function manifest(projectType: 'backend' | 'frontend') {
  return registerWorkspaceInManifest(
    createProjectManifestDraft({
      rootPath: `/projects/${projectType}`,
      name: projectType,
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
    readBackendAnalysisMock.mockClear()
    readBackendFlowMock.mockClear()
    readFrontendFlowMock.mockClear()
  })

  it('delegates backend workspace data to the physical-design reader', async () => {
    const backendManifest = manifest('backend')

    await expect(readProjectWorkspaceFlowStates(backendManifest)).resolves.toEqual({
      ws_backend: { Synth: 'success' },
    })
    await expect(readProjectWorkspaceAnalysisInputs(backendManifest)).resolves.toEqual({
      ws_backend: { flowText: '{}' },
    })
    expect(readBackendFlowMock).toHaveBeenCalledWith(backendManifest)
    expect(readBackendAnalysisMock).toHaveBeenCalledWith(backendManifest)
  })

  it('keeps frontend workspaces away from backend artifact paths', async () => {
    const frontendManifest = manifest('frontend')

    await expect(readProjectWorkspaceFlowStates(frontendManifest)).resolves.toEqual({
      ws_frontend: { prepare: 'success' },
    })
    await expect(readProjectWorkspaceAnalysisInputs(frontendManifest)).resolves.toEqual({
      ws_0001: {},
    })
    expect(readBackendFlowMock).not.toHaveBeenCalled()
    expect(readBackendAnalysisMock).not.toHaveBeenCalled()
    expect(readFrontendFlowMock).toHaveBeenCalledWith(frontendManifest)
    expect(projectWorkspaceDataReaderFor('frontend')).not.toBe(
      projectWorkspaceDataReaderFor('backend'),
    )
  })
})
