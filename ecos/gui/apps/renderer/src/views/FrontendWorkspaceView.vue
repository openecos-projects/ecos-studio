<template>
  <div class="frontend-workspace">
    <div class="frontend-header">
      <div>
        <p class="frontend-kicker">Frontend Flow</p>
        <h1>{{ stepTitle }}</h1>
      </div>
      <div class="header-actions">
        <button v-if="isSimStep" type="button" class="run-btn subtle" :disabled="runBusy" @click="runRtThread">
          <i :class="runBusy ? 'ri-loader-4-line animate-spin' : 'ri-terminal-box-line'"></i>
          RT-Thread
        </button>
        <button type="button" class="run-btn" :disabled="runBusy" @click="runCurrentStep">
          <i :class="runBusy ? 'ri-loader-4-line animate-spin' : 'ri-play-circle-line'"></i>
          Run
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
      <section class="panel flow-panel">
        <div class="panel-header">
          <h2>Flow Steps</h2>
          <span>{{ completedCount }}/{{ steps.length }} done</span>
        </div>
        <div class="step-list">
          <RouterLink
            v-for="step in steps"
            :key="step.name"
            class="step-row"
            :class="{ active: step.name === currentStepName }"
            :to="`/workspace/${step.name}`"
          >
            <div class="step-icon" :class="stateClass(step.state)">
              <i :class="stateIcon(step.state)"></i>
            </div>
            <div class="step-body">
              <div class="step-title">
                <span>{{ labelForStep(step.name) }}</span>
                <span class="tool">{{ step.tool }}</span>
              </div>
              <div class="step-meta">
                <span>{{ step.state || 'Unstart' }}</span>
                <span v-if="step.runtime">{{ step.runtime }}</span>
              </div>
            </div>
          </RouterLink>
        </div>
      </section>

      <section class="panel detail-panel">
        <div class="panel-header">
          <h2>Step Detail</h2>
          <span>{{ currentStep?.tool || '--' }}</span>
        </div>

        <div v-if="!currentStep" class="state-panel">
          <i class="ri-file-list-3-line"></i>
          <span>No flow step selected.</span>
        </div>

        <div v-else class="detail-content">
          <section class="summary-grid">
            <div class="summary-tile status" :class="stateClass(detail?.state || currentStep.state)">
              <span>Status</span>
              <strong>{{ detail?.state || currentStep.state || 'Unstart' }}</strong>
            </div>
            <div class="summary-tile">
              <span>Runtime</span>
              <strong>{{ detail?.runtime || currentStep.runtime || '--' }}</strong>
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
            <div class="suite-row">
              <button
                type="button"
                class="suite-pill"
                :class="{ active: simSuite === 'cpu_tests' }"
                @click="simSuite = 'cpu_tests'"
              >
                <i class="ri-cpu-line"></i>
                CPU Tests
              </button>
              <button
                type="button"
                class="suite-pill"
                :class="{ active: simSuite === 'rtthread' }"
                @click="simSuite = 'rtthread'"
              >
                <i class="ri-terminal-box-line"></i>
                RT-Thread
              </button>
              <div v-if="simSuite === 'cpu_tests'" class="mode-segment">
                <button type="button" :class="{ active: simCpuMode === 'selected' }" @click="simCpuMode = 'selected'">
                  Selected
                </button>
                <button type="button" :class="{ active: simCpuMode === 'all' }" @click="simCpuMode = 'all'">
                  All
                </button>
              </div>
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
                          <span>{{ testCase.name }}</span>
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
import { RouterLink, useRoute } from 'vue-router'
import type { WorkspaceStepResource } from '@ecos-studio/shared'
import { getWorkspaceResourceIndexApi } from '@/api/workspaceResources'
import { CMDEnum, InfoEnum, ResponseEnum, StateEnum, getStepMetadata } from '@/api/type'
import { getInfoApi, runStepApi } from '@/api/flow'
import { useWorkspace } from '@/composables/useWorkspace'
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
  returncode?: number
  image?: string
  log?: string
  report_log?: string
  run_log?: string
  wave?: string
  run_id?: string
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

type TabId = 'summary' | 'cases' | 'log' | 'reports' | 'artifacts' | 'src' | 'wave'

