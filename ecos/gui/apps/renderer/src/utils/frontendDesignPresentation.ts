import type { ConfigData } from '@/composables/useParameters'
import type { FrontendDesignKind } from '@ecos-studio/shared'

/** Prepare reports list generic RTL inputs separately from generated artifacts. */
export function preparedFrontendSourceItems(
  report: {
    inputs?: { rtl_sources?: Array<{ path?: string; ownership?: string }> }
  } | null,
  kind: FrontendDesignKind,
): Array<{ label: string; path: string }> {
  const owner = kind === 'generic_rtl' ? 'design' : 'cpu'
  return (report?.inputs?.rtl_sources ?? []).flatMap((source) => {
    const path = source?.path
    if (
      typeof path !== 'string' ||
      !/\.(v|sv|vh|svh)$/i.test(path) ||
      source.ownership !== owner
    )
      return []
    return [{ label: path.replace(/\\/g, '/').split('/').pop() || path, path }]
  })
}

export function genericRtlConfigItems(config: ConfigData, workspaceName?: string) {
  return [
    { label: 'Design', value: config.design || workspaceName || '--', highlight: true },
    { label: 'Design Type', value: 'General RTL' },
    { label: 'Top Module', value: config.topModule || '--' },
    { label: 'Clock', value: config.clock || 'Not specified' },
    { label: 'Target Frequency', value: `${config.frequencyMax} MHz` },
    { label: 'RTL Filelist', value: config.frontend.inputFilelist || '--', wide: true },
    { label: 'Flow', value: 'Prepare → RTL Review → Elaboration → Lint', wide: true },
  ]
}

export const genericRtlGuideItems = [
  {
    icon: 'ri-code-box-line',
    title: 'Design sources',
    text: 'Open Src to inspect and edit the selected RTL files.',
  },
  {
    icon: 'ri-flow-chart',
    title: 'RTL checks',
    text: 'Run Prepare, RTL Review, Elaboration, and Lint to check the design.',
  },
  {
    icon: 'ri-bug-line',
    title: 'Diagnostics',
    text: 'Use Problems and the Review/Lint results to locate issues, then rerun the affected steps.',
  },
]
