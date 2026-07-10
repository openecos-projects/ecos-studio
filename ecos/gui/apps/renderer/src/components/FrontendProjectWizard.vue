<template>
  <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 sm:p-6">
    <div
      class="relative flex h-[85vh] max-h-[850px] w-full max-w-5xl flex-col overflow-hidden rounded-[24px] border border-white/10 bg-(--bg-primary) shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] ring-1 ring-black/5 dark:border-white/5 dark:ring-white/5">
      <div class="absolute left-0 right-0 top-0 h-1 bg-(--accent-color)"></div>

      <button
        class="absolute right-6 top-6 z-20 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-(--bg-secondary)/80 text-(--text-secondary) transition-colors hover:bg-(--border-color) hover:text-(--text-primary)"
        @click="$emit('close')"
      >
        <i class="ri-close-line text-lg"></i>
      </button>

      <div class="flex h-full flex-col md:flex-row">
        <aside class="relative flex w-full shrink-0 flex-col border-r border-(--border-color)/40 bg-(--bg-secondary)/40 p-8 md:w-80 md:p-10">
          <div class="pointer-events-none absolute left-0 top-0 h-full w-full bg-gradient-to-b from-white/5 to-transparent"></div>

          <div class="relative z-10 mb-12">
            <h1 class="text-3xl font-bold tracking-tight text-(--text-primary)">New Workspace</h1>
            <p class="mt-2 text-sm text-(--text-secondary)">Frontend verification setup</p>
          </div>

          <div class="relative z-10 flex flex-col gap-8">
            <template v-for="(step, index) in steps" :key="step.id">
              <div
                class="group relative flex items-start gap-4"
                :class="step.id <= highestStep && step.id !== currentStep ? 'cursor-pointer transition-opacity hover:opacity-80' : 'cursor-default'"
                @click="handleStepClick(step.id)"
              >
                <div
                  v-if="index < steps.length - 1"
                  class="absolute bottom-[-32px] left-5 top-12 w-[2px] -translate-x-1/2 rounded-full transition-colors"
                  :class="currentStep > step.id ? 'bg-(--accent-color)' : 'bg-(--border-color)/60'"
                ></div>

                <div class="relative z-10 flex shrink-0 flex-col items-center">
                  <div
                    :class="[
                      'flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold shadow-sm transition-colors',
                      currentStep > step.id
                        ? 'border border-transparent bg-(--accent-color) text-white ring-4 ring-(--accent-color)/20'
                        : currentStep === step.id
                          ? 'border border-transparent bg-(--accent-color) text-white ring-4 ring-(--accent-color)/30'
                          : 'border border-(--border-color) bg-(--bg-primary)/80 text-(--text-secondary)'
                    ]"
                  >
                    <i v-if="currentStep > step.id" class="ri-check-line text-lg"></i>
                    <span v-else>{{ step.id }}</span>
                  </div>
                </div>

                <div class="flex flex-col pt-2 transition-transform" :class="currentStep === step.id ? 'translate-x-1' : ''">
                  <span
                    :class="[
                      'text-base font-semibold transition-colors',
                      currentStep >= step.id ? 'text-(--text-primary)' : 'text-(--text-secondary)'
                    ]"
                  >
                    {{ step.title }}
                  </span>
                  <span v-if="currentStep === step.id" class="mt-1 text-xs font-medium uppercase tracking-wide text-(--accent-color)">
                    In Progress
                  </span>
                </div>
              </div>
            </template>
          </div>
        </aside>

        <main class="relative flex min-w-0 flex-1 flex-col bg-transparent">
          <div ref="wizardScrollRef" class="custom-scrollbar flex-1 overflow-y-auto p-8 md:p-12">
            <Transition name="fade-slide" mode="out-in">
              <section v-if="currentStep === 1" key="step1" class="mx-auto w-full max-w-2xl">
                <div class="mb-10">
                  <h2 class="text-2xl font-bold text-(--text-primary)">Project Basics</h2>
                  <p class="mt-2 text-(--text-secondary)">Name and location.</p>
                </div>

                <div class="space-y-8">
                  <div class="group">
                    <label class="mb-2 block text-sm font-semibold text-(--text-primary) transition-colors group-focus-within:text-(--accent-color)">
                      Project Name <span class="text-red-500">*</span>
                    </label>
                    <input
                      v-model="config.parameters.design"
                      type="text"
                      placeholder="e.g. cl3_soc"
                      :class="[
                        'w-full rounded-xl border bg-(--bg-secondary)/40 px-4 py-3.5 text-(--text-primary) shadow-sm transition-colors placeholder:text-(--text-secondary)/50 focus:bg-(--bg-primary)/80 focus:outline-none',
                        designNameError ? 'border-red-500 focus:border-red-500' : 'border-(--border-color) focus:border-(--accent-color)'
                      ]"
                    />
                    <p v-if="designNameError" class="mt-2 flex items-center gap-1 text-xs text-red-500">
                      <i class="ri-error-warning-fill"></i> {{ designNameError }}
                    </p>
                    <p v-else class="mt-2 flex items-center gap-1 text-xs text-(--text-secondary)">
                      <i class="ri-error-warning-line"></i> Only letters, numbers, and underscores are allowed.
                    </p>
                  </div>

                  <div class="group">
                    <label class="mb-2 block text-sm font-semibold text-(--text-primary) transition-colors group-focus-within:text-(--accent-color)">
                      Project Description
                    </label>
                    <textarea
                      v-model="config.parameters.description"
                      rows="3"
                      placeholder="Briefly describe this frontend flow..."
                      class="w-full resize-none rounded-xl border border-(--border-color) bg-(--bg-secondary)/40 px-4 py-3.5 text-(--text-primary) shadow-sm transition-colors placeholder:text-(--text-secondary)/50 focus:border-(--accent-color) focus:bg-(--bg-primary)/80 focus:outline-none"
                    ></textarea>
                  </div>

                  <div class="group">
                    <label class="mb-2 block text-sm font-semibold text-(--text-primary) transition-colors group-focus-within:text-(--accent-color)">
                      Save Location <span class="text-red-500">*</span>
                    </label>
                    <div class="flex gap-3">
                      <div class="relative flex-1">
                        <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                          <i class="ri-folder-line text-(--text-secondary)"></i>
                        </div>
                        <input
                          v-model="config.directory"
                          type="text"
                          readonly
                          placeholder="Choose a folder..."
                          :class="[
                            'w-full cursor-pointer truncate rounded-xl border bg-(--bg-secondary)/40 py-3.5 pl-10 pr-4 text-(--text-primary) shadow-sm transition-colors placeholder:text-(--text-secondary)/50 focus:bg-(--bg-primary)/80',
                            directoryError ? 'border-red-500 focus:border-red-500' : 'border-(--border-color) focus:border-(--accent-color)'
                          ]"
                          @click="selectLocation"
                        />
                      </div>
                      <button
                        class="flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-(--border-color) bg-(--bg-primary)/50 px-6 py-3.5 font-medium text-(--text-primary) shadow-sm transition-colors hover:border-(--text-secondary) hover:bg-(--bg-secondary)"
                        @click="selectLocation"
                      >
                        Browse
                      </button>
                    </div>
                    <p v-if="directoryError" class="mt-2 flex items-center gap-1 text-xs text-red-500">
                      <i class="ri-error-warning-fill"></i> {{ directoryError }}
                    </p>
                  </div>
                </div>
              </section>

              <section v-else-if="currentStep === 2" key="step2" class="mx-auto w-full max-w-3xl">
                <div class="mb-8">
                  <h2 class="text-2xl font-bold text-(--text-primary)">Verification Setup</h2>
                  <p class="mt-2 text-(--text-secondary)">CPU source, harness, toolchain, and tests.</p>
                </div>

                <div v-if="catalogLoading" class="state-panel">
                  <i class="ri-loader-4-line animate-spin"></i>
                  <span>Loading catalog</span>
                </div>

                <div v-else-if="catalogUnavailable" class="state-panel failed">
                  <i class="ri-error-warning-line"></i>
                  <span>{{ catalogError || 'Frontend catalog is unavailable.' }}</span>
                  <button type="button" class="text-action" @click="loadCatalog">Retry</button>
                </div>

                <div v-else class="space-y-8">
                  <section>
                    <div class="mb-3 flex items-center justify-between gap-3">
                      <label class="text-sm font-semibold text-(--text-primary)">CPU Source <span class="text-red-500">*</span></label>
                      <span class="text-xs text-(--text-secondary)">{{ visibleCores.length }} options</span>
                    </div>
                    <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <CatalogCard
                        v-for="core in visibleCores"
                        :key="core.id"
                        :active="selectedCoreId === core.id"
                        :entry="core"
                        :compatibility="compatibilityFor(core.id, selectedSocHarnessId)"
                        icon="ri-cpu-line"
                        @select="selectCore(core.id)"
                      />
                    </div>
                  </section>

                  <PathPicker
                    v-if="selectedCore?.requires_filelist !== false"
                    label="CPU RTL Filelist"
                    required
                    icon="ri-file-list-3-line"
                    :model-value="config.parameters.cpu_filelist"
                    @browse="selectCpuFilelist"
                  />

                  <section>
                    <div class="mb-3 flex items-center justify-between gap-3">
                      <label class="text-sm font-semibold text-(--text-primary)">SoC Harness <span class="text-red-500">*</span></label>
                      <span class="text-xs text-(--text-secondary)">{{ visibleSocHarnesses.length }} options</span>
                    </div>
                    <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <CatalogCard
                        v-for="soc in visibleSocHarnesses"
                        :key="soc.id"
                        :active="selectedSocHarnessId === soc.id"
                        :entry="soc"
                        :compatibility="compatibilityFor(selectedCoreId, soc.id)"
                        icon="ri-layout-grid-line"
                        @select="selectSocHarness(soc.id)"
                      />
                    </div>
                  </section>

                  <section class="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div>
                      <label class="mb-3 block text-sm font-semibold text-(--text-primary)">Toolchain</label>
                      <div class="space-y-2">
                        <button
                          v-for="toolchain in visibleToolchains"
                          :key="toolchain.id"
                          type="button"
                          class="option-row"
                          :class="{ active: selectedToolchainId === toolchain.id }"
                          @click="selectToolchain(toolchain.id)"
                        >
                          <span>
                            <strong>{{ toolchain.name }}</strong>
                            <small>{{ toolchain.id }}</small>
                          </span>
                          <StatusPill :status="toolchain.status" />
                          <i v-if="selectedToolchainId === toolchain.id" class="ri-check-line"></i>
                        </button>
                      </div>
                    </div>

                    <div>
                      <label class="mb-3 block text-sm font-semibold text-(--text-primary)">Test Suite</label>
                      <div class="space-y-2">
                        <button
                          v-for="suite in visibleTestSuites"
                          :key="suite.id"
                          type="button"
                          class="option-row"
                          :class="{ active: selectedTestSuiteId === suite.id }"
                          @click="selectTestSuite(suite.id)"
                        >
                          <span>
                            <strong>{{ suite.name }}</strong>
                            <small>{{ suite.id }}</small>
                          </span>
                          <StatusPill :status="suite.status" />
                          <i v-if="selectedTestSuiteId === suite.id" class="ri-check-line"></i>
                        </button>
                      </div>
                    </div>
                  </section>

                  <section
                    v-if="showCpuTopContract"
                    ref="cpuTopContractRef"
                    class="cpu-top-contract"
                  >
                    <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div class="flex items-center gap-2 text-sm font-bold text-(--text-primary)">
                          <i class="ri-code-box-line text-(--accent-color)"></i>
                          <span>CPU Top IO Contract</span>
                        </div>
                        <p class="mt-1 text-xs text-(--text-secondary)">
                          The user CPU filelist must define this exact CPU top module interface.
                        </p>
                      </div>
                      <div class="grid min-w-0 grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                        <div class="cpu-top-contract-metric">
                          <span>Module</span>
                          <strong>{{ requiredCpuTopModule }}</strong>
                        </div>
                        <div class="cpu-top-contract-metric">
                          <span>IO Count</span>
                          <strong>{{ cpuTopPortCount }} ports</strong>
                        </div>
                        <div class="cpu-top-contract-metric col-span-2 sm:col-span-1">
                          <span>Match</span>
                          <strong>Name + direction + width</strong>
                        </div>
                      </div>
                    </div>

                    <div v-if="showAddressContract" class="mt-4 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                      <div class="cpu-top-contract-metric">
                        <span>CPU Reset PC</span>
                        <strong>{{ requiredCpuResetVector || '-' }}</strong>
                      </div>
                      <div class="cpu-top-contract-metric">
                        <span>Program Link Base</span>
                        <strong>{{ defaultProgramLinkBase || '-' }}</strong>
                      </div>
                      <div class="cpu-top-contract-metric">
                        <span>Boot Payload Base</span>
                        <strong>{{ bootloaderPayloadLinkBase || '-' }}</strong>
                      </div>
                    </div>

                    <div class="mt-4 overflow-hidden rounded-xl border border-(--border-color)/70 bg-(--bg-primary)/65">
                      <div class="flex items-center justify-between gap-3 border-b border-(--border-color)/70 px-4 py-2.5">
                        <span class="text-xs font-semibold uppercase tracking-wide text-(--text-secondary)">{{ requiredCpuTopModule }}.sv</span>
                        <span class="text-xs font-medium text-(--text-secondary)">module and complete IO contract must match</span>
                      </div>
                      <pre class="custom-scrollbar max-h-72 overflow-auto p-4 text-[11px] leading-relaxed text-(--text-primary)"><code>{{ cpuTopExample }}</code></pre>
                    </div>
                  </section>

                  <section class="validation-panel" :class="validationPanelClass">
                    <div class="validation-head">
                      <i :class="validationIcon"></i>
                      <div>
                        <strong>{{ validationTitle }}</strong>
                        <span>{{ validationSummary }}</span>
                      </div>
                    </div>
                    <div v-if="validationIssues.length" class="validation-issues">
                      <div v-for="issue in validationIssues" :key="`${issue.code}:${issue.field}:${issue.message}`" class="validation-issue" :class="issue.severity">
                        <i :class="issue.severity === 'error' ? 'ri-close-circle-line' : 'ri-alert-line'"></i>
                        <span>{{ issue.message }}</span>
                      </div>
                    </div>
                  </section>
                </div>
              </section>

              <section v-else key="step3" class="mx-auto w-full max-w-2xl">
                <div class="mb-10 text-center">
                  <div
                    class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border shadow-sm"
                    :class="validationOk ? 'border-green-500/20 bg-green-500/10' : 'border-red-500/20 bg-red-500/10'"
                  >
                    <i :class="validationOk ? 'ri-check-double-line text-green-500' : 'ri-error-warning-line text-red-500'" class="text-3xl"></i>
                  </div>
                  <h2 class="text-2xl font-bold text-(--text-primary)">Review & Create</h2>
                  <p class="mt-2 text-(--text-secondary)">{{ validationSummary }}</p>
                </div>

                <div class="space-y-5">
                  <ReviewSection title="Project details" icon="ri-folder-info-line" @edit="jumpToStep(1)">
                    <ReviewItem label="Project Name" :value="config.parameters.design || '-'" />
                    <ReviewItem label="Save Location" :value="config.directory || '-'" monospace wide />
                  </ReviewSection>

                  <ReviewSection title="Verification setup" icon="ri-file-list-3-line" @edit="jumpToStep(2)">
                    <ReviewItem label="CPU Source" :value="selectedCore?.name || '-'" />
                    <ReviewItem label="Core Capability" :value="capabilityLabel(validation?.normalized.core_capability || selectedCore?.integration_level)" />
                    <ReviewItem label="SoC Harness" :value="selectedSocHarness?.name || '-'" />
                    <ReviewItem label="Combination" :value="combinationSummary" wide />
                    <ReviewItem label="Compatible Tests" :value="compatibleTestSuitesLabel" />
                    <ReviewItem label="Toolchain" :value="selectedToolchain?.name || '-'" />
                    <ReviewItem label="Test Suite" :value="selectedTestSuite?.name || '-'" />
                    <ReviewItem label="CPU Filelist" :value="effectiveCpuFilelist || '-'" monospace wide />
                    <ReviewItem label="CPU Reset PC" :value="requiredCpuResetVector || '-'" monospace />
                    <ReviewItem label="Program Link Base" :value="defaultProgramLinkBase || '-'" monospace />
                    <ReviewItem label="Boot Payload Base" :value="bootloaderPayloadLinkBase || '-'" monospace wide />
                    <ReviewItem label="Default Flow" value="prepare -> elab -> lint -> sim" monospace wide />
                  </ReviewSection>

                  <section v-if="validationIssues.length" class="validation-panel" :class="validationPanelClass">
                    <div class="validation-head">
                      <i :class="validationIcon"></i>
                      <div>
                        <strong>{{ validationTitle }}</strong>
                        <span>{{ validationSummary }}</span>
                      </div>
                    </div>
                    <div class="validation-issues">
                      <div v-for="issue in validationIssues" :key="`${issue.code}:${issue.field}:${issue.message}`" class="validation-issue" :class="issue.severity">
                        <i :class="issue.severity === 'error' ? 'ri-close-circle-line' : 'ri-alert-line'"></i>
                        <span>{{ issue.message }}</span>
                      </div>
                    </div>
                  </section>
                </div>
              </section>
            </Transition>
          </div>

          <div class="z-10 flex shrink-0 items-center justify-between border-t border-(--border-color)/60 bg-(--bg-primary)/80 px-8 py-6 shadow-[0_-10px_30px_-15px_rgba(0,0,0,0.1)] backdrop-blur-md md:px-12">
            <button
              v-if="currentStep > 1"
              class="flex cursor-pointer items-center gap-2 rounded-xl border border-(--border-color) bg-(--bg-secondary)/40 px-6 py-3 font-semibold text-(--text-primary) shadow-sm transition-colors hover:bg-(--bg-secondary)/80"
              @click="prevStep"
            >
              <i class="ri-arrow-left-line"></i>
              Back
            </button>
            <div v-else></div>

            <div class="flex items-center gap-4">
              <button
                class="cursor-pointer rounded-xl px-6 py-3 font-semibold text-(--text-secondary) transition-colors hover:bg-(--bg-secondary)/50 hover:text-(--text-primary)"
                @click="$emit('close')"
              >
                Cancel
              </button>

              <button
                v-if="currentStep < FINAL_STEP"
                class="flex cursor-pointer items-center gap-2 rounded-xl bg-(--accent-color) px-8 py-3 font-semibold text-white shadow-sm transition-all hover:bg-(--accent-color)/90 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-sm"
                :disabled="!canProceed"
                @click="nextStep"
              >
                Continue
                <i class="ri-arrow-right-line"></i>
              </button>

              <button
                v-else
                class="flex cursor-pointer items-center gap-2 rounded-xl bg-(--accent-color) px-8 py-3 font-bold text-white shadow-md transition-all hover:opacity-90 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="isCreating || !canProceed"
                @click="createProject"
              >
                <i v-if="isCreating" class="ri-loader-4-line animate-spin"></i>
                <i v-else class="ri-rocket-line"></i>
                {{ isCreating ? 'Creating Workspace...' : 'Create Workspace' }}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onMounted, ref, watch } from 'vue'
