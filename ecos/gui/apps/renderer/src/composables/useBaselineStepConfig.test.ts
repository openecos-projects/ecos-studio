import { effectScope, ref, type EffectScope, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StepEnum } from '@/api/type'
import {
  createProjectManifestDraft,
  registerWorkspaceInManifest,
  setQorBaselineInManifest,
} from '@/utils/projectManagement'

const testState = vi.hoisted(() => ({
  currentProject: null as Ref<{ path: string } | null> | null,
  desktopAvailable: true,
  route: { query: {} as Record<string, unknown> },
  readManifest: vi.fn(),
  readWorkspaceTexts: vi.fn(),
  resolveProjectRouteContextForWorkspace: vi.fn(),
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: testState.currentProject,
  }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => testState.route,
}))

vi.mock('@/platform/desktop', () => ({
  hasDesktopApi: () => testState.desktopAvailable,
  getDesktopApi: () => ({
    projectManagement: {
      readManifest: testState.readManifest,
    },
  }),
}))

vi.mock('@/utils/projectManagementRead', () => ({
  readProjectManagementWorkspaceTexts: testState.readWorkspaceTexts,
}))

vi.mock('@/utils/projectManifestRegistration', () => ({
  resolveProjectRouteContextForWorkspace:
    testState.resolveProjectRouteContextForWorkspace,
}))

import {
  clearBaselineStepConfigCache,
  useBaselineStepConfig,
} from './useBaselineStepConfig'
import { baselineStepConfigReadPaths } from '@/utils/stepConfigResourceMap'

function projectManifest() {
  const draft = createProjectManifestDraft({
    rootPath: '/projects/gcd',
    name: 'gcd',
    designName: 'gcd',
    now: '2026-08-04T00:00:00.000Z',
  })
  const baseline = registerWorkspaceInManifest(draft, {
    projectRoot: '/projects/gcd',
    workspacePath: '/projects/gcd/ws_0001',
    now: '2026-08-04T00:00:00.000Z',
  })
  const withCurrent = registerWorkspaceInManifest(baseline, {
    projectRoot: '/projects/gcd',
    workspacePath: '/projects/gcd/ws_0004',
    now: '2026-08-04T01:00:00.000Z',
  })
  return setQorBaselineInManifest(withCurrent, 'ws_0001')
}

function singleWorkspaceManifest() {
  return registerWorkspaceInManifest(
    createProjectManifestDraft({
      rootPath: '/projects/gcd',
      name: 'gcd',
      designName: 'gcd',
      now: '2026-08-04T00:00:00.000Z',
    }),
    {
      projectRoot: '/projects/gcd',
      workspacePath: '/projects/gcd/ws_0004',
      now: '2026-08-04T00:00:00.000Z',
    },
  )
}

const BASELINE_FLOW = {
  steps: [
    {
      name: 'Synthesis',
      tool: 'yosys',
      state: 'done',
      runtime: '',
      'peak memory (mb)': 0,
      info: {},
    },
    {
      name: 'Floorplan',
      tool: 'ecc',
      state: 'done',
      runtime: '',
      'peak memory (mb)': 0,
      info: {},
    },
    {
      name: 'CTS',
      tool: 'ecc',
      state: 'done',
      runtime: '',
      'peak memory (mb)': 0,
      info: {},
    },
    {
      name: 'place',
      tool: 'dreamplace',
      state: 'done',
      runtime: '',
      'peak memory (mb)': 0,
      info: {},
    },
  ],
}

/** Backing store served by the mocked readWorkspaceTexts. */
let workspaceTexts: Record<string, Record<string, string | null>>

function mockWorkspaceTexts(texts: Record<string, string | null>): void {
  workspaceTexts = { '/projects/gcd/ws_0001': texts }
}

