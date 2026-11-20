import { useWorkspaceJsonFile } from '@/composables/useWorkspaceJsonFile'
import { parsePowerSummary } from '@/components/flow-insights/powerSummary'

export function usePowerSummary() {
  const { data, loading, error, refresh } = useWorkspaceJsonFile(
    '',
    parsePowerSummary,
    'Power analysis result is invalid.',
    'power_analysis',
    'power_summary',
  )
  return { summary: data, loading, error, refresh }
}