import { listFrontendCatalogApi, validateFrontendConfigApi, type FrontendCatalogEntry, type FrontendCatalogPayload, type FrontendCompatibilityEntry, type FrontendValidationIssue, type FrontendValidationResult } from '@/api/frontendCatalog'
import { waitForDesktopApi } from '@/platform/desktop'
import type { WorkspaceConfig } from '../types'
import { formatCpuTopModule, normalizeCpuPortContract } from './frontendCpuContract'

const FINAL_STEP = 3

interface FrontendParameters extends Record<string, unknown> {
  design: string
  description: string
  top_module: string
  clock: string
  frequency_max: number
  cpu_filelist: string
  soc_variant: string
  soc_harness_id: string
  frontend_core_id: string
  toolchain_id: string
  test_suite_id: string
}

interface FrontendWorkspaceConfig extends WorkspaceConfig {
  designTool: 'frontend'
  parameters: FrontendParameters
}

interface Emits {
  (e: 'close'): void
  (e: 'create', config: WorkspaceConfig): void
}

const emit = defineEmits<Emits>()

function createEmptyCatalog(): FrontendCatalogPayload {
  return {
    version: 1,
    defaults: {
      core_id: '',
      soc_harness_id: '',
      toolchain_id: '',
      test_suite_id: '',
    },
    cores: [],
    soc_harnesses: [],
    toolchains: [],
    test_suites: [],
    compatibility: [],
  }
}

