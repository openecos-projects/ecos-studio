<template>
  <section
    v-if="request || contract"
    class="my-4 border border-(--border-color) bg-(--bg-secondary)/30 p-4"
  >
    <div class="mb-4 flex items-center justify-between gap-3">
      <div>
        <p class="text-xs font-semibold text-(--text-secondary)">NEW WORKSPACE</p>
        <h3 class="text-sm font-semibold text-(--text-primary)">{{ activeTitle }}</h3>
      </div>
      <span class="text-xs text-(--text-secondary)">{{ activeIndex }}/6</span>
    </div>

    <ol class="mb-4 grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
      <li
        v-for="(title, index) in stepTitles"
        :key="title"
        class="border px-2 py-1.5"
        :class="
          index + 1 === activeIndex
            ? 'border-(--accent-color) text-(--text-primary)'
            : 'border-(--border-color) text-(--text-secondary)'
        "
      >
        {{ index + 1 }}. {{ title }}
      </li>
    </ol>

    <div v-if="contract" class="space-y-3">
      <p class="text-sm text-(--text-secondary)">
        {{
          createSetupId === contract.setup_id
            ? 'The resolved six-step contract is ready. Creating the workspace does not start an ECC flow.'
            : 'The resolved contract is shown below. Confirm creation in chat to continue.'
        }}
      </p>
      <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-(--text-secondary)">
        <div>
          <dt>Design</dt>
          <dd class="text-(--text-primary)">{{ contract.parameters.design }}</dd>
        </div>
        <div>
          <dt>Flow</dt>
          <dd class="text-(--text-primary)">
            {{ contract.flow_config.start_step }} to {{ contract.flow_config.end_step }}
          </dd>
        </div>
        <div>
          <dt>PDK</dt>
          <dd class="text-(--text-primary)">{{ selectedPdk?.pdkId || '-' }}</dd>
        </div>
        <div>
          <dt>Workspace</dt>
          <dd class="text-(--text-primary)">{{ workspaceDirectory || '-' }}</dd>
        </div>
      </dl>
      <p v-if="error" class="text-xs text-red-500">{{ error }}</p>
    </div>

    <div
      v-else-if="request?.authority === 'agent_text'"
      class="text-sm text-(--text-secondary)"
    >
      Use the chat input to accept the recommended values or describe the changes for this
      step.
    </div>

    <div v-else-if="request?.step === 'project'" class="space-y-3">
      <div class="flex gap-2 text-sm">
        <label
          ><input v-model="projectMode" type="radio" value="select" /> Select
          project</label
        >
        <label
          ><input v-model="projectMode" type="radio" value="create" /> Create
          project</label
        >
      </div>
      <label class="block text-sm text-(--text-secondary)"
        >Project name
        <input
          v-model.trim="projectName"
          class="mt-1 w-full border border-(--border-color) bg-(--bg-primary) px-2 py-1.5 text-(--text-primary)"
        />
      </label>
      <div class="flex gap-2">
        <input
          :value="projectPickerPath"
          readonly
          class="min-w-0 flex-1 border border-(--border-color) bg-(--bg-primary) px-2 py-1.5 text-xs text-(--text-secondary)"
        />
        <button
          type="button"
          class="agent-workspace-action"
          :disabled="disabled"
          @click="pickProjectDirectory"
        >
          Browse
        </button>
      </div>
      <p v-if="error" class="text-xs text-red-500">{{ error }}</p>
      <button
        type="button"
        class="agent-workspace-action"
        :disabled="disabled"
        @click="completeProject"
      >
        Continue
      </button>
    </div>

    <div v-else-if="request?.step === 'design_files'" class="space-y-3">
      <p class="text-sm text-(--text-secondary)">
        Select inputs required by the configured flow start.
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="agent-workspace-action"
          :disabled="disabled"
          @click="pickRtlFiles"
        >
          RTL
        </button>
        <button
          type="button"
          class="agent-workspace-action"
          :disabled="disabled"
          @click="pickRtlDirectory"
        >
          RTL Folder
        </button>
        <button
          type="button"
          class="agent-workspace-action"
          :disabled="disabled"
          @click="pickDesignFile('filelist')"
        >
          Filelist
        </button>
        <button
          type="button"
          class="agent-workspace-action"
          :disabled="disabled"
          @click="pickDesignFile('def')"
        >
          DEF
        </button>
        <button
          type="button"
          class="agent-workspace-action"
          :disabled="disabled"
          @click="pickDesignFile('verilog')"
        >
          Verilog
        </button>
        <button
          type="button"
          class="agent-workspace-action"
          :disabled="disabled"
          @click="pickDesignFile('sdc')"
        >
          SDC
        </button>
      </div>
      <p class="text-xs text-(--text-secondary)">{{ designSummary }}</p>
      <p v-if="error" class="text-xs text-red-500">{{ error }}</p>
      <button
        type="button"
        class="agent-workspace-action"
        :disabled="disabled"
        @click="completeDesignFiles"
      >
        Continue
      </button>
    </div>

    <div v-else-if="request?.step === 'pdk'" class="space-y-3">
      <div class="flex gap-2">
        <select
          v-model="selectedPdkId"
          class="min-w-0 flex-1 border border-(--border-color) bg-(--bg-primary) px-2 py-1.5 text-sm text-(--text-primary)"
        >
          <option value="">Select PDK</option>
          <option v-for="pdk in matchingPdks" :key="pdk.id" :value="pdk.id">
            {{ pdk.name }}
          </option>
        </select>
        <button
          type="button"
          class="agent-workspace-action"
          :disabled="disabled"
          @click="importSelectedPdk"
        >
          Import PDK
        </button>
      </div>
      <div class="flex gap-2 text-sm">
        <label
          ><input v-model="pdkConfigMode" type="radio" value="default" /> Default
          resources</label
        >
        <label
          ><input v-model="pdkConfigMode" type="radio" value="manual" /> Manual
          resources</label
        >
      </div>
      <div v-if="pdkConfigMode === 'manual'" class="flex flex-wrap gap-2">
        <button
          type="button"
          class="agent-workspace-action"
          :disabled="disabled"
          @click="pickPdkResource('tech_lef')"
        >
          Tech LEF
        </button>
        <button
          type="button"
          class="agent-workspace-action"
          :disabled="disabled"
          @click="pickPdkResource('cell_lef')"
        >
          Cell LEF
        </button>
        <button
          type="button"
          class="agent-workspace-action"
          :disabled="disabled"
          @click="pickPdkResource('liberty')"
        >
          Liberty
        </button>
      </div>
      <p class="text-xs text-(--text-secondary)">{{ pdkSummary }}</p>
      <p v-if="error" class="text-xs text-red-500">{{ error }}</p>
      <button
        type="button"
        class="agent-workspace-action"
        :disabled="disabled"
        @click="completePdk"
      >
        Continue
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  DesktopAgentWorkspaceSetupContract,
  DesktopAgentWorkspaceSetupStepRequest,
  DesktopAgentWorkspaceSetupStepResponse,
} from '@ecos-studio/shared'
import type { WorkspaceConfig } from '@/types'
import { getDesktopApi } from '@/platform/desktop'
import { usePdkManager } from '@/composables/usePdkManager'

