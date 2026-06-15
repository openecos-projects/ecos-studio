<template>
  <div class="frontend-workspace">
    <div class="frontend-header">
      <div>
        <p class="frontend-kicker">{{ isHomeView ? 'Frontend Workspace' : 'Frontend Flow' }}</p>
        <h1>{{ stepTitle }}</h1>
      </div>
      <div v-if="!isHomeView" class="header-actions">
        <button
          v-if="!isSimStep"
          type="button"
          class="run-btn"
          :class="{ danger: runBusy }"
          @click="runBusy ? cancelCurrentRun() : runCurrentStep()"
        >
          <i :class="runBusy ? 'ri-stop-circle-line' : 'ri-play-circle-line'"></i>
          {{ runBusy ? 'Cancel' : 'Run' }}
        </button>
        <button type="button" class="refresh-btn" :disabled="loading" @click="refresh">
          <i :class="loading ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'"></i>
        </button>
      </div>
    </div>

    <div v-if="error" class="state-panel error">
      <i class="ri-error-warning-line"></i>
      <span>{{ error }}</span>
    </div>

    <div v-else class="frontend-grid">
      <section class="panel detail-panel detail-panel-full">
        <div class="panel-header">
          <h2>{{ isHomeView ? 'Workspace Summary' : 'Step Detail' }}</h2>
          <span>{{ isHomeView ? 'frontend' : currentStep?.tool || '--' }}</span>
        </div>

        <div v-if="isHomeView" class="detail-content">
          <section class="summary-grid">
            <div class="summary-tile">
              <span>Workspace</span>
              <strong :title="currentProject?.name || ''">{{ currentProject?.name || 'Frontend Workspace' }}</strong>
            </div>
            <div class="summary-tile">
              <span>Flow Steps</span>
              <strong>{{ steps.length }}</strong>
            </div>
            <div class="summary-tile">
              <span>Completed</span>
              <strong>{{ completedCount }}/{{ steps.length }}</strong>
            </div>
            <div class="summary-tile" :class="nextPendingStep ? stateClass(nextPendingStep.state) : ''">
              <span>Next Step</span>
              <strong>{{ nextPendingStep ? labelForStep(nextPendingStep.name) : 'Complete' }}</strong>
            </div>
          </section>

          <section class="frontend-config-card">
            <div class="frontend-config-card__head">
              <div>
                <strong>Frontend Configuration</strong>
                <span>Read-only selections from this workspace.</span>
              </div>
              <span class="frontend-config-card__badge">Read only</span>
            </div>
            <div class="frontend-config-grid">
              <div
                v-for="item in frontendConfigItems"
                :key="item.label"
                class="frontend-config-item"
                :class="{ wide: item.wide }"
              >
                <span>{{ item.label }}</span>
                <strong
                  :title="item.value"
                  :class="{ mono: item.mono, highlight: item.highlight }"
                >
                  {{ item.value }}
                </strong>
              </div>
            </div>
          </section>

          <section class="workspace-home-card">
            <div class="workspace-home-card__head">
              <strong>Workspace Home</strong>
              <span>Choose a step from the left sidebar to inspect logs, artifacts, source, and waveforms.</span>
            </div>
            <div class="workspace-home-card__body">
              <div class="workspace-home-metric">
                <span>Current Status</span>
                <strong>{{ currentOverallState }}</strong>
              </div>
              <div class="workspace-home-metric">
                <span>Latest Tool</span>
                <strong>{{ latestActiveTool }}</strong>
              </div>
              <div class="workspace-home-metric">
                <span>Simulation</span>
                <strong>{{ simStepState }}</strong>
              </div>
            </div>
          </section>
        </div>

        <div v-else-if="!currentStep" class="state-panel">
          <i class="ri-file-list-3-line"></i>
          <span>No flow step selected.</span>
        </div>

        <div v-else class="detail-content">
          <section class="summary-grid">
            <div class="summary-tile status" :class="stateClass(currentStepDisplayState)">
              <span>Status</span>
              <strong>{{ currentStepDisplayState }}</strong>
            </div>
            <div class="summary-tile">
              <span>Runtime</span>
              <strong>{{ currentStepRuntime }}</strong>
            </div>
            <div class="summary-tile">
              <span>Tool</span>
              <strong>{{ detail?.tool || currentStep.tool || 'frontend' }}</strong>
            </div>
            <div v-if="isSimStep" class="summary-tile">
              <span>Cases</span>
              <strong>{{ passedCases }}/{{ totalCases }}</strong>
            </div>
          </section>

          <section v-if="isSimStep" class="sim-run-card">
            <div class="sim-run-head">
              <div class="suite-row">
                <button
                  type="button"
                  class="suite-pill"
                  :class="{ active: simSuite === 'cpu_tests' }"
                  :disabled="runBusy"
                  @click="simSuite = 'cpu_tests'"
                >
                  <i class="ri-cpu-line"></i>
                  CPU Tests
                </button>
                <button
                  type="button"
                  class="suite-pill"
                  :class="{ active: simSuite === 'rtthread' }"
                  :disabled="runBusy"
                  @click="simSuite = 'rtthread'"
                >
                  <i class="ri-terminal-box-line"></i>
                  RT-Thread
                </button>
                <div v-if="simSuite === 'cpu_tests'" class="mode-segment">
                  <button type="button" :disabled="runBusy" :class="{ active: simCpuMode === 'selected' }" @click="simCpuMode = 'selected'">
                    Selected
                  </button>
                  <button type="button" :disabled="runBusy" :class="{ active: simCpuMode === 'all' }" @click="simCpuMode = 'all'">
                    All
                  </button>
                </div>
              </div>
              <button
                type="button"
                class="run-btn sim-run-action"
                :class="{ running: runBusy }"
                @click="runBusy ? cancelCurrentRun() : runCurrentStep()"
              >
                <i :class="runBusy ? 'ri-stop-circle-line' : 'ri-play-circle-line'"></i>
                {{ runBusy ? `Cancel ${runningSimSuiteLabel}` : `Run ${simSuiteLabel}` }}
              </button>
            </div>
            <div v-if="simSuite === 'cpu_tests' && simCpuMode === 'selected'" class="case-picker">
              <button
                v-for="name in availableCpuTests"
                :key="name"
                type="button"
                class="case-chip"
                :class="{ active: selectedCpuCases.includes(name) }"
                @click="toggleCpuCase(name)"
              >
                {{ name }}
              </button>
            </div>
          </section>

          <div class="frontend-step-tabs">
            <button
              v-for="tab in visibleTabs"
              :key="tab.id"
              type="button"
              class="frontend-step-tab"
              :class="{ active: activeTab === tab.id }"
              @click="activeTab = tab.id"
            >
              <i :class="tab.icon"></i>
              <span>{{ tab.label }}</span>
            </button>
          </div>

          <main class="tab-content">
            <section v-if="activeTab === 'summary'" class="text-panel">
              <pre>{{ formattedSummary }}</pre>
            </section>

            <section v-else-if="activeTab === 'cases'" class="cases-panel">
              <div v-if="cases.length === 0" class="empty-panel">
                <i class="ri-file-list-3-line"></i>
                <span>No simulation case result yet.</span>
              </div>
              <div v-else class="cases-table-wrap">
                <table class="cases-table">
                  <thead>
                    <tr>
                      <th>Case</th>
                      <th>Status</th>
                      <th>RC</th>
                      <th>Wave</th>
                      <th>Image</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="testCase in cases"
                      :key="testCase.name"
                      :class="{ selected: selectedCase?.name === testCase.name, failed: !testCase.ok }"
                      @click="selectCase(testCase)"
                    >
                      <td>
                        <div class="case-name">
                          <i :class="testCase.ok ? 'ri-checkbox-circle-line' : 'ri-close-circle-line'"></i>
                          <span>
                            <strong>{{ testCase.name }}</strong>
                            <small v-if="caseIssue(testCase)" :title="caseIssue(testCase)">
                              {{ caseIssue(testCase) }}
                            </small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <span class="case-status" :class="testCase.ok ? 'ok' : 'failed'">
                          {{ testCase.ok ? 'PASS' : 'FAIL' }}
                        </span>
                      </td>
                      <td>{{ testCase.returncode ?? '-' }}</td>
                      <td>
                        <button
                          v-if="testCase.wave"
                          type="button"
                          class="path-pill path-button"
                          :title="testCase.wave"
                          @click.stop="openWaveform(testCase.wave, testCase.name)"
                        >
                          <i class="ri-pulse-line"></i>
                          {{ fileName(testCase.wave) }}
                        </button>
                        <span v-else class="path-pill">-</span>
                      </td>
                      <td>
                        <span class="path-pill" :title="testCase.image || ''">
                          {{ testCase.image ? fileName(testCase.image) : '-' }}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section v-else-if="activeTab === 'log'" class="log-panel">
              <div class="panel-tools">
                <select v-model="selectedLogPath" class="log-select" @change="loadSelectedLog">
                  <option v-for="log in availableLogs" :key="log.path" :value="log.path">
                    {{ log.label }}
                  </option>
                </select>
                <button type="button" class="icon-action" :disabled="logLoading || !selectedLogPath" @click="loadSelectedLog">
                  <i :class="logLoading ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'"></i>
                </button>
              </div>
              <pre class="log-viewer">{{ logContent || 'No log content.' }}</pre>
            </section>

            <section v-else-if="activeTab === 'reports'" class="files-panel">
              <ResourceFileList :items="reports" empty-label="No reports yet." @select="selectTextFile" />
            </section>

            <section v-else-if="activeTab === 'artifacts'" class="files-panel">
              <ResourceFileList :items="artifacts" empty-label="No artifacts yet." @select="handleArtifactClick" />
            </section>

            <section v-else-if="activeTab === 'src'" class="source-layout">
              <aside class="source-list">
                <div class="source-list-head">
                  <strong>Source</strong>
                  <span>{{ sourceArtifacts.length }} files</span>
                </div>
                <button
                  v-for="item in sourceArtifacts"
                  :key="item.path"
                  type="button"
                  class="source-row"
                  :class="{ active: activeSource?.path === item.path }"
                  :title="item.path"
                  @click="openSource(item)"
                >
                  <i :class="fileIcon(item.path)"></i>
                  <span>
                    <strong>{{ sourceDisplayName(item) }}</strong>
                    <small>{{ shortPath(item.path) }}</small>
                  </span>
                </button>
                <div v-if="sourceArtifacts.length === 0" class="empty-panel compact">
                  <i class="ri-code-s-slash-line"></i>
                  <span>No source files discovered.</span>
                </div>
              </aside>
              <FrontendSourceEditor :source="activeSource" @saved="refresh" @linted="refresh" />
            </section>

            <section v-else-if="activeTab === 'wave'" class="wave-panel">
              <div class="wave-header">
                <div class="wave-title">
                  <i class="ri-pulse-line"></i>
                  <div>
                    <strong>{{ activeWaveform?.caseName || fileName(activeWaveform?.path || '') || 'Waveform' }}</strong>
                    <span :title="activeWaveform?.path || ''">{{ activeWaveform?.path || 'Select a VCD/FST/GHW artifact.' }}</span>
                  </div>
                </div>
                <button
                  type="button"
                  class="text-action"
                  :disabled="!activeWaveform"
                  @click="activeWaveform && openWaveExternal(activeWaveform.path)"
                >
                  <i class="ri-external-link-line"></i>
                  Open
                </button>
              </div>
              <div v-if="!activeWaveform" class="empty-panel">
                <i class="ri-pulse-line"></i>
                <span>Select a VCD/FST/GHW artifact.</span>
              </div>
              <div v-else class="surfer-shell">
                <iframe
                  ref="surferFrame"
                  class="surfer-frame"
                  title="Surfer waveform viewer"
                  :src="surferViewerUrl"
                  @load="handleSurferFrameLoad"
                ></iframe>
                <div v-if="waveStatusMessage" class="wave-status" :class="{ error: waveformError }">
                  <i :class="waveformError ? 'ri-error-warning-line' : 'ri-loader-4-line animate-spin'"></i>
                  <span>{{ waveStatusMessage }}</span>
                </div>
              </div>
            </section>
          </main>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { DesktopCliCommandEvent, WorkspaceStepResource } from '@ecos-studio/shared'