const currentStep = ref(1)
const highestStep = ref(1)
const isCreating = ref(false)
const catalogLoading = ref(false)
const catalogError = ref('')
const validationBusy = ref(false)
const validation = ref<FrontendValidationResult | null>(null)
const validationFallbackIssues = ref<FrontendValidationIssue[]>([])
const wizardScrollRef = ref<HTMLElement | null>(null)
const cpuTopContractRef = ref<HTMLElement | null>(null)
const selectedCoreId = ref('')
const selectedSocHarnessId = ref('')
const selectedToolchainId = ref('')
const selectedTestSuiteId = ref('')
let validationToken = 0

const steps = [
  { id: 1, title: 'Basic Info' },
  { id: 2, title: 'Verification Setup' },
  { id: 3, title: 'Review & Create' },
]

const catalog = ref<FrontendCatalogPayload>(createEmptyCatalog())

const config = ref<FrontendWorkspaceConfig>({
  directory: '',
  designTool: 'frontend',
  pdk: '',
  pdk_root: '',
  parameters: {
    design: '',
    description: '',
    top_module: 'ecos_sim_top',
    clock: 'clk',
    frequency_max: 100,
    cpu_filelist: '',
    soc_variant: '',
    soc_harness_id: '',
    frontend_core_id: '',
    toolchain_id: '',
    test_suite_id: '',
  },
  origin_def: '',
  origin_verilog: '',
  rtl_list: [],
})