type PdkResource = 'tech_lef' | 'cell_lef' | 'liberty'

const props = defineProps<{
  contract?: DesktopAgentWorkspaceSetupContract
  createSetupId?: string
  disabled?: boolean
  request?: DesktopAgentWorkspaceSetupStepRequest
}>()
const emit = defineEmits<{
  completeHostStep: [response: DesktopAgentWorkspaceSetupStepResponse]
  createWorkspace: [config: WorkspaceConfig]
}>()

const stepTitles = [
  'Project Setup',
  'Basic Info',
  'Flow Setup',
  'Design Files',
  'PDK Config',
  'Spec Setting',
]
const stepIndices = { project: 1, basic: 2, flow: 3, design_files: 4, pdk: 5, spec: 6 }
const { importedPdks, importPdk, loadPdks } = usePdkManager()
const error = ref('')
const projectMode = ref<'select' | 'create'>('create')
const projectName = ref('')
const selectedProjectRoot = ref('')
const projectParentPath = ref('')
const rtlList = ref<string[]>([])
const filelist = ref('')
const originDef = ref('')
const originVerilog = ref('')
const sdc = ref('')
const selectedPdkId = ref('')
const pdkConfigMode = ref<'default' | 'manual'>('default')
const pdkResources = ref<Record<PdkResource, string[]>>({
  tech_lef: [],
  cell_lef: [],
  liberty: [],
})

