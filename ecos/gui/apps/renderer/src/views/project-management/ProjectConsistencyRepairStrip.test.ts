// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectDoctorCheckResult } from '@ecos-studio/shared'

const api = vi.hoisted(() => ({
  checkProjectConsistency: vi.fn(),
  repairProjectConsistency: vi.fn(),
}))
vi.mock('@/utils/projectConsistency', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/projectConsistency')>()),
  ...api,
}))

import ProjectConsistencyRepairStrip from './ProjectConsistencyRepairStrip.vue'
import { useNotificationStore } from '@/stores/notificationStore'
import { useProjectConsistencyStore } from '@/stores/projectConsistencyStore'

function failedReport(
  overrides: Partial<ProjectDoctorCheckResult> = {},
): ProjectDoctorCheckResult {
  return {
    doctor: 'project',
    status: 'failed',
    projectRoot: '/projects/demo',
    checked: 3,
    inconsistent: 2,
    findings: [
      {
        check: 'derived-field-mismatch',
        status: 'fail',
        workspace_id: 'ws_0001',
        workspace: '/projects/demo/ws_0001',
        detail: 'derived fields disagree with directory facts: status',
      },
      {
        check: 'missing-directory',
        status: 'fail',
        workspace_id: 'ws_0002',
        workspace: '/projects/demo/ws_0002',
        detail: 'workspace directory does not exist',
      },
    ],
    ...overrides,
  }
}

describe('ProjectConsistencyRepairStrip', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useNotificationStore().clear()
  })

  it('stays hidden when its project has no findings', () => {
    const store = useProjectConsistencyStore()
    store.reports = {
      '/projects/other': failedReport({ projectRoot: '/projects/other' }),
    }

    const wrapper = mount(ProjectConsistencyRepairStrip, {
      props: { projectRoot: '/projects/demo' },
    })

    expect(wrapper.find('.consistency-strip').exists()).toBe(false)
  })

  it('summarizes findings for its own project only', () => {
    const store = useProjectConsistencyStore()
    store.reports = {
      '/projects/demo': failedReport(),
      '/projects/consistent': failedReport({
        status: 'ok',
        projectRoot: '/projects/consistent',
        inconsistent: 0,
        findings: [],
      }),
    }

    const wrapper = mount(ProjectConsistencyRepairStrip, {
      props: { projectRoot: '/projects/demo' },
    })

    expect(wrapper.text()).toContain('1 out-of-sync manifest entry')
    expect(wrapper.text()).toContain('1 missing workspace directory')
    expect(wrapper.findAll('button')).toHaveLength(1)
  })

  it('repairs, re-checks, hides, and emits repaired', async () => {
    const store = useProjectConsistencyStore()
    store.reports = { '/projects/demo': failedReport() }
    api.repairProjectConsistency.mockResolvedValue({
      doctor: 'project',
      status: 'fixed',
      projectRoot: '/projects/demo',
      checked: 3,
      inconsistent: 2,
      fixed: 2,
      findings: [
        { ...failedReport().findings[0]!, fix: 'rebuilt' },
        { ...failedReport().findings[1]!, fix: 'removed' },
      ],
    })
    api.checkProjectConsistency.mockResolvedValue({
      doctor: 'project',
      status: 'ok',
      projectRoot: '/projects/demo',
      checked: 2,
      inconsistent: 0,
      findings: [],
    })
    const wrapper = mount(ProjectConsistencyRepairStrip, {
      props: { projectRoot: '/projects/demo' },
    })

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(api.repairProjectConsistency).toHaveBeenCalledWith('/projects/demo')
    expect(api.checkProjectConsistency).toHaveBeenCalledWith('/projects/demo')
    expect(wrapper.emitted('repaired')).toEqual([['/projects/demo']])
    expect(wrapper.find('.consistency-strip').exists()).toBe(false)
  })

  it('keeps the strip and notifies when the repair reports failures', async () => {
    const store = useProjectConsistencyStore()
    store.reports = { '/projects/demo': failedReport() }
    api.repairProjectConsistency.mockResolvedValue({
      doctor: 'project',
      status: 'failed',
      projectRoot: '/projects/demo',
      checked: 3,
      inconsistent: 2,
      fixed: 1,
      findings: [
        { ...failedReport().findings[0]!, fix: 'rebuilt' },
        {
          ...failedReport().findings[1]!,
          fix: 'failed',
          fix_detail: 'manifest update failed',
        },
      ],
    })
    api.checkProjectConsistency.mockResolvedValue(failedReport({ inconsistent: 1 }))
    const wrapper = mount(ProjectConsistencyRepairStrip, {
      props: { projectRoot: '/projects/demo' },
    })
    const notifications = useNotificationStore()

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('repaired')).toEqual([['/projects/demo']])
    expect(wrapper.find('.consistency-strip').exists()).toBe(true)
    expect(notifications.notifications.value[0]).toMatchObject({
      severity: 'error',
      title: 'Project consistency repair incomplete',
    })
    expect(notifications.notifications.value[0]?.message).toContain(
      'ws_0002: manifest update failed',
    )
  })

  it('notifies an understandable error when the repair request fails', async () => {
    const store = useProjectConsistencyStore()
    store.reports = { '/projects/demo': failedReport() }
    api.repairProjectConsistency.mockRejectedValue(new Error('Shutdown is in progress.'))
    const wrapper = mount(ProjectConsistencyRepairStrip, {
      props: { projectRoot: '/projects/demo' },
    })
    const notifications = useNotificationStore()

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('repaired')).toBeUndefined()
    expect(wrapper.find('.consistency-strip').exists()).toBe(true)
    expect(notifications.notifications.value[0]).toMatchObject({
      message: 'Shutdown is in progress.',
      severity: 'error',
      title: 'Project consistency repair failed',
    })
  })
})
