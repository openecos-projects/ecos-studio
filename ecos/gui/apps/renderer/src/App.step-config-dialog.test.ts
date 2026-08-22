import { describe, expect, it } from 'vitest'
import appSource from './App.vue?raw'
import stepDashboardSource from './components/StepDashboard.vue?raw'

describe('Step configuration dialog sizing', () => {
  it('fills the maximized window instead of stopping at the normal-mode height', () => {
    const ruleStart = appSource.indexOf('.step-config-dialog {')
    const ruleEnd = appSource.indexOf('}', ruleStart)
    expect(appSource.slice(ruleStart, ruleEnd)).toContain('height: min(72vh, 720px)')

    // PrimeVue marks the maximized dialog root with p-dialog-maximized; the inner
    // area must stretch to the bottom of the window (above the footer).
    expect(appSource).toContain('.p-dialog-maximized .step-config-dialog')
    const maximizedStart = appSource.indexOf('.p-dialog-maximized .step-config-dialog')
    const maximizedEnd = appSource.indexOf('}', maximizedStart)
    expect(appSource.slice(maximizedStart, maximizedEnd)).toContain('height: 100%')
  })

  it('offers and fills on maximize in the Step Dashboard configuration dialog too', () => {
    const dialogStart = stepDashboardSource.indexOf(
      'v-model:visible="showStepConfiguration"',
    )
    const dialogEnd = stepDashboardSource.indexOf('</Dialog>', dialogStart)
    const dialogSource = stepDashboardSource.slice(dialogStart, dialogEnd)
    expect(dialogSource).toContain('maximizable')

    const maximizedStart = stepDashboardSource.indexOf(
      '.p-dialog-maximized .step-config-dialog',
    )
    expect(maximizedStart).toBeGreaterThan(-1)
    const maximizedEnd = stepDashboardSource.indexOf('}', maximizedStart)
    expect(stepDashboardSource.slice(maximizedStart, maximizedEnd)).toContain(
      'height: 100%',
    )
  })
})