import { getWorkspaceResourceIndexApi } from '@/api/workspaceResources'
import { CMDEnum, InfoEnum, ResponseEnum, StateEnum, getStepMetadata } from '@/api/type'
import { getInfoApi, runStepApi } from '@/api/flow'
import { useWorkspace } from '@/composables/useWorkspace'
import { useParameters } from '@/composables/useParameters'
import { readOptionalProjectTextFileTail } from '@/utils/projectFiles'
import { getDesktopApi } from '@/platform/desktop'
import FrontendSourceEditor from '@/components/FrontendSourceEditor.vue'

interface PathItem {
  label: string
  path: string
}

interface SimCase {
  name: string
  ok: boolean
  suite?: string
  returncode?: number
  image?: string
  log?: string
  report_log?: string
  run_log?: string
  wave?: string
  run_id?: string
  validation?: {
    type?: string
    required_markers?: string[]
    missing_markers?: string[]
  }
}

interface FrontendStepDetail {
  step: string
  tool: string
  state: string
  runtime: string
  peak_memory_mb?: number
  summary: Record<string, unknown>
  cases?: SimCase[]
  logs: PathItem[]
  reports: PathItem[]
  artifacts: PathItem[]
}

interface WaveSelection {
  path: string
  caseName?: string
}

interface FrontendSourceSelection {
  label: string
  path: string
}

