import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import type { ProjectManifest } from '@ecos-studio/shared'
import { parse as parseToml } from 'smol-toml'
import { isPathWithinRoot } from '../pathScope'

export interface LegacyWorkspaceReference {
  projectRoot: string
  workspaceId: string
}

const LEGACY_MANIFEST_MAX_BYTES = 512 * 1024

/**
 * Legacy projects keep workspaces under runs/. Only a real child directory is
 * a migration candidate; lock files and hidden transaction entries do not
 * trigger a write when a project is merely opened.
 */
export async function hasLegacyRunsLayout(projectRoot: string): Promise<boolean> {
  const runsPath = join(projectRoot, 'runs')
  try {
    const runsStats = await lstat(runsPath)
    // Keep symlinked runs/ layouts as migration candidates so ECC can return
    // its structured unsafe-path error, but never enumerate them here.
    if (runsStats.isSymbolicLink()) return true
    if (!runsStats.isDirectory()) return false
    const entries = await readdir(runsPath, { withFileTypes: true })
    return entries.some(
      (entry) =>
        !entry.name.startsWith('.') &&
        !entry.name.endsWith('.lock') &&
        entry.isDirectory(),
    )
  } catch {
    return false
  }
}

/**
 * Detect compatibility work that must be delegated to `ecc migrate`.
 * Parsing here only avoids an extra CLI process for already-current projects;
 * ECC remains the sole owner of validation and writes.
 */
