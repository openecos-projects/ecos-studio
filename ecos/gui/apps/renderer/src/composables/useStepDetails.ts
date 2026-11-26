import {
  useWorkspaceJsonFile,
  workspaceStepFeaturePath,
} from '@/composables/useWorkspaceJsonFile'
import { parseStepDetails } from '@/components/flow-insights/stepDetails'

function useStepDetails(stepId: string, invalidMessage: string) {
  const { data, loading, error, refresh } = useWorkspaceJsonFile(
    (workspace) => workspaceStepFeaturePath(workspace, stepId),
    parseStepDetails,
    invalidMessage,
  )
  return { summary: data, loading, error, refresh }
}

export function useLvsSummary() {
  return useStepDetails('lvs', 'LVS analysis result is invalid.')
}

export function useAntennaSummary() {
  return useStepDetails('antenna_check', 'Antenna check result is invalid.')
}