interface FrontendConfigItem {
  label: string
  value: string
  mono?: boolean
  highlight?: boolean
  wide?: boolean
}

type TabId = 'summary' | 'cases' | 'log' | 'reports' | 'artifacts' | 'src' | 'wave'

const route = useRoute()
const {
  currentProject,
  resourceVersions,
  showToast,
  invalidateWorkspaceResources,
} = useWorkspace()
const { config } = useParameters()
const steps = ref<WorkspaceStepResource[]>([])
const loading = ref(false)
const runBusy = ref(false)
const runJobId = ref('')
const logLoading = ref(false)
const error = ref('')
const detail = ref<FrontendStepDetail | null>(null)
const activeTab = ref<TabId>('summary')
const selectedCase = ref<SimCase | null>(null)
const selectedLogPath = ref('')
const logContent = ref('')
const activeSource = ref<FrontendSourceSelection | null>(null)
const activeWaveform = ref<WaveSelection | null>(null)
const simSuite = ref<'cpu_tests' | 'rtthread'>('cpu_tests')
const runningSimSuite = ref<'cpu_tests' | 'rtthread' | null>(null)
const simCpuMode = ref<'all' | 'selected'>('selected')
const selectedCpuCases = ref<string[]>([])
const surferFrame = ref<HTMLIFrameElement | null>(null)
const surferReady = ref(false)
const waveformLoading = ref(false)
const waveformError = ref('')
let waveformLoadToken = 0
let unsubscribeCliEvents: (() => void) | null = null

