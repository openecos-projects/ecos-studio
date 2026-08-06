export const EARLIER_COLLAPSE_THRESHOLD = 6

export type AgentToolStepStatus = 'done' | 'running' | 'error'

export interface AgentToolStep {
  id: string
  summary: string
  status: AgentToolStepStatus
  detailLines?: string[]
}

const RUNNING_RE = /^Running\s+(.+?)\.?$/i
const FAILED_RE = /^Failed\s+(.+?)\.?$/i
const COMPLETED_SAVED_RE = /^Completed\s+(.+?)\.\s*Saved:\s*(.+)$/i
const COMPLETED_RE = /^Completed\s+(.+?)\.?$/i
const SUBFLOW_RE = /^(.+?)\s+[›>]\s+(.+)$/

function basename(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return trimmed
  const parts = trimmed.split(/[/\\]/)
  return parts[parts.length - 1] || trimmed
}

function parseArtifactPaths(saved: string): string[] {
  return saved
    .split(';')
    .map((part) => basename(part))
    .filter(Boolean)
}

function subflowDetailKey(detail: string): string {
  return detail
    .replace(/\s+failed$/i, '')
    .split('·')[0]!
    .trim()
    .toLowerCase()
}

export function parseToolContentLines(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function upsertDetail(step: { detailLines?: string[] }, detail: string): void {
  const lines = step.detailLines ? [...step.detailLines] : []
  const key = subflowDetailKey(detail)
  const index = lines.findIndex((line) => subflowDetailKey(line) === key)
  if (index >= 0) lines[index] = detail
  else lines.push(detail)
  step.detailLines = lines
}

/**
 * Collapse Running/Completed flow lines into scannable timeline steps.
 * Subflow lines (`place › run placement`) attach under the matching stage.
 * Plain progress lines (Codex, rerun prep) stay as one step per line.
 */
export function buildAgentToolSteps(
  content: string,
  status: 'loading' | 'done' | 'error' = 'done',
): AgentToolStep[] {
  const lines = parseToolContentLines(content)
  if (lines.length === 0) {
    if (status === 'loading') {
      return [{ id: 'tool-empty', summary: 'Working…', status: 'running' }]
    }
    return []
  }

  type MutableStep = AgentToolStep & { kind: 'flow' | 'plain' }
  const steps: MutableStep[] = []

  const closePlainRunning = () => {
    for (const step of steps) {
      if (step.kind === 'plain' && step.status === 'running') step.status = 'done'
    }
  }

  const findFlowStep = (name: string, preferRunning = false): MutableStep | undefined => {
    const matches = steps.filter((step) => step.kind === 'flow' && step.summary === name)
    if (preferRunning) {
      return (
        [...matches].reverse().find((step) => step.status === 'running') ??
        matches[matches.length - 1]
      )
    }
    return matches[matches.length - 1]
  }

  for (const [index, line] of lines.entries()) {
    const subflow = line.match(SUBFLOW_RE)
    if (subflow) {
      const stage = subflow[1]!.trim()
      const detail = subflow[2]!.trim()
      const existing = findFlowStep(stage, true)
      if (existing) {
        upsertDetail(existing, detail)
      } else {
        steps.push({
          id: `tool-${index}`,
          summary: stage,
          status: /failed$/i.test(detail) ? 'error' : 'running',
          kind: 'flow',
          detailLines: [detail],
        })
      }
      continue
    }

    const completedSaved = line.match(COMPLETED_SAVED_RE)
    if (completedSaved) {
      const name = completedSaved[1]!.trim()
      const artifacts = parseArtifactPaths(completedSaved[2]!)
      const existing = findFlowStep(name, true)
      if (existing) {
        existing.status = 'done'
        if (!existing.detailLines?.length && artifacts.length) {
          existing.detailLines = artifacts
        }
      } else {
        steps.push({
          id: `tool-${index}`,
          summary: name,
          status: 'done',
          kind: 'flow',
          detailLines: artifacts.length ? artifacts : undefined,
        })
      }
      continue
    }

    const completed = line.match(COMPLETED_RE)
    if (completed) {
      const name = completed[1]!.trim()
      const existing = findFlowStep(name, true)
      if (existing) {
        existing.status = 'done'
      } else {
        steps.push({
          id: `tool-${index}`,
          summary: name,
          status: 'done',
          kind: 'flow',
        })
      }
      continue
    }

    const failed = line.match(FAILED_RE)
    if (failed) {
      const name = failed[1]!.trim()
      const existing = findFlowStep(name, true)
      if (existing) {
        existing.status = 'error'
      } else {
        steps.push({
          id: `tool-${index}`,
          summary: name,
          status: 'error',
          kind: 'flow',
        })
      }
      continue
    }

    const running = line.match(RUNNING_RE)
    if (running) {
      closePlainRunning()
      steps.push({
        id: `tool-${index}`,
        summary: running[1]!.trim(),
        status: 'running',
        kind: 'flow',
      })
      continue
    }

    closePlainRunning()
    steps.push({
      id: `tool-${index}`,
      summary: line.replace(/\.$/, ''),
      status: status === 'loading' ? 'running' : 'done',
      kind: 'plain',
    })
  }

  if (status === 'error' && steps.length > 0) {
    steps[steps.length - 1]!.status = 'error'
  }

  if (status === 'done') {
    for (const step of steps) {
      if (step.status === 'running') step.status = 'done'
    }
  }

  return steps.map(({ kind: _kind, ...step }) => step)
}

export function splitToolSteps(tools: AgentToolStep[]): {
  earlier: AgentToolStep[]
  recent: AgentToolStep[]
} {
  if (tools.length <= EARLIER_COLLAPSE_THRESHOLD) {
    return { earlier: [], recent: tools }
  }
  const keepRecent = Math.max(3, EARLIER_COLLAPSE_THRESHOLD - 3)
  const splitAt = tools.length - keepRecent
  return {
    earlier: tools.slice(0, splitAt),
    recent: tools.slice(splitAt),
  }
}