const selectedCore = computed(() => entryById(catalog.value.cores, selectedCoreId.value))
const selectedSocHarness = computed(() => entryById(catalog.value.soc_harnesses, selectedSocHarnessId.value))
const selectedToolchain = computed(() => entryById(catalog.value.toolchains, selectedToolchainId.value))
const selectedTestSuite = computed(() => entryById(catalog.value.test_suites, selectedTestSuiteId.value))
const selectedCompatibility = computed(() => compatibilityFor(selectedCoreId.value, selectedSocHarnessId.value))
const effectiveCpuFilelist = computed(() =>
  config.value.parameters.cpu_filelist
  || validation.value?.normalized?.cpu_filelist
  || stringField(selectedCore.value, 'cpu_filelist')
  || '',
)
const requiredCpuTopModule = computed(() =>
  validation.value?.normalized?.required_cpu_top_module
  || selectedCore.value?.required_cpu_top_module
  || '',
)
const requiredCpuTopPortContract = computed(() => normalizeCpuPortContract(
  validation.value?.normalized?.required_cpu_top_port_contract
  || selectedCore.value?.required_cpu_top_port_contract,
))
const showCpuTopContract = computed(() =>
  Boolean(requiredCpuTopModule.value && requiredCpuTopPortContract.value.length),
)
const cpuTopExample = computed(() =>
  formatCpuTopModule(requiredCpuTopModule.value, requiredCpuTopPortContract.value),
)
const cpuTopPortCount = computed(() => requiredCpuTopPortContract.value.length)
const requiredCpuResetVector = computed(() =>
  validation.value?.normalized?.required_cpu_reset_vector
  || selectedCore.value?.cpu_reset_vector
  || validation.value?.normalized?.soc_cpu_reset_vector
  || selectedSocHarness.value?.cpu_reset_vector
  || '',
)
const defaultProgramLinkBase = computed(() =>
  validation.value?.normalized?.core_sim_program_link_base
  || selectedCore.value?.sim_program_link_base
  || validation.value?.normalized?.soc_default_program_link_base
  || selectedSocHarness.value?.default_program_link_base
  || '',
)
const bootloaderPayloadLinkBase = computed(() =>
  validation.value?.normalized?.soc_bootloader_payload_link_base
  || selectedSocHarness.value?.bootloader_payload_link_base
  || '',
)
const showAddressContract = computed(() => Boolean(
  requiredCpuResetVector.value || defaultProgramLinkBase.value || bootloaderPayloadLinkBase.value,
))
const combinationSummary = computed(() =>
  validation.value?.normalized?.compatibility_summary
  || selectedCompatibility.value?.summary
  || validationSummary.value,
)
const compatibleTestSuitesLabel = computed(() => {
  const suites = validation.value?.normalized?.compatible_test_suites
    || selectedCompatibility.value?.supported_test_suites
    || []
  return suites.length ? suites.join(', ') : '-'
})
const visibleSocHarnesses = computed(() =>
  sortedCatalogEntries(catalog.value.soc_harnesses),
)
const visibleCores = computed(() =>
  sortedCatalogEntries(catalog.value.cores),
)
const visibleToolchains = computed(() =>
  sortedCatalogEntries(catalog.value.toolchains),
)
const visibleTestSuites = computed(() =>
  sortedCatalogEntries(catalog.value.test_suites),
)
const catalogUnavailable = computed(() =>
  Boolean(catalogError.value)
  && visibleCores.value.length === 0
  && visibleSocHarnesses.value.length === 0,
)

