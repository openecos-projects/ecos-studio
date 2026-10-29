import type { WorkspaceConfig } from '@/types'
import { getDesktopApi } from '@/platform/desktop'
import { startFlowOperationApi } from '@/api/flow'

export interface DefViewLaunchDeps {
  createProject(config: WorkspaceConfig): Promise<boolean>
  workspaceHandle(): string | null
  workspaceRevision(): number
  showToast(toast: {
    severity: 'error' | 'warn' | 'info'
    summary: string
    detail?: string
    life?: number
  }): void
}

/** Poll interval and cap while waiting for the defview step to finish. */
const FLOW_POLL_INTERVAL_MS = 1500
const FLOW_POLL_MAX_ATTEMPTS = 400

function defStem(defPath: string): string {
  const leaf = defPath.split(/[\\/]/).pop() ?? 'design'
  return leaf.replace(/\.def(\.gz)?$/i, '') || 'design'
}

async function nextWorkspaceDirectory(parent: string, stem: string): Promise<string> {
  const api = getDesktopApi()
  const separator = parent.endsWith('/') || parent.includes('\\') ? '' : '/'
  for (let index = 0; index < 100; index += 1) {
    const candidate =
      index === 0
        ? `${parent}${separator}${stem}-defview`
        : `${parent}${separator}${stem}-defview-${index}`
    if (!(await api.workspace.pathExists(candidate))) return candidate
  }
  throw new Error(`Unable to allocate a defview workspace directory under ${parent}.`)
}

function stepState(flow: Record<string, unknown> | null, step: string): string | null {
  const steps = flow?.steps
  if (!Array.isArray(steps)) return null
  const entry = steps.find(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      (candidate as Record<string, unknown>).name === step,
  ) as Record<string, unknown> | undefined
  const state = entry?.state
  return typeof state === 'string' ? state : null
}

async function waitForDefViewStep(step: string): Promise<boolean> {
  const api = getDesktopApi()
  for (let attempt = 0; attempt < FLOW_POLL_MAX_ATTEMPTS; attempt += 1) {
    const state = stepState(await api.workspaceResources.readFlow(), step)
    if (state === 'Success') return true
    if (state && state !== 'Unstart' && state !== 'Ongoing') return false
    await new Promise((resolve) => setTimeout(resolve, FLOW_POLL_INTERVAL_MS))
  }
  return false
}

/**
 * One-click DEF layout preview: create a defview workspace from the picked
 * DEF, run its single defview step, and open the result in Chip Viewer.
 */
export async function launchDefView(
  defPath: string,
  deps: DefViewLaunchDeps,
): Promise<void> {
  const api = getDesktopApi()
  const stem = defStem(defPath)
  const parent = defPath.slice(
    0,
    defPath.length - (defPath.split(/[\\/]/).pop() ?? '').length - 1,
  )
  const directory = await nextWorkspaceDirectory(parent || '.', stem)

  const installations = await api.pdkInventory.list()
  const installation =
    installations.find(
      (candidate) => candidate.familyId === 'ics55' && candidate.readiness === 'ready',
    ) ?? installations[0]
  if (!installation) {
    deps.showToast({
      severity: 'error',
      summary: 'DEF View Error',
      detail: 'No PDK installation is available for layout viewing.',
    })
    return
  }

  const config: WorkspaceConfig = {
    directory,
    designTool: 'backend',
    pdk: installation.familyId,
    pdk_root: installation.root,
    pdk_installation_id: installation.id,
    pdk_requirement: {
      familyId: installation.familyId,
      version: installation.version,
      manualConfig: null,
    },
    parameters: {
      design: stem,
      top_module: stem,
      clock: 'clk',
    },
    origin_def: defPath,
    origin_verilog: '',
    rtl_list: [],
    design_input_mode: 'def',
    flow_config: { start_step: 'defview', end_step: 'defview', steps: ['defview'] },
    project_context: undefined,
  }

  if (!(await deps.createProject(config))) return

  const handle = deps.workspaceHandle()
  if (!handle) {
    deps.showToast({
      severity: 'warn',
      summary: 'DEF View',
      detail: 'Workspace created; open it and run the defview step to view the layout.',
    })
    return
  }

  await startFlowOperationApi({
    expectedWorkspaceRevision: deps.workspaceRevision(),
    idempotencyKey: crypto.randomUUID(),
    rerun: false,
    workspaceHandle: handle,
  })

  if (!(await waitForDefViewStep('defview'))) {
    deps.showToast({
      severity: 'error',
      summary: 'DEF View Error',
      detail: 'The defview step did not complete; inspect the workspace log.',
    })
    return
  }

  await api.chipViewer.open({ projectPath: directory, step: 'defview', mode: 'view' })
}
