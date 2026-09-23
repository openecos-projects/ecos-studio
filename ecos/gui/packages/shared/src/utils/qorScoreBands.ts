import type { EccQorSnapshotExtension } from '../contracts/eccRuntime.ts'

export type QorScalarStatus = EccQorSnapshotExtension['scalarStatus']

/** qor-v3 scalar bands: GREEN >= 90, YELLOW >= 75, ORANGE >= 60, below that RED. */
export const QOR_SCORE_BAND_GREEN_MIN = 90
export const QOR_SCORE_BAND_YELLOW_MIN = 75
export const QOR_SCORE_BAND_ORANGE_MIN = 60

/**
 * Derives the band a bare score falls into. Only a fallback for scores that arrive
 * without ECC's own scalarStatus; the committed extension status stays authoritative.
 */
export function qorScalarStatusForScore(
  score: number | null | undefined,
): QorScalarStatus {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return 'NOT_RATED'
  }
  if (score >= QOR_SCORE_BAND_GREEN_MIN) return 'GREEN'
  if (score >= QOR_SCORE_BAND_YELLOW_MIN) return 'YELLOW'
  if (score >= QOR_SCORE_BAND_ORANGE_MIN) return 'ORANGE'
  return 'RED'
}

/** Display label: NOT_RATED reads as NR, every rated band keeps its ECC name. */
export function qorScalarStatusLabel(status: QorScalarStatus | null | undefined): string {
  return !status || status === 'NOT_RATED' ? 'NR' : status
}