const isHomeView = computed(() => route.path.endsWith('/home'))
const currentStepName = computed(() => {
  const param = String(route.params.step || '')
  return param && param !== 'home' ? param : ''
})
const currentStep = computed(() =>
  steps.value.find((step) => step.name.toLowerCase() === currentStepName.value.toLowerCase()) ?? null,
)
const isSimStep = computed(() => currentStepName.value.toLowerCase() === 'sim')
const completedCount = computed(() => steps.value.filter((step) => step.state === 'Success').length)
const nextPendingStep = computed(() =>
  steps.value.find((step) => step.state !== 'Success') ?? null,
)
const stepTitle = computed(() => {
  if (isHomeView.value) {
    return currentProject.value?.name || 'Frontend Workspace'
  }
  return labelForStep(currentStepName.value || 'Step')
})
const currentOverallState = computed(() => {
  if (steps.value.some((step) => step.state === 'Ongoing')) return 'Running'
  if (steps.value.some((step) => step.state === 'Invalid' || step.state === 'Incomplete')) return 'Attention Needed'
  if (steps.value.length > 0 && steps.value.every((step) => step.state === 'Success')) return 'Complete'
  return 'Ready'
})
const latestActiveTool = computed(() => nextPendingStep.value?.tool || steps.value.at(-1)?.tool || 'frontend')
const simStepState = computed(() => {
  const simStep = steps.value.find((step) => step.name.toLowerCase() === 'sim')
  return simStep?.state || 'Unstart'
})
const currentStepDisplayState = computed(() =>
  runBusy.value && currentStep.value ? 'Ongoing' : detail.value?.state || currentStep.value?.state || 'Unstart',
)
const currentStepRuntime = computed(() =>
  runBusy.value ? 'Running' : detail.value?.runtime || currentStep.value?.runtime || '--',
)
const simSuiteLabel = computed(() => simSuiteLabelFor(simSuite.value))
const runningSimSuiteLabel = computed(() => simSuiteLabelFor(runningSimSuite.value || simSuite.value))
const cases = computed(() => detail.value?.cases || [])
const totalCases = computed(() => cases.value.length)
const passedCases = computed(() => cases.value.filter((testCase) => testCase.ok).length)
const frontendConfigItems = computed<FrontendConfigItem[]>(() => [
  { label: 'Design', value: config.design || currentProject.value?.name || '--', highlight: true },
  { label: 'Top Module', value: config.topModule || '--', mono: true },
  {
    label: 'CPU Source',
    value: displayCatalogId(config.frontend.coreId || (config.frontend.cpuFilelist ? 'custom-filelist' : '')),
  },
  {
    label: 'CPU Wrapper',
    value: displayCatalogId(config.frontend.cpuWrapperTop || config.frontend.cpuWrapperContract || ''),
    mono: true,
  },
  {
    label: 'CPU Socket',
    value: displayCatalogId(config.frontend.cpuSocketContract || ''),
    mono: true,
  },
  {
    label: 'SoC Harness',
    value: displayCatalogId(config.frontend.socHarnessId || config.frontend.socVariant || ''),
  },
  { label: 'Toolchain', value: displayCatalogId(config.frontend.toolchainId || '') },
  { label: 'Test Suite', value: displayCatalogId(config.frontend.testSuiteId || '') },
  { label: 'Clock', value: config.clock || '--' },
  { label: 'Target Frequency', value: config.frequencyMax ? `${config.frequencyMax} MHz` : '--' },
  {
    label: 'CPU Filelist',
    value: config.frontend.cpuFilelist || config.frontend.inputFilelist || '--',
    mono: true,
    wide: true,
  },
  {
    label: 'Default Cases',
    value: config.frontend.simAllTests
      ? 'All CPU tests'
      : config.frontend.simProgramNames.length
        ? config.frontend.simProgramNames.join(', ')
        : '--',
    mono: true,
    wide: true,
  },
])
const availableCpuTests = computed(() => {
  const raw = detail.value?.summary?.available_cpu_tests
  return Array.isArray(raw) ? raw.map((item) => String(item)).filter(Boolean) : []
})
const defaultCpuTests = computed(() => {
  const raw = detail.value?.summary?.default_cpu_tests
  return Array.isArray(raw) ? raw.map((item) => String(item)).filter(Boolean) : []
})
const reports = computed(() => detail.value?.reports || [])
const allArtifacts = computed(() => {
  const fromCases = cases.value.flatMap((testCase) => [
    testCase.wave ? { label: `${testCase.name} wave`, path: testCase.wave } : null,
    testCase.image ? { label: `${testCase.name} image`, path: testCase.image } : null,
    testCase.log ? { label: `${testCase.name} log`, path: testCase.log } : null,
  ]).filter(Boolean) as PathItem[]
  return uniquePathItems([...(detail.value?.artifacts || []), ...fromCases])
})
const sourceArtifacts = computed(() => allArtifacts.value.filter((item) => isSourceArtifactPath(item.path)))
const artifacts = computed(() => allArtifacts.value.filter((item) => !isSourceArtifactPath(item.path)))
const availableLogs = computed(() => {
  const logs = [...(detail.value?.logs || [])]
  const selected = selectedCase.value
  if (!selected) return logs
  const caseLogs = [
    selected.log ? { label: `${selected.name} log`, path: selected.log } : null,
    selected.report_log ? { label: `${selected.name} report log`, path: selected.report_log } : null,
    selected.run_log ? { label: `${selected.name} run log`, path: selected.run_log } : null,
  ].filter(Boolean) as PathItem[]
  return uniquePathItems([...caseLogs, ...logs])
})
const formattedSummary = computed(() => JSON.stringify(detail.value?.summary || {}, null, 2))
const visibleTabs = computed(() => [
  { id: 'summary' as const, label: 'Summary', icon: 'ri-dashboard-3-line' },
  ...(isSimStep.value ? [{ id: 'cases' as const, label: 'Cases', icon: 'ri-list-check-3' }] : []),
  { id: 'log' as const, label: 'Log', icon: 'ri-terminal-box-line' },
  { id: 'reports' as const, label: 'Reports', icon: 'ri-file-chart-line' },
  { id: 'artifacts' as const, label: 'Artifacts', icon: 'ri-folder-3-line' },
  { id: 'src' as const, label: 'Src', icon: 'ri-code-s-slash-line' },
  { id: 'wave' as const, label: 'Wave', icon: 'ri-pulse-line' },
])
const surferViewerUrl = 'ecos-surfer://viewer/'
const waveStatusMessage = computed(() => {
  if (waveformError.value) return waveformError.value
  if (!activeWaveform.value) return ''
  if (!surferReady.value || waveformLoading.value) return 'Loading Surfer waveform viewer...'
  return ''
})

async function refresh(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const index = await getWorkspaceResourceIndexApi()
    steps.value = index.flow.steps
    if (!isHomeView.value) {
      await loadDetail()
    } else {
      detail.value = null
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    steps.value = []
    detail.value = null
  } finally {
    loading.value = false
  }
}

async function loadDetail(): Promise<void> {
  if (!currentStepName.value) return
  try {
    const response = await getInfoApi({
      cmd: CMDEnum.get_info,
      data: {
        designTool: 'frontend',
        directory: currentProject.value?.path,
        step: currentStepName.value,
        id: InfoEnum.frontend_detail,
      },
    })
    if (response.response !== ResponseEnum.success) {
      throw new Error(response.message?.join(', ') || 'Failed to load frontend detail')
    }
    detail.value = response.data.info as FrontendStepDetail
    selectedCase.value = cases.value[0] || null
    selectedLogPath.value = preferredLogPath()
    syncDefaultCpuSelection()
    if (!activeSource.value && sourceArtifacts.value.length) {
      activeSource.value = toSourceSelection(sourceArtifacts.value[0])
    }
    await loadSelectedLog()
  } catch (err) {
    detail.value = null
    logContent.value = err instanceof Error ? err.message : String(err)
  }
}