const validationIssues = computed(() => [
  ...(catalogError.value ? [{
    severity: catalogUnavailable.value ? 'error' as const : 'warning' as const,
    code: 'catalog_load_failed',
    field: 'catalog',
    message: catalogError.value,
  }] : []),
  ...validationFallbackIssues.value,
  ...(validation.value?.issues || []),
])
const validationOk = computed(() => Boolean(validation.value?.ok) && !validationIssues.value.some((issue) => issue.severity === 'error'))
const validationTitle = computed(() => {
  if (validationBusy.value) return 'Checking compatibility'
  if (validationOk.value) return 'Supported configuration'
  if (validationIssues.value.some((issue) => issue.severity === 'error')) return 'Unsupported configuration'
  return 'Compatibility warning'
})
const validationSummary = computed(() => {
  if (validationBusy.value) return 'waiting for frontend CLI'
  if (validation.value?.summary) return validation.value.summary
  return 'Select a CPU source, SoC harness, toolchain, and test suite.'
})
const validationPanelClass = computed(() => ({
  success: validationOk.value,
  failed: validationIssues.value.some((issue) => issue.severity === 'error'),
  warning: !validationOk.value && validationIssues.value.some((issue) => issue.severity === 'warning'),
}))
const validationIcon = computed(() => {
  if (validationBusy.value) return 'ri-loader-4-line animate-spin'
  if (validationOk.value) return 'ri-checkbox-circle-line'
  if (validationIssues.value.some((issue) => issue.severity === 'error')) return 'ri-close-circle-line'
  return 'ri-alert-line'
})

const CHINESE_CHAR_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/
const HAS_SPACE_RE = /\s/

const designNameError = computed(() => {
  const name = config.value.parameters.design || ''
  if (!name) return ''
  if (HAS_SPACE_RE.test(name)) return 'Project name cannot contain spaces'
  if (CHINESE_CHAR_RE.test(name)) return 'Project name cannot contain Chinese characters'
  return ''
})

const directoryError = computed(() => {
  const dir = config.value.directory
  if (!dir) return ''
  if (HAS_SPACE_RE.test(dir)) return 'Save path cannot contain spaces'
  if (CHINESE_CHAR_RE.test(dir)) return 'Save path cannot contain Chinese characters'
  return ''
})

const canProceed = computed(() => {
  switch (currentStep.value) {
    case 1:
      return config.value.directory.trim() !== ''
        && config.value.parameters.design.trim() !== ''
        && !designNameError.value
        && !directoryError.value
    case 2:
    default:
      return selectedCoreId.value !== ''
        && selectedSocHarnessId.value !== ''
        && selectedToolchainId.value !== ''
        && selectedTestSuiteId.value !== ''
        && validationOk.value
        && !validationBusy.value
  }
})

onMounted(loadCatalog)

watch(
  [
    selectedCoreId,
    selectedSocHarnessId,
    selectedToolchainId,
    selectedTestSuiteId,
    () => config.value.parameters.cpu_filelist,
  ],
  () => {
    syncParameters()
    void refreshValidation()
  },
)

async function loadCatalog(): Promise<void> {
  catalogLoading.value = true
  catalogError.value = ''
  validation.value = null
  validationFallbackIssues.value = []
  try {
    const response = await listFrontendCatalogApi()
    if (response.response === 'success' && response.data) {
      catalog.value = response.data
      applyCatalogDefaults(response.data)
      return
    }
    catalogError.value = response.message?.join(', ') || 'Failed to load frontend catalog.'
    resetCatalogSelection()
  } catch (err) {
    catalogError.value = err instanceof Error ? err.message : String(err)
    resetCatalogSelection()
  } finally {
    catalogLoading.value = false
    await refreshValidation()
  }
}

async function refreshValidation(): Promise<void> {
  const token = ++validationToken
  validationFallbackIssues.value = localValidationIssues()
  validation.value = null
  if (!selectedCoreId.value || !selectedSocHarnessId.value || !selectedToolchainId.value || !selectedTestSuiteId.value) {
    return
  }

  validationBusy.value = true
  try {
    const response = await validateFrontendConfigApi(validationPayload())
    if (token !== validationToken) return
    if (response.data) {
      validation.value = response.data
    } else {
      validationFallbackIssues.value = [
        ...validationFallbackIssues.value,
        {
          severity: 'error',
          code: 'validation_failed',
          field: 'catalog',
          message: response.message?.join(', ') || 'Compatibility validation failed.',
        },
      ]
    }
  } catch (err) {
    if (token !== validationToken) return
    validationFallbackIssues.value = [
      ...validationFallbackIssues.value,
      {
        severity: 'error',
        code: 'validation_error',
        field: 'catalog',
        message: err instanceof Error ? err.message : String(err),
      },
    ]
  } finally {
    if (token === validationToken) validationBusy.value = false
  }
}

