import { useWorkspaceJsonFile } from '@/composables/useWorkspaceJsonFile'
import {
  parsePowerSummaryStep,
  POWER_SUMMARY_STEP_PATH,
} from '@/components/flow-insights/powerSummary'

export function usePowerSummary() {
  const { data, loading, error, refresh } = useWorkspaceJsonFile(
    POWER_SUMMARY_STEP_PATH,
    parsePowerSummaryStep,
    'Power analysis result is invalid.',
  )
  return { summary: data, loading, error, refresh }
}
