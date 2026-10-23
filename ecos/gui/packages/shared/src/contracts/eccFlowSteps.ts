/**
 * Canonical ECC flow step catalog shared by the Electron main process and the
 * renderer. The Python counterpart is `ECCStepName`
 * (ecos/agent/src/ecos_agent/ecc_contracts.py) — keep the entries and their
 * order identical. The joint contract lives in `ecos/agent/docs/ecc-agent-rpc.md`.
 */
export const ECC_FLOW_STEPS = [
  'Synthesis',
  'lec',
  'preFloorplan',
  'macroPlacement',
  'postFloorplan',
  'preplace',
  'place',
  'diff_sizing',
  'CTS',
  'legalization',
  'Timing optimization',
  'route',
  'filler',
  'lvs',
  'drc',
  'antennaCheck',
  'postRouteLec',
  'RCX',
  'sta',
  'powerAnalysis',
  'emir',
  'Harden',
] as const

export type EccFlowStep = (typeof ECC_FLOW_STEPS)[number]

export const ECC_FLOW_STEP_SET: ReadonlySet<string> = new Set(ECC_FLOW_STEPS)

export const ECC_CATALOG_END_STEP: EccFlowStep = ECC_FLOW_STEPS[ECC_FLOW_STEPS.length - 1]

/** Default tool names when extending a short source flow to the catalog end. */
export const ECC_DEFAULT_STEP_TOOLS: Record<EccFlowStep, string> = {
  Synthesis: 'yosys',
  lec: 'kepler_formal',
  preFloorplan: 'ecc',
  macroPlacement: 'dreamplace',
  postFloorplan: 'ecc',
  preplace: 'sizer',
  place: 'dreamplace',
  diff_sizing: 'dreamplace',
  CTS: 'ecc',
  legalization: 'dreamplace',
  'Timing optimization': 'sizer',
  route: 'ecc',
  drc: 'ecc',
  antennaCheck: 'ecc',
  lvs: 'ecc',
  filler: 'ecc',
  postRouteLec: 'kepler_formal',
  RCX: 'ecc',
  sta: 'ecc',
  powerAnalysis: 'ecc',
  emir: 'ecc',
  Harden: 'ecc',
}
