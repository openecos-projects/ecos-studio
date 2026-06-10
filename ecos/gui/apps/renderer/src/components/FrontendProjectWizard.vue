<template>
  <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 sm:p-6">
    <div
      class="relative w-full max-w-5xl bg-(--bg-primary) rounded-[24px] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] border border-white/10 dark:border-white/5 overflow-hidden flex flex-col h-[85vh] max-h-[850px] ring-1 ring-black/5 dark:ring-white/5">
      <div class="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500/80 via-(--accent-color)/80 to-purple-500/80"></div>

      <button @click="$emit('close')"
        class="absolute top-6 right-6 z-20 w-8 h-8 flex items-center justify-center rounded-full bg-(--bg-secondary)/80 hover:bg-(--border-color) text-(--text-secondary) hover:text-(--text-primary) transition-colors cursor-pointer">
        <i class="ri-close-line text-lg"></i>
      </button>

      <div class="flex flex-col md:flex-row h-full">
        <div class="w-full md:w-80 bg-(--bg-secondary)/40 border-r border-(--border-color)/40 p-8 md:p-10 flex flex-col shrink-0 relative">
          <div class="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-white/5 to-transparent pointer-events-none"></div>

          <div class="mb-12 relative z-10">
            <h1 class="text-3xl font-bold text-(--text-primary) tracking-tight">New Workspace</h1>
            <p class="text-sm text-(--text-secondary) mt-2">Configure your frontend design flow</p>
          </div>

          <div class="flex flex-col gap-8 relative z-10">
            <template v-for="(step, index) in steps" :key="step.id">
              <div class="relative flex items-start gap-4 group"
                :class="step.id <= highestStep && step.id !== currentStep ? 'cursor-pointer hover:opacity-80 transition-opacity' : 'cursor-default'"
                @click="handleStepClick(step.id)">
                <div v-if="index < steps.length - 1"
                  class="absolute left-5 top-12 bottom-[-32px] w-[2px] -translate-x-1/2 rounded-full transition-colors"
                  :class="currentStep > step.id ? 'bg-(--accent-color)' : 'bg-(--border-color)/60'">
                </div>

                <div class="relative z-10 flex flex-col items-center shrink-0">
                  <div :class="[
                    'w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-colors shadow-sm',
                    currentStep > step.id ? 'bg-(--accent-color) text-white ring-4 ring-(--accent-color)/20 border border-transparent' :
                      currentStep === step.id ? 'bg-(--accent-color) text-white ring-4 ring-(--accent-color)/30 border border-transparent' :
                        'bg-(--bg-primary)/80 text-(--text-secondary) border border-(--border-color)'
                  ]">
                    <i v-if="currentStep > step.id" class="ri-check-line text-lg"></i>
                    <span v-else>{{ step.id }}</span>
                  </div>
                </div>

                <div class="flex flex-col pt-2 transition-transform" :class="currentStep === step.id ? 'translate-x-1' : ''">
                  <span :class="[
                    'text-base font-semibold transition-colors',
                    currentStep >= step.id ? 'text-(--text-primary)' : 'text-(--text-secondary)'
                  ]">{{ step.title }}</span>
                  <span v-if="currentStep === step.id" class="text-xs text-(--accent-color) mt-1 font-medium tracking-wide uppercase">In Progress</span>
                </div>
              </div>
            </template>
          </div>
        </div>

        <div class="flex-1 flex flex-col min-w-0 bg-transparent relative">
          <div class="flex-1 overflow-y-auto p-8 md:p-12 custom-scrollbar">
            <Transition name="fade-slide" mode="out-in">
              <div v-if="currentStep === 1" key="step1" class="max-w-2xl mx-auto w-full">
                <div class="mb-10">
                  <h2 class="text-2xl font-bold text-(--text-primary)">Project Basics</h2>
                  <p class="text-(--text-secondary) mt-2">Set up the workspace name and save location.</p>
                </div>

                <div class="space-y-8">
                  <div class="group">
                    <label class="block text-sm font-semibold text-(--text-primary) mb-2 group-focus-within:text-(--accent-color) transition-colors">
                      Project Name <span class="text-red-500">*</span>
                    </label>
                    <input v-model="config.parameters.design" type="text" placeholder="e.g. cl3_soc"
                      :class="[
                        'w-full px-4 py-3.5 bg-(--bg-secondary)/40 border rounded-xl text-(--text-primary) placeholder:text-(--text-secondary)/50 focus:outline-none focus:bg-(--bg-primary)/80 transition-colors shadow-sm',
                        designNameError ? 'border-red-500 focus:border-red-500' : 'border-(--border-color) focus:border-(--accent-color)'
                      ]" />
                    <p v-if="designNameError" class="mt-2 text-xs text-red-500 flex items-center gap-1">
                      <i class="ri-error-warning-fill"></i> {{ designNameError }}
                    </p>
                    <p v-else class="mt-2 text-xs text-(--text-secondary) flex items-center gap-1">
                      <i class="ri-error-warning-line"></i> Only letters, numbers, and underscores are allowed.
                    </p>
                  </div>

                  <div class="group">
                    <label class="block text-sm font-semibold text-(--text-primary) mb-2 group-focus-within:text-(--accent-color) transition-colors">
                      Project Description
                    </label>
                    <textarea v-model="config.parameters.description" rows="3" placeholder="Briefly describe this frontend flow..."
                      class="w-full px-4 py-3.5 bg-(--bg-secondary)/40 border border-(--border-color) rounded-xl text-(--text-primary) placeholder:text-(--text-secondary)/50 focus:outline-none focus:border-(--accent-color) focus:bg-(--bg-primary)/80 transition-colors shadow-sm resize-none"></textarea>
                  </div>

                  <div class="group">
                    <label class="block text-sm font-semibold text-(--text-primary) mb-2 group-focus-within:text-(--accent-color) transition-colors">
                      Save Location <span class="text-red-500">*</span>
                    </label>
                    <div class="flex gap-3">
                      <div class="relative flex-1">
                        <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                          <i class="ri-folder-line text-(--text-secondary)"></i>
                        </div>
                        <input v-model="config.directory" type="text" readonly placeholder="Choose a folder..."
                          @click="selectLocation"
                          :class="[
                            'w-full pl-10 pr-4 py-3.5 bg-(--bg-secondary)/40 border rounded-xl text-(--text-primary) placeholder:text-(--text-secondary)/50 cursor-pointer focus:bg-(--bg-primary)/80 transition-colors shadow-sm truncate',
                            directoryError ? 'border-red-500 focus:border-red-500' : 'border-(--border-color) focus:border-(--accent-color)'
                          ]" />
                      </div>
                      <button @click="selectLocation"
                        class="px-6 py-3.5 bg-(--bg-primary)/50 border border-(--border-color) text-(--text-primary) rounded-xl hover:bg-(--bg-secondary) hover:border-(--text-secondary) transition-colors font-medium cursor-pointer shadow-sm flex items-center gap-2 shrink-0">
                        Browse
                      </button>
                    </div>
                    <p v-if="directoryError" class="mt-2 text-xs text-red-500 flex items-center gap-1">
                      <i class="ri-error-warning-fill"></i> {{ directoryError }}
                    </p>
                  </div>
                </div>
              </div>

              <div v-else-if="currentStep === 2" key="step2" class="max-w-2xl mx-auto w-full">
                <div class="mb-10">
                  <h2 class="text-2xl font-bold text-(--text-primary)">Design Inputs</h2>
                  <p class="text-(--text-secondary) mt-2">Select your CPU RTL filelist and target SoC platform.</p>
                </div>

                <div class="space-y-8">
                  <PathPicker
                    label="CPU RTL Filelist"
                    required
                    icon="ri-file-list-3-line"
                    :model-value="config.parameters.cpu_filelist"
                    @browse="selectCpuFilelist"
                  />

                  <div>
                    <label class="block text-sm font-semibold text-(--text-primary) mb-3">
                      Target SoC <span class="text-red-500">*</span>
                    </label>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <button v-for="soc in socVariants" :key="soc.id" type="button" @click="selectSoc(soc.id)"
                        class="group text-left p-4 rounded-xl border transition-colors cursor-pointer bg-(--bg-secondary)/30 hover:bg-(--bg-secondary)/70"
                        :class="selectedSocId === soc.id
                          ? 'border-(--accent-color) ring-2 ring-(--accent-color)/20'
                          : 'border-(--border-color) hover:border-(--text-secondary)'">
                        <div class="flex items-center justify-between gap-3">
                          <div class="w-10 h-10 rounded-lg bg-(--bg-primary)/80 border border-(--border-color) flex items-center justify-center">
                            <i class="ri-cpu-line text-lg"
                              :class="selectedSocId === soc.id ? 'text-(--accent-color)' : 'text-(--text-secondary)'"></i>
                          </div>
                          <i v-if="selectedSocId === soc.id" class="ri-check-line text-(--accent-color) text-xl"></i>
                        </div>
                        <h3 class="mt-4 text-sm font-bold text-(--text-primary)">{{ soc.name }}</h3>
                        <p class="mt-1 text-xs text-(--text-secondary)">{{ soc.description }}</p>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else key="step3" class="max-w-2xl mx-auto w-full">
                <div class="mb-10 text-center">
                  <div class="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4 border border-green-500/20 shadow-sm">
                    <i class="ri-check-double-line text-3xl text-green-500"></i>
                  </div>
                  <h2 class="text-2xl font-bold text-(--text-primary)">Review & Create</h2>
                  <p class="text-(--text-secondary) mt-2">Review your frontend workspace configuration.</p>
                </div>

                <div class="space-y-5">
                  <ReviewSection title="Project details" icon="ri-folder-info-line" @edit="jumpToStep(1)">
                    <ReviewItem label="Project Name" :value="config.parameters.design || '-'" />
                    <ReviewItem label="Save Location" :value="config.directory || '-'" monospace wide />
                  </ReviewSection>

                  <ReviewSection title="Design inputs" icon="ri-file-list-3-line" @edit="jumpToStep(2)">
                    <ReviewItem label="CPU Filelist" :value="config.parameters.cpu_filelist || '-'" monospace wide />
                    <ReviewItem label="Target SoC" :value="selectedSoc?.name || '-'" />
                    <ReviewItem label="Default Flow" value="prepare -> elab -> lint -> sim" monospace wide />
                  </ReviewSection>
                </div>
              </div>
            </Transition>
          </div>

          <div class="px-8 md:px-12 py-6 border-t border-(--border-color)/60 bg-(--bg-primary)/80 backdrop-blur-md flex items-center justify-between shrink-0 shadow-[0_-10px_30px_-15px_rgba(0,0,0,0.1)] z-10">
            <button v-if="currentStep > 1" @click="prevStep"
              class="px-6 py-3 text-(--text-primary) bg-(--bg-secondary)/40 border border-(--border-color) hover:bg-(--bg-secondary)/80 rounded-xl transition-colors font-semibold cursor-pointer flex items-center gap-2 shadow-sm">
              <i class="ri-arrow-left-line"></i>
              Back
            </button>
            <div v-else></div>

            <div class="flex items-center gap-4">
              <button @click="$emit('close')"
                class="px-6 py-3 text-(--text-secondary) hover:text-(--text-primary) hover:bg-(--bg-secondary)/50 rounded-xl transition-colors font-semibold cursor-pointer">
                Cancel
              </button>

              <button v-if="currentStep < FINAL_STEP" @click="nextStep" :disabled="!canProceed"
                class="px-8 py-3 bg-(--accent-color) text-white rounded-xl hover:bg-(--accent-color)/90 shadow-sm hover:shadow-md transition-all font-semibold cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-sm">
                Continue
                <i class="ri-arrow-right-line"></i>
              </button>

              <button v-else @click="createProject" :disabled="isCreating || !canProceed"
                class="px-8 py-3 bg-(--accent-color) text-white rounded-xl hover:opacity-90 shadow-md hover:shadow-lg transition-all font-bold cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                <i v-if="isCreating" class="ri-loader-4-line animate-spin"></i>
                <i v-else class="ri-rocket-line"></i>
                {{ isCreating ? 'Creating Workspace...' : 'Create Workspace' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, ref } from 'vue'
import { waitForDesktopApi } from '@/platform/desktop'
import type { WorkspaceConfig } from '../types'

const FINAL_STEP = 3

interface SocVariant {
  id: string
  name: string
  description: string
}

interface FrontendParameters extends Record<string, unknown> {
  design: string
  description: string
  top_module: string
  clock: string
  frequency_max: number
  cpu_filelist: string
  soc_variant: string
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

const socVariants: SocVariant[] = [
  { id: 'soc1', name: 'SoC 1', description: 'Default SoC test platform' },
  { id: 'soc2', name: 'SoC 2', description: 'Alternative SoC test platform' },
  { id: 'soc3', name: 'SoC 3', description: 'Extended SoC test platform' },
]

const currentStep = ref(1)
const highestStep = ref(1)
const isCreating = ref(false)
const selectedSocId = ref('')

const steps = [
  { id: 1, title: 'Basic Info' },
  { id: 2, title: 'Design Inputs' },
  { id: 3, title: 'Review & Create' },
]

const config = ref<FrontendWorkspaceConfig>({
  directory: '',
  designTool: 'frontend',
  pdk: '',
  pdk_root: '',
  parameters: {
    design: '',
    description: '',
    top_module: 'ysyxSoCTop',
    clock: 'clk',
    frequency_max: 100,
    cpu_filelist: '',
    soc_variant: '',
  },
  origin_def: '',
  origin_verilog: '',
  rtl_list: [],
})

const selectedSoc = computed(() => {
  return socVariants.find((soc) => soc.id === selectedSocId.value) || null
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
      return config.value.parameters.cpu_filelist.trim() !== ''
        && selectedSoc.value !== null
    default:
      return config.value.parameters.cpu_filelist.trim() !== ''
        && selectedSoc.value !== null
  }
})

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

function selectSoc(id: string) {
  selectedSocId.value = id
  config.value.parameters.soc_variant = id
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
  if (!selectedSoc.value) return
  isCreating.value = true
  try {
    emit('create', {
      ...config.value,
      designTool: 'frontend',
      parameters: {
        ...config.value.parameters,
        soc_variant: selectedSoc.value.id,
      },
      rtl_list: [],
    })
  } finally {
    isCreating.value = false
  }
}

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
      h('label', { class: 'block text-sm font-semibold text-(--text-primary) mb-2 group-focus-within:text-(--accent-color) transition-colors' }, [
        props.label,
        props.required ? h('span', { class: 'text-red-500' }, ' *') : null,
      ]),
      h('div', { class: 'flex gap-3' }, [
        h('div', { class: 'relative flex-1 min-w-0' }, [
          h('div', { class: 'absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none' }, [
            h('i', { class: `${props.icon} text-(--text-secondary)` }),
          ]),
          h('input', {
            value: props.modelValue,
            readonly: true,
            placeholder: 'Choose a file...',
            class: 'w-full pl-10 pr-4 py-3 bg-(--bg-secondary)/40 border border-(--border-color) rounded-xl text-(--text-primary) placeholder:text-(--text-secondary)/50 cursor-pointer focus:bg-(--bg-primary)/80 transition-colors shadow-sm truncate',
            onClick: () => emit('browse'),
          }),
        ]),
        h('button', {
          class: 'px-5 py-3 bg-(--bg-primary)/50 border border-(--border-color) text-(--text-primary) rounded-xl hover:bg-(--bg-secondary) hover:border-(--text-secondary) transition-colors font-medium cursor-pointer shadow-sm shrink-0',
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
    return () => h('div', { class: 'bg-(--bg-secondary)/20 rounded-2xl border border-(--border-color) overflow-hidden backdrop-blur-sm' }, [
      h('div', { class: 'px-6 py-4 border-b border-(--border-color)/60 flex items-center justify-between bg-(--bg-secondary)/40' }, [
        h('h3', { class: 'font-bold text-(--text-primary) flex items-center gap-2' }, [
          h('i', { class: `${props.icon} text-(--accent-color)` }),
          props.title,
        ]),
        h('button', {
          class: 'text-sm font-medium text-(--accent-color) hover:text-(--accent-color)/80 transition-colors px-3 py-1 rounded-md hover:bg-(--accent-color)/10 cursor-pointer',
          onClick: () => emit('edit'),
        }, 'Edit'),
      ]),
      h('div', { class: 'p-6 grid grid-cols-2 gap-y-6 gap-x-8' }, slots.default?.()),
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
      h('span', { class: 'text-[11px] font-semibold text-(--text-secondary) uppercase tracking-wider' }, props.label),
      h('p', {
        class: [
          'font-medium text-(--text-primary) mt-1.5 truncate',
          props.monospace ? 'font-mono text-sm bg-(--bg-primary)/60 p-2.5 rounded-lg border border-(--border-color)/50' : '',
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
</style>
