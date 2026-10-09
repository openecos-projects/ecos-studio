// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const episodeForParent = vi.hoisted(() => vi.fn())
const dynamicFlowStages = vi.hoisted(() => ({ value: [] as Array<{ state: string }> }))

vi.mock('@/stores/optimizationEpisodeStore', () => ({
  useOptimizationEpisodeStore: () => ({ episodeForParent }),
}))

vi.mock('@/composables/useCurrentStage', () => ({
  useCurrentStage: () => ({ currentStage: ref('home') }),
}))

vi.mock('@/composables/useFlowRunner', () => ({
  useFlowRunner: () => ({ isRunning: ref(false), runAllFlow: vi.fn(), runFlow: vi.fn() }),
}))

vi.mock('@/composables/useBackendFlowStages', () => ({
  useBackendFlowStages: () => ({
    dynamicFlowStages,
    refreshFlowStages: vi.fn(),
    setFirstRunStepOngoing: vi.fn(),
    setRunStepOngoingByPath: vi.fn(),
  }),
}))

vi.mock('@/composables/useSubflow', () => ({
  useSubflow: () => ({ overallStatus: ref('pending') }),
}))

vi.mock('@/composables/useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: ref({ path: '/work/demo' }),
    ensureApiReady: vi.fn(),
    showToast: vi.fn(),
    workspaceSession: ref({ workspaceId: 'workspace-parent' }),
  }),
}))

import FlowRunControl from './FlowRunControl.vue'

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'FlowRunControl.vue'),
  'utf8',
)

describe('FlowRunControl Agent capture', () => {
  beforeEach(() => {
    dynamicFlowStages.value = []
    episodeForParent.mockReset()
  })

  it('starts the flow without owning Agent artifact capture', () => {
    expect(source).not.toContain('startFlowRunArtifactCapture')
    expect(source).not.toContain('useFlowRunArtifacts')
  })

  it('guards the Parent run control without presenting it as running', () => {
    episodeForParent.mockReturnValue({ episodeId: 'episode-1', state: 'running' })

    const wrapper = mount(FlowRunControl, {
      global: { stubs: { Dialog: true } },
    })
    const button = wrapper.get('button.flow-run-start-button')

    expect(episodeForParent).toHaveBeenCalledWith('workspace-parent', '/work/demo')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('aria-busy')).toBe('false')
    expect(button.attributes('title')).toBe('Optimization is running in the background.')
    expect(button.get('i').classes()).toContain('ri-play-fill')
    expect(button.get('i').classes()).not.toContain('ri-loader-4-line')
  })

  it('presents an externally started flow as running', () => {
    dynamicFlowStages.value = [{ state: 'Ongoing' }]

    const wrapper = mount(FlowRunControl, {
      global: { stubs: { Dialog: true } },
    })
    const button = wrapper.get('button.flow-run-start-button')

    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('aria-busy')).toBe('true')
    expect(button.get('i').classes()).toContain('ri-loader-4-line')
    expect(button.get('i').classes()).not.toContain('ri-play-fill')
  })
})
