import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { expect, it, vi } from 'vitest'
import type { WorkspaceStepResource } from '@ecos-studio/shared'
import { useFlowRunArtifacts } from './useFlowRunArtifacts'
import { useMessageStore } from '@/stores/messageStore'

const { getWorkspaceResourceIndexApi, readProjectBlobUrl } = vi.hoisted(() => ({
  getWorkspaceResourceIndexApi: vi.fn(),
  readProjectBlobUrl: vi.fn(),
}))

vi.mock('@/api/workspaceResources', () => ({ getWorkspaceResourceIndexApi }))
vi.mock('@/composables/useWorkspace', async () => {
  const { ref } = await import('vue')
  return {
    useWorkspace: () => ({
      backendRuntimeEvents: ref([]),
      currentProject: ref({ path: '/runs/gcd' }),
    }),
  }
})
vi.mock('@/composables/useWorkspaceLifecycle', () => ({
  useWorkspaceLifecycle: () => ({
    registerBlobUrl: vi.fn(),
    registerCleanup: () => () => {},
  }),
}))
vi.mock('@/utils/projectFiles', () => ({
  readProjectBlobUrl,
  readOptionalProjectTextFile: vi.fn(),
}))
vi.mock('@/utils/projectFs', () => ({
  resolveProjectPathAccess: async (path: string) => path,
}))

it('awaits the final layout from committed resources even without a step event', async () => {
  setActivePinia(createPinia())
  const step: WorkspaceStepResource = {
    name: 'Harden',
    tool: 'ecc',
    state: 'Success',
    runtime: '00:00:02',
    directory: '/runs/gcd/Harden',
    info: {},
    resources: {
      output: {
        image: {
          path: '/runs/gcd/Harden/output/gcd.png',
          exists: true,
          kind: 'layout-image',
        },
      },
      data: {},
      feature: {},
      report: {},
      log: {},
      script: {},
      analysis: {},
      subflow: {},
      checklist: {},
      config: {},
    },
  }
  getWorkspaceResourceIndexApi.mockResolvedValue({ flow: { steps: [step] } })
  let releaseLayout!: (url: string) => void
  readProjectBlobUrl.mockReturnValue(
    new Promise<string>((resolve) => {
      releaseLayout = resolve
    }),
  )
  const messages = useMessageStore()
  messages.setActiveSessionId('owner')
  const capture = useFlowRunArtifacts().startFlowRunArtifactCapture({
    ownerSessionId: 'owner',
  })
  let inspected = false
  const inspection = capture.inspect().then(() => {
    inspected = true
  })
  try {
    await flushPromises()
    expect(readProjectBlobUrl).toHaveBeenCalledWith(step.resources.output.image!.path, {
      mimeType: 'image/png',
    })
    expect(inspected).toBe(false)
    expect(messages.messages).toEqual([])
    releaseLayout('blob:harden')
    await inspection
    expect(messages.messages.map((message) => message.mapData?.step)).toEqual(['Harden'])
    await capture.inspect()
    expect(messages.messages).toHaveLength(1)
    expect(readProjectBlobUrl).toHaveBeenCalledOnce()
  } finally {
    releaseLayout('blob:harden')
    await inspection
    capture.stop()
  }
})
