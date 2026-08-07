import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearAgentWorkspaceRerunHomePrepared,
  consumePendingHomeRunArtifactReset,
  isAgentWorkspaceRerunHomePrepared,
  markAgentWorkspaceRerunHomePrepared,
  requestHomeRunArtifactReset,
} from './homeRunArtifacts'

describe('homeRunArtifacts agent rerun prepared mark', () => {
  beforeEach(() => {
    clearAgentWorkspaceRerunHomePrepared('/workspace/a_rerun_place')
    consumePendingHomeRunArtifactReset('/workspace/a_rerun_place')
  })

  it('tracks prepared agent rerun workspaces for skipping runtime clear', () => {
    expect(isAgentWorkspaceRerunHomePrepared('/workspace/a_rerun_place')).toBe(false)
    markAgentWorkspaceRerunHomePrepared('/workspace/a_rerun_place/')
    expect(isAgentWorkspaceRerunHomePrepared('/workspace/a_rerun_place')).toBe(true)
    clearAgentWorkspaceRerunHomePrepared('/workspace/a_rerun_place')
    expect(isAgentWorkspaceRerunHomePrepared('/workspace/a_rerun_place')).toBe(false)
  })

  it('still accepts pending reset requests for open-time cache clear', () => {
    markAgentWorkspaceRerunHomePrepared('/workspace/a_rerun_place')
    requestHomeRunArtifactReset('/workspace/a_rerun_place')
    expect(consumePendingHomeRunArtifactReset('/workspace/a_rerun_place')).toBe(true)
    expect(isAgentWorkspaceRerunHomePrepared('/workspace/a_rerun_place')).toBe(true)
  })
})