describe('useBaselineStepConfig', () => {
  let scope: EffectScope
  let step: Ref<StepEnum | undefined>

  beforeEach(() => {
    clearBaselineStepConfigCache()
    scope = effectScope()
    step = ref<StepEnum | undefined>(StepEnum.CTS)
    testState.currentProject = ref({ path: '/projects/gcd/ws_0004' })
    testState.desktopAvailable = true
    testState.route.query = { projectRoot: '/projects/gcd' }
    testState.readManifest.mockReset()
    testState.readWorkspaceTexts.mockReset()
    testState.resolveProjectRouteContextForWorkspace.mockReset()
    testState.resolveProjectRouteContextForWorkspace.mockResolvedValue(null)
    testState.readManifest.mockResolvedValue(JSON.stringify(projectManifest()))
    mockWorkspaceTexts({
      'home/flow.json': JSON.stringify(BASELINE_FLOW),
      'config/cts_ecc.json': '{"cts_buf_list":"BUF"}',
      'config/floorplan_ecc.json': '{"ifp":{"utilization":0.6}}',
      'config/dreamplace_ecc.json': '{"place":{"enable":true}}',
    })
    testState.readWorkspaceTexts.mockImplementation(
      async (_projectRoot: string, workspacePath: string, paths: string[]) => {
        const texts = workspaceTexts[workspacePath] ?? {}
        return {
          texts: Object.fromEntries(paths.map((path) => [path, texts[path] ?? null])),
          unavailablePaths: [],
        }
      },
    )
  })

  afterEach(() => {
    scope.stop()
    clearBaselineStepConfigCache()
  })

  function create() {
    return scope.run(() => useBaselineStepConfig(step))!
  }

  it('reports no-project without an open workspace', async () => {
    testState.currentProject = ref(null)
    const baseline = create()
    await vi.waitFor(() => {
      expect(baseline.status.value).toBe('no-project')
    })
  })

  it('reports browser when the desktop runtime is unavailable', async () => {
    testState.desktopAvailable = false
    const baseline = create()
    await vi.waitFor(() => {
      expect(baseline.status.value).toBe('browser')
    })
  })

  it('reports no-baseline when the workspace is not part of a routed project', async () => {
    testState.route.query = {}
    testState.resolveProjectRouteContextForWorkspace.mockResolvedValue(null)
    const baseline = create()
    await vi.waitFor(() => {
      expect(baseline.status.value).toBe('no-baseline')
    })
  })

  it('reports self-baseline when the current workspace is the only workspace', async () => {
    testState.readManifest.mockResolvedValue(JSON.stringify(singleWorkspaceManifest()))
    const baseline = create()
    await vi.waitFor(() => {
      expect(baseline.status.value).toBe('self-baseline')
    })
  })

  it('loads the baseline config for the selected step with a private view draft', async () => {
    const baseline = create()
    await vi.waitFor(() => {
      expect(baseline.status.value).toBe('available')
    })
    expect(baseline.configRelativePath.value).toBe('config/cts_ecc.json')
    expect(baseline.configFileName.value).toBe('cts_ecc.json')
    expect(baseline.baselineWorkspaceName.value).toBeTruthy()
    expect(baseline.baselineSource.value).toBe('selected')
    expect(baseline.parsed.value).toEqual({ cts_buf_list: 'BUF' })
    expect(baseline.viewDraft.value).toEqual({ cts_buf_list: 'BUF' })

    const draft = baseline.viewDraft.value!
    draft.cts_buf_list = 'MUTATED'
    expect(baseline.parsed.value).toEqual({ cts_buf_list: 'BUF' })
  })

  it('falls back to legacy config filenames for pre-migration baselines', async () => {
    mockWorkspaceTexts({
      'home/flow.json': JSON.stringify(BASELINE_FLOW),
      'config/cts_default_config.json': '{"cts_buf_list":"LEGACY"}',
    })
    const baseline = create()
    await vi.waitFor(() => {
      expect(baseline.status.value).toBe('available')
    })
    expect(baseline.configRelativePath.value).toBe('config/cts_default_config.json')
    expect(baseline.parsed.value).toEqual({ cts_buf_list: 'LEGACY' })
  })

  it('uses the baseline flow step tool so tool drift resolves the right file', async () => {
    step.value = StepEnum.PLACEMENT
    const baseline = create()
    await vi.waitFor(() => {
      expect(baseline.status.value).toBe('available')
    })
    expect(baseline.configRelativePath.value).toBe('config/dreamplace_ecc.json')
  })

  it('reports file-missing when the baseline workspace lacks the config file', async () => {
    mockWorkspaceTexts({
      'home/flow.json': JSON.stringify(BASELINE_FLOW),
    })
    const baseline = create()
    await vi.waitFor(() => {
      expect(baseline.status.value).toBe('no-config-for-step')
    })
    expect(baseline.noConfigReason.value).toBe('file-missing')
  })

  it('reports step-absent for steps missing from the baseline flow', async () => {
    step.value = StepEnum.ROUTING
    const baseline = create()
    await vi.waitFor(() => {
      expect(baseline.status.value).toBe('no-config-for-step')
    })
    expect(baseline.noConfigReason.value).toBe('step-absent')
  })

  it('reports no-config-file for steps without an editable config (yosys)', async () => {
    step.value = StepEnum.SYNTHESIS
    const baseline = create()
    await vi.waitFor(() => {
      expect(baseline.status.value).toBe('no-config-for-step')
    })
    expect(baseline.noConfigReason.value).toBe('no-config-file')
  })

  it('flags invalid baseline JSON while staying available', async () => {
    mockWorkspaceTexts({
      'home/flow.json': JSON.stringify(BASELINE_FLOW),
      'config/cts_ecc.json': '{not json',
    })
    const baseline = create()
    await vi.waitFor(() => {
      expect(baseline.status.value).toBe('available')
    })
    expect(baseline.jsonInvalid.value).toBe(true)
    expect(baseline.parsed.value).toBeNull()
    expect(baseline.viewDraft.value).toBeNull()
  })

  it('treats an empty baseline config file as available with no view draft', async () => {
    mockWorkspaceTexts({
      'home/flow.json': JSON.stringify(BASELINE_FLOW),
      'config/cts_ecc.json': '   ',
    })
    const baseline = create()
    await vi.waitFor(() => {
      expect(baseline.status.value).toBe('available')
    })
    expect(baseline.viewDraft.value).toBeNull()
  })

  it('reuses the snapshot cache across instances and re-reads on force', async () => {
    const first = create()
    await vi.waitFor(() => {
      expect(first.status.value).toBe('available')
    })
    expect(testState.readWorkspaceTexts).toHaveBeenCalledTimes(1)
    expect(testState.readWorkspaceTexts).toHaveBeenCalledWith(
      '/projects/gcd',
      '/projects/gcd/ws_0001',
      expect.arrayContaining([...baselineStepConfigReadPaths]),
    )

    const secondScope = effectScope()
    const second = secondScope.run(() => useBaselineStepConfig(step))!
    await vi.waitFor(() => {
      expect(second.status.value).toBe('available')
    })
    expect(testState.readWorkspaceTexts).toHaveBeenCalledTimes(1)

    await second.refresh(true)
    expect(testState.readWorkspaceTexts).toHaveBeenCalledTimes(2)
    secondScope.stop()
  })

  it('re-resolves when the step changes', async () => {
    const baseline = create()
    await vi.waitFor(() => {
      expect(baseline.status.value).toBe('available')
    })
    expect(baseline.configRelativePath.value).toBe('config/cts_ecc.json')

    step.value = StepEnum.FLOORPLAN
    await vi.waitFor(() => {
      expect(baseline.configRelativePath.value).toBe('config/floorplan_ecc.json')
    })
  })

  it('reports unavailable when the baseline read fails', async () => {
    testState.readWorkspaceTexts.mockRejectedValue(new Error('disk exploded'))
    const baseline = create()
    await vi.waitFor(() => {
      expect(baseline.status.value).toBe('unavailable')
    })
    expect(baseline.error.value).toContain('disk exploded')
  })
})