export async function projectNeedsCliMigration(projectRoot: string): Promise<boolean> {
  if (await hasLegacyRunsLayout(projectRoot)) return true
  try {
    const manifest = await stat(join(projectRoot, 'project.json'))
    if (!manifest.isFile()) return false
  } catch {
    return false
  }

  const configPath = join(projectRoot, 'ecc.toml')
  try {
    const config = await lstat(configPath)
    // Delegate unsafe or malformed config handling to ECC. Returning true
    // does not authorize a rewrite: migrate rejects symlinks/non-files and
    // the caller falls back to the read-only legacy projection.
    if (config.isSymbolicLink() || !config.isFile()) return true
  } catch {
    return true
  }

  let text: string
  try {
    text = await readFile(configPath, 'utf8')
  } catch {
    return true
  }

  try {
    const document = parseToml(text) as Record<string, unknown>
    const design = record(document.design)
    const pdk = record(document.pdk)
    const flow = record(document.flow)
    return (
      !nonempty(design.name) ||
      !nonempty(design.top) ||
      !nonempty(design.clock_port) ||
      !positiveNumber(design.frequency_mhz) ||
      !nonempty(pdk.name) ||
      !nonempty(flow.preset)
    )
  } catch {
    // ECC owns the final check and refuses to overwrite malformed user data.
    return true
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function nonempty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function positiveNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * Resolve an old runs/<workspace> path before migration moves it. This is
 * deliberately read-only; ECC remains the owner of migration and manifest
 * writes.
 */
export async function findLegacyWorkspaceReference(
  directory: string,
): Promise<LegacyWorkspaceReference | null> {
  const target = resolve(directory)
  let candidate = target
  while (true) {
    const relativeTarget = relative(candidate, target).replace(/\\/g, '/')
    if (relativeTarget.split('/').length === 2 && relativeTarget.startsWith('runs/')) {
      if (await hasLegacyRunsLayout(candidate)) {
        const workspaceId = await workspaceIdFromLegacyManifest(candidate, target)
        return {
          projectRoot: candidate,
          workspaceId: workspaceId ?? basename(target),
        }
      }
    }
    const parent = dirname(candidate)
    if (parent === candidate) return null
    candidate = parent
  }
}

/** Build an in-memory projection when ECC cannot migrate yet. */
export async function readLegacyProjectManifest(
  projectRoot: string,
  reason: string,
): Promise<ProjectManifest | null> {
  const root = resolve(projectRoot)
  const rootRealPath = await realpath(root).catch(() => root)
  const raw = await readLegacyJson(join(root, 'project.json'))
  const rawWorkspaces = Array.isArray(raw?.workspaces) ? raw.workspaces : []
  const workspaceSources = rawWorkspaces.length
    ? rawWorkspaces
    : await legacyWorkspaceDirectories(root)
  const now = new Date().toISOString()
  const workspaces = await Promise.all(
    workspaceSources.flatMap((source, index) => {
      const workspacePath = typeof source === 'string' ? source : source?.workspace_path
      if (typeof workspacePath !== 'string' || !workspacePath.trim()) return []
      const absolutePath = resolve(root, workspacePath)
      const relativePath = relative(root, absolutePath).replace(/\\/g, '/')
      if (
        relativePath === '..' ||
        relativePath.startsWith('../') ||
        !isPathWithinRoot(absolutePath, root)
      )
        return []
      if (absolutePath === root || absolutePath === join(root, 'runs')) return []
      const workspaceId =
        typeof source === 'string'
          ? basename(absolutePath)
          : typeof source?.workspace_id === 'string' && source.workspace_id
            ? source.workspace_id
            : basename(absolutePath)
      const name =
        typeof source === 'object' && typeof source?.name === 'string' && source.name
          ? source.name
          : basename(absolutePath)
      return [
        (async () => {
          const readablePath = await realpath(absolutePath)
            .then((candidate) =>
              isPathWithinRoot(candidate, rootRealPath) ? candidate : null,
            )
            .catch(() => null)
          return await legacyWorkspaceProjection(
            absolutePath,
            workspaceId,
            name,
            typeof source === 'object' ? source : undefined,
            now,
            index,
            readablePath,
          )
        })(),
      ]
    }),
  )
  if (!raw && workspaces.length === 0) return null
  const name =
    typeof raw?.name === 'string' && raw.name.trim()
      ? raw.name.trim()
      : basename(root) || 'project'
  return {
    schema_version: 1,
    project_type: 'backend',
    project_id:
      typeof raw?.project_id === 'string' && raw.project_id
        ? raw.project_id
        : `proj_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    name,
    design_name:
      typeof raw?.design_name === 'string' && raw.design_name ? raw.design_name : name,
    description: typeof raw?.description === 'string' ? raw.description : '',
    root_path: root,
    created_at: typeof raw?.created_at === 'string' ? raw.created_at : now,
    updated_at: typeof raw?.updated_at === 'string' ? raw.updated_at : now,
    base_design: isRecord(raw?.base_design) ? raw.base_design : {},
    objectives: isRecord(raw?.objectives)
      ? {
          primary:
            typeof raw.objectives.primary === 'string'
              ? raw.objectives.primary
              : 'timing',
          directions: isRecord(raw.objectives.directions)
            ? raw.objectives.directions
            : {},
        }
      : { primary: 'timing', directions: {} },
    workspaces,
    mpc: isRecord(raw?.mpc) ? (raw.mpc as ProjectManifest['mpc']) : null,
    best_workspace: isRecord(raw?.best_workspace)
      ? (raw.best_workspace as ProjectManifest['best_workspace'])
      : null,
    qor_baseline: isRecord(raw?.qor_baseline)
      ? (raw.qor_baseline as ProjectManifest['qor_baseline'])
      : null,
    project_migration: { status: 'legacy-readonly', reason },
  }
}

async function workspaceIdFromLegacyManifest(
  projectRoot: string,
  workspacePath: string,
): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(join(projectRoot, 'project.json'), 'utf8'))
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.workspaces)) return null
    for (const workspace of raw.workspaces) {
      if (!workspace || typeof workspace !== 'object') continue
      if (typeof workspace.workspace_id !== 'string') continue
      if (typeof workspace.workspace_path !== 'string') continue
      const declared = resolve(projectRoot, workspace.workspace_path)
      if (resolve(declared) === resolve(workspacePath)) return workspace.workspace_id
    }
  } catch {
    // A no-manifest legacy project is still discoverable by its directory name.
  }
  return null
}

async function readLegacyJson(path: string): Promise<Record<string, any> | null> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > LEGACY_MANIFEST_MAX_BYTES) return null
    const raw = JSON.parse(await readFile(path, 'utf8'))
    return isRecord(raw) ? raw : null
  } catch {
    return null
  }
}

async function legacyWorkspaceDirectories(projectRoot: string): Promise<string[]> {
  try {
    const runsPath = join(projectRoot, 'runs')
    const runsStats = await lstat(runsPath)
    if (!runsStats.isDirectory() || runsStats.isSymbolicLink()) return []
    const entries = await readdir(runsPath, { withFileTypes: true })
    return entries
      .filter(
        (entry) =>
          !entry.name.startsWith('.') &&
          !entry.name.endsWith('.lock') &&
          entry.isDirectory(),
      )
      .map((entry) => join('runs', entry.name))
  } catch {
    return []
  }
}

async function legacyWorkspaceProjection(
  workspacePath: string,
  workspaceId: string,
  name: string,
  source: Record<string, any> | undefined,
  now: string,
  index: number,
  readablePath: string | null,
): Promise<ProjectManifest['workspaces'][number]> {
  const persistedStatus = source?.status
  const validStatuses = [
    'success',
    'warning',
    'failed',
    'running',
    'in_progress',
    'not_started',
    'archived',
  ] as const
  let status: ProjectManifest['workspaces'][number]['status'] = validStatuses.includes(
    persistedStatus,
  )
    ? persistedStatus
    : 'not_started'
  try {
    if (!readablePath) throw new Error('legacy workspace path is not project-owned')
    const workspaceStats = await lstat(readablePath)
    const homeStats = await lstat(join(readablePath, 'home'))
    const flowPath = join(readablePath, 'home', 'flow.json')
    const flowStats = await lstat(flowPath)
    if (
      !workspaceStats.isDirectory() ||
      workspaceStats.isSymbolicLink() ||
      !homeStats.isDirectory() ||
      homeStats.isSymbolicLink() ||
      !flowStats.isFile() ||
      flowStats.isSymbolicLink()
    )
      throw new Error('legacy workspace flow is not project-owned')
    const flow = JSON.parse(await readFile(flowPath, 'utf8'))
    const states = Array.isArray(flow?.steps)
      ? flow.steps.map((step: any) => String(step?.state ?? '').toLowerCase())
      : []
    if (states.some((state: string) => ['ongoing', 'running'].includes(state)))
      status = 'running'
    else if (states.some((state: string) => ['failed', 'incomplete'].includes(state)))
      status = 'failed'
    else if (
      states.length > 0 &&
      states.every((state: string) => ['success', 'skipped'].includes(state))
    )
      status = 'success'
  } catch {
    // Missing or malformed flow remains visible as an unstarted read-only workspace.
  }
  return {
    workspace_id: workspaceId || `legacy-${index}`,
    name: name || workspaceId || `legacy-${index}`,
    workspace_path: workspacePath,
    source_workspace_id:
      typeof source?.source_workspace_id === 'string' ? source.source_workspace_id : null,
    branch_from: null,
    start_step: typeof source?.start_step === 'string' ? source.start_step : 'Synth',
    end_step: typeof source?.end_step === 'string' ? source.end_step : 'Harden',
    status,
    created_at: typeof source?.created_at === 'string' ? source.created_at : now,
    updated_at: typeof source?.updated_at === 'string' ? source.updated_at : now,
    parameter_patch: isRecord(source?.parameter_patch) ? source.parameter_patch : {},
    metrics_summary: isRecord(source?.metrics_summary) ? source.metrics_summary : {},
    step_metrics: isRecord(source?.step_metrics) ? source.step_metrics : {},
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
