export interface ValidatedMpcSpecDesign {
  index: number
  design: Record<string, unknown>
  coreTemplate: Record<string, unknown>
  ioPins: Record<string, unknown>
  pins: Record<string, unknown>[]
  declaredPinCount: number | null
}

export interface ValidatedMpcSpec {
  source: Record<string, unknown>
  designs: ValidatedMpcSpecDesign[]
}

export function validateMpcSpec(spec: unknown): ValidatedMpcSpec {
  const source = recordValue(spec)
  if (!source || !Array.isArray(source.designs)) {
    throw new Error('MPC spec must contain a designs array.')
  }

  const declaredDesignCount = optionalNonNegativeInteger(source.number)
  if (source.number !== undefined && declaredDesignCount === null) {
    throw new Error('MPC spec number must be a non-negative integer.')
  }
  if (declaredDesignCount !== null && declaredDesignCount !== source.designs.length) {
    throw new Error('MPC spec number must match designs.length.')
  }

  const designs = source.designs.flatMap((value, index) => {
    const design = recordValue(value)
    if (!design) return []
    const coreTemplate = recordValue(design.core_template)
    if (!coreTemplate) return []

    const ioPins = recordValue(design.io_pins) ?? {}
    const pins = recordList(ioPins.list)
    const declaredPinCount = optionalNonNegativeInteger(ioPins.number)
    if (ioPins.number !== undefined && declaredPinCount === null) {
      throw new Error(
        `MPC design ${index + 1} io_pins.number must be a non-negative integer.`,
      )
    }
    if (declaredPinCount !== null && declaredPinCount !== pins.length) {
      throw new Error(
        `MPC design ${index + 1} io_pins.number must match io_pins.list.length.`,
      )
    }

    return [{ index, design, coreTemplate, ioPins, pins, declaredPinCount }]
  })

  if (designs.length === 0) {
    throw new Error('MPC spec has no design with a core_template object.')
  }

  return { source, designs }
}

function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const record = recordValue(item)
        return record ? [record] : []
      })
    : []
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function optionalNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}
