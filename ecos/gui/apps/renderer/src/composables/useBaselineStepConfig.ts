import { onScopeDispose, ref, watch, type Ref } from 'vue'
import { useRoute } from 'vue-router'
import type { StepEnum } from '@/api/type'
import { getDesktopApi } from '@/platform/desktop'
import {
  resolveProjectQorBaselineWorkspace,
  type ProjectQorBaselineSource,
} from '@/utils/projectManagement'
import { resolveProjectRouteContextForWorkspace } from '@/utils/projectManifestRegistration'
import { useWorkspace } from './useWorkspace'

export type BaselineStepConfigStatus =
  | 'loading'
  | 'available'
  | 'no-project'
  | 'no-baseline'
  | 'self-baseline'
  | 'no-config-for-step'
  | 'unavailable'

/** Why a baseline exists but has no config to show for the step. */
export type BaselineStepConfigNoConfigReason =
  | 'step-absent'
  | 'no-config-file'
  | 'frontend'
  | 'file-missing'

interface BaselineWorkspaceSnapshot {
  workspaceName: string
  workspacePath: string
}

const snapshotCache = new Map<string, BaselineWorkspaceSnapshot>()
const READ_TIMEOUT_MS = 12_000

/** Clears cached baseline workspace snapshots (route leave / workspace close). */
export function clearBaselineStepConfigCache(): void {
  snapshotCache.clear()
}

/**
 * Loads the baseline workspace's config file for the given flow step, following
 * the useHomeQorComparison pattern (routed parent project, read deadlines,
 * request tokens, module-level snapshot cache). Read-only by construction: no
 * write API is exposed and saveStepConfig only ever writes the active workspace.
 */