async function loadSelectedLog(): Promise<void> {
  logContent.value = ''
  if (!selectedLogPath.value) return
  logLoading.value = true
  try {
    const content = await readOptionalProjectTextFileTail(selectedLogPath.value, 300_000, {
      projectPath: currentProject.value?.path,
    })
    logContent.value = content?.content || 'No readable log content.'
  } catch (err) {
    logContent.value = err instanceof Error ? err.message : String(err)
  } finally {
    logLoading.value = false
  }
}

async function runCurrentStep(suiteOverride?: 'cpu_tests' | 'rtthread'): Promise<void> {
  if (!currentProject.value?.path || !currentStepName.value) return
  runBusy.value = true
  runningSimSuite.value = isSimStep.value ? suiteOverride || simSuite.value : null
  runJobId.value = ''
  try {
    const payload = simRunPayload(suiteOverride)
    const response = await runStepApi({
      cmd: CMDEnum.run_step,
      data: {
        designTool: 'frontend',
        directory: currentProject.value.path,
        step: currentStepName.value,
        rerun: true,
        ...payload,
      },
    })
    invalidateWorkspaceResources(['flow', 'step', 'logs'])
    await refresh()
    showToast({
      severity: response.data?.state === StateEnum.Success ? 'success' : 'error',
      summary: response.data?.state === StateEnum.Success ? 'Step Completed' : 'Step Failed',
      detail: response.data?.state === StateEnum.Success
        ? currentStepName.value
        : runFailureDetail(response.message, currentStepName.value),
      life: 4000,
    })
  } catch (err) {
    showToast({
      severity: 'error',
      summary: 'Run Failed',
      detail: err instanceof Error ? err.message : runFailureDetail([], currentStepName.value),
      life: 6000,
    })
  } finally {
    runBusy.value = false
    runningSimSuite.value = null
    runJobId.value = ''
  }
}

async function cancelCurrentRun(): Promise<void> {
  const jobId = runJobId.value
  if (!jobId) {
    showToast({
      severity: 'warn',
      summary: 'Cancel Pending',
      detail: 'The runtime job is still starting.',
      life: 2500,
    })
    return
  }
  try {
    const response = await getDesktopApi().cli.cancel(jobId)
    invalidateWorkspaceResources(['flow', 'step', 'logs'])
    window.setTimeout(() => {
      void refresh()
    }, 400)
    showToast({
      severity: response.response === 'cancelled' ? 'warn' : 'info',
      summary: response.response === 'cancelled' ? 'Run Cancelled' : 'Cancel Request',
      detail: currentStepName.value,
      life: 3500,
    })
  } catch {
    showToast({
      severity: 'error',
      summary: 'Cancel Failed',
      detail: 'Unable to stop the current CLI job.',
      life: 5000,
    })
  }
}

function handleCliEvent(event: DesktopCliCommandEvent): void {
  const projectPath = currentProject.value?.path
  if (!projectPath || !event.directory || normalizeWorkspacePath(event.directory) !== normalizeWorkspacePath(projectPath)) {
    return
  }
  if (event.cmd !== 'run_step' && event.cmd !== 'rtl2gds') return

  if (event.type === 'started') {
    runBusy.value = true
    runJobId.value = event.jobId
    runningSimSuite.value = runningSimSuite.value || (isSimStep.value ? simSuite.value : null)
    return
  }

  if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') {
    runBusy.value = false
    runningSimSuite.value = null
    runJobId.value = ''
    invalidateWorkspaceResources(['flow', 'step', 'logs'])
    void refresh()
  }
}

function normalizeWorkspacePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/')
  return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
}

function simRunPayload(suiteOverride?: 'cpu_tests' | 'rtthread') {
  if (!isSimStep.value) return {}
  const suite = suiteOverride || simSuite.value
  if (suite === 'rtthread') {
    return { sim_test_suite: 'rtthread' }
  }
  const selectedCases = selectedCpuCases.value.length
    ? selectedCpuCases.value
    : defaultCpuTests.value.length
      ? defaultCpuTests.value
      : availableCpuTests.value.slice(0, 1)
  return {
    sim_test_suite: 'cpu_tests',
    sim_cpu_test_mode: simCpuMode.value,
    sim_cpu_test_cases: simCpuMode.value === 'selected' ? selectedCases : [],
  }
}

function syncDefaultCpuSelection(): void {
  if (!isSimStep.value || selectedCpuCases.value.length) return
  const defaults = defaultCpuTests.value.length ? defaultCpuTests.value : availableCpuTests.value.slice(0, 1)
  selectedCpuCases.value = defaults
}

function toggleCpuCase(name: string): void {
  if (runBusy.value) return
  selectedCpuCases.value = selectedCpuCases.value.includes(name)
    ? selectedCpuCases.value.filter((item) => item !== name)
    : [...selectedCpuCases.value, name]
}

function simSuiteLabelFor(suite: 'cpu_tests' | 'rtthread'): string {
  return suite === 'rtthread' ? 'RT-Thread' : 'CPU Tests'
}

function displayCatalogId(value: string): string {
  if (!value) return '--'
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => part.toUpperCase() === part ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function preferredLogPath(): string {
  if (isSimStep.value && detail.value?.state !== StateEnum.Success) {
    const preferred = availableLogs.value.find((log) => log.label === 'Build programs log')
      || availableLogs.value.find((log) => log.label === 'Tool log')
    if (preferred) return preferred.path
  }
  return availableLogs.value[0]?.path || ''
}

function runFailureDetail(messages: string[] | undefined, step: string): string {
  const lines = (messages || []).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) {
    return step ? `${step} failed. Open Log for details.` : 'Open Log for details.'
  }
  return lines.slice(-4).join('\n')
}

