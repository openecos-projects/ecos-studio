/**
 * Canonical ECC flow step catalog shared by the Electron main process and the
 * renderer. The Python counterpart is `ECCStepName`
 * (ecos/agent/src/ecos_agent/ecc_contracts.py) — keep the entries and their
 * order identical. The joint contract lives in `ecos/agent/docs/ecc-agent-rpc.md`.
 */
export const ECC_FLOW_STEPS = [
  'synthesis',
  'pre_floorplan',
  'macro_placement',
  'post_floorplan',
  'preplace',
  'placement',
  'diff_opt',
  'diff_sizing',
  'cts',
  'legalization',
  'timing_optimization',
  'routing',
  'filler',
  'lvs',
  'drc',
  'antenna_check',
  'post_route_lec',
  'rcx',
  'sta',
  'power_analysis',
  'emir',
  'harden',
] as const

export type EccFlowStep = (typeof ECC_FLOW_STEPS)[number]

export const ECC_FLOW_STEP_SET: ReadonlySet<string> = new Set(ECC_FLOW_STEPS)

export const ECC_CATALOG_END_STEP: EccFlowStep = ECC_FLOW_STEPS[ECC_FLOW_STEPS.length - 1]

/** Default tool names when extending a short source flow to the catalog end. */
export const ECC_DEFAULT_STEP_TOOLS: Record<EccFlowStep, string> = {
  synthesis: 'yosys',
  pre_floorplan: 'ecc',
  macro_placement: 'dreamplace',
  post_floorplan: 'ecc',
  preplace: 'sizer',
  placement: 'dreamplace',
  diff_opt: 'dreamplace',
  diff_sizing: 'dreamplace',
  cts: 'ecc',
  legalization: 'dreamplace',
  timing_optimization: 'sizer',
  routing: 'ecc',
  drc: 'ecc',
  antenna_check: 'ecc',
  lvs: 'ecc',
  filler: 'ecc',
  post_route_lec: 'kepler_formal',
  rcx: 'ecc',
  sta: 'ecc',
  power_analysis: 'ecc',
  emir: 'ecc',
  harden: 'ecc',
}
