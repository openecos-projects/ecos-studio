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

  it('waits for a ready workspace before allowing a step run', () => {
    expect(frontendWorkspaceViewSource).toContain(
      'const workspaceRuntimeReady = computed(',
    )
    expect(frontendWorkspaceViewSource).toContain(
      ':disabled="!runBusy && !workspaceRuntimeReady"',
    )
    expect(frontendWorkspaceViewSource).toContain('readWorkspaceResourceIndexWithRetry')
    expect(frontendWorkspaceViewSource).toContain('Workspace Is Still Starting')
  })

  it('renders live frontend subflow progress with the shared status strip', () => {
    expect(frontendWorkspaceViewSource).toContain('useSubflow()')
    expect(frontendWorkspaceViewSource).toContain('<FlowStatusStrip')
    expect(frontendWorkspaceViewSource).toContain(':nodes="frontendSubflowNodes"')
  })

  it('keeps live parent step state ahead of a delayed resource refresh', () => {
    expect(frontendWorkspaceViewSource).toContain(
      'const liveRuntimeStepOverrides = new Map',
    )
    expect(frontendWorkspaceViewSource).toContain('runtimeProtocolType')
    expect(frontendWorkspaceViewSource).toContain("protocolType === 'step.started'")
    expect(frontendWorkspaceViewSource).toContain("protocolType === 'step.completed'")
    expect(frontendWorkspaceViewSource).toContain('watch(runtimeEvents')
    expect(frontendWorkspaceViewSource).toContain(
      'runJobId.value && eventOperationId && eventOperationId !== runJobId.value',
    )
    expect(frontendWorkspaceViewSource).toContain(
      '...liveRuntimeStepOverrides.get(step.name.trim().toLowerCase())',
    )
  })
})
