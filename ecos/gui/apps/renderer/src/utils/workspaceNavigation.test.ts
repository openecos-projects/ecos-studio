import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearWorkspaceManagementReturnRoute,
  consumeWorkspaceManagementReturnRoute,
  consumeWorkspaceWizardRequest,
  beginWorkspaceCreation,
  finishWorkspaceCreation,
  rememberWorkspaceManagementReturnRoute,
  requestWorkspaceWizard,
  useWorkspaceCreation,
} from './workspaceNavigation'

describe('workspace navigation context', () => {
  beforeEach(() => {
    clearWorkspaceManagementReturnRoute()
    consumeWorkspaceWizardRequest()
    const pendingCreation = useWorkspaceCreation().value
    if (pendingCreation) finishWorkspaceCreation(pendingCreation.token)
  })

  it('round-trips the exact workspace route without sharing mutable query arrays', () => {
    const query = { projectRoot: '/work/demo', workspaceId: 'ws_0001' }
    rememberWorkspaceManagementReturnRoute({
      path: '/workspace/floorplan',
      query,
      params: { step: 'floorplan' },
    })
    query.workspaceId = 'changed'

    expect(consumeWorkspaceManagementReturnRoute()).toEqual({
      path: '/workspace/floorplan',
      query: { projectRoot: '/work/demo', workspaceId: 'ws_0001' },
      params: { step: 'floorplan' },
    })
    expect(consumeWorkspaceManagementReturnRoute()).toBeNull()
  })

  it('ignores standalone and management routes as return targets', () => {
    rememberWorkspaceManagementReturnRoute({ path: '/projects', query: {} })
    rememberWorkspaceManagementReturnRoute({ path: '/workspace/projects', query: {} })
    expect(consumeWorkspaceManagementReturnRoute()).toBeNull()
  })

  it('passes a workspace wizard request through the app shell', () => {
    requestWorkspaceWizard({
      directory: '/work/demo/ws_0002',
      managedWorkspaceRoot: '/work/demo',
      lockWorkspaceDirectory: true,
    })

    expect(consumeWorkspaceWizardRequest()).toEqual({
      initialConfig: {
        directory: '/work/demo/ws_0002',
        managedWorkspaceRoot: '/work/demo',
        lockWorkspaceDirectory: true,
      },
    })
    expect(consumeWorkspaceWizardRequest()).toBeNull()
  })

  it('allows one pending creation and ignores stale completion tokens', () => {
    const firstToken = beginWorkspaceCreation('/work/demo/ws_0001')
    expect(firstToken).toBeTypeOf('number')
    expect(beginWorkspaceCreation('/work/demo/ws_0002')).toBeNull()

    finishWorkspaceCreation(firstToken! + 1)
    expect(useWorkspaceCreation().value).toEqual({
      targetPath: '/work/demo/ws_0001',
      token: firstToken,
    })

    finishWorkspaceCreation(firstToken!)
    expect(useWorkspaceCreation().value).toBeNull()
  })
})
