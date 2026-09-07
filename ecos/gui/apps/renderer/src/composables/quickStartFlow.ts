import type {
  DesktopApi,
  EccRuntimeOperation,
  EccRuntimeProtocolEvent,
} from '@ecos-studio/shared'

export interface QuickStartFlowResult {
  workspacePath: string
  operationId: string
  state: 'succeeded' | 'failed' | 'cancelled'
  error?: string
}

const STAGES: Record<string, [string, string]> = {
  Synthesis: ['逻辑综合', '将 RTL 转换为标准单元网表'],
  lec: ['逻辑等价检查', '检查综合前后逻辑的一致性'],
  Floorplan: ['布局规划', '确定芯片和核心区域，安排引脚及宏单元位置'],
  place: ['全局布局', '安排标准单元位置，兼顾线长、密度和拥塞'],
  CTS: ['时钟树综合', '构建时钟分配网络，控制时钟偏斜和延迟'],
  legalization: ['布局合法化', '消除单元重叠，并将单元对齐到合法位置'],
  'Timing optimization': [
    '时序优化',
    '调整单元尺寸以改善时序，并对调整后的布局进行合法化',
  ],
  route: ['布线', '为网表连接分配金属走线和过孔'],
  postRouteLec: ['布线后逻辑等价检查', '检查布线后的网表逻辑一致性'],
  drc: ['设计规则检查', '检查版图是否违反工艺设计规则'],
  lvs: ['版图与网表一致性检查', '检查版图连接与设计网表是否一致'],
  filler: ['填充单元插入', '填补布局空隙，维持电源轨和阱的连续性'],
  RCX: ['寄生参数提取', '提取布线的寄生电阻和电容，供时序分析使用'],
  sta: ['静态时序分析', '结合时钟约束和寄生参数，检查 setup 与 hold 等时序指标'],
  Harden: ['最终结果生成', '整理设计输出并生成 GDS 等交付文件'],
}

function stageNarration(event: EccRuntimeProtocolEvent): string | null {
  const step = event.event.payload.step
  if (typeof step !== 'string' || !step) return null
  const description = STAGES[step]
  const label = description ? `${step}（${description[0]}）` : step
  if (event.event.type === 'step.started') {
    return description ? `正在进行 ${label}：${description[1]}。` : `正在执行 ${label}。`
  }
  if (event.event.type !== 'step.completed') return null
  const state = String(event.event.payload.state).toLowerCase()
  if (state === 'skipped') return `${label}复用已有结果，本次未重新执行。`
  return state === 'success' ? `${label}执行完成。` : `${label}未成功完成。`
}

export async function runQuickStartFlow(options: {
  api: DesktopApi
  workspaceHandle: string
  workspacePath: string
  start: () => Promise<EccRuntimeOperation | null>
  onStarted: (operation: EccRuntimeOperation) => Promise<void>
  narrate: (message: string) => void
  signal?: AbortSignal
}): Promise<QuickStartFlowResult> {
  const { api, workspaceHandle, workspacePath, narrate } = options
  const runtime = api.ecc.runtime
  if (!runtime) throw new Error('ECC runtime operation API is unavailable.')
  options.signal?.throwIfAborted()
  const normalizedPath = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')
  let operationId = ''
  const earlyEvents: EccRuntimeProtocolEvent[] = []
  const seen = new Set<string>()
  const cancel = () => {
    void runtime.cancel({ workspaceHandle, operationId }).catch((error: unknown) => {
      narrate(
        `停止请求未成功，仍在等待流程终态：${error instanceof Error ? error.message : String(error)}`,
      )
    })
  }
  const report = (event: EccRuntimeProtocolEvent) => {
    if (event.event.operationId !== operationId) return
    const key = `${event.event.runtimeInstanceId ?? ''}:${event.event.eventId}`
    if (seen.has(key)) return
    seen.add(key)
    const message = stageNarration(event)
    if (message) narrate(message)
  }
  // Subscribe before launch: a fast stage can finish before startFlow returns.
  const unsubscribe = api.runtime.events.onEvent((event) => {
    if (event.designTool !== 'backend' || event.type !== 'runtime.protocol') return
    if (
      !event.workspaceDirectory ||
      normalizedPath(event.workspaceDirectory) !== normalizedPath(workspacePath)
    )
      return
    if (event.event.type !== 'step.started' && event.event.type !== 'step.completed')
      return
    if (operationId) report(event)
    else earlyEvents.push(event)
  })
  try {
    const operation = await options.start()
    if (!operation) throw new Error('Run All Flow did not start.')
    operationId = operation.operationId
    earlyEvents.forEach(report)
    earlyEvents.length = 0
    await options.onStarted(operation)
    options.signal?.addEventListener('abort', cancel, { once: true })
    if (options.signal?.aborted) cancel()
    const terminal = await runtime.waitForOperation({ workspaceHandle, operationId })
    if (
      terminal.operationId !== operationId ||
      !['succeeded', 'failed', 'cancelled'].includes(terminal.state)
    ) {
      throw new Error('Quick Start did not receive matching terminal execution evidence.')
    }
    return {
      workspacePath,
      operationId,
      state: terminal.state as QuickStartFlowResult['state'],
      ...(terminal.error?.message ? { error: terminal.error.message } : {}),
    }
  } finally {
    options.signal?.removeEventListener('abort', cancel)
    unsubscribe()
  }
}
