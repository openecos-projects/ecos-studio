import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright-core'

export async function readFlowSteps(workspaceDir: string): Promise<
  Array<{
    name: string
    state: string
    checklistStatus: string | undefined
  }>
> {
  const flow = JSON.parse(
    await readFile(join(workspaceDir, 'home/flow.json'), 'utf8'),
  ) as {
    steps?: Array<{
      name?: string
      id?: string
      state?: string
      checklist_status?: { status?: string }
    }>
  }
  return (flow.steps ?? []).map((step) => ({
    name: step.name ?? step.id ?? '?',
    state: step.state ?? '?',
    checklistStatus: step.checklist_status?.status,
  }))
}

export async function readChecklistCardMismatches(
  page: Page,
  workspaceDir: string,
): Promise<string[]> {
  const steps = await readFlowSteps(workspaceDir)
  if (!steps.length) return ['No persisted flow steps']
  const cards = await page
    .locator('.workspace-flow-dashboard .flow-step-card')
    .evaluateAll((items) =>
      items.map((item) => ({
        step: item.getAttribute('data-step'),
        checkState: item.getAttribute('data-check-state'),
      })),
    )
  const expectedStates: Record<string, string> = {
    passed: 'passed',
    blocked: 'blocked',
    attention: 'warning',
    unknown: 'unavailable',
  }
  return steps.flatMap((step) => {
    const expected = expectedStates[step.checklistStatus ?? '']
    const actual = cards.find((card) => card.step === step.name)?.checkState
    return expected && actual === expected
      ? []
      : [`${step.name}: checklist=${step.checklistStatus}, card=${actual}`]
  })
}
