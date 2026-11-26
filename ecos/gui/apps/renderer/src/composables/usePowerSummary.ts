import {
  useWorkspaceJsonFile,
  workspaceStepFeaturePath,
} from '@/composables/useWorkspaceJsonFile'
import { parsePowerSummaryStep } from '@/components/flow-insights/powerSummary'

export function usePowerSummary() {
  const { data, loading, error, refresh } = useWorkspaceJsonFile(
    (workspace) => workspaceStepFeaturePath(workspace, 'power_analysis'),
    parsePowerSummaryStep,
    'Power analysis result is invalid.',
  )
  return { summary: data, loading, error, refresh }
}
