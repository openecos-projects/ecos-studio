/** Routing milestones share the flow bar; batch frames play between these nodes. */
export function routeMilestones(
  frames: unknown[],
): { seconds: number; label: string; sequence: number }[] {
  return frames.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const frame = item as Record<string, unknown>
    if (frame.subflow !== 'run routing' || frame.state_domain !== 'algorithm_state')
      return []
    if (typeof frame.phase !== 'string' || /_(wave|box)$/.test(frame.phase)) return []
    if (
      !Number.isSafeInteger(frame.sequence) ||
      Number(frame.sequence) < 0 ||
      typeof frame.elapsed_ns !== 'number' ||
      !Number.isFinite(frame.elapsed_ns) ||
      frame.elapsed_ns < 0
    )
      throw new Error('Invalid Replay routing milestone')
    const metrics =
      frame.metrics && typeof frame.metrics === 'object'
        ? (frame.metrics as Record<string, unknown>)
        : {}
    const iteration =
      Number.isSafeInteger(metrics.iteration) && Number(metrics.iteration) > 0
        ? ` · iteration ${metrics.iteration}`
        : ''
    return [
      {
        seconds: frame.elapsed_ns / 1e9,
        label: frame.phase.replaceAll('_', ' ') + iteration,
        sequence: Number(frame.sequence),
      },
    ]
  })
}