function applyCatalogDefaults(nextCatalog: FrontendCatalogPayload): void {
  selectedCoreId.value = selectedCoreId.value || nextCatalog.defaults.core_id || nextCatalog.cores[0]?.id || ''
  selectedSocHarnessId.value = selectedSocHarnessId.value || nextCatalog.defaults.soc_harness_id || nextCatalog.soc_harnesses[0]?.id || ''
  selectedToolchainId.value = selectedToolchainId.value || nextCatalog.defaults.toolchain_id || nextCatalog.toolchains[0]?.id || ''
  selectedTestSuiteId.value = selectedTestSuiteId.value || nextCatalog.defaults.test_suite_id || nextCatalog.test_suites[0]?.id || ''
  syncParameters()
}

function resetCatalogSelection(): void {
  catalog.value = createEmptyCatalog()
  selectedCoreId.value = ''
  selectedSocHarnessId.value = ''
  selectedToolchainId.value = ''
  selectedTestSuiteId.value = ''
  syncParameters()
}

function syncParameters(): void {
  config.value.parameters.frontend_core_id = selectedCoreId.value
  config.value.parameters.soc_harness_id = selectedSocHarnessId.value
  config.value.parameters.toolchain_id = selectedToolchainId.value
  config.value.parameters.test_suite_id = selectedTestSuiteId.value
  config.value.parameters.soc_variant = String(selectedSocHarness.value?.variant || validation.value?.normalized?.soc_variant || '')
}

function validationPayload(): Record<string, unknown> {
  return {
    core_id: selectedCoreId.value,
    cpu_filelist: config.value.parameters.cpu_filelist,
    soc_harness_id: selectedSocHarnessId.value,
    toolchain_id: selectedToolchainId.value,
    test_suite_id: selectedTestSuiteId.value,
  }
}

function localValidationIssues(): FrontendValidationIssue[] {
  const issues: FrontendValidationIssue[] = []
  if (selectedCore.value?.requires_filelist !== false && !config.value.parameters.cpu_filelist.trim()) {
    issues.push({
      severity: 'error',
      code: 'missing_cpu_filelist',
      field: 'cpu_filelist',
      message: 'CPU filelist is required.',
    })
  }
  return issues
}

function entryById(entries: FrontendCatalogEntry[], id: string): FrontendCatalogEntry | null {
  return entries.find((entry) => entry.id === id) || null
}

function sortedCatalogEntries(entries: FrontendCatalogEntry[]): FrontendCatalogEntry[] {
  const statusOrder: Record<string, number> = {
    stable: 0,
    experimental: 1,
    planned: 2,
  }
  return [...entries].sort((left, right) => {
    const leftRank = statusOrder[String(left.status || '')] ?? 3
    const rightRank = statusOrder[String(right.status || '')] ?? 3
    if (leftRank !== rightRank) return leftRank - rightRank
    return left.name.localeCompare(right.name)
  })
}

function stringField(entry: FrontendCatalogEntry | null, field: string): string {
  const value = entry?.[field]
  return typeof value === 'string' ? value : ''
}

function capabilityLabel(value: unknown): string {
  const text = String(value || '').trim()
  if (!text) return '-'
  return text.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function compatibilityFor(coreId: string, socHarnessId: string): FrontendCompatibilityEntry | null {
  if (!coreId || !socHarnessId) return null
  return (catalog.value.compatibility || []).find((item) =>
    item.core_id === coreId && item.soc_harness_id === socHarnessId,
  ) || null
}

const selectLocation = async () => {
  const desktopApi = await waitForDesktopApi()
  const result = await desktopApi.dialog.pickDirectory({
    title: 'Select Project Save Location',
  })
  if (result) {
    config.value.directory = result
  }
}

const selectCpuFilelist = async () => {
  const desktopApi = await waitForDesktopApi()
  const result = await desktopApi.dialog.pickFiles({
    multiple: false,
    filters: [{
      name: 'Filelists',
      extensions: ['f', 'fl', 'filelist'],
    }],
    title: 'Select CPU RTL Filelist',
  })
  const selected = result?.[0]
  if (selected) {
    config.value.parameters.cpu_filelist = selected
  }
}

function selectCore(id: string) {
  selectedCoreId.value = id
  if (id === 'custom-filelist') {
    void scrollToCpuTopContract()
  }
}

function selectSocHarness(id: string) {
  selectedSocHarnessId.value = id
}

function selectToolchain(id: string) {
  selectedToolchainId.value = id
}

function selectTestSuite(id: string) {
  selectedTestSuiteId.value = id
}

async function scrollToCpuTopContract(): Promise<void> {
  await nextTick()
  const target = cpuTopContractRef.value
  if (!target) return

  const container = wizardScrollRef.value
  if (!container) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' })
    return
  }

  const containerRect = container.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const nextTop = container.scrollTop + targetRect.top - containerRect.top - 12
  container.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' })
}

const nextStep = () => {
  if (currentStep.value < FINAL_STEP && canProceed.value) {
    currentStep.value++
    highestStep.value = Math.max(highestStep.value, currentStep.value)
  }
}

const prevStep = () => {
  if (currentStep.value > 1) {
    currentStep.value--
  }
}

const jumpToStep = (step: number) => {
  highestStep.value = Math.max(highestStep.value, currentStep.value)
  currentStep.value = step
}

const handleStepClick = (targetStep: number) => {
  if (targetStep === currentStep.value) return
  if (targetStep < currentStep.value) {
    jumpToStep(targetStep)
  } else if (targetStep <= highestStep.value && canProceed.value) {
    jumpToStep(targetStep)
  }
}

