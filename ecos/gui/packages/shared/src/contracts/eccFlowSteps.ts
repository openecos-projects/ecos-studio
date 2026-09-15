/**
 * Canonical ECC flow step catalog shared by the Electron main process and the
 * renderer. The Python counterpart is `ECCStepName`
 * (ecos/agent/src/ecos_agent/ecc_contracts.py) — keep the entries and their
 * order identical. The joint contract lives in `ecos/agent/docs/ecc-agent-rpc.md`.
 */
export const ECC_FLOW_STEPS = [
  'Synthesis',
  'lec',
  'Floorplan',
  'place',
  'CTS',
  'legalization',
  'Timing optimization',
  'route',
  'filler',
  'RCX',
  'sta',
  'lvs',
  'postRouteLec',
  'drc',
  'Harden',
] as const

export type EccFlowStep = (typeof ECC_FLOW_STEPS)[number]

export const ECC_FLOW_STEP_SET: ReadonlySet<string> = new Set(ECC_FLOW_STEPS)

export const ECC_CATALOG_END_STEP: EccFlowStep = ECC_FLOW_STEPS[ECC_FLOW_STEPS.length - 1]

/** Default tool names when extending a short source flow to the catalog end. */
export const ECC_DEFAULT_STEP_TOOLS: Record<EccFlowStep, string> = {
  Synthesis: 'yosys',
  lec: 'yosys_lec',
  Floorplan: 'ecc',
  place: 'dreamplace',
  CTS: 'ecc',
  legalization: 'dreamplace',
  'Timing optimization': 'sizer',
  route: 'ecc',
  drc: 'ecc',
  lvs: 'ecc',
  filler: 'ecc',
  postRouteLec: 'yosys_lec',
  RCX: 'ecc',
  sta: 'ecc',
  Harden: 'ecc',
}
