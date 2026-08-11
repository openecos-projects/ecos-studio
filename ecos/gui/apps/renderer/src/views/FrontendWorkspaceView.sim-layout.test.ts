import { describe, expect, it } from 'vitest'
import frontendWorkspaceViewSource from './FrontendWorkspaceView.vue?raw'

describe('FrontendWorkspaceView simulation layout', () => {
  it('keeps current simulation views without the legacy simulation terminal', () => {
    expect(frontendWorkspaceViewSource).not.toContain('Simulation Terminal')
    expect(frontendWorkspaceViewSource).not.toContain('shouldShowSimTerminal')
    expect(frontendWorkspaceViewSource).not.toContain('sim-terminal-')

    expect(frontendWorkspaceViewSource).toContain('class="cases-table"')
    expect(frontendWorkspaceViewSource).toContain('<FrontendDisassemblyViewer')
    expect(frontendWorkspaceViewSource).toContain('class="frontend-console"')
    expect(frontendWorkspaceViewSource).toContain('class="console-log"')
    expect(frontendWorkspaceViewSource).toContain('@change="loadSelectedLog"')
  })

  it('opens the simulation log console by default and highlights semantic lines', () => {
    expect(frontendWorkspaceViewSource).toContain('const initialConsoleStepIsSim =')
    expect(frontendWorkspaceViewSource).toContain(
      'const consoleCollapsed = ref(!initialConsoleStepIsSim)',
    )
    expect(frontendWorkspaceViewSource).toContain(
      "initialConsoleStepIsSim ? 'log' : 'problems'",
    )
    expect(frontendWorkspaceViewSource).toContain(
      'step.trim().toLowerCase() === FrontendStepEnum.SIM',
    )
    expect(frontendWorkspaceViewSource).toContain('<MonacoLogViewer')
    expect(frontendWorkspaceViewSource).toContain(':channel-key="selectedLogPath')
    expect(frontendWorkspaceViewSource).toContain(':content="logContent"')
  })
})