const selectedPdk = computed(() =>
  importedPdks.value.find((pdk) => pdk.id === selectedPdkId.value),
)
const expectedPdk = computed(() =>
  String(props.contract?.pdk || props.request?.defaults.pdk || 'ics55'),
)
const matchingPdks = computed(() =>
  importedPdks.value.filter((pdk) => pdk.pdkId === expectedPdk.value),
)
const activeIndex = computed(() => {
  if (props.contract) return 6
  return props.request ? stepIndices[props.request.step] : 1
})
const activeTitle = computed(() => stepTitles[activeIndex.value - 1])
const projectRoot = computed(() =>
  projectMode.value === 'select'
    ? selectedProjectRoot.value
    : joinPath(projectParentPath.value, projectName.value),
)
const projectPickerPath = computed(() =>
  projectMode.value === 'select' ? selectedProjectRoot.value : projectParentPath.value,
)
const workspaceName = computed(
  () =>
    props.contract?.suggested_workspace_name || props.contract?.parameters.design || '',
)
const workspaceDirectory = computed(() =>
  joinPath(projectRoot.value, workspaceName.value),
)
const designStart = computed(() =>
  String(
    props.request?.defaults.flow_start ||
      props.contract?.flow_config.start_step ||
      'Synthesis',
  ),
)
const designReady = computed(() => {
  if (designStart.value === 'Synthesis')
    return rtlList.value.length > 0 || Boolean(filelist.value)
  if (designStart.value === 'Floorplan') return Boolean(originVerilog.value)
  return Boolean(originDef.value && originVerilog.value)
})
const designSummary = computed(
  () =>
    `RTL ${rtlList.value.length}, filelist ${filelist.value ? 'selected' : '-'}, DEF ${originDef.value ? 'selected' : '-'}, Verilog ${originVerilog.value ? 'selected' : '-'}, SDC ${sdc.value ? 'selected' : '-'}`,
)
const pdkReady = computed(
  () =>
    selectedPdk.value?.pdkId === expectedPdk.value &&
    (pdkConfigMode.value === 'default' ||
      Object.values(pdkResources.value).every((files) => files.length > 0)),
)
const pdkSummary = computed(() =>
  selectedPdk.value
    ? `${selectedPdk.value.pdkId}: ${pdkConfigMode.value}`
    : 'No PDK selected',
)

watch(
  () => props.request?.setup_id,
  (setupId, previous) => {
    if (!setupId || setupId === previous) return
    resetHostDraft()
    projectName.value = String(props.request?.defaults.project_name || '')
  },
  { immediate: true },
)
watch(
  () => props.request?.step,
  (step) => {
    error.value = ''
    if (step === 'pdk') void loadPdks()
  },
  { immediate: true },
)
watch(
  () => props.createSetupId,
  (setupId) => {
    if (setupId && setupId === props.contract?.setup_id) createWorkspace()
  },
)

async function pickProjectDirectory(): Promise<void> {
  const path = await getDesktopApi().dialog.pickDirectory({
    title:
      projectMode.value === 'select'
        ? 'Select Project Root'
        : 'Select Project Parent Path',
  })
  if (!path) return
  if (projectMode.value === 'select') {
    selectedProjectRoot.value = normalizePath(path)
    projectName.value = basename(path)
  } else projectParentPath.value = normalizePath(path)
}

async function pickRtlFiles(): Promise<void> {
  const result = await getDesktopApi().dialog.pickRtlSources({
    multiple: true,
    title: 'Select RTL Design Files',
  })
  if (!result) return
  rtlList.value = unique([...rtlList.value, ...result.files.filter(isHdlFile)])
}

async function pickRtlDirectory(): Promise<void> {
  const directory = await getDesktopApi().dialog.pickDirectory({
    title: 'Select RTL Design Folder',
  })
  if (!directory) return
  const result = await getDesktopApi().workspace.scanRtlDirectory(directory)
  rtlList.value = unique([...rtlList.value, ...result.files.filter(isHdlFile)])
}

async function pickDesignFile(
  kind: 'filelist' | 'def' | 'verilog' | 'sdc',
): Promise<void> {
  const filters = {
    filelist: ['f', 'fl', 'flist', 'filelist', 'lst', 'txt', 'gz'],
    def: ['def', 'gz'],
    verilog: ['v', 'sv', 'vg', 'gz'],
    sdc: ['sdc', 'gz'],
  }
  const paths = await getDesktopApi().dialog.pickFiles({
    multiple: false,
    title: `Select ${kind.toUpperCase()}`,
    filters: [{ name: kind.toUpperCase(), extensions: filters[kind] }],
  })
  const path = paths?.[0]
  if (!path) return
  if (kind === 'filelist') filelist.value = path
  if (kind === 'def') originDef.value = path
  if (kind === 'verilog') originVerilog.value = path
  if (kind === 'sdc') sdc.value = path
}

