import { load } from 'js-yaml'

export const QUICK_START_WORKFLOW_YAML = `
id: backend-gcd-quick-start
version: 1.0.0
schema_version: ecos.quick_start.workflow.v1
app_version:
  min: 0.1.0
steps:
  - id: preflight
    capability: preflight_resources
    bind: preflight
  - id: project-management
    capability: open_project_management
    depends_on: [preflight]
  - id: create-project
    capability: create_project
    depends_on: [project-management]
    bind: project
  - id: workspace-setup
    capability: create_workspace
    depends_on: [create-project]
    bind: workspace
  - id: handoff
    capability: workspace_handoff
    depends_on: [workspace-setup]
  - id: run-flow
    capability: start_flow
    depends_on: [handoff]
`

export type QuickStartValue = unknown

export interface QuickStartCapabilityProjection {
  detailKey: string
  labelKey: string
  surface: string
}

export interface QuickStartCapabilityContext {
  bindings: Record<string, QuickStartValue>
  inputs: Record<string, QuickStartValue>
  step: QuickStartWorkflowStep
}

export interface QuickStartCapability {
  projection: QuickStartCapabilityProjection
  run(context: QuickStartCapabilityContext): Promise<QuickStartValue> | QuickStartValue
}

export interface QuickStartWorkflowStep {
  capability: string
  depends_on?: string[]
  id: string
  inputs?: Record<string, QuickStartValue>
  on_error?: 'stop'
  bind?: string
  when?: {
    binding: string
    equals: unknown
    path?: string
  }
}

export interface QuickStartWorkflowInput {
  default?: QuickStartValue
  required?: boolean
  type: 'array' | 'boolean' | 'number' | 'object' | 'string'
}

export interface QuickStartWorkflowDefinition {
  app_version?: { max?: string; min?: string }
  inputs?: Record<string, QuickStartWorkflowInput>
  id: string
  schema_version: 'ecos.quick_start.workflow.v1'
  steps: QuickStartWorkflowStep[]
  version: string
}

export interface QuickStartWorkflowEvent {
  capability: string
  detailKey: string
  labelKey: string
  output?: QuickStartValue
  status: 'pending' | 'running' | 'completed' | 'failed'
  stepId: string
  surface: string
}

export interface QuickStartWorkflowResult {
  bindings: Record<string, QuickStartValue>
  definition: QuickStartWorkflowDefinition
}

export interface QuickStartWorkflowExecutionOptions {
  appVersion: string
  bindings?: Record<string, QuickStartValue>
  onEvent?: (event: QuickStartWorkflowEvent) => void
  signal?: AbortSignal
}

const VERSION = /^\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?$/

export function parseQuickStartWorkflow(
  source: string,
  capabilities: Record<string, QuickStartCapability>,
  appVersion: string,
): QuickStartWorkflowDefinition {
  let value: unknown
  try {
    value = load(source, { json: true })
  } catch (error) {
    throw new Error(`Quick Start Workflow YAML is invalid: ${errorMessage(error)}`)
  }
  if (!isRecord(value)) throw new Error('Quick Start Workflow must be an object.')
  const definition = validateDefinition(value, appVersion)
  for (const step of definition.steps) {
    const capability = capabilities[step.capability]
    if (!capability) throw new Error(`Unknown capability: ${step.capability}`)
    if (!capability.projection?.surface || !capability.projection.labelKey) {
      throw new Error(`Capability ${step.capability} is missing a UI projection.`)
    }
  }
  return definition
}

