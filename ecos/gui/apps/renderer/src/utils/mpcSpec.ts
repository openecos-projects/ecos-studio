import type { ProjectManifestMpc, ProjectManifestMpcCandidate } from './projectManagement'

export interface MpcSpecDesign {
  index: number
  designName: string
  directory?: string
  coreTemplate: Record<string, unknown>
}

export interface MpcCoreTemplatePreview {
  template: Record<string, unknown>
  limits: Record<string, unknown>
  parameters: Record<string, unknown>[]
  ports: Record<string, unknown>[]
  frameIo: Record<string, unknown>
  templateBehavior: Record<string, unknown>
  other: Record<string, unknown>
}

const TEMPLATE_FIELDS = ['name', 'module', 'source', 'info'] as const
const LIMIT_FIELDS = [
  'maximum_core_num',
  'minimum_area',
  'maximum_area',
  'maximum_cell_num',
] as const
const GROUPED_FIELDS = new Set([
  ...TEMPLATE_FIELDS,
  ...LIMIT_FIELDS,
  'parameters',
  'ports',
  'frame_io',
  'template_behavior',
])

export function parseMpcSpecDesigns(spec: unknown): MpcSpecDesign[] {
  const source = recordValue(spec)
  if (!source || !Array.isArray(source.designs)) {
    throw new Error('MPC spec must contain a designs array.')
  }

  const designs = source.designs.flatMap((value, index) => {
    const design = recordValue(value)
    if (!design) return []
    const coreTemplate = recordValue(design.core_template)
    if (!coreTemplate) return []

    const designName = optionalString(design.design_name) || `Design ${index + 1}`
    const directory = optionalString(design.directory)
    return [
      {
        index,
        designName,
        ...(directory ? { directory } : {}),
        coreTemplate,
      },
    ]
  })

  if (designs.length === 0) {
    throw new Error('MPC spec has no design with a core_template object.')
  }
  return designs
}

export function createProjectManifestMpcSnapshot(
  candidate: ProjectManifestMpcCandidate,
  design: MpcSpecDesign,
): ProjectManifestMpc {
  return {
    ...candidate,
    design: {
      index: design.index,
      design_name: design.designName,
      ...(design.directory ? { directory: design.directory } : {}),
    },
    core_template: cloneJsonRecord(design.coreTemplate),
  }
}

export function previewMpcCoreTemplate(
  coreTemplate: Record<string, unknown>,
): MpcCoreTemplatePreview {
  return {
    template: pickFields(coreTemplate, TEMPLATE_FIELDS),
    limits: pickFields(coreTemplate, LIMIT_FIELDS),
    parameters: recordList(coreTemplate.parameters),
    ports: recordList(coreTemplate.ports),
    frameIo: recordValue(coreTemplate.frame_io) ?? {},
    templateBehavior: recordValue(coreTemplate.template_behavior) ?? {},
    other: Object.fromEntries(
      Object.entries(coreTemplate).filter(([key]) => !GROUPED_FIELDS.has(key)),
    ),
  }
}

function pickFields(
  source: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    fields.flatMap((field) =>
      Object.prototype.hasOwnProperty.call(source, field) ? [[field, source[field]]] : [],
    ),
  )
}

function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const record = recordValue(item)
        return record ? [record] : []
      })
    : []
}

function cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function optionalString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}