function caseIssue(testCase: SimCase): string {
  const missing = testCase.validation?.missing_markers || []
  if (missing.length) {
    return `Missing markers: ${missing.join(', ')}`
  }
  if (!testCase.ok && testCase.returncode && testCase.returncode !== 0) {
    return `Return code ${testCase.returncode}`
  }
  return ''
}

function selectCase(testCase: SimCase): void {
  selectedCase.value = testCase
  activeTab.value = 'log'
  selectedLogPath.value = testCase.log || testCase.report_log || testCase.run_log || availableLogs.value[0]?.path || ''
  void loadSelectedLog()
}

function selectTextFile(item: PathItem): void {
  selectedLogPath.value = item.path
  activeTab.value = 'log'
  void loadSelectedLog()
}

function handleArtifactClick(item: PathItem): void {
  if (isWaveformPath(item.path)) {
    openWaveform(item.path, caseNameFromArtifactLabel(item.label))
    return
  }
  selectTextFile(item)
}

function openSource(item: PathItem): void {
  activeSource.value = toSourceSelection(item)
  activeTab.value = 'src'
}

function toSourceSelection(item: PathItem): FrontendSourceSelection {
  return {
    label: sourceDisplayName(item),
    path: item.path,
  }
}

function openWaveform(path: string, caseName?: string): void {
  activeWaveform.value = { path, caseName }
  activeTab.value = 'wave'
  waveformError.value = ''
  void loadCurrentWaveform()
}

async function openWaveExternal(path: string): Promise<void> {
  try {
    await getDesktopApi().system.openExternal(pathToFileUrl(path))
  } catch {
    showToast({
      severity: 'error',
      summary: 'Open Waveform Failed',
      detail: 'Unable to open waveform in external viewer.',
      life: 5000,
    })
  }
}

function pathToFileUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `file://${normalized.split('/').map(encodeURIComponent).join('/')}`
}

function handleSurferFrameLoad(): void {
  waveformError.value = ''
  void loadCurrentWaveform()
}

function handleSurferMessage(event: MessageEvent): void {
  if (event.source !== surferFrame.value?.contentWindow) return
  const data = event.data as { source?: string; command?: string; message?: string }
  if (data?.source !== 'ecos-surfer') return

  if (data.command === 'SurferReady') {
    surferReady.value = true
    void loadCurrentWaveform()
    return
  }

  if (data.command === 'SurferError') {
    waveformLoading.value = false
    waveformError.value = data.message || 'Surfer viewer failed to initialize.'
  }
}

async function loadCurrentWaveform(): Promise<void> {
  const wave = activeWaveform.value
  const frame = surferFrame.value
  if (!wave || !frame?.contentWindow) return

  const token = ++waveformLoadToken
  waveformLoading.value = true
  waveformError.value = ''

  if (!surferReady.value) {
    window.setTimeout(() => {
      if (token === waveformLoadToken && !surferReady.value) {
        waveformLoading.value = false
        waveformError.value = 'Surfer viewer is not ready. Check network access to app.surfer-project.org.'
      }
    }, 12000)
    return
  }

  try {
    const waveformUrl = surferWaveformUrl(wave.path)
    const response = await fetch(waveformUrl, { method: 'HEAD' })
    if (token !== waveformLoadToken) return
    if (!response.ok) {
      throw new Error(`Cannot load waveform: ${response.status} ${response.statusText}`)
    }
    frame.contentWindow.postMessage({ command: 'LoadUrl', url: waveformUrl }, '*')
  } catch (err) {
    if (token === waveformLoadToken) {
      waveformError.value = err instanceof Error ? err.message : String(err)
    }
  } finally {
    if (token === waveformLoadToken) {
      waveformLoading.value = false
    }
  }
}

function surferWaveformUrl(path: string): string {
  const name = encodeURIComponent(fileName(path))
  return `ecos-surfer://viewer/waveform/${name}?path=${encodeURIComponent(path)}`
}

function labelForStep(step: string): string {
  return getStepMetadata(step)?.label || step
}

function stateClass(state: string): string {
  if (state === 'Success') return 'success'
  if (state === 'Ongoing') return 'running'
  if (state === 'Incomplete' || state === 'Invalid') return 'failed'
  return 'pending'
}

function fileName(path: string): string {
  return path.split('/').filter(Boolean).pop() || path
}

function shortPath(path: string): string {
  return path.split('/').filter(Boolean).slice(-4).join('/')
}

function sourceDisplayName(item: PathItem): string {
  const label = item.label || fileName(item.path)
  return label.startsWith('CPU RTL · ') ? label.slice('CPU RTL · '.length) : label
}

function fileIcon(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'json') return 'ri-braces-line'
  if (ext === 'vcd' || ext === 'fst' || ext === 'ghw') return 'ri-pulse-line'
  if (ext === 'bin' || ext === 'elf') return 'ri-cpu-line'
  if (ext === 'v' || ext === 'sv' || ext === 'vh' || ext === 'svh') return 'ri-code-s-slash-line'
  if (ext === 'f' || ext === 'fl' || ext === 'filelist') return 'ri-file-list-3-line'
  if (ext === 'rpt') return 'ri-file-chart-line'
  return 'ri-file-text-line'
}

function isSourceArtifactPath(path: string): boolean {
  return /\.(v|sv|vh|svh|c|cc|cpp|h|hpp|f|fl|filelist|py|sh|tcl|s|asm)$/i.test(path)
}

function isWaveformPath(path: string): boolean {
  return /\.(vcd|fst|ghw)$/i.test(path)
}