export function useBaselineStepConfig(step: Ref<StepEnum | undefined>) {
  const route = useRoute()
  const { currentProject } = useWorkspace()

  const status = ref<BaselineStepConfigStatus>('loading')
  const noConfigReason = ref<BaselineStepConfigNoConfigReason | null>(null)
  const baselineWorkspaceName = ref<string | null>(null)
  const baselineSource = ref<ProjectQorBaselineSource | null>(null)
  const workspaceRevision = ref<number | null>(null)
  const configRelativePath = ref<string | null>(null)
  const configFileName = ref<string | null>(null)
  const rawText = ref<string | null>(null)
  const parsed = ref<unknown>(null)
  const jsonInvalid = ref(false)
  const viewDraft = ref<Record<string, unknown> | null>(null)
  const error = ref<string | null>(null)

  let requestToken = 0
  let disposed = false

  function applyResult(next: {
    status: BaselineStepConfigStatus
    noConfigReason?: BaselineStepConfigNoConfigReason | null
    baselineWorkspaceName?: string | null
    baselineSource?: ProjectQorBaselineSource | null
    workspaceRevision?: number | null
    configRelativePath?: string | null
    rawText?: string | null
    error?: string | null
  }): void {
    status.value = next.status
    noConfigReason.value = next.noConfigReason ?? null
    baselineWorkspaceName.value = next.baselineWorkspaceName ?? null
    baselineSource.value = next.baselineSource ?? null
    workspaceRevision.value = next.workspaceRevision ?? null
    configRelativePath.value = next.configRelativePath ?? null
    configFileName.value = next.configRelativePath
      ? basename(next.configRelativePath)
      : null
    rawText.value = next.rawText ?? null
    error.value = next.error ?? null

    const text = rawText.value
    if (next.status === 'available' && text != null && text.trim() !== '') {
      try {
        parsed.value = JSON.parse(text)
        jsonInvalid.value = false
      } catch {
        parsed.value = null
        jsonInvalid.value = true
      }
    } else {
      parsed.value = null
      jsonInvalid.value = false
    }
    viewDraft.value =
      parsed.value !== null &&
      typeof parsed.value === 'object' &&
      !Array.isArray(parsed.value)
        ? (JSON.parse(JSON.stringify(parsed.value)) as Record<string, unknown>)
        : null
  }

  async function refresh(force = false): Promise<void> {
    const token = ++requestToken
    const workspacePath = currentProject.value?.path
    if (!workspacePath) {
      applyResult({ status: 'no-project' })
      return
    }
    if ((currentProject.value?.designTool ?? 'backend') !== 'backend') {
      applyResult({ status: 'no-config-for-step', noConfigReason: 'frontend' })
      return
    }
    let projectRoot: string | null
    try {
      projectRoot =
        routeString(route.query.projectRoot) ??
        (
          await withReadDeadline(
            resolveProjectRouteContextForWorkspace(workspacePath),
            'project context',
          )
        )?.projectRoot ??
        null
    } catch (cause) {
      if (disposed || token !== requestToken) return
      console.warn('Failed to resolve project context for baseline step config:', cause)
      applyResult({ status: 'unavailable', error: describeError(cause) })
      return
    }
    if (disposed || token !== requestToken) return
    if (!projectRoot) {
      applyResult({ status: 'no-baseline' })
      return
    }

    try {
      const manifest = await withReadDeadline(
        getProjectManagement().readManifest(projectRoot),
        'project manifest',
      )
      if (disposed || token !== requestToken) return
      if (!manifest) {
        applyResult({ status: 'no-baseline' })
        return
      }

      const currentWorkspace = manifest.workspaces.find((workspace) =>
        samePath(workspace.workspace_path, workspacePath),
      )
      if (!currentWorkspace) {
        applyResult({ status: 'no-baseline' })
        return
      }

      const baseline = resolveProjectQorBaselineWorkspace(
        manifest,
        currentWorkspace.workspace_id,
      )
      if (!baseline) {
        applyResult({
          status: 'no-baseline',
          baselineWorkspaceName: manifest.name || null,
        })
        return
      }
      if (baseline.workspaceId === currentWorkspace.workspace_id) {
        applyResult({ status: 'self-baseline' })
        return
      }

      const baselineWorkspace = manifest.workspaces.find(
        (workspace) => workspace.workspace_id === baseline.workspaceId,
      )
      if (!baselineWorkspace) {
        applyResult({ status: 'no-baseline' })
        return
      }

      const cacheKey = `${projectRoot}::${baseline.workspaceId}`
      let snapshot = force ? undefined : snapshotCache.get(cacheKey)
      if (!snapshot) {
        snapshot = {
          workspaceName: baselineWorkspace.name,
          workspacePath: baselineWorkspace.workspace_path,
        }
        snapshotCache.set(cacheKey, snapshot)
      }

      if (disposed || token !== requestToken) return

      const stepValue = step.value?.trim()
      if (!stepValue) {
        applyResult({
          status: 'no-config-for-step',
          noConfigReason: 'step-absent',
          baselineWorkspaceName: snapshot.workspaceName,
          baselineSource: baseline.source,
        })
        return
      }

      const result = await withReadDeadline(
        getProjectManagement().readWorkspaceStepConfiguration({
          projectRoot,
          step: stepValue,
          workspacePath: snapshot.workspacePath,
        }),
        'baseline Step Configuration',
      )
      if (disposed || token !== requestToken) return

      if (
        result.status === 'available' &&
        (typeof result.workspaceId !== 'string' ||
          typeof result.workspaceRevision !== 'number' ||
          !Number.isInteger(result.workspaceRevision) ||
          result.workspaceRevision < 1)
      ) {
        applyResult({
          status: 'unavailable',
          baselineWorkspaceName: snapshot.workspaceName,
          baselineSource: baseline.source,
          error: 'Baseline Step Configuration response has no valid Workspace identity.',
        })
        return
      }

      if (result.status === 'missing' || result.status === 'unavailable') {
        if (
          result.status === 'missing' &&
          (typeof result.workspaceId !== 'string' ||
            typeof result.workspaceRevision !== 'number' ||
            !Number.isInteger(result.workspaceRevision) ||
            result.workspaceRevision < 1)
        ) {
          applyResult({
            status: 'unavailable',
            baselineWorkspaceName: snapshot.workspaceName,
            baselineSource: baseline.source,
            error:
              'Baseline Step Configuration response has no valid Workspace identity.',
          })
          return
        }
        if (
          result.status === 'missing' ||
          result.reason === 'step_configuration_unavailable'
        ) {
          applyResult({
            status: 'no-config-for-step',
            noConfigReason: 'no-config-file',
            baselineWorkspaceName: snapshot.workspaceName,
            baselineSource: baseline.source,
            workspaceRevision: result.workspaceRevision,
          })
        } else {
          applyResult({
            status: 'unavailable',
            baselineWorkspaceName: snapshot.workspaceName,
            baselineSource: baseline.source,
            workspaceRevision: result.workspaceRevision,
            error: result.reason ?? 'Step Configuration is unavailable.',
          })
        }
        return
      }
      if (!Array.isArray(result.parameters)) {
        applyResult({
          status: 'unavailable',
          baselineWorkspaceName: snapshot.workspaceName,
          baselineSource: baseline.source,
          error: 'Step Configuration response is invalid.',
        })
        return
      }

      applyResult({
        status: 'available',
        baselineWorkspaceName: snapshot.workspaceName,
        baselineSource: baseline.source,
        workspaceRevision: result.workspaceRevision,
        configRelativePath: result.stepId ?? result.step,
        rawText: JSON.stringify(
          Object.fromEntries(
            result.parameters.map((parameter) => [parameter.param, parameter.value]),
          ),
          null,
          2,
        ),
      })
    } catch (cause) {
      if (disposed || token !== requestToken) return
      console.warn('Failed to load baseline step config:', cause)
      applyResult({ status: 'unavailable', error: describeError(cause) })
    }
  }

  watch(
    () => [
      currentProject.value?.path ?? '',
      routeString(route.query.projectRoot) ?? '',
      step.value ?? '',
    ],
    () => {
      void refresh()
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    disposed = true
    requestToken += 1
  })

  return {
    status,
    noConfigReason,
    baselineWorkspaceName,
    baselineSource,
    workspaceRevision,
    configRelativePath,
    configFileName,
    rawText,
    parsed,
    jsonInvalid,
    viewDraft,
    error,
    refresh,
  }
}

function getProjectManagement() {
  const api = getDesktopApi().projectManagement
  if (!api)
    throw new Error('Project management reads are unavailable in this desktop build.')
  return api
}

function routeString(value: unknown): string | null {
  const routeValue = Array.isArray(value) ? value[0] : value
  return typeof routeValue === 'string' && routeValue.trim() ? routeValue : null
}

function samePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right)
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '')
}

function basename(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(index + 1) : normalized
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Baseline reads are an optional comparison surface; a slow NFS read must not
 * hang the Step Configuration dialog indefinitely.
 */
function withReadDeadline<T>(request: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out after ${READ_TIMEOUT_MS}ms while reading ${label}.`))
    }, READ_TIMEOUT_MS)
    request.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}