export async function executeQuickStartWorkflow(
  source: string,
  capabilities: Record<string, QuickStartCapability>,
  options: QuickStartWorkflowExecutionOptions,
): Promise<QuickStartWorkflowResult> {
  const definition = parseQuickStartWorkflow(source, capabilities, options.appVersion)
  const bindings: Record<string, unknown> = { ...options.bindings }
  for (const [name, input] of Object.entries(definition.inputs ?? {})) {
    if (bindings[name] === undefined && input.default !== undefined)
      bindings[name] = input.default
    if (input.required && bindings[name] === undefined) {
      throw new Error(`Workflow input is required: ${name}`)
    }
    if (bindings[name] !== undefined && !matchesInputType(bindings[name], input.type)) {
      throw new Error(`Workflow input has an invalid type: ${name}`)
    }
  }
  validateExecutionBindings(definition, bindings)
  const completed = new Set<string>()
  for (const step of definition.steps) {
    options.signal?.throwIfAborted()
    if (step.depends_on?.some((dependency) => !completed.has(dependency))) {
      throw new Error(`Workflow step ${step.id} has an unmet dependency.`)
    }
    const capability = capabilities[step.capability]!
    const projection = capability.projection
    options.onEvent?.({
      capability: step.capability,
      detailKey: projection.detailKey,
      labelKey: projection.labelKey,
      status: 'pending',
      stepId: step.id,
      surface: projection.surface,
    })
    if (step.when && !conditionMatches(step.when, bindings)) {
      completed.add(step.id)
      continue
    }
    const event = (status: QuickStartWorkflowEvent['status'], output?: QuickStartValue) =>
      options.onEvent?.({
        capability: step.capability,
        detailKey: projection.detailKey,
        labelKey: projection.labelKey,
        ...(output === undefined ? {} : { output }),
        status,
        stepId: step.id,
        surface: projection.surface,
      })
    event('running')
    try {
      options.signal?.throwIfAborted()
      const output = await capability.run({
        bindings,
        inputs: resolveRefs(step.inputs ?? {}, bindings) as Record<string, unknown>,
        step,
      })
      if (step.bind) bindings[step.bind] = output
      event('completed', output)
      completed.add(step.id)
    } catch (error) {
      event('failed')
      throw new Error(`Quick Start step ${step.id} failed: ${errorMessage(error)}`)
    }
  }
  return { bindings, definition }
}

function validateExecutionBindings(
  definition: QuickStartWorkflowDefinition,
  bindings: Record<string, unknown>,
): void {
  const available = new Set(Object.keys(bindings))
  for (const step of definition.steps) {
    for (const reference of [
      ...collectRefs(step.inputs),
      ...(step.when ? [step.when.binding] : []),
    ]) {
      if (!available.has(reference))
        throw new Error(`Workflow binding is unavailable: ${reference}`)
    }
    if (step.bind) available.add(step.bind)
  }
}

function collectRefs(value: unknown): string[] {
  if (isRecord(value)) {
    if (Object.keys(value).length === 1 && typeof value.ref === 'string') {
      if (!value.ref.trim()) throw new Error('Workflow binding reference is invalid.')
      return [value.ref]
    }
    return Object.values(value).flatMap(collectRefs)
  }
  return Array.isArray(value) ? value.flatMap(collectRefs) : []
}

function validateDefinition(
  value: Record<string, unknown>,
  appVersion: string,
): QuickStartWorkflowDefinition {
  const id = stringField(value, 'id')
  const version = stringField(value, 'version')
  if (!VERSION.test(version)) throw new Error('Workflow version is invalid.')
  if (value.schema_version !== 'ecos.quick_start.workflow.v1') {
    throw new Error('Workflow schema version is unsupported.')
  }
  const appRange = optionalRecord(value.app_version)
  const min = appRange ? optionalString(appRange.min) : undefined
  const max = appRange ? optionalString(appRange.max) : undefined
  if (
    appRange &&
    ((appRange.min !== undefined && !min) || (appRange.max !== undefined && !max))
  ) {
    throw new Error('Workflow application version range is invalid.')
  }
  if (
    (min && compareVersions(appVersion, min) < 0) ||
    (max && compareVersions(appVersion, max) > 0)
  ) {
    throw new Error('Workflow application version is incompatible.')
  }
  if (
    !Array.isArray(value.steps) ||
    value.steps.length === 0 ||
    value.steps.length > 64
  ) {
    throw new Error('Workflow steps must contain between 1 and 64 items.')
  }
  const ids = new Set<string>()
  const steps = value.steps.map((item) => {
    if (!isRecord(item)) throw new Error('Workflow step must be an object.')
    const step: QuickStartWorkflowStep = {
      capability: stringField(item, 'capability'),
      id: stringField(item, 'id'),
      ...(item.bind === undefined ? {} : { bind: stringField(item, 'bind') }),
      ...(item.inputs === undefined
        ? {}
        : { inputs: recordValue(item.inputs, 'inputs') }),
      ...(item.depends_on === undefined
        ? {}
        : { depends_on: stringList(item.depends_on, 'depends_on') }),
      ...(item.on_error === undefined
        ? {}
        : { on_error: item.on_error === 'stop' ? 'stop' : invalidField('on_error') }),
      ...(item.when === undefined ? {} : { when: conditionValue(item.when) }),
    }
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(step.id) || ids.has(step.id)) {
      throw new Error(`Workflow step id is invalid or duplicated: ${step.id}`)
    }
    ids.add(step.id)
    return step
  })
  for (const step of steps) {
    for (const dependency of step.depends_on ?? []) {
      if (!ids.has(dependency) || dependency === step.id) {
        throw new Error(`Workflow dependency is invalid: ${dependency}`)
      }
    }
  }
  return {
    ...(appRange
      ? { app_version: { ...(min ? { min } : {}), ...(max ? { max } : {}) } }
      : {}),
    ...(value.inputs === undefined ? {} : { inputs: workflowInputs(value.inputs) }),
    id,
    schema_version: 'ecos.quick_start.workflow.v1',
    steps,
    version,
  }
}

