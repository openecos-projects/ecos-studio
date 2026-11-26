<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Dialog from 'primevue/dialog'
import { getWorkspaceRuntimeSnapshotApi } from '@/api/workspaceResources'
import { updateWorkspaceConfigurationApi } from '@/api/workspace'
import { toDesktopBridgeData } from '@/api/desktopPayload'
import { isFlowExecutionActiveForWorkspace } from '@/composables/useFlowRunner'
import { useWorkspaceLifecycle } from '@/composables/useWorkspaceLifecycle'
import StepConfigValueBlock from './step-config/StepConfigValueBlock.vue'

const props = defineProps<{ handle: string; directory: string; sessionId: string }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const lifecycle = useWorkspaceLifecycle()
const original = ref<Record<string, unknown>>({})
const draft = ref<Record<string, unknown>>({})
const selected = ref('')
const revision = ref<number>()
const busy = ref(false)
const error = ref('')
const primaryClockDefined = ref(false)
const frequencyFixed = computed(
  () => selected.value === 'design.frequency_mhz' && primaryClockDefined.value,
)
const locked = computed(() => isFlowExecutionActiveForWorkspace(props.directory))
const changes = computed(() =>
  Object.fromEntries(
    Object.entries(draft.value).filter(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(original.value[key]),
    ),
  ),
)
const dirty = computed(() => Object.keys(changes.value).length > 0)

onMounted(async () => {
  try {
    const snapshot = await getWorkspaceRuntimeSnapshotApi(props.handle)
    const parameters = snapshot.configuration?.workspaceSpec.parameters
    const version = snapshot.engineeringSnapshot?.workspaceRevision
    if (
      !parameters ||
      typeof parameters !== 'object' ||
      Array.isArray(parameters) ||
      typeof version !== 'number'
    ) {
      throw new Error(
        'Workspace parameters or revision unavailable. Reopen the workspace and try again.',
      )
    }
    // Step-qualified overrides remain owned by the step editor.
    const values = Object.fromEntries(
      Object.entries(parameters).filter(([key]) => !key.includes(':')),
    )
    original.value = values
    draft.value = structuredClone(values)
    const sdc = snapshot.parameters.sdc
    if (
      sdc &&
      typeof sdc === 'object' &&
      'primary_clocks' in sdc &&
      typeof sdc.primary_clocks === 'string'
    ) {
      primaryClockDefined.value = sdc.primary_clocks
        .split('\n')
        .some((line) => line.trim() && !line.trimStart().startsWith('#'))
    }
    selected.value =
      'design.frequency_mhz' in values
        ? 'design.frequency_mhz'
        : (Object.keys(values)[0] ?? '')
    revision.value = version
  } catch (cause) {
    error.value = String(cause)
  }
})

function close() {
  if (!busy.value && (!dirty.value || confirm('Discard unsaved configuration changes?')))
    emit('close')
}

async function save() {
  if (
    !dirty.value ||
    locked.value ||
    busy.value ||
    revision.value === undefined ||
    !lifecycle.isCurrentSession(props.sessionId)
  )
    return
  busy.value = true
  error.value = ''
  try {
    const result = await updateWorkspaceConfigurationApi({
      workspaceHandle: props.handle,
      expectedWorkspaceRevision: revision.value,
      commandId: crypto.randomUUID(),
      configuration: {
        design: {},
        pdk: {},
        parameters: toDesktopBridgeData(changes.value),
      },
    })
    if (!('workspaceRevision' in result) || typeof result.workspaceRevision !== 'number')
      throw new Error('Missing workspace revision after update.')
    lifecycle.updateWorkspaceRevision(result.workspaceRevision, props.sessionId)
    lifecycle.invalidate('all', { sessionId: props.sessionId })
    if (lifecycle.isCurrentSession(props.sessionId)) emit('saved')
  } catch (cause) {
    error.value = String(cause)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog
    visible
    modal
    header="Update Workspace"
    :style="{ width: 'min(640px, 94vw)' }"
    :draggable="false"
    @update:visible="close"
  >
    <p class="mb-3 text-sm text-(--text-secondary)">{{ directory }}</p>
    <p v-if="error" role="alert" class="mb-3 text-red-500">{{ error }}</p>
    <p v-if="locked" role="status">
      Configuration is read-only while the flow is running.
    </p>
    <template v-if="selected">
      <label class="block text-sm"
        >Workspace parameter
        <select
          v-model="selected"
          class="my-2 block w-full border border-(--border-color) bg-(--bg-primary) p-2"
        >
          <option v-for="key in Object.keys(draft).sort()" :key="key" :value="key">
            {{ key }}
          </option>
        </select>
      </label>
      <div v-if="frequencyFixed" class="py-2">
        <strong>{{ original[selected] }} MHz</strong>
        <p class="text-sm text-(--text-secondary)">
          Set by this workspace’s primary clock. To use another period, update the project
          timing input and create a workspace.
        </p>
      </div>
      <StepConfigValueBlock
        v-else
        :key="selected"
        v-model="draft[selected]"
        :path="selected"
        :readonly="busy || locked"
        :inert="busy || locked"
      />
    </template>
    <p v-else-if="!error">
      {{
        revision === undefined
          ? 'Loading workspace parameters…'
          : 'No workspace parameters.'
      }}
    </p>
    <div class="mt-4 flex justify-end gap-4">
      <button type="button" :disabled="busy" @click="close">Close</button>
      <button
        type="button"
        class="rounded bg-(--accent-color) px-3 py-1 text-white disabled:opacity-50"
        :disabled="!dirty || busy || locked"
        @click="save"
      >
        <i class="ri-save-line" /> Save changes
      </button>
    </div>
  </Dialog>
</template>
