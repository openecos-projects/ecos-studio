/** Frontend profiles supported by the pinned ECC-FE runtime. */
export type FrontendDesignKind = 'cpu_core' | 'generic_rtl'

export const genericRtlFlowSteps = ['prepare', 'review', 'elab', 'lint'] as const
export const cpuCoreFlowSteps = [...genericRtlFlowSteps, 'sim'] as const

export function normalizeFrontendDesignKind(value: unknown): FrontendDesignKind {
  const kind = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
  if (!kind || kind === 'cpu_core') return 'cpu_core'
  if (kind === 'generic_rtl') return kind
  throw new Error(`Unsupported frontend design kind: ${String(value)}`)
}

export function frontendDesignKindFromConfig(config?: {
  frontend_design_kind?: unknown
  parameters?: Record<string, unknown>
}): FrontendDesignKind {
  return normalizeFrontendDesignKind(
    config?.frontend_design_kind ?? config?.parameters?.frontend_design_kind,
  )
}

export function frontendFlowSteps(kind: FrontendDesignKind) {
  return kind === 'generic_rtl' ? genericRtlFlowSteps : cpuCoreFlowSteps
}
