import { constants } from 'node:fs'
import { lstat, open, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  normalizeProjectManifestFlowStep,
  parseProjectManifest,
  serializeProjectManifest,
  type DesktopProjectManagementWorkspaceImportFailureCode,
  type DesktopProjectManagementWorkspaceImportResult,
  type ProjectManifest,
  type ProjectManifestMutationResult,
  type ProjectManifestWorkspaceStatus,
} from '@ecos-studio/shared'
import { isPathWithinRoot } from './pathScope'
import { parseWorkspaceParametersText } from './workspaceParametersFile'

const MAX_IMPORT_FILE_BYTES = 512 * 1024
const PATCH_EXCLUDED_PARAMETERS = new Set([
  '_flow',
  'clock',
  'config_overrides',
  'design',
  'pdk',
  'pdk_config',
  'pdk_root',
  'top_module',
  'workspace_param_overrides',
])

export class ProjectWorkspaceImportError extends Error {
  constructor(
    readonly code: DesktopProjectManagementWorkspaceImportFailureCode,
    message: string,
  ) {
    super(message)
    this.name = 'ProjectWorkspaceImportError'
  }
}

interface WorkspaceRegistrationRequest {
  projectRoot: string
  mutation: {
    type: 'register-workspace'
    input: WorkspaceRegistrationInput
  }
}

interface WorkspaceRegistrationInput {
  projectRoot: string
  projectName: string
  workspacePath: string
  startStep: string
  endStep: string
  status: ProjectManifestWorkspaceStatus
  parameterPatch: Record<string, unknown>
  config: {
    pdk?: string
    pdk_root?: string
    parameters: Record<string, unknown>
  }
}

export interface ProjectWorkspaceManifestMutator {
  mutateWithWorkspaceLock(
    request: WorkspaceRegistrationRequest,
    workspacePath: string,
    revalidate: () => Promise<void>,
  ): Promise<ProjectManifestMutationResult>
}

class WorkspaceRegistrationAlreadyComplete extends Error {
  constructor(readonly manifest: ProjectManifest) {
    super('Workspace registration is already complete.')
  }
}

export type ProjectWorkspaceImportSuccess = Extract<
  DesktopProjectManagementWorkspaceImportResult,
  { status: 'imported' | 'already_registered' }
>

export class ProjectWorkspaceImportService {
  constructor(private readonly manifestService: ProjectWorkspaceManifestMutator) {}

  async importWorkspace(
    requestedProjectRoot: string,
    requestedWorkspacePath: string,
  ): Promise<ProjectWorkspaceImportSuccess> {
    const projectRoot = await canonicalizeDirectory(
      requestedProjectRoot,
      'project_invalid',
      'Project folder',
    )
    const workspacePath = await canonicalizeDirectory(
      requestedWorkspacePath,
      'workspace_not_importable',
      'Workspace folder',
    )
    validateWorkspaceRoot(projectRoot, workspacePath)

    const manifest = await loadProjectManifest(projectRoot)
    const metadata = await inspectWorkspace(workspacePath, manifest)
    const workspaceId = basename(workspacePath)
    if (!workspaceId || workspaceId === '.' || workspaceId === '..') {
      throw new ProjectWorkspaceImportError(
        'workspace_not_importable',
        'The selected workspace directory does not have a valid basename.',
      )
    }

    await findExistingRegistration(manifest, projectRoot, workspaceId, workspacePath)
    const request: WorkspaceRegistrationRequest = {
      projectRoot,
      mutation: {
        type: 'register-workspace',
        input: workspaceRegistrationInput(projectRoot, workspacePath, manifest, metadata),
      },
    }

    let result: ProjectManifestMutationResult
    try {
      result = await this.manifestService.mutateWithWorkspaceLock(
        request,
        workspacePath,
        async () => {
          const lockedWorkspacePath = await canonicalizeDirectory(
            requestedWorkspacePath,
            'workspace_not_importable',
            'Workspace folder',
          )
          if (lockedWorkspacePath !== workspacePath) {
            throw new ProjectWorkspaceImportError(
              'workspace_not_importable',
              'The selected workspace path changed while import was waiting for its lock.',
            )
          }
          validateWorkspaceRoot(projectRoot, lockedWorkspacePath)
          const lockedManifest = await loadProjectManifest(projectRoot)
          const lockedMetadata = await inspectWorkspace(
            lockedWorkspacePath,
            lockedManifest,
          )
          const lockedExisting = await findExistingRegistration(
            lockedManifest,
            projectRoot,
            workspaceId,
            lockedWorkspacePath,
          )
          if (lockedExisting === 'already_registered') {
            throw new WorkspaceRegistrationAlreadyComplete(lockedManifest)
          }
          request.mutation.input = workspaceRegistrationInput(
            projectRoot,
            lockedWorkspacePath,
            lockedManifest,
            lockedMetadata,
          )
        },
      )
    } catch (error) {
      if (error instanceof WorkspaceRegistrationAlreadyComplete) {
        return {
          status: 'already_registered',
          content: serializeProjectManifest(error.manifest),
          workspaceId,
          workspacePath,
        }
      }
      throw error
    }
    return {
      status: 'imported',
      content: result.content,
      workspaceId,
      workspacePath,
    }
  }
}