async function importSelectedPdk(): Promise<void> {
  const pdk = await importPdk()
  if (!pdk) return
  if (pdk.pdkId !== expectedPdk.value) {
    showError(`This contract requires the ${expectedPdk.value} PDK.`)
    return
  }
  selectedPdkId.value = pdk.id
}

async function pickPdkResource(kind: PdkResource): Promise<void> {
  const extensions = kind === 'liberty' ? ['lib', 'liberty'] : ['lef']
  const paths = await getDesktopApi().dialog.pickFiles({
    multiple: true,
    title: `Select ${kind}`,
    filters: [{ name: kind, extensions }],
  })
  if (paths) pdkResources.value[kind] = unique(paths)
}

function completeProject(): void {
  if (!projectRoot.value || !projectName.value)
    return showError('Select a project directory and provide a project name.')
  completeHostStep('project')
}

function completeDesignFiles(): void {
  if (!designReady.value)
    return showError('Select the required design input for the configured flow start.')
  completeHostStep('design_files')
}

function completePdk(): void {
  if (!pdkReady.value)
    return showError('Select a PDK and complete its resource configuration.')
  completeHostStep('pdk')
}

function completeHostStep(step: DesktopAgentWorkspaceSetupStepResponse['step']): void {
  if (!props.request || props.request.step !== step) return
  error.value = ''
  emit('completeHostStep', {
    schema_version: 'flow-agent.workspace_setup_step_response.v1',
    setup_id: props.request.setup_id,
    step,
  })
}

function createWorkspace(): void {
  const contract = props.contract
  if (!contract || props.createSetupId !== contract.setup_id) return
  if (
    !projectRoot.value ||
    !designReady.value ||
    !pdkReady.value ||
    !workspaceDirectory.value
  )
    return showError(
      'Complete the required host configuration before creating the workspace.',
    )
  const parameters = contract.parameters
  if (!parameters.design || !parameters.top_module || !parameters.clock)
    return showError(
      'The resolved spec is incomplete. Describe the missing values in chat before confirming.',
    )
  emit('createWorkspace', {
    design_input_mode: designStart.value === 'Synthesis' ? 'rtl' : 'post_synthesis',
    directory: workspaceDirectory.value,
    filelist: filelist.value || undefined,
    flow_config: contract.flow_config,
    origin_def: originDef.value,
    origin_verilog: originVerilog.value,
    parameters: { ...parameters },
    pdk: selectedPdk.value?.pdkId || '',
    pdk_config: { mode: pdkConfigMode.value, ...pdkResources.value },
    pdk_config_mode: pdkConfigMode.value,
    pdk_root: selectedPdk.value?.path || '',
    project_context: {
      mode: projectMode.value,
      project_name: projectName.value,
      project_root: projectRoot.value,
      project_json_path: joinPath(projectRoot.value, 'project.json'),
    },
    rtl_list: [...rtlList.value],
    sdc: sdc.value || undefined,
  })
}

function resetHostDraft(): void {
  error.value = ''
  projectMode.value = 'create'
  projectName.value = ''
  selectedProjectRoot.value = ''
  projectParentPath.value = ''
  rtlList.value = []
  filelist.value = ''
  originDef.value = ''
  originVerilog.value = ''
  sdc.value = ''
  selectedPdkId.value = ''
  pdkConfigMode.value = 'default'
  pdkResources.value = { tech_lef: [], cell_lef: [], liberty: [] }
}
function showError(message: string): void {
  error.value = message
}
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}
function joinPath(...parts: string[]): string {
  return parts.map(normalizePath).filter(Boolean).join('/')
}
function basename(path: string): string {
  return normalizePath(path).split('/').filter(Boolean).pop() || ''
}
function unique(paths: string[]): string[] {
  return [...new Set(paths.filter(Boolean))]
}
function isHdlFile(path: string): boolean {
  return /\.(v|sv|vhd|vhdl)(\.gz)?$/i.test(path)
}
</script>

<style scoped>
.agent-workspace-action {
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  padding: 0.375rem 0.625rem;
  font-size: 0.75rem;
  color: var(--text-primary);
}
.agent-workspace-action:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