const createProject = async () => {
  if (!validationOk.value || !selectedCore.value || !selectedSocHarness.value) return
  syncParameters()
  isCreating.value = true
  try {
    emit('create', {
      ...config.value,
      designTool: 'frontend',
      parameters: {
        ...config.value.parameters,
        frontend_core_id: selectedCore.value.id,
        core_id: selectedCore.value.id,
        soc_harness_id: selectedSocHarness.value.id,
        soc_variant: config.value.parameters.soc_variant || String(selectedSocHarness.value.variant || 'soc1'),
        toolchain_id: selectedToolchainId.value,
        test_suite_id: selectedTestSuiteId.value,
        sim_program_link_base: validation.value?.normalized?.core_sim_program_link_base || stringField(selectedCore.value, 'sim_program_link_base'),
      },
      rtl_list: [],
    })
  } finally {
    isCreating.value = false
  }
}

const CatalogCard = defineComponent({
  props: {
    active: { type: Boolean, required: true },
    entry: { type: Object as () => FrontendCatalogEntry, required: true },
    compatibility: { type: Object as () => FrontendCompatibilityEntry | null, default: null },
    icon: { type: String, default: 'ri-cpu-line' },
  },
  emits: ['select'],
  setup(props, { emit }) {
    const capability = () => capabilityLabel(props.entry.integration_level)
    const hasBuiltInFilelist = () => typeof props.entry.cpu_filelist === 'string' && props.entry.cpu_filelist.length > 0
    const comboClass = () => {
      if (!props.compatibility) return 'bg-(--bg-primary) text-(--text-secondary)'
      if (props.compatibility.support_level === 'supported') return 'bg-emerald-500/10 text-emerald-400'
      if (props.compatibility.support_level === 'experimental') return 'bg-amber-500/10 text-amber-400'
      return 'bg-red-500/10 text-red-400'
    }
    const comboLabel = () => {
      if (!props.compatibility) return ''
      if (props.compatibility.support_level === 'supported') return 'Ready'
      if (props.compatibility.support_level === 'experimental') return 'Experimental'
      if (props.compatibility.status === 'needs_cpu_adapter') return 'Needs CPU Adapter'
      if (props.compatibility.status === 'needs_soc_adapter') return 'Needs SoC Adapter'
      return 'Blocked'
    }
    return () => h('button', {
      class: [
        'group cursor-pointer rounded-xl border bg-(--bg-secondary)/30 p-4 text-left transition-colors hover:bg-(--bg-secondary)/70',
        props.active ? 'border-(--accent-color) ring-2 ring-(--accent-color)/20' : 'border-(--border-color) hover:border-(--text-secondary)',
      ],
      type: 'button',
      title: props.compatibility?.summary || props.entry.description,
      onClick: () => emit('select'),
    }, [
      h('div', { class: 'flex items-center justify-between gap-3' }, [
        h('div', { class: 'flex h-10 w-10 items-center justify-center rounded-lg border border-(--border-color) bg-(--bg-primary)/80' }, [
          h('i', { class: `${props.icon} text-lg ${props.active ? 'text-(--accent-color)' : 'text-(--text-secondary)'}` }),
        ]),
        h('span', {
          class: [
            'rounded-full px-2 py-1 text-[10px] font-semibold uppercase',
            props.entry.status === 'stable'
              ? 'bg-emerald-500/10 text-emerald-400'
              : props.entry.status === 'experimental'
                ? 'bg-amber-500/10 text-amber-400'
                : 'bg-(--bg-primary) text-(--text-secondary)',
          ],
        }, String(props.entry.status || 'planned')),
      ]),
      h('h3', { class: 'mt-4 text-sm font-bold text-(--text-primary)' }, props.entry.name),
      h('p', { class: 'mt-1 line-clamp-2 text-xs text-(--text-secondary)' }, props.entry.description),
      h('div', { class: 'mt-3 flex flex-wrap gap-1' }, [
        h('span', {
          class: [
            'rounded px-1.5 py-0.5 text-[10px] font-semibold',
            props.entry.integration_level === 'sim_ready'
              ? 'bg-emerald-500/10 text-emerald-400'
              : props.entry.integration_level === 'filelist_ready'
                ? 'bg-sky-500/10 text-sky-400'
                : 'bg-(--bg-primary)/70 text-(--text-secondary)',
          ],
        }, capability()),
        ...(hasBuiltInFilelist()
          ? [h('span', { class: 'rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-sky-400' }, 'Built-in filelist')]
          : []),
        ...(props.compatibility
          ? [h('span', { class: ['rounded px-1.5 py-0.5 text-[10px] font-semibold', comboClass()] }, comboLabel())]
          : []),
        ...(props.compatibility?.supported_test_suites?.length
          ? [h('span', { class: 'rounded bg-(--bg-primary)/70 px-1.5 py-0.5 text-[10px] text-(--text-secondary)' }, props.compatibility.supported_test_suites.join('/'))]
          : []),
        ...(Array.isArray(props.entry.isa) ? props.entry.isa.slice(0, 3) : []).map((isa) =>
          h('span', { class: 'rounded bg-(--bg-primary)/70 px-1.5 py-0.5 text-[10px] text-(--text-secondary)' }, String(isa)),
        ),
      ]),
    ])
  },
})

const StatusPill = defineComponent({
  props: {
    status: { type: String, default: 'planned' },
  },
  setup(props) {
    return () => h('span', {
      class: [
        'ml-auto shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold uppercase',
        props.status === 'stable'
          ? 'bg-emerald-500/10 text-emerald-400'
          : props.status === 'experimental'
            ? 'bg-amber-500/10 text-amber-400'
            : 'bg-(--bg-primary) text-(--text-secondary)',
      ],
    }, props.status || 'planned')
  },
})