function caseNameFromArtifactLabel(label: string): string | undefined {
  return label.endsWith(' wave') ? label.slice(0, -5) : undefined
}

function uniquePathItems(items: PathItem[]): PathItem[] {
  const seen = new Set<string>()
  const result: PathItem[] = []
  for (const item of items) {
    const path = String(item.path || '').trim()
    if (!path || seen.has(path)) continue
    seen.add(path)
    result.push({ ...item, path })
  }
  return result
}

const ResourceFileList = defineComponent({
  props: {
    items: { type: Array as () => PathItem[], required: true },
    emptyLabel: { type: String, required: true },
  },
  emits: ['select'],
  setup(props, { emit }) {
    return () => props.items.length
      ? h('div', { class: 'file-list' }, props.items.map((item) =>
          h('button', {
            class: 'file-row',
            title: item.path,
            type: 'button',
            onClick: () => emit('select', item),
          }, [
            h('i', { class: fileIcon(item.path) }),
            h('span', { class: 'file-row-main' }, [
              h('strong', item.label || fileName(item.path)),
              h('small', shortPath(item.path)),
            ]),
            h('i', { class: 'ri-arrow-right-s-line' }),
          ]),
        ))
      : h('div', { class: 'empty-panel' }, [
          h('i', { class: 'ri-folder-open-line' }),
          h('span', props.emptyLabel),
        ])
  },
})

onMounted(refresh)
onMounted(() => {
  unsubscribeCliEvents = getDesktopApi().cli.onEvent(handleCliEvent)
  window.addEventListener('message', handleSurferMessage)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', handleSurferMessage)
  unsubscribeCliEvents?.()
  unsubscribeCliEvents = null
})

watch(
  () => [
    currentProject.value?.path,
    resourceVersions.value.flow,
    resourceVersions.value.step,
    resourceVersions.value.logs,
    resourceVersions.value.all,
  ],
  () => {
    void refresh()
  },
)

watch(currentStepName, () => {
  detail.value = null
  logContent.value = ''
  selectedCase.value = null
  selectedLogPath.value = ''
  activeTab.value = 'summary'
  activeSource.value = null
  if (!isHomeView.value) {
    void loadDetail()
  }
})

watch(activeTab, (tab) => {
  if (tab === 'wave') {
    void loadCurrentWaveform()
  }
})
</script>

<style scoped>
.frontend-workspace {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 18px;
  overflow: hidden;
  color: var(--text-primary);
  background: var(--bg-primary);
}

.frontend-header,
.header-actions,
.panel-header,
.step-title,
.step-meta,
.summary-grid,
.sim-run-head,
.suite-row,
.frontend-step-tabs,
.panel-tools,
.file-row,
.source-row,
.wave-header,
.wave-title,
.case-name,
.path-button {
  display: flex;
  min-width: 0;
}

.frontend-header {
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.frontend-kicker,
.panel-header span,
.step-meta,
.tool,
.summary-tile span,
.empty-panel,
.source-list-head span {
  color: var(--text-secondary);
}

.frontend-kicker {
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

h1,
h2 {
  margin: 0;
}

h1 {
  font-size: 22px;
  line-height: 1.2;
}

h2 {
  font-size: 13px;
}

.header-actions {
  align-items: center;
  gap: 8px;
}

.refresh-btn,
.run-btn,
.icon-action,
.suite-pill,
.mode-segment button,
.frontend-step-tab,
.case-chip,
.file-row,
.source-row,
.text-action {
  border: 0;
  color: var(--text-primary);
  cursor: pointer;
}

.refresh-btn,
.run-btn,
.icon-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 34px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.refresh-btn {
  width: 34px;
}

.run-btn {
  padding: 0 12px;
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.12);
  color: var(--accent-color);
  font-weight: 700;
}

.run-btn.running {
  color: #10b981;
  background: rgba(16, 185, 129, 0.14);
  border-color: rgba(16, 185, 129, 0.35);
  box-shadow: 0 10px 24px rgba(16, 185, 129, 0.16);
}

.run-btn.running:hover {
  background: rgba(16, 185, 129, 0.2);
}

.run-btn.danger {
  background: #b91c1c;
  box-shadow: 0 10px 24px rgba(185, 28, 28, 0.2);
}

.run-btn.danger:hover {
  background: #991b1b;
}

.run-btn.subtle {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.frontend-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
  min-height: 0;
  flex: 1;
}

.detail-panel-full {
  min-width: 0;
}

.panel,
.state-panel {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.panel-header {
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.success {
  color: #10b981;
}

.running {
  color: #10b981;
}

.failed {
  color: #ef4444;
}

.pending {
  color: var(--text-secondary);
}

.step-title span:first-child,
.file-row-main strong,
.file-row-main small,
.source-row strong,
.source-row small,
.wave-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool,
.log-viewer,
.text-panel pre {
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
}

.detail-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  flex: 1;
  padding: 14px;
}

.summary-grid {
  gap: 10px;
  flex-wrap: wrap;
}

.summary-tile {
  min-width: 130px;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.summary-tile span,
.summary-tile strong {
  display: block;
}

.summary-tile span {
  margin-bottom: 4px;
  font-size: 10px;
  text-transform: uppercase;
}

.frontend-config-card {
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.frontend-config-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-color);
}

.frontend-config-card__head div {
  min-width: 0;
}

.frontend-config-card__head div > strong,
.frontend-config-card__head div > span {
  display: block;
}

.frontend-config-card__head div > span {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.4;
}

.frontend-config-card__badge {
  flex-shrink: 0;
  padding: 4px 8px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}

.frontend-config-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  padding: 12px;
}

.frontend-config-item {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  cursor: default;
}

.frontend-config-item.wide {
  grid-column: span 2;
}

.frontend-config-item span,
.frontend-config-item strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.frontend-config-item span {
  margin-bottom: 6px;
  color: var(--text-secondary);
  font-size: 10px;
  text-transform: uppercase;
}

.frontend-config-item strong {
  font-size: 13px;
}

.frontend-config-item strong.mono {
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 12px;
}

.frontend-config-item strong.highlight {
  color: var(--accent-color);
}

.workspace-home-card {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  padding: 14px;
}

.workspace-home-card__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}

