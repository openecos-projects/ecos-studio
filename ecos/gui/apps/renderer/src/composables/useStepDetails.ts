import { useWorkspaceJsonFile } from '@/composables/useWorkspaceJsonFile'
import {
  ANTENNA_STEP_PATH,
  LVS_STEP_PATH,
  parseStepDetails,
} from '@/components/flow-insights/stepDetails'

function useStepDetails(path: string, invalidMessage: string) {
  const { data, loading, error, refresh } = useWorkspaceJsonFile(
    path,
    parseStepDetails,
    invalidMessage,
  )
  return { summary: data, loading, error, refresh }
}

export function useLvsSummary() {
  return useStepDetails(LVS_STEP_PATH, 'LVS analysis result is invalid.')
}

export function useAntennaSummary() {
  return useStepDetails(ANTENNA_STEP_PATH, 'Antenna check result is invalid.')
}