const route = useRoute()
const {
  currentProject,
  resourceVersions,
  showToast,
  invalidateWorkspaceResources,
} = useWorkspace()
const steps = ref<WorkspaceStepResource[]>([])
const loading = ref(false)
const runBusy = ref(false)
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
const simCpuMode = ref<'all' | 'selected'>('selected')
const selectedCpuCases = ref<string[]>([])
const surferFrame = ref<HTMLIFrameElement | null>(null)
const surferReady = ref(false)
const waveformLoading = ref(false)
const waveformError = ref('')
let waveformLoadToken = 0

const currentStepName = computed(() => {
  const param = String(route.params.step || '')
  return param && param !== 'home' ? param : steps.value[0]?.name || ''
})
const currentStep = computed(() =>
  steps.value.find((step) => step.name.toLowerCase() === currentStepName.value.toLowerCase()) ?? null,
)
const isSimStep = computed(() => currentStepName.value.toLowerCase() === 'sim')
const completedCount = computed(() => steps.value.filter((step) => step.state === 'Success').length)
const stepTitle = computed(() => labelForStep(currentStepName.value || 'Workspace Home'))
const cases = computed(() => detail.value?.cases || [])
const totalCases = computed(() => cases.value.length)
const passedCases = computed(() => cases.value.filter((testCase) => testCase.ok).length)
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
    await loadDetail()
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
    selectedLogPath.value = availableLogs.value[0]?.path || ''
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

async function runCurrentStep(): Promise<void> {
  if (!currentProject.value?.path || !currentStepName.value) return
  runBusy.value = true
  try {
    const payload = simRunPayload()
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
      detail: currentStepName.value,
      life: 4000,
    })
  } catch (err) {
    showToast({
      severity: 'error',
      summary: 'Run Failed',
      detail: err instanceof Error ? err.message : String(err),
      life: 6000,
    })
  } finally {
    runBusy.value = false
  }
}

function runRtThread(): void {
  simSuite.value = 'rtthread'
  void runCurrentStep()
}

function simRunPayload() {
  if (!isSimStep.value) return {}
  if (simSuite.value === 'rtthread') {
    return { sim_test_suite: 'rtthread' }
  }
  return {
    sim_test_suite: 'cpu_tests',
    sim_cpu_test_mode: simCpuMode.value,
    sim_cpu_test_cases: simCpuMode.value === 'selected' ? selectedCpuCases.value : [],
  }
}

function syncDefaultCpuSelection(): void {
  if (!isSimStep.value || selectedCpuCases.value.length) return
  const defaults = defaultCpuTests.value.length ? defaultCpuTests.value : availableCpuTests.value.slice(0, 2)
  selectedCpuCases.value = defaults
}

function toggleCpuCase(name: string): void {
  selectedCpuCases.value = selectedCpuCases.value.includes(name)
    ? selectedCpuCases.value.filter((item) => item !== name)
    : [...selectedCpuCases.value, name]
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
  } catch (err) {
    showToast({
      severity: 'error',
      summary: 'Open Waveform Failed',
      detail: err instanceof Error ? err.message : String(err),
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

function stateIcon(state: string): string {
  if (state === 'Success') return 'ri-checkbox-circle-fill'
  if (state === 'Ongoing') return 'ri-loader-4-line animate-spin'
  if (state === 'Incomplete' || state === 'Invalid') return 'ri-close-circle-fill'
  return 'ri-time-line'
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
  window.addEventListener('message', handleSurferMessage)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', handleSurferMessage)
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
  void loadDetail()
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
  grid-template-columns: minmax(250px, 300px) minmax(0, 1fr);
  gap: 14px;
  min-height: 0;
  flex: 1;
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

.step-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}

.step-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 8px;
  color: inherit;
  text-decoration: none;
}

.step-row:hover,
.step-row.active {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.08);
}

.step-row.active {
  box-shadow: inset 2px 0 0 var(--accent-color);
}

.step-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: var(--bg-primary);
  flex-shrink: 0;
}

.success {
  color: #10b981;
}

.running {
  color: #60a5fa;
}

.failed {
  color: #ef4444;
}

.pending {
  color: var(--text-secondary);
}

.step-body {
  min-width: 0;
  flex: 1;
}

.step-title,
.step-meta {
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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
.step-meta,
.log-viewer,
.text-panel pre {
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
}

.tool {
  font-size: 10px;
}

.step-meta {
  margin-top: 3px;
  font-size: 10px;
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

.sim-run-card {
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.suite-row {
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
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

  .flow-panel {
    min-height: 180px;
  }
}
</style>
