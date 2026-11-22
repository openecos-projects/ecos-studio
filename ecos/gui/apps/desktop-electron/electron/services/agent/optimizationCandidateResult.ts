export function readBestOptimizationCandidate(value: unknown) {
  if (!isRecord(value)) return
  const { candidate_id, manifest_sha256, metrics } = value
  if (
    typeof candidate_id !== 'string' ||
    !/^candidate-[a-f0-9]{16}-[a-zA-Z0-9._:-]+$/.test(candidate_id) ||
    candidate_id.length > 128 ||
    typeof manifest_sha256 !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(manifest_sha256) ||
    !Array.isArray(metrics) ||
    metrics.length > 64
  )
    return
  const entries = metrics.flatMap((value: unknown) => {
    if (!isRecord(value)) return []
    const { id, baseline, candidate } = value
    return typeof id === 'string' &&
      /^[a-zA-Z0-9_.-]{1,128}$/.test(id) &&
      (baseline === null ||
        (typeof baseline === 'number' && Number.isFinite(baseline))) &&
      typeof candidate === 'number' &&
      Number.isFinite(candidate)
      ? [{ id, baseline, candidate }]
      : []
  })
  if (
    entries.length !== metrics.length ||
    new Set(entries.map(({ id }) => id)).size !== entries.length
  )
    return
  return { candidate_id, manifest_sha256, metrics: entries }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
