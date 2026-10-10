import type { ChecklistFinding, FlowStepSummary } from '@ecos-studio/shared'
import { getStepMetadata, sameFlowStepName } from '@/api/type'
import type { HomeLayoutThumbnail } from '@/composables/useHomeSnapshots'
import { checklistStatusSummary } from '@/components/home/dashboardData'
import {
  flowNodeStatus,
  formatRuntime,
  type FlowStatusNode,
} from '@/components/workbench/flowStatus'

export type StepCheckState = 'passed' | 'blocked' | 'warning' | 'unavailable'

export interface DashboardFlowStep extends FlowStatusNode {
  path: string
  checklist: ChecklistFinding[]
  checkState: StepCheckState
  thumbnail: HomeLayoutThumbnail | null
}

export function stepCheckState(findings: ChecklistFinding[]): StepCheckState {
  const summary = checklistStatusSummary(findings)
  if (summary.blocked || findings.some((finding) => finding.blocked)) return 'blocked'
  if (
    findings.some(
      (finding) => !['pass', 'warning'].includes(finding.state.trim().toLowerCase()),
    )
  )
    return 'unavailable'
  if (!summary.total || summary.unavailable) return 'unavailable'
  if (summary.warning) return 'warning'
  return 'passed'
}

export function dashboardFlowSteps(
  steps: readonly FlowStepSummary[],
  findings: ChecklistFinding[],
  thumbnails: readonly HomeLayoutThumbnail[],
): DashboardFlowStep[] {
  return [...steps]
    .sort((left, right) => left.order - right.order)
    .map((step) => {
      const checklist = findings.filter((finding) =>
        sameFlowStepName(finding.step, step.stepId),
      )
      const metadata = getStepMetadata(step.stepId)
      return {
        id: step.stepId,
        path: metadata?.path ?? step.stepId,
        label: metadata?.label ?? step.name,
        status: flowNodeStatus(step.state),
        runtime: formatRuntime(step.runtimeSeconds),
        peakMemoryMb: step.peakMemoryMb ?? null,
        checklist,
        checkState: stepCheckState(checklist),
        thumbnail:
          thumbnails.find((thumbnail) => sameFlowStepName(thumbnail.step, step.stepId)) ??
          null,
      }
    })
}