function workspaceRegistrationInput(
  projectRoot: string,
  workspacePath: string,
  manifest: ProjectManifest,
  metadata: Awaited<ReturnType<typeof inspectWorkspace>>,
): WorkspaceRegistrationInput {
  return {
    projectRoot,
    projectName: manifest.name,
    workspacePath,
    startStep: metadata.startStep,
    endStep: metadata.endStep,
    status: metadata.status,
    parameterPatch: metadata.parameterPatch,
    config: {
      ...(metadata.pdk ? { pdk: metadata.pdk } : {}),
      ...(metadata.pdkRoot ? { pdk_root: metadata.pdkRoot } : {}),
      parameters: metadata.parameters,
    },
  }
}

export function projectWorkspaceImportFailure(
  error: unknown,
): Extract<DesktopProjectManagementWorkspaceImportResult, { status: 'failed' }> {
  if (error instanceof ProjectWorkspaceImportError) {
    return { status: 'failed', code: error.code, message: error.message }
  }
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith('workspace_id_conflict:')) {
    return { status: 'failed', code: 'workspace_id_conflict', message }
  }
  if (message.startsWith('workspace_path_conflict:')) {
    return { status: 'failed', code: 'workspace_path_conflict', message }
  }
  return {
    status: 'failed',
    code: 'project_invalid',
    message: message || 'Workspace import failed.',
  }
}

