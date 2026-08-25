// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadProjectHistory: vi.fn(async () => []),
  readProjectManagementManifest: vi.fn(async () => null),
  listProjectManagementEntries: vi.fn(async () => []),
  readProjectWorkspaceData: vi.fn(async () => ({ flowStates: {}, analysisInputs: {} })),
  mutateProjectManifest: vi.fn(),
  listResourcesApi: vi.fn(async () => []),
  readMpcSpecApi: vi.fn(async () => null),
  waitForDesktopApi: vi.fn(async () => ({
    settings: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
    },
  })),
  openProject: vi.fn(async () => true),
  showToast: vi.fn(),
  push: vi.fn(),
}))

vi.mock('@/utils/projectHistory', () => ({
  loadProjectHistory: mocks.loadProjectHistory,
  rememberProjectHistoryEntry: vi.fn(),
  removeProjectHistoryEntry: vi.fn(),
}))

vi.mock('@/utils/projectManagementRead', () => ({
  listProjectManagementEntries: mocks.listProjectManagementEntries,
  readProjectManagementManifest: mocks.readProjectManagementManifest,
}))

vi.mock('@/views/project-management/projectWorkspaceData', () => ({
  readProjectWorkspaceData: mocks.readProjectWorkspaceData,
}))

vi.mock('@/platform/desktop', () => ({
  waitForDesktopApi: mocks.waitForDesktopApi,
}))

vi.mock('@/api/plugin', () => ({
  listResourcesApi: mocks.listResourcesApi,
  readMpcSpecApi: mocks.readMpcSpecApi,
}))

vi.mock('@/api/projectManifest', () => ({
  mutateProjectManifest: mocks.mutateProjectManifest,
}))

vi.mock('@/composables/useWorkspace', () => ({
  useWorkspace: () => ({
    openProject: mocks.openProject,
    showToast: mocks.showToast,
  }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: mocks.push }),
}))

import ProjectsView from './ProjectsView.vue'

describe('ProjectsView runtime mounting', () => {
  it('renders the project management shell during initial setup', async () => {
    const wrapper = mount(ProjectsView, {
      global: {
        stubs: {
          ProjectAnalysisPanel: { template: '<div data-test="analysis-panel" />' },
          MpcTemplatePreview: true,
        },
      },
    })

    await flushPromises()

    expect(wrapper.find('.resource-manager-view').exists()).toBe(true)
    expect(wrapper.find('#project-manager-title').text()).toBe('Project Management')
  })
})
