import { realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type {
  ProjectManifest,
  ProjectWorkspaceFlows,
  ProjectWorkspaceFlowsRequest,
  ProjectWorkspaceFlowState,
  ProjectStepStatus,
} from '@ecos-studio/shared'
import { readProjectManifest, readWorkspaceFlowFile } from './eccCli/persistedState'
import { mapWithConcurrency } from './boundedConcurrency'
import { isPathWithinRoot } from './pathScope'
import { ProjectComparisonFileWatcher } from './projectComparisonFileWatcher'
import { workspaceFlowStepStatus } from './workspaceQorAnalysis'

interface CachedFlow {
  path: string
  pending: Promise<ProjectWorkspaceFlowState>
  value?: ProjectWorkspaceFlowState
}

interface VisibleFlows {
  key: string
  cache: Map<string, CachedFlow>
  watchers: Map<string, ProjectComparisonFileWatcher>
  timer: ReturnType<typeof setInterval>
}

const unavailable = (): ProjectWorkspaceFlowState => ({
  issue: 'unavailable',
  steps: {},
  running: false,
})
const MAX_VISIBLE_WORKSPACES = 512
const PROJECT_SCOPE_RETRY_ATTEMPTS = 10
const PROJECT_SCOPE_RETRY_DELAY_MS = 50

/** Watches and reads only the workspace rows currently rendered by one window. */
export class ProjectWorkspaceFlowService {
  private readonly windows = new Map<number, VisibleFlows>()
  private readonly listeners = new Set<(windowId: number) => void>()

  constructor(
    private readonly authorizeProject: (root: string) => Promise<string>,
    private readonly processIsAlive: (
      root: string,
      id: string,
      runId: string,
    ) => Promise<boolean>,
    private readonly readManifest: (
      root: string,
    ) => Promise<ProjectManifest> = readProjectManifest,
    private readonly createWatcher = (
      callbacks: ConstructorParameters<typeof ProjectComparisonFileWatcher>[0],
    ) => new ProjectComparisonFileWatcher(callbacks, undefined, undefined, 'flow.json'),
  ) {}

  async watch(
    windowId: number,
    request: ProjectWorkspaceFlowsRequest,
  ): Promise<ProjectWorkspaceFlows> {
    validateRequest(request)
    if (!request.projects.length) {
      this.clearWindow(windowId)
      return {}
    }
    const key = JSON.stringify(request.projects)
    let context = this.windows.get(windowId)
    if (!context || context.key !== key) {
      this.clearWindow(windowId)
      context = {
        key,
        cache: new Map(),
        watchers: new Map(),
        timer: setInterval(() => {
          let changed = false
          for (const [entryKey, entry] of context!.cache) {
            if (
              !entry.value?.running &&
              entry.value?.issue !== 'unavailable' &&
              entry.value?.issue !== 'interrupted'
            )
              continue
            context!.cache.delete(entryKey)
            changed = true
          }
          if (changed) this.notify(windowId)
        }, 5000),
      }
      context.timer.unref?.()
      this.windows.set(windowId, context)
    }
    const current = context
    const projects = await mapWithConcurrency(request.projects, 2, async (project) => {
      const values: Record<string, ProjectWorkspaceFlowState> = Object.create(null)
      try {
        const root = await authorizeWithRetry(this.authorizeProject, project.projectRoot)
        if (this.windows.get(windowId) !== current)
          return [project.projectRoot, values] as const
        const manifest = await this.readManifest(root)
        if (this.windows.get(windowId) !== current)
          return [project.projectRoot, values] as const
        const targets = project.workspaceIds.map((id) => {
          const workspace = manifest.workspaces.find((entry) => entry.workspace_id === id)
          if (!workspace) throw new Error('Workspace is not declared by this Project.')
          const path = resolve(root, workspace.workspace_path)
          if (
            path === root ||
            path === join(root, 'runs') ||
            isPathWithinRoot(root, path)
          )
            throw new Error('Workspace path resolves to a protected Project path.')
          return { id, path }
        })
        const watcherKey = `${project.projectRoot}\0`
        if (!current.watchers.has(watcherKey)) {
          const watcher = this.createWatcher({
            onError: () => this.invalidate(windowId, current, watcherKey),
            onManifestChanged: () => this.invalidate(windowId, current, watcherKey),
            onSnapshotChanged: (path) => {
              for (const [entryKey, entry] of current.cache) {
                if (entry.path === resolve(path))
                  this.invalidate(windowId, current, entryKey)
              }
            },
          })
          current.watchers.set(watcherKey, watcher)
          try {
            await watcher.startProject(root)
          } catch (error) {
            current.watchers.delete(watcherKey)
            await watcher.close().catch(() => undefined)
            throw error
          }
        }
        if (this.windows.get(windowId) !== current)
          return [project.projectRoot, values] as const
        await current.watchers.get(watcherKey)!.reconcile(
          root,
          targets.map((entry) => entry.path),
        )
        if (this.windows.get(windowId) !== current) {
          await current.watchers.get(watcherKey)!.close()
          return [project.projectRoot, values] as const
        }
        await mapWithConcurrency(targets, 2, async ({ id, path }) => {
          if (this.windows.get(windowId) !== current) return
          const entryKey = `${watcherKey}${id}`
          let cached = current.cache.get(entryKey)
          if (!cached || cached.path !== path) {
            cached = { path, pending: this.readFlow(root, id, path, manifest) }
            current.cache.set(entryKey, cached)
            const entry = cached
            void cached.pending.then((value) => {
              entry.value = value
            })
          }
          values[id] = await cached.pending
        })
      } catch {
        for (const id of project.workspaceIds) {
          values[id] = unavailable()
          current.cache.set(`${project.projectRoot}\0${id}`, {
            path: '',
            value: values[id],
            pending: Promise.resolve(values[id]),
          })
        }
      }
      return [project.projectRoot, values] as const
    })
    return Object.fromEntries(projects)
  }

  onChanged(listener: (windowId: number) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  clearWindow(windowId: number): void {
    const context = this.windows.get(windowId)
    if (!context) return
    this.windows.delete(windowId)
    clearInterval(context.timer)
    for (const watcher of context.watchers.values()) void watcher.close()
  }

  private invalidate(windowId: number, context: VisibleFlows, key: string): void {
    if (this.windows.get(windowId) !== context) return
    for (const entryKey of context.cache.keys()) {
      if (entryKey === key || (key.endsWith('\0') && entryKey.startsWith(key)))
        context.cache.delete(entryKey)
    }
    this.notify(windowId)
  }

  private notify(windowId: number): void {
    for (const listener of this.listeners) listener(windowId)
  }

  private async readFlow(
    root: string,
    id: string,
    path: string,
    manifest: ProjectManifest,
  ): Promise<ProjectWorkspaceFlowState> {
    try {
      const workspace = await realpath(path)
      const home = await realpath(join(workspace, 'home'))
      const flowPath = await realpath(join(home, 'flow.json'))
      if (!isPathWithinRoot(home, workspace) || !isPathWithinRoot(flowPath, home))
        return unavailable()
      const flow = await readWorkspaceFlowFile(flowPath)
      if (!flow.steps.length) return unavailable()
      const steps: Record<string, ProjectStepStatus> = Object.create(null)
      for (const step of flow.steps) {
        const state = workspaceFlowStepStatus(step.state)
        if (!step.name.trim() || !state || Object.hasOwn(steps, step.name))
          return unavailable()
        steps[step.name] = state
      }
      const process = manifest.runtime_processes?.[id]
      let running = false
      let processInspectionUnavailable = false
      if (process) {
        try {
          running = await this.processIsAlive(root, id, process.run_id)
        } catch {
          processInspectionUnavailable = true
        }
      }
      const hasRunningStep = Object.values(steps).includes('running')
      return {
        steps,
        running,
        ...(!running && hasRunningStep
          ? {
              issue: processInspectionUnavailable
                ? ('unavailable' as const)
                : ('interrupted' as const),
            }
          : {}),
      }
    } catch {
      return unavailable()
    }
  }
}

function validateRequest(value: ProjectWorkspaceFlowsRequest): void {
  if (!value || !Array.isArray(value.projects) || value.projects.length > 128)
    throw new Error('Invalid visible Project request.')
  let count = 0
  const projects = new Set<string>()
  for (const project of value.projects) {
    if (
      !project ||
      typeof project.projectRoot !== 'string' ||
      !project.projectRoot ||
      project.projectRoot.length > 8192 ||
      projects.has(project.projectRoot) ||
      !Array.isArray(project.workspaceIds) ||
      project.workspaceIds.some(
        (id) => typeof id !== 'string' || !id || id.length > 128,
      ) ||
      new Set(project.workspaceIds).size !== project.workspaceIds.length
    )
      throw new Error('Invalid visible Workspace request.')
    projects.add(project.projectRoot)
    count += project.workspaceIds.length
  }
  if (count > MAX_VISIBLE_WORKSPACES) throw new Error('Too many visible Workspaces.')
}

async function authorizeWithRetry(
  authorizeProject: (root: string) => Promise<string>,
  projectRoot: string,
): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await authorizeProject(projectRoot)
    } catch (error) {
      if (
        !isNodeErrorWithCode(error, 'PROJECT_PATH_ACCESS_DENIED') ||
        attempt >= PROJECT_SCOPE_RETRY_ATTEMPTS - 1
      ) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, PROJECT_SCOPE_RETRY_DELAY_MS))
    }
  }
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}