async function canonicalizeDirectory(
  path: string,
  code: DesktopProjectManagementWorkspaceImportFailureCode,
  label: string,
): Promise<string> {
  try {
    const canonicalPath = await realpath(path)
    if (!(await stat(canonicalPath)).isDirectory()) {
      throw new Error(`${label} is not a directory.`)
    }
    return canonicalPath
  } catch (error) {
    throw new ProjectWorkspaceImportError(
      code,
      `${label} is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function validateWorkspaceRoot(projectRoot: string, workspacePath: string): void {
  if (
    workspacePath === projectRoot ||
    isPathWithinRoot(projectRoot, workspacePath) ||
    workspacePath === resolve(projectRoot, 'runs')
  ) {
    throw new ProjectWorkspaceImportError(
      'workspace_not_importable',
      'The selected workspace path is a protected project directory or its ancestor.',
    )
  }
}

async function loadProjectManifest(projectRoot: string): Promise<ProjectManifest> {
  try {
    const content = await readBoundedRegularFile(
      join(projectRoot, 'project.json'),
      projectRoot,
    )
    const manifest = parseProjectManifest(content)
    const manifestRoot = await realpath(manifest.root_path)
    if (relative(projectRoot, manifestRoot) !== '') {
      throw new Error('project.json root_path does not match the selected project.')
    }
    return manifest
  } catch (error) {
    throw new ProjectWorkspaceImportError(
      'project_invalid',
      `The selected project is invalid: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function inspectWorkspace(
  workspacePath: string,
  manifest: ProjectManifest,
): Promise<{
  endStep: string
  parameterPatch: Record<string, unknown>
  parameters: Record<string, unknown>
  pdk: string
  pdkRoot: string
  startStep: string
  status: ProjectManifestWorkspaceStatus
}> {
  try {
    await assertRegularDirectory(join(workspacePath, 'home'), workspacePath)
    const flowText = await readBoundedRegularFile(
      join(workspacePath, 'home', 'flow.json'),
      workspacePath,
    )
    const parametersText = await readBoundedRegularFile(
      join(workspacePath, 'home', 'params.toml'),
      workspacePath,
    )
    const parameters = parseWorkspaceParametersText(parametersText, 'toml', workspacePath)
    assertJsonSerializable(parameters)

    const flow = parseWorkspaceFlow(flowText)
    const startStep = normalizeImportedStep(flow.steps[0]!.name)
    const endStep = normalizeImportedStep(flow.steps.at(-1)!.name)
    const design = optionalString(parameters.design)
    if (design && design !== manifest.design_name) {
      throw new Error(
        `Workspace design ${JSON.stringify(design)} does not match project design ${JSON.stringify(manifest.design_name)}.`,
      )
    }
    const pdk = optionalString(parameters.pdk)
    if (pdk && manifest.base_design.pdk && pdk !== manifest.base_design.pdk) {
      throw new Error(
        `Workspace PDK ${JSON.stringify(pdk)} does not match project PDK ${JSON.stringify(manifest.base_design.pdk)}.`,
      )
    }

    return {
      startStep,
      endStep,
      status: deriveWorkspaceStatus(flow.steps),
      parameters: importableParameters(parameters),
      parameterPatch: buildParameterPatch(
        manifest.base_design.parameters ?? {},
        parameters,
      ),
      pdk,
      pdkRoot: optionalString(parameters.pdk_root),
    }
  } catch (error) {
    if (error instanceof ProjectWorkspaceImportError) throw error
    throw new ProjectWorkspaceImportError(
      'workspace_not_importable',
      `The selected directory is not an importable ECC workspace: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

async function findExistingRegistration(
  manifest: ProjectManifest,
  projectRoot: string,
  workspaceId: string,
  workspacePath: string,
): Promise<'already_registered' | null> {
  let matchingIdPath: string | null = null
  let matchingPathId: string | null = null
  for (const workspace of manifest.workspaces) {
    if (workspace.status === 'archived') continue
    const registeredPath = await canonicalizeManifestWorkspacePath(
      workspace.workspace_path,
      projectRoot,
    )
    if (workspace.workspace_id === workspaceId) matchingIdPath = registeredPath
    if (registeredPath === workspacePath) matchingPathId = workspace.workspace_id
  }
  if (matchingIdPath && matchingIdPath !== workspacePath) {
    throw new ProjectWorkspaceImportError(
      'workspace_id_conflict',
      `Workspace ID ${workspaceId} is already registered at ${matchingIdPath}.`,
    )
  }
  if (matchingPathId && matchingPathId !== workspaceId) {
    throw new ProjectWorkspaceImportError(
      'workspace_path_conflict',
      `Workspace path ${workspacePath} is already registered as ${matchingPathId}.`,
    )
  }
  return matchingIdPath === workspacePath && matchingPathId === workspaceId
    ? 'already_registered'
    : null
}

async function canonicalizeManifestWorkspacePath(
  workspacePath: string,
  projectRoot: string,
): Promise<string> {
  const candidate = isAbsolute(workspacePath)
    ? resolve(workspacePath)
    : resolve(projectRoot, workspacePath)
  if (!isAbsolute(workspacePath) && !isPathWithinRoot(candidate, projectRoot)) {
    throw new ProjectWorkspaceImportError(
      'project_invalid',
      `Relative workspace path escapes the project root: ${workspacePath}.`,
    )
  }
  try {
    return await realpath(candidate)
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return candidate
    throw error
  }
}

async function assertRegularDirectory(path: string, root: string): Promise<void> {
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`${path} must be a regular directory.`)
  }
  const canonicalPath = await realpath(path)
  if (!isPathWithinRoot(canonicalPath, root)) {
    throw new Error(`${path} resolves outside the workspace.`)
  }
}

async function readBoundedRegularFile(path: string, root: string): Promise<string> {
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`${path} must be a regular file.`)
  }
  const canonicalParent = await realpath(dirname(path))
  if (!isPathWithinRoot(canonicalParent, root)) {
    throw new Error(`${path} resolves outside its authorized root.`)
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size > MAX_IMPORT_FILE_BYTES) {
      throw new Error(`${path} is not a bounded regular file.`)
    }
    const buffer = Buffer.allocUnsafe(MAX_IMPORT_FILE_BYTES + 1)
    let total = 0
    while (total < buffer.length) {
      const { bytesRead } = await handle.read({
        buffer,
        length: buffer.length - total,
        offset: total,
        position: total,
      })
      if (bytesRead === 0) break
      total += bytesRead
    }
    if (total > MAX_IMPORT_FILE_BYTES) {
      throw new Error(`${path} exceeds ${MAX_IMPORT_FILE_BYTES} bytes.`)
    }
    if ((await realpath(dirname(path))) !== canonicalParent) {
      throw new Error(`${path} changed directories while it was being read.`)
    }
    return buffer.subarray(0, total).toString('utf8')
  } finally {
    await handle.close()
  }
}

function parseWorkspaceFlow(content: string): {
  steps: Array<{ name: string; state: string; tool: string }>
} {
  const parsed: unknown = JSON.parse(content)
  if (!isRecord(parsed) || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new Error('home/flow.json must contain at least one flow step.')
  }
  const steps = parsed.steps.map((value) => {
    if (
      !isRecord(value) ||
      !optionalString(value.name) ||
      !optionalString(value.state) ||
      !optionalString(value.tool)
    ) {
      throw new Error('home/flow.json contains an invalid flow step.')
    }
    return {
      name: optionalString(value.name),
      state: optionalString(value.state),
      tool: optionalString(value.tool),
    }
  })
  if (new Set(steps.map((step) => step.name)).size !== steps.length) {
    throw new Error('home/flow.json contains duplicate flow steps.')
  }
  return { steps }
}

function normalizeImportedStep(step: string): string {
  const normalized = normalizeProjectManifestFlowStep(step)
  const token = step.toLowerCase().replace(/[_\-\s]+/g, '')
  if (normalized === 'Synth' && token !== 'synth' && token !== 'synthesis') {
    throw new Error(`Unsupported workspace flow step: ${step}.`)
  }
  return normalized
}

function deriveWorkspaceStatus(
  steps: Array<{ state: string }>,
): ProjectManifestWorkspaceStatus {
  const states = new Set(
    steps.map((step) => step.state.toLowerCase().replace(/[\s_-]+/g, '')),
  )
  if (
    [...states].some((state) =>
      ['failed', 'failure', 'error', 'incomplete', 'invalid'].includes(state),
    )
  ) {
    return 'failed'
  }
  if ([...states].every((state) => state === 'success' || state === 'reused')) {
    return 'success'
  }
  if (
    [...states].every((state) =>
      ['ongoing', 'pending', 'success', 'reused', 'unstart'].includes(state),
    )
  ) {
    return 'not_started'
  }
  return 'failed'
}

function importableParameters(
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(parameters).filter(([key]) => key !== '_flow'))
}

function buildParameterPatch(
  baseParameters: Record<string, unknown>,
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(parameters)
      .filter(
        ([key, value]) =>
          !PATCH_EXCLUDED_PARAMETERS.has(key) && !deepEqual(baseParameters[key], value),
      )
      .map(([key, value]) => [
        key,
        {
          from: Object.prototype.hasOwnProperty.call(baseParameters, key)
            ? baseParameters[key]
            : null,
          to: value,
        },
      ]),
  )
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function assertJsonSerializable(value: unknown): void {
  if (
    typeof value === 'bigint' ||
    value instanceof Date ||
    (typeof value === 'number' && !Number.isFinite(value))
  ) {
    throw new Error('Workspace parameters contain a value project.json cannot represent.')
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonSerializable(item)
    return
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) assertJsonSerializable(item)
  }
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code
}
