import { validateMpcSpec, type ProjectManifestMpc } from '@ecos-studio/shared'
import type { ProjectManifestMpcCandidate } from './projectManagement'

export interface MpcSpecDesign {
  index: number
  designName: string
  directory?: string
  dbu: unknown
  die: Record<string, unknown>
  core: Record<string, unknown>
  ioPins: MpcSpecIoPins
  other: Record<string, unknown>
  coreTemplate: Record<string, unknown>
}

export interface MpcSpecIoPins {
  declaredCount: number | null
  list: Record<string, unknown>[]
  other: Record<string, unknown>
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
const DESIGN_FIELDS = new Set([
  'directory',
  'design_name',
  'dbu',
  'die',
  'core',
  'io_pins',
  'core_template',
])
const IO_PIN_FIELDS = new Set(['number', 'list'])

export function parseMpcSpecDesigns(spec: unknown): MpcSpecDesign[] {
  return validateMpcSpec(spec).designs.map(
    ({ index, design, coreTemplate, ioPins, pins, declaredPinCount }) => {
      const designName = optionalString(design.design_name) || `Design ${index + 1}`
      const directory = optionalString(design.directory)
      return {
        index,
        designName,
        ...(directory ? { directory } : {}),
        dbu: design.dbu ?? null,
        die: recordValue(design.die) ?? {},
        core: recordValue(design.core) ?? {},
        ioPins: {
          declaredCount: declaredPinCount,
          list: pins,
          other: omitFields(ioPins, IO_PIN_FIELDS),
        },
        other: omitFields(design, DESIGN_FIELDS),
        coreTemplate,
      }
    },
  )
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

function omitFields(
  source: Record<string, unknown>,
  fields: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !fields.has(key)))
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
