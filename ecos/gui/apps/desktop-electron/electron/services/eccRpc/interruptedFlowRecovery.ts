import { randomUUID } from 'node:crypto'
import { chmod, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'

const RETRY_DELAY_MS = 100
const WRITE_ATTEMPTS = 3

interface FlowStep {
  name: string
  state: string
  tool: string
  [key: string]: unknown
}

interface FlowDocument {
  steps: FlowStep[]
  [key: string]: unknown
}

export interface InterruptedFlowRecoveryResult {
  errors: string[]
  recoveredSteps: number
}

function isWithin(root: string, path: string): boolean {
  const relativePath = relative(root, path)
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
    !isAbsolute(relativePath)
  )
}

function isOngoing(state: string): boolean {
  return state.trim().toLowerCase() === 'ongoing'
}

function workspaceStepDirectoryName(step: FlowStep): string {
  if (step.tool.toLowerCase() === 'sizer') {
    return `${step.name.trim().split(/\s+/).join('_').toLowerCase()}_sizer`
  }
  return `${step.name}_${step.tool}`
}

function parseFlowDocument(raw: string, label: string, requireTool = true): FlowDocument {
  const data = JSON.parse(raw) as { steps?: unknown }
  if (!Array.isArray(data.steps)) throw new Error(`${label} has no steps array`)
  for (const step of data.steps) {
    if (
      typeof step !== 'object' ||
      step === null ||
      typeof (step as FlowStep).name !== 'string' ||
      (requireTool && typeof (step as FlowStep).tool !== 'string') ||
      typeof (step as FlowStep).state !== 'string'
    ) {
      throw new Error(`${label} contains an invalid step`)
    }
  }
  return data as FlowDocument
}

async function resolveWorkspaceFile(root: string, ...parts: string[]): Promise<string> {
  const candidate = resolve(root, ...parts)
  if (!isWithin(root, candidate)) throw new Error(`path is outside workspace: ${candidate}`)
  const path = await realpath(candidate)
  if (!isWithin(root, path)) throw new Error(`path resolves outside workspace: ${candidate}`)
  return path
}

async function pause(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
}

async function writeJsonAtomically(path: string, data: FlowDocument): Promise<void> {
  const mode = (await stat(path)).mode
  const content = `${JSON.stringify(data, null, 4)}\n`
  let lastError: unknown

  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
    try {
      const file = await open(temporaryPath, 'w', mode)
      try {
        await file.writeFile(content, 'utf8')
        await file.sync()
      } finally {
        await file.close()
      }
      await chmod(temporaryPath, mode)
      await rename(temporaryPath, path)
      return
    } catch (error) {
      lastError = error
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      if (attempt < WRITE_ATTEMPTS - 1) await pause()
    }
  }

  throw lastError
}

async function recoverSubflow(root: string, step: FlowStep): Promise<void> {
  const path = await resolveWorkspaceFile(root, workspaceStepDirectoryName(step), 'subflow.json')
  const flow = parseFlowDocument(await readFile(path, 'utf8'), `subflow for ${step.name}`, false)
  let changed = false
  for (const substep of flow.steps) {
    if (!isOngoing(substep.state)) continue
    substep.state = 'Incomplete'
    changed = true
  }
  if (changed) await writeJsonAtomically(path, flow)
}

/** Recover state that a dead sidecar could no longer persist itself. */
export async function recoverInterruptedFlow(
  workspaceDirectory: string,
): Promise<InterruptedFlowRecoveryResult> {
  const errors: string[] = []
  let root: string
  let flowPath: string
  let flow: FlowDocument

  try {
    root = await realpath(workspaceDirectory)
    flowPath = await resolveWorkspaceFile(root, 'home', 'flow.json')
    flow = parseFlowDocument(await readFile(flowPath, 'utf8'), 'flow.json')
  } catch (error) {
    return {
      errors: [`flow.json recovery failed: ${error instanceof Error ? error.message : String(error)}`],
      recoveredSteps: 0,
    }
  }

  const interrupted = flow.steps.filter((step) => isOngoing(step.state))
  if (interrupted.length === 0) return { errors, recoveredSteps: 0 }

  for (const step of interrupted) step.state = 'Incomplete'
  try {
    await writeJsonAtomically(flowPath, flow)
  } catch (error) {
    return {
      errors: [`flow.json recovery failed: ${error instanceof Error ? error.message : String(error)}`],
      recoveredSteps: 0,
    }
  }

  for (const step of interrupted) {
    try {
      await recoverSubflow(root, step)
    } catch (error) {
      errors.push(
        `subflow recovery failed for ${step.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  return { errors, recoveredSteps: interrupted.length }
}
