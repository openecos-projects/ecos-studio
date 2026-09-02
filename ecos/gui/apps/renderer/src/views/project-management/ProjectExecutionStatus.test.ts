// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { BackendProjectActiveOperation } from '@ecos-studio/shared'
import ProjectExecutionStatus from './ProjectExecutionStatus.vue'

function operation(
  overrides: Partial<BackendProjectActiveOperation> = {},
): BackendProjectActiveOperation {
  return {
    cancelRequested: false,
    engineeringWorkspaceId: 'engineering-1',
    kind: 'step',
    operationId: 'operation-1',
    projectWorkspaceId: 'ws_1',
    rerun: false,
    state: 'queued',
    step: 'Route',
    updatedAt: 1,
    workspaceRevision: 1,
    ...overrides,
  }
}

describe('ProjectExecutionStatus', () => {
  it('shows queued work and prioritizes cancellation requests', async () => {
    const wrapper = mount(ProjectExecutionStatus, {
      props: { operations: [operation()] },
    })
    expect(wrapper.text()).toBe('Route queued')

    await wrapper.setProps({
      operations: [
        operation(),
        operation({
          cancelRequested: true,
          operationId: 'operation-2',
          state: 'running',
          step: 'STA',
        }),
      ],
    })
    expect(wrapper.text()).toBe('STA cancelling +1')
  })
})