const PathPicker = defineComponent({
  props: {
    label: { type: String, required: true },
    modelValue: { type: String, default: '' },
    icon: { type: String, default: 'ri-file-line' },
    required: { type: Boolean, default: false },
  },
  emits: ['browse'],
  setup(props, { emit }) {
    return () => h('div', { class: 'group' }, [
      h('label', { class: 'mb-2 block text-sm font-semibold text-(--text-primary) transition-colors group-focus-within:text-(--accent-color)' }, [
        props.label,
        props.required ? h('span', { class: 'text-red-500' }, ' *') : null,
      ]),
      h('div', { class: 'flex gap-3' }, [
        h('div', { class: 'relative min-w-0 flex-1' }, [
          h('div', { class: 'pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4' }, [
            h('i', { class: `${props.icon} text-(--text-secondary)` }),
          ]),
          h('input', {
            value: props.modelValue,
            readonly: true,
            placeholder: 'Choose a file...',
            class: 'w-full cursor-pointer truncate rounded-xl border border-(--border-color) bg-(--bg-secondary)/40 py-3 pl-10 pr-4 text-(--text-primary) shadow-sm transition-colors placeholder:text-(--text-secondary)/50 focus:bg-(--bg-primary)/80',
            onClick: () => emit('browse'),
          }),
        ]),
        h('button', {
          class: 'shrink-0 cursor-pointer rounded-xl border border-(--border-color) bg-(--bg-primary)/50 px-5 py-3 font-medium text-(--text-primary) shadow-sm transition-colors hover:border-(--text-secondary) hover:bg-(--bg-secondary)',
          onClick: () => emit('browse'),
        }, 'Browse'),
      ]),
    ])
  },
})

const ReviewSection = defineComponent({
  props: {
    title: { type: String, required: true },
    icon: { type: String, default: 'ri-information-line' },
  },
  emits: ['edit'],
  setup(props, { slots, emit }) {
    return () => h('div', { class: 'overflow-hidden rounded-2xl border border-(--border-color) bg-(--bg-secondary)/20 backdrop-blur-sm' }, [
      h('div', { class: 'flex items-center justify-between border-b border-(--border-color)/60 bg-(--bg-secondary)/40 px-6 py-4' }, [
        h('h3', { class: 'flex items-center gap-2 font-bold text-(--text-primary)' }, [
          h('i', { class: `${props.icon} text-(--accent-color)` }),
          props.title,
        ]),
        h('button', {
          class: 'cursor-pointer rounded-md px-3 py-1 text-sm font-medium text-(--accent-color) transition-colors hover:bg-(--accent-color)/10 hover:text-(--accent-color)/80',
          onClick: () => emit('edit'),
        }, 'Edit'),
      ]),
      h('div', { class: 'grid grid-cols-2 gap-x-8 gap-y-6 p-6' }, slots.default?.()),
    ])
  },
})

const ReviewItem = defineComponent({
  props: {
    label: { type: String, required: true },
    value: { type: String, default: '-' },
    monospace: { type: Boolean, default: false },
    wide: { type: Boolean, default: false },
  },
  setup(props) {
    return () => h('div', { class: props.wide ? 'col-span-2 min-w-0' : 'min-w-0' }, [
      h('span', { class: 'text-[11px] font-semibold uppercase tracking-wider text-(--text-secondary)' }, props.label),
      h('p', {
        class: [
          'mt-1.5 truncate font-medium text-(--text-primary)',
          props.monospace ? 'rounded-lg border border-(--border-color)/50 bg-(--bg-primary)/60 p-2.5 font-mono text-sm' : '',
        ],
        title: props.value,
      }, props.value),
    ])
  },
})
</script>

<style scoped>
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 10px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}

.state-panel {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-secondary) 55%, transparent);
  color: var(--text-secondary);
  padding: 1rem;
}

.state-panel.failed {
  border-color: color-mix(in srgb, #ef4444 45%, var(--border-color));
  background: color-mix(in srgb, #ef4444 8%, transparent);
}

.state-panel .text-action {
  margin-left: auto;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.35rem 0.7rem;
}

.state-panel .text-action:hover {
  border-color: var(--accent-color);
}

.option-row {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-secondary) 30%, transparent);
  color: var(--text-primary);
  padding: 0.8rem 0.95rem;
  text-align: left;
  transition: border-color 0.18s ease, background-color 0.18s ease, box-shadow 0.18s ease;
}

.option-row:hover,
.option-row.active {
  border-color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 8%, transparent);
}

.option-row > span:first-child {
  min-width: 0;
}

.option-row strong,
.option-row small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.option-row strong {
  font-size: 0.82rem;
  font-weight: 700;
}

.option-row small {
  margin-top: 0.15rem;
  color: var(--text-secondary);
  font-size: 0.68rem;
}

.cpu-top-contract {
  scroll-margin-top: 0.75rem;
  border: 1px solid color-mix(in srgb, var(--accent-color) 25%, var(--border-color));
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent-color) 6%, var(--bg-secondary) 24%);
  padding: 1rem;
}

.cpu-top-contract-metric {
  min-width: 0;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-primary) 70%, transparent);
  padding: 0.65rem 0.75rem;
}

.cpu-top-contract-metric span,
.cpu-top-contract-metric strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cpu-top-contract-metric span {
  color: var(--text-secondary);
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
}

.cpu-top-contract-metric strong {
  margin-top: 0.15rem;
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.78rem;
}

.validation-panel {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-secondary) 35%, transparent);
  padding: 1rem;
}

.validation-panel.success {
  border-color: color-mix(in srgb, #10b981 45%, var(--border-color));
  background: color-mix(in srgb, #10b981 8%, transparent);
}

.validation-panel.warning {
  border-color: color-mix(in srgb, #f59e0b 45%, var(--border-color));
  background: color-mix(in srgb, #f59e0b 8%, transparent);
}

.validation-panel.failed {
  border-color: color-mix(in srgb, #ef4444 45%, var(--border-color));
  background: color-mix(in srgb, #ef4444 8%, transparent);
}

.validation-head {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.validation-head > i {
  margin-top: 0.1rem;
  color: var(--accent-color);
  font-size: 1.1rem;
}

.validation-head strong,
.validation-head span {
  display: block;
}

.validation-head strong {
  color: var(--text-primary);
  font-size: 0.9rem;
}

.validation-head span {
  margin-top: 0.15rem;
  color: var(--text-secondary);
  font-size: 0.78rem;
}

.validation-issues {
  margin-top: 0.85rem;
  display: grid;
  gap: 0.45rem;
}

.validation-issue {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  color: var(--text-secondary);
  font-size: 0.76rem;
}

.validation-issue.error i {
  color: #ef4444;
}

.validation-issue.warning i {
  color: #f59e0b;
}
</style>
