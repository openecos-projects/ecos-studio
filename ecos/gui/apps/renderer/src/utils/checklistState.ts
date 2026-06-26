export type ChecklistStateKind = 'success' | 'failed' | 'warning' | 'ongoing' | 'pending' | 'unstart'

export function normalizeChecklistState(state: string): ChecklistStateKind {
  switch (state) {
    case 'Passed':
    case 'Success':
    case 'Accepted':
      return 'success'
    case 'Failed':
    case 'Imcomplete':
      return 'failed'
    case 'Warning':
      return 'warning'
    case 'Ongoing':
      return 'ongoing'
    case 'Pending':
      return 'pending'
    case 'Unstart':
      return 'unstart'
    default:
      return 'unstart'
  }
}

export function checklistStateClass(state: string): string {
  return `state-${normalizeChecklistState(state)}`
}

export function checklistStateIcon(state: string): string {
  switch (normalizeChecklistState(state)) {
    case 'success':
      return 'ri-checkbox-circle-fill'
    case 'failed':
      return 'ri-close-circle-fill'
    case 'warning':
      return 'ri-error-warning-fill'
    case 'ongoing':
      return 'ri-loader-4-line spin'
    case 'pending':
      return 'ri-time-line'
    default:
      return 'ri-checkbox-blank-circle-line'
  }
}

export function isChecklistPassed(state: string): boolean {
  return normalizeChecklistState(state) === 'success'
}
