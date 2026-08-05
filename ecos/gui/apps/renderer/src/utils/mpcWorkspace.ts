import type { ProjectManifestMpc } from './projectManagement'

export type MpcDieAreaMode = 'width_height' | 'utilitization_margin'

export interface MpcDieAreaConstraint {
  minimumArea: number | null
  maximumArea: number | null
}

export interface MpcDieAreaValidation {
  area: number | null
  constraint: MpcDieAreaConstraint
  error: string | null
}

export function mpcDieAreaConstraint(
  mpc: ProjectManifestMpc | null | undefined,
): MpcDieAreaConstraint {
  const coreTemplate = mpc?.core_template
  return {
    minimumArea: positiveFiniteNumber(coreTemplate?.minimum_area),
    maximumArea: positiveFiniteNumber(coreTemplate?.maximum_area),
  }
}

export function validateMpcDieArea(
  mpc: ProjectManifestMpc | null | undefined,
  mode: MpcDieAreaMode,
  width: unknown,
  height: unknown,
): MpcDieAreaValidation {
  const constraint = mpcDieAreaConstraint(mpc)
  if (mode !== 'width_height') {
    return { area: null, constraint, error: null }
  }

  if (
    constraint.minimumArea !== null &&
    constraint.maximumArea !== null &&
    constraint.minimumArea > constraint.maximumArea
  ) {
    return {
      area: null,
      constraint,
      error: 'The selected MPC core template has an invalid die-area range.',
    }
  }

  const parsedWidth = positiveFiniteNumber(width)
  const parsedHeight = positiveFiniteNumber(height)
  if (parsedWidth === null || parsedHeight === null) {
    return { area: null, constraint, error: null }
  }

  const area = parsedWidth * parsedHeight
  if (constraint.minimumArea !== null && area < constraint.minimumArea) {
    return {
      area,
      constraint,
      error: `Die area must be at least ${constraint.minimumArea}.`,
    }
  }
  if (constraint.maximumArea !== null && area > constraint.maximumArea) {
    return {
      area,
      constraint,
      error: `Die area must be at most ${constraint.maximumArea}.`,
    }
  }
  return { area, constraint, error: null }
}

function positiveFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}