.workspace-home-card__head span {
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.5;
}

.workspace-home-card__body {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding-top: 14px;
}

.workspace-home-metric {
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.workspace-home-metric span,
.workspace-home-metric strong {
  display: block;
}

.workspace-home-metric span {
  color: var(--text-secondary);
  font-size: 10px;
  text-transform: uppercase;
}

.workspace-home-metric strong {
  margin-top: 6px;
  font-size: 15px;
}

.sim-run-card {
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.sim-run-head {
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.suite-row {
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.sim-run-action {
  min-width: 138px;
  flex-shrink: 0;
}

.suite-pill,
.mode-segment button,
.case-chip {
  border-radius: 7px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.suite-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border: 1px solid var(--border-color);
}

.suite-pill.active,
.mode-segment button.active,
.case-chip.active {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.13);
  color: var(--accent-color);
  border-color: rgba(var(--accent-rgb, 59, 130, 246), 0.28);
}

.mode-segment {
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
}

.mode-segment button {
  padding: 5px 8px;
}

.case-picker {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  max-height: 92px;
  overflow: auto;
  padding-top: 10px;
}

.case-chip {
  padding: 5px 8px;
  border: 1px solid var(--border-color);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
}

.frontend-step-tabs {
  align-items: center;
  gap: 5px;
  border-bottom: 1px solid var(--border-color);
}

.frontend-step-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 10px;
  border-radius: 7px 7px 0 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
}

.frontend-step-tab.active {
  color: var(--accent-color);
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.09);
  box-shadow: inset 0 -2px 0 var(--accent-color);
}

.tab-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.text-panel,
.log-panel,
.files-panel,
.cases-panel,
.source-layout,
.wave-panel {
  height: 100%;
  min-height: 0;
}

.text-panel pre,
.log-viewer {
  height: 100%;
  margin: 0;
  padding: 12px;
  overflow: auto;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 11px;
  line-height: 1.5;
}

.panel-tools {
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.log-select {
  min-width: 220px;
  max-width: 100%;
  height: 30px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.log-panel {
  display: flex;
  flex-direction: column;
}

.log-viewer {
  flex: 1;
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  height: 100%;
  overflow: auto;
}

.file-row {
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  text-align: left;
}

.file-row:hover,
.source-row:hover,
.source-row.active {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.08);
}

.file-row-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.file-row-main small,
.source-row small {
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
}

.source-layout {
  display: grid;
  grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
  gap: 10px;
}

.source-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.source-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 10px;
  border-bottom: 1px solid var(--border-color);
}

.source-row {
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  background: transparent;
  text-align: left;
}

.source-row span {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.cases-table-wrap {
  height: 100%;
  overflow: auto;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.cases-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.cases-table th,
.cases-table td {
  padding: 9px 10px;
  border-bottom: 1px solid var(--border-color);
  text-align: left;
}

.cases-table th {
  position: sticky;
  top: 0;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 10px;
  text-transform: uppercase;
}

.cases-table tr {
  cursor: pointer;
}

.cases-table tr.selected {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.08);
}

.case-name {
  align-items: center;
  gap: 7px;
}

.case-name span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.case-name strong,
.case-name small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-name small {
  max-width: 420px;
  color: #ef4444;
  font-size: 10px;
}

.case-status {
  display: inline-flex;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
}

.case-status.ok {
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
}

.case-status.failed {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

.path-pill {
  display: inline-flex;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
}

.path-button {
  align-items: center;
  gap: 5px;
  padding: 4px 7px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--bg-secondary);
  color: var(--accent-color);
}

.wave-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.wave-header {
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-width: 0;
  padding: 9px 10px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  flex-shrink: 0;
}

.wave-title {
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.wave-title > i {
  font-size: 18px;
  color: var(--accent-color);
}

.wave-title div {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.wave-title strong,
.wave-title span {
  display: block;
}

.wave-title span {
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
}

.surfer-shell {
  position: relative;
  flex: 1;
  width: 100%;
  min-height: 0;
  background: #111827;
}

.surfer-frame {
  width: 100%;
  height: 100%;
  border: 0;
  background: #111827;
}

.wave-status {
  position: absolute;
  inset: 12px auto auto 12px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: min(520px, calc(100% - 24px));
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 11px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.16);
}

.wave-status.error {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.35);
}

.text-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-radius: 7px;
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.1);
  color: var(--accent-color);
}

.empty-panel,
.state-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 120px;
  padding: 20px;
}

.empty-panel.compact {
  min-height: 80px;
  font-size: 11px;
}

.state-panel.error {
  color: #ef4444;
}

@media (max-width: 1180px) {
  .frontend-grid,
  .source-layout {
    grid-template-columns: 1fr;
  }

  .frontend-config-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .workspace-home-card__head,
  .workspace-home-card__body {
    grid-template-columns: 1fr;
  }

  .workspace-home-card__head {
    align-items: flex-start;
    flex-direction: column;
  }

  .sim-run-head {
    align-items: stretch;
    flex-direction: column;
  }

  .sim-run-action {
    width: 100%;
  }
}

@media (max-width: 720px) {
  .frontend-config-card__head {
    align-items: flex-start;
    flex-direction: column;
  }

  .frontend-config-grid {
    grid-template-columns: 1fr;
  }

  .frontend-config-item.wide {
    grid-column: auto;
  }
}
</style>