function workflowInputs(value: unknown): Record<string, QuickStartWorkflowInput> {
  if (!isRecord(value)) throw new Error('Workflow inputs must be an object.')
  return Object.fromEntries(
    Object.entries(value).map(([name, item]) => {
      if (
        !isRecord(item) ||
        !['array', 'boolean', 'number', 'object', 'string'].includes(String(item.type)) ||
        (item.required !== undefined && typeof item.required !== 'boolean')
      ) {
        throw new Error(`Workflow input is invalid: ${name}`)
      }
      return [
        name,
        {
          type: item.type as QuickStartWorkflowInput['type'],
          ...(item.default === undefined ? {} : { default: toValue(item.default) }),
          ...(item.required === undefined ? {} : { required: item.required }),
        },
      ]
    }),
  )
}

function matchesInputType(
  value: unknown,
  type: QuickStartWorkflowInput['type'],
): boolean {
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return isRecord(value)
  return typeof value === type
}

function conditionValue(value: unknown): NonNullable<QuickStartWorkflowStep['when']> {
  if (!isRecord(value) || typeof value.binding !== 'string' || !('equals' in value)) {
    throw new Error('Workflow condition is invalid.')
  }
  return {
    binding: value.binding,
    equals: toValue(value.equals),
    ...(value.path === undefined ? {} : { path: stringField(value, 'path') }),
  }
}

function conditionMatches(
  condition: NonNullable<QuickStartWorkflowStep['when']>,
  bindings: Record<string, unknown>,
): boolean {
  let value: QuickStartValue | undefined = bindings[condition.binding]
  if (condition.path) {
    for (const key of condition.path.split('.')) {
      value = isRecord(value) ? value[key] : undefined
    }
  }
  return JSON.stringify(value) === JSON.stringify(condition.equals)
}

function resolveRefs(value: unknown, bindings: Record<string, unknown>): unknown {
  if (isRecord(value)) {
    if (Object.keys(value).length === 1 && typeof value.ref === 'string') {
      const resolved = bindings[value.ref]
      if (resolved === undefined)
        throw new Error(`Workflow binding is unavailable: ${value.ref}`)
      return resolved
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveRefs(item, bindings)]),
    )
  }
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, bindings))
  return value
}

function toValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return value
  if (Array.isArray(value)) return value.map(toValue)
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toValue(item)]),
    )
  throw new Error('Workflow value is invalid.')
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Workflow ${label} must be an object.`)
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, toValue(item)]),
  )
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Workflow ${label} must be a list of strings.`)
  }
  return value as string[]
}

function stringField(value: Record<string, unknown>, field: string): string {
  if (typeof value[field] !== 'string' || !value[field].trim())
    throw new Error(`Workflow ${field} is required.`)
  return value[field].trim()
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && VERSION.test(value) ? value : undefined
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalidField(field: string): never {
  throw new Error(`Workflow ${field} is invalid.`)
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const b = right.split('.').map((part) => Number.parseInt(part, 10) || 0)
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0)
    if (delta) return delta
  }
  return 0
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
