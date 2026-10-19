export interface PowerSummaryModel {
  internalUw: number
  switchingUw: number
  dynamicUw: number
  leakageUw: number
}

const POWER_SUMMARY_KEYS = [
  ['internalUw', 'internal_uw'],
  ['switchingUw', 'switching_uw'],
  ['dynamicUw', 'dynamic_uw'],
  ['leakageUw', 'leakage_uw'],
] as const

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function parsePowerSummaryStep(value: unknown): PowerSummaryModel | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const summary = (value as Record<string, unknown>).power_summary
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null

  const parsed = Object.fromEntries(
    POWER_SUMMARY_KEYS.map(([modelKey, jsonKey]) => [
      modelKey,
      finiteNumber((summary as Record<string, unknown>)[jsonKey]),
    ]),
  ) as Record<string, number | null>
  if (Object.values(parsed).some((entry) => entry === null)) return null

  return {
    internalUw: parsed.internalUw as number,
    switchingUw: parsed.switchingUw as number,
    dynamicUw: parsed.dynamicUw as number,
    leakageUw: parsed.leakageUw as number,
  }
}

export const POWER_SUMMARY_STEP_PATH =
  'powerAnalysis_ecc/feature/powerAnalysis.step.json'
