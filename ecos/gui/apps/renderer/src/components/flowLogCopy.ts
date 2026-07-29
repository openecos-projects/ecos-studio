export type FlowLogCopyResult =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'failed'; message?: string }

export async function copyFlowLogText(
  text: string,
  writeText: (value: string) => Promise<void> = (value) =>
    navigator.clipboard.writeText(value),
): Promise<FlowLogCopyResult> {
  if (!text) {
    return { ok: false, reason: 'empty' }
  }

  try {
    await writeText(text)
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      reason: 'failed',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
